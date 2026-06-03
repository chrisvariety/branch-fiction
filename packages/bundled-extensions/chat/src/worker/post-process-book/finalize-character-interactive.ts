import { Agent } from '@earendil-works/pi-agent-core';
import { encode } from '@stablelib/base64';
import dedent from 'dedent';
import { Jimp } from 'jimp';
import { v7 as uuidv7 } from 'uuid';

import { BookInteractive } from '@/lib/db/types';
import { UnrecoverableError } from '@/lib/error-types';
import {
  createLookupRelatedEntityAppearanceTool,
  getRelatedEntitiesFromArcs
} from '@/lib/lit/related-entities';
import { watchAgent } from '@/lib/llm/agent';
import { getText, parse, querySelector } from '@/lib/llm/xml';
import {
  cropToPolygon,
  expandBoundingBox,
  getBoundingBox,
  makeSquare
} from '@/lib/media/bounding-box';
import { segmentAndFilter } from '@/lib/media/character-crops';
import { debugImage } from '@/lib/media/debug';
import { generateOneShotImage } from '@/lib/media/generate-one-shot-image';
import { detectHeadsWithFallback } from '@/lib/media/head';
import { assemblePrompt, type StructuredPrompt } from '@/lib/media/image-models';
import { createNumberedOverlayImage } from '@/lib/media/numbered-overlay';
import { buildAssetUrl, parseAssetUrl } from '@/lib/media/transform-url';
import characterFullBodyPrompt from '@/lib/prompts/interactive/character-full-body';
import { getDb } from '@/worker/db';
import { updateBookInteractiveEntityById } from '@/worker/db/models/book-interactive-entity/update-book-interactive-entity';
import {
  getBookInteractiveByIdSlim,
  getBookInteractiveWithEntitiesById
} from '@/worker/db/models/book-interactive/get-book-interactive';
import { promoteBookInteractive } from '@/worker/db/models/book-interactive/update-book-interactive';
import { getBookById } from '@/worker/db/models/book/get-book';
import { getCharacterRefsByBookIdAndCharacterIds } from '@/worker/db/models/character-ref/get-character-ref';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/worker/handler';
import { getProvider, getSegmentationProvider } from '@/worker/providers';

export const handler = createWorkflowFunction<
  {
    bookId: string;
    interactiveId: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    interactive: {
      id: string;
      type: BookInteractive['type'];
      url: string | null;
    };
  },
  { bookId: string; entitiesProcessed: number }
>(
  {
    name: ({ book }, retryCount) =>
      `Finalize Character Interactive ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId, interactiveId }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');

      // Get the interactive
      const interactive = await getBookInteractiveByIdSlim(interactiveId);

      if (!interactive) {
        throw new UnrecoverableError('Interactive not found');
      }

      if (
        interactive.type !== 'CHARACTER_VERTICAL' &&
        interactive.type !== 'CHARACTER_HORIZONTAL' &&
        interactive.type !== 'CHARACTER_SIMPLE'
      ) {
        throw new UnrecoverableError('Incorrect interactive type (expected CHARACTER_*)');
      }

      return { book, interactive };
    },
    check: async (_payload, result) => ({
      passed: result.entitiesProcessed > 0,
      metadata: { entitiesProcessed: result.entitiesProcessed }
    })
  },
  async ({ book, interactive }, ctx) => {
    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title,
        interactiveId: interactive.id,
        interactiveType: interactive.type
      })
      .info('Starting finalize character interactive');

    // Fetch the interactive entities
    const interactiveWithEntities = await getBookInteractiveWithEntitiesById(
      interactive.id
    );

    if (!interactiveWithEntities) {
      throw new UnrecoverableError(
        `No interactive found for book ${book.id} with type ${interactive.type}`
      );
    }

    if (
      !interactiveWithEntities.bookInteractiveEntities ||
      interactiveWithEntities.bookInteractiveEntities.length === 0
    ) {
      ctx.log.info('No interactive entities found');
      return {
        bookId: book.id,
        entitiesProcessed: 0
      };
    }

    ctx.log
      .withMetadata({
        entityCount: interactiveWithEntities.bookInteractiveEntities.length
      })
      .info('Found interactive entities to process');

    // CHARACTER_SIMPLE interactives have no composite image or clickAreas — each
    // entity's reference headshot is used as the crop source instead.
    const isSimple = interactive.type === 'CHARACTER_SIMPLE';

    const characterIds = interactiveWithEntities.bookInteractiveEntities
      .map((e) => e.bookEntity?.id)
      .filter((id): id is string => !!id);
    const refByCharacterId = new Map(
      (await getCharacterRefsByBookIdAndCharacterIds(book.id, characterIds)).map((r) => [
        r.characterId,
        r
      ])
    );

    let compositeJimpImage: Awaited<ReturnType<typeof Jimp.read>> | null = null;
    if (!isSimple) {
      const interactiveUrl = interactive.url;
      if (!interactiveUrl) {
        throw new UnrecoverableError('Interactive missing url');
      }
      ctx.log.withMetadata({ interactiveUrl }).info('Fetching interactive image');
      const compositeImageBytes = await ctx.fs.read(
        parseAssetUrl(interactiveUrl).relPath
      );

      compositeJimpImage = await Jimp.read(compositeImageBytes.slice().buffer);

      // Debug: show all clickAreas overlaid on composite image
      const overlayItems = interactiveWithEntities.bookInteractiveEntities
        .filter((e) => e.bookEntity && e.clickArea && e.clickArea.length)
        .map((e, idx) => ({
          points: e.clickArea!,
          number: idx + 1,
          label: e.bookEntity!.name
        }));

      const overlayImage = await createNumberedOverlayImage(
        compositeJimpImage.clone(),
        overlayItems
      );
      await debugImage(overlayImage, 'Interactive Entities ClickAreas');
    }

    // Process each interactive entity and collect results
    const results: Array<{
      bookInteractiveEntityId: string;
      imageUrl: string | null;
      headImageUrl: string | null;
      croppedImageUrl: string | null;
    }> = [];

    for (const interactiveEntity of interactiveWithEntities.bookInteractiveEntities) {
      if (!interactiveEntity.bookEntity) {
        ctx.log
          .withMetadata({ interactiveEntityId: interactiveEntity.id })
          .warn('Skipping entity without bookEntity');
        continue;
      }

      // In non-simple mode the clickArea is required (we crop the composite).
      // In simple mode we fall back to the character's reference headshot.
      if (!isSimple && !interactiveEntity.clickArea) {
        ctx.log
          .withMetadata({ interactiveEntityId: interactiveEntity.id })
          .warn('Skipping non-simple entity without clickArea');
        continue;
      }

      // Extract bookEntity after null check for type narrowing
      const bookEntity = interactiveEntity.bookEntity;

      // Check if full body reference already exists before doing expensive operations
      const key = `book-interactive-entities/${interactiveEntity.id}`;
      const headKey = `book-interactive-entities/${interactiveEntity.id}-head`;
      const imageUrl = buildAssetUrl(key, 'image/png');
      const exists = await ctx.fs
        .read(parseAssetUrl(imageUrl).relPath)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        ctx.log
          .withMetadata({
            entityId: bookEntity.id,
            name: bookEntity.name,
            url: imageUrl
          })
          .info('Full body reference already exists, skipping');
        results.push({
          bookInteractiveEntityId: interactiveEntity.id,
          imageUrl,
          headImageUrl: null,
          croppedImageUrl: null
        });
        continue;
      }

      let croppedBase64: string;
      if (isSimple) {
        // Use the character's reference headshot as the crop source.
        const ref = refByCharacterId.get(bookEntity.id);
        if (!ref) {
          ctx.log
            .withMetadata({ name: bookEntity.name })
            .warn('Simple entity has no reference image, skipping');
          continue;
        }
        let refImageBytes: Uint8Array;
        try {
          refImageBytes = await ctx.fs.read(parseAssetUrl(ref.imageUrl).relPath);
        } catch {
          ctx.log
            .withMetadata({ name: bookEntity.name, url: ref.imageUrl })
            .warn('Failed to fetch reference headshot, skipping');
          continue;
        }
        croppedBase64 = encode(refImageBytes);
      } else {
        const croppedImage = cropToPolygon(
          compositeJimpImage!,
          interactiveEntity.clickArea!
        );
        const croppedBuffer = await croppedImage.getBuffer('image/png');
        croppedBase64 = encode(croppedBuffer);
      }

      await debugImage(croppedBase64, `Full Body Reference Input: ${bookEntity.name}`);

      // In simple mode the scene-derived refined description doesn't exist yet —
      // fall back to the canonical book entity description.
      const characterDescription =
        interactiveEntity.description ?? bookEntity.description;
      if (!characterDescription) {
        ctx.log
          .withMetadata({ name: bookEntity.name })
          .warn('No description found on interactive entity or book entity, skipping');
        continue;
      }

      // Get related entities from RELATED_RELATIONSHIP arcs
      const relatedEntitiesResult = await getRelatedEntitiesFromArcs({
        bookId: book.id,
        bookEntityIds: [bookEntity.id],
        searchTextForMentions: characterDescription
      });

      ctx.log
        .withMetadata({
          name: bookEntity.name,
          relatedCount: relatedEntitiesResult.entities.length
        })
        .info('Found related entities for character');

      const {
        description: enhancedDescription,
        aspectRatio,
        pose
      } = await extractCharacterDescription(
        {
          croppedBase64,
          bookId: book.id,
          bookEntity: {
            ...bookEntity,
            description: characterDescription
          },
          segmentClass: interactiveEntity.segmentClass,
          relatedEntities:
            relatedEntitiesResult.entities.length > 0
              ? relatedEntitiesResult.entities
              : undefined,
          contextEntityIds: relatedEntitiesResult.contextEntityIds
        },
        ctx
      );

      ctx.log
        .withMetadata({
          name: bookEntity.name,
          originalDescription: characterDescription,
          enhancedDescription
        })
        .info('Character description enhancement');

      const cropKey = `book-interactive-entities/${interactiveEntity.id}-crop`;
      const result = await generateFullBodyReference(
        {
          croppedBase64,
          key,
          headKey,
          cropKey,
          entity: bookEntity,
          characterDescription: enhancedDescription,
          segmentClass: interactiveEntity.segmentClass,
          aspectRatio,
          pose
        },
        ctx
      );

      results.push({
        bookInteractiveEntityId: interactiveEntity.id,
        imageUrl: result.fullBodyImageUrl,
        headImageUrl: result.headImageUrl,
        croppedImageUrl: result.croppedImageUrl
      });
    }

    // Update all interactive entities and clean up old interactives in a transaction
    const successfulUpdates = results.filter(
      (r) => r.imageUrl || r.headImageUrl || r.croppedImageUrl
    );

    await getDb()
      .transaction()
      .execute(async (trx) => {
        for (const {
          bookInteractiveEntityId,
          imageUrl,
          headImageUrl,
          croppedImageUrl
        } of successfulUpdates) {
          await updateBookInteractiveEntityById(
            bookInteractiveEntityId,
            {
              ...(imageUrl && { imageUrl }),
              ...(headImageUrl && { headImageUrl }),
              ...(croppedImageUrl && { croppedImageUrl })
            },
            trx
          );
        }

        // Promote this interactive to active (archives the previous active one)
        await promoteBookInteractive(book.id, interactive.type, interactive.id, trx);
      });

    if (successfulUpdates.length > 0) {
      ctx.log
        .withMetadata({
          bookId: book.id,
          updatedCount: successfulUpdates.length
        })
        .info('Updated book interactive entities with reference images');
    }

    ctx.log
      .withMetadata({ bookId: book.id, processedCount: results.length })
      .info('Completed full body reference generation');

    return {
      bookId: book.id,
      entitiesProcessed: successfulUpdates.length
    };
  }
);

async function extractCharacterDescription(
  {
    croppedBase64,
    bookId,
    bookEntity,
    segmentClass,
    relatedEntities,
    contextEntityIds
  }: {
    croppedBase64: string;
    bookId: string;
    bookEntity: {
      name: string;
      description: string | null;
      pronouns: string | null;
    };
    segmentClass: string;
    relatedEntities?: {
      friendlyId: string;
      name: string;
      type: string;
      summary: string;
      phrasesUsed?: string;
    }[];
    contextEntityIds: string[];
  },
  ctx: WorkflowContext
): Promise<{
  description: string;
  aspectRatio: '3:4' | '9:16' | '1:1';
  pose: string;
}> {
  const { model, apiKey, reasoning } = ctx.getPiModel('text');
  const agent = new Agent({
    sessionId: uuidv7(),
    initialState: {
      model,
      thinkingLevel: reasoning,
      tools: [
        createLookupRelatedEntityAppearanceTool(
          bookId,
          contextEntityIds,
          'appearance',
          `complete visual appearance as it relates to ${bookEntity.name}, in a few concise sentences. Focus on physical details visible from head to toe — materials, colors, construction, and how the entity is worn, carried, or attached. Prioritize describing how this entity appears on ${bookEntity.name} specifically if that information is available. If the data describes this entity as it appears on multiple different characters, write a generalized description of its common form and note any variation in how it manifests.`,
          ctx
        )
      ]
    },
    getApiKey: () => apiKey
  });

  const watcher = watchAgent(agent, ctx, 'character');

  const promptText = characterFullBodyPrompt.render({
    character: {
      name: bookEntity.name,
      segmentClass,
      pronouns: bookEntity.pronouns,
      description: bookEntity.description
    },
    relatedEntities: relatedEntities?.length ? relatedEntities : undefined
  });

  ctx.log
    .withMetadata({ name: bookEntity.name, prompt: promptText })
    .info('Extracting character description');

  try {
    await agent.prompt(promptText, [
      { type: 'image', data: croppedBase64, mimeType: 'image/png' }
    ]);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      ctx.log.warn('Extract character description aborted');
    } else {
      throw e;
    }
  }

  if (agent.state.errorMessage) {
    ctx.log.warn(`Agent ended with error: ${agent.state.errorMessage}`);
  }

  const responseText = watcher.xml;

  ctx.log
    .withMetadata({ name: bookEntity.name, response: responseText })
    .info('Received character description response');

  if (!responseText) {
    ctx.log
      .withMetadata({ name: bookEntity.name })
      .warn('No character found in response');
    throw new Error(`Failed to extract character description for ${bookEntity.name}`);
  }

  const ast = parse(responseText);
  const description = getText(querySelector(ast, 'character > description')).trim();
  const rawAspectRatio = getText(querySelector(ast, 'character > aspect_ratio')).trim();
  const aspectRatio: '3:4' | '9:16' | '1:1' =
    rawAspectRatio === '3:4' || rawAspectRatio === '9:16' || rawAspectRatio === '1:1'
      ? rawAspectRatio
      : '3:4';
  const pose =
    getText(querySelector(ast, 'character > pose')).trim() ||
    'standing in a neutral, relaxed position';

  if (!description) {
    ctx.log
      .withMetadata({ name: bookEntity.name, xml: responseText })
      .warn('Empty character description content');
    throw new Error(`Empty character description for ${bookEntity.name}`);
  }

  ctx.log
    .withMetadata({
      name: bookEntity.name,
      aspectRatio,
      pose,
      description,
      originalDescription: bookEntity.description
    })
    .info('Extracted character description');

  return { description, aspectRatio, pose };
}

/**
 * Generate a full body reference image for a character entity.
 * Crops the character from the source image and uses an LLM to generate
 * a full body neutral pose on a white background.
 * Saves to R2 and returns the URLs (does not update database).
 */
async function generateFullBodyReference(
  {
    croppedBase64,
    key,
    headKey,
    cropKey,
    entity,
    characterDescription,
    segmentClass,
    aspectRatio,
    pose
  }: {
    croppedBase64: string;
    key: string;
    headKey: string;
    cropKey: string;
    entity: {
      id: string;
      name: string;
    };
    characterDescription: string;
    segmentClass: string;
    aspectRatio: '3:4' | '9:16' | '1:1';
    pose: string;
  },
  ctx: WorkflowContext
): Promise<{
  fullBodyImageUrl: string | null;
  headImageUrl: string | null;
  croppedImageUrl: string | null;
}> {
  ctx.log
    .withMetadata({ entityId: entity.id, name: entity.name, key })
    .info('Generating full body reference');

  const prompt: StructuredPrompt = {
    prefix: 'Create a full body image based on the reference image of this character.',
    content: [
      `CHARACTER: ${entity.name}`,
      `CHARACTER DETAILS: ${characterDescription}`,
      `POSE: ${pose}`
    ].join('\n'),
    suffix: dedent`
      REQUIREMENTS:
      - Show the complete character from head to toe in the pose described above
      - Use a neutral background
      - Maintain the EXACT same appearance, clothing, colors, and art style as shown in the reference image. If the character details and the reference image conflict, prioritize the reference image - the character details are to fill in the blanks where the reference image is missing details.
      - Do NOT include any props, weapons, or objects in the character's hands - hands should be empty. If CHARACTER DETAILS or POSE contain conflicting information (e.g. describing the character holding something), prioritize this instruction and generate the full body image without the prop/weapon/object.
    `
  };

  ctx.log
    .withMetadata({
      entityId: entity.id,
      name: entity.name,
      base64Length: croppedBase64.length
    })
    .info('Full body reference prompt');

  await debugImage(croppedBase64, `Full Body Gen Input: ${entity.name}`);

  const { data: imageData, mimeType } = await generateOneShotImage(
    getProvider('image_generation_reference'),
    {
      prompt: assemblePrompt(prompt),
      refImages: [{ data: croppedBase64, mimeType: 'image/png' }],
      aspectRatio
    }
  );

  await debugImage(encode(imageData), `Full Body Reference Output: ${entity.name}`);

  const fullBodyImageUrl = buildAssetUrl(key, mimeType);
  await ctx.fs.write(parseAssetUrl(fullBodyImageUrl).relPath, imageData);

  ctx.log
    .withMetadata({ entityId: entity.id, url: fullBodyImageUrl })
    .info('Generated and saved full body reference');

  // Now detect the head and create a square cropped image
  const headImageUrl = await extractAndSaveHeadImage(imageData, headKey, entity, ctx);

  if (headImageUrl) {
    ctx.log
      .withMetadata({ entityId: entity.id, headImageUrl })
      .info('Generated head reference image');
  }

  // Segment the full body image and crop the character out
  const croppedImageUrl = await extractAndSaveCroppedImage(
    imageData,
    cropKey,
    segmentClass,
    entity,
    ctx
  );

  if (croppedImageUrl) {
    ctx.log
      .withMetadata({ entityId: entity.id, croppedImageUrl })
      .info('Generated cropped character image');
  }

  return {
    fullBodyImageUrl,
    headImageUrl,
    // fallback to full body image if cropped image fails
    // this is for more abstract characters like Full Land where the characters are geometric shapes
    // the full body image only contains the single character anyway, there
    croppedImageUrl: croppedImageUrl ?? fullBodyImageUrl
  };
}

/**
 * Extract the head from a full body image and save it as a square cropped image.
 * Tries to detect 'head and shoulders' first, then 'head', falls back to 'body'.
 * Returns the R2 URL of the saved image, or null if detection fails.
 */
async function extractAndSaveHeadImage(
  fullBodyImageData: Uint8Array,
  key: string,
  entity: {
    id: string;
    name: string;
  },
  ctx: WorkflowContext
): Promise<string | null> {
  ctx.log
    .withMetadata({ entityId: entity.id, name: entity.name })
    .info('Extracting head from full body image');

  const validPredictions = await detectHeadsWithFallback(
    getSegmentationProvider(),
    fullBodyImageData,
    ctx
  );

  if (validPredictions.length === 0) {
    ctx.log.withMetadata({ entityId: entity.id }).warn('No valid head predictions found');
    return null;
  }

  // Use the first (typically largest) valid prediction
  const bestPrediction = validPredictions[0];

  // Get the bounding box, expand by 10%, then make it square
  const bbox = getBoundingBox(bestPrediction.points);
  const expandedBbox = expandBoundingBox(bbox, 0.1);
  const squareBbox = makeSquare(expandedBbox);

  ctx.log
    .withMetadata({
      entityId: entity.id,
      originalBbox: bbox,
      expandedBbox,
      squareBbox
    })
    .info('Calculated square bounding box with padding');

  // Load the full body image and crop to the square bounding box
  const fullBodyJimp = await Jimp.read(fullBodyImageData.slice().buffer);

  // Clamp to image bounds
  const clampedBbox = {
    x: Math.max(0, squareBbox.x),
    y: Math.max(0, squareBbox.y),
    width: Math.min(squareBbox.width, fullBodyJimp.width - Math.max(0, squareBbox.x)),
    height: Math.min(squareBbox.height, fullBodyJimp.height - Math.max(0, squareBbox.y))
  };

  const croppedHead = fullBodyJimp.clone().crop({
    x: clampedBbox.x,
    y: clampedBbox.y,
    w: clampedBbox.width,
    h: clampedBbox.height
  });

  const croppedBuffer = await croppedHead.getBuffer('image/png');
  const croppedData = new Uint8Array(croppedBuffer);

  await debugImage(encode(croppedBuffer), `Head Reference: ${entity.name}`);

  const url = buildAssetUrl(key, 'image/png');
  await ctx.fs.write(parseAssetUrl(url).relPath, croppedData);

  ctx.log.withMetadata({ entityId: entity.id, url }).info('Saved head reference image');

  return url;
}

/**
 * Segment the full body image to find the character, crop to the bounding box
 * of the detected polygon, and save to R2.
 * Returns the R2 URL of the cropped image, or null if segmentation fails.
 */
async function extractAndSaveCroppedImage(
  fullBodyImageData: Uint8Array,
  key: string,
  segmentClass: string,
  entity: {
    id: string;
    name: string;
  },
  ctx: WorkflowContext
): Promise<string | null> {
  ctx.log
    .withMetadata({ entityId: entity.id, name: entity.name, segmentClass })
    .info('Segmenting full body image for character crop');

  const { predictions } = await segmentAndFilter(
    getSegmentationProvider(),
    fullBodyImageData,
    segmentClass,
    ctx
  );

  if (predictions.length === 0) {
    ctx.log
      .withMetadata({ entityId: entity.id })
      .warn('No predictions found when segmenting full body image');
    return null;
  }

  // Pick the largest prediction by bounding box area
  const bestPrediction = predictions.reduce((best, p) =>
    p.width * p.height > best.width * best.height ? p : best
  );

  const fullBodyJimp = await Jimp.read(fullBodyImageData.slice().buffer);
  const cropped = cropToPolygon(fullBodyJimp, bestPrediction.points);
  const croppedBuffer = await cropped.getBuffer('image/png');

  await debugImage(encode(croppedBuffer), `Cropped Character: ${entity.name}`);

  const imageUrl = buildAssetUrl(key, 'image/png');
  await ctx.fs.write(parseAssetUrl(imageUrl).relPath, new Uint8Array(croppedBuffer));

  ctx.log
    .withMetadata({ entityId: entity.id, url: imageUrl })
    .info('Saved cropped character image');

  return imageUrl;
}
