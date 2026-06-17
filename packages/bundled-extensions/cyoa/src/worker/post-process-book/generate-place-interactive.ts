import {
  getAttribute,
  getInnerHtml,
  getText,
  parse,
  querySelector,
  querySelectorAll
} from '@branch-fiction/extension-sdk/llm/xml';
import { resolveArtStyle } from '@branch-fiction/extension-sdk/media/art-style';
import { generateOneShotImage } from '@branch-fiction/extension-sdk/media/generate-one-shot-image';
import {
  assemblePrompt,
  type StructuredPrompt
} from '@branch-fiction/extension-sdk/media/image-models';
import {
  buildAssetUrl,
  parseAssetUrl
} from '@branch-fiction/extension-sdk/media/transform-url';
import { completeOrThrow, getAssistantText } from '@branch-fiction/extension-sdk/pi-ai';
import {
  RecoverableError,
  UnrecoverableError
} from '@branch-fiction/extension-sdk/worker/error-types';
import { encode } from '@stablelib/base64';
import dedent from 'dedent';
import { Jimp } from 'jimp';
import { v7, v7 as uuidv7 } from 'uuid';
import * as v from 'valibot';

import {
  BookInteractive,
  InteractiveEntityPosition,
  NewBookInteractiveEntity,
  Point
} from '@/lib/db/types';
import { convertArcFriendlyIdPrefixToIsolated } from '@/lib/lit/arc-types';
import { calculatePolygonArea, getBoundingBox } from '@/lib/media/bounding-box';
import { DEBUG_MODE, debugImage } from '@/lib/media/debug';
import {
  createImageChatSession,
  type ImageChatSession
} from '@/lib/media/image-chat-session';
import { createNumberedOverlayImage } from '@/lib/media/numbered-overlay';
import placeInteractive from '@/lib/prompts/interactive/place-interactive';
import placePositions from '@/lib/prompts/interactive/place-positions';
import planPlaceInteractive from '@/lib/prompts/interactive/plan-place-interactive';
import { matchSegmentsToEntities } from '@/lib/segment/match';
import {
  SegmentationProvider,
  segmentImage,
  smoothByMergingIntersections,
  symmetrizeShape
} from '@/lib/segment/prediction';
import { getBookArcsByBookIdAndTypesAndEntityIds } from '@/worker/db/models/book-arc/get-book-arc';
import { getBookEntitiesByBookIdAndTypesAndSignificanceTiers } from '@/worker/db/models/book-entity/get-book-entity';
import { createBookInteractiveEntities } from '@/worker/db/models/book-interactive-entity/create-book-interactive-entity';
import { createBookInteractives } from '@/worker/db/models/book-interactive/create-book-interactive';
import { getBookSettings } from '@/worker/db/models/book-settings/get-book-settings';
import { getBookById } from '@/worker/db/models/book/get-book';
import {
  addOrdinalSuffix,
  createWorkflowFunction,
  type WorkflowContext
} from '@/worker/handler';
import {
  getImageEvaluationPiModel,
  getProvider,
  getSegmentationProvider
} from '@/worker/providers';

export const handler = createWorkflowFunction<
  {
    type: BookInteractive['type'];
    bookId: string;
    existingImageUrl?: string;
    existingVideoUrl?: string;
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    type: BookInteractive['type'];
    existingImageUrl?: string;
    existingVideoUrl?: string;
  }
>(
  {
    name: ({ book }, retryCount) =>
      `Generate Interactive ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId, type, existingImageUrl, existingVideoUrl }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');

      return { book, type, existingImageUrl, existingVideoUrl };
    }
  },
  async ({ book, type: inputType, existingImageUrl, existingVideoUrl }, ctx) => {
    const settings = await getBookSettings(book.id);
    // book settings place_interactive_type opts into PLACE_SIMPLE regardless
    // of what the orchestrator passed in.
    const type: BookInteractive['type'] =
      settings?.placeInteractiveType === 'PLACE_SIMPLE' &&
      (inputType === 'PLACE_HORIZONTAL' || inputType === 'PLACE_VERTICAL')
        ? 'PLACE_SIMPLE'
        : inputType;

    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title,
        bookType: type,
        existingImageUrl,
        existingVideoUrl
      })
      .info('Starting Interactive generation');

    const interactiveId = v7();

    if (
      type === 'CHARACTER_HORIZONTAL' ||
      type === 'CHARACTER_VERTICAL' ||
      type === 'CHARACTER_SIMPLE'
    ) {
      throw new UnrecoverableError(`Not Implemented: ${type}`);
    }

    // place
    const places = await fetchPlacesWithArcs(book.id);

    if (type === 'PLACE_SIMPLE') {
      ctx.log.info('Generating simple place interactive (one image per place)');

      // Pre-fetch APPEARANCE_ISOLATED arcs to map APPEARANCE friendlyIds to
      // actual arc database IDs (consumers store this on the entity).
      const isolatedArcs = await getBookArcsByBookIdAndTypesAndEntityIds(
        book.id,
        ['APPEARANCE_ISOLATED'],
        places.map((p) => p.id)
      );
      const isolatedArcIdByFriendlyId = new Map(
        isolatedArcs.map((arc) => [arc.friendlyId, arc.id])
      );

      const placeEntries: Array<{
        place: (typeof places)[number];
        imageUrl: string;
        description: string;
        selectedBookArcId: string;
      }> = [];

      for (const place of places) {
        const arc = place.arcs[0];
        if (!arc) {
          ctx.log
            .withMetadata({ placeName: place.name })
            .warn('No appearance arc for place, skipping');
          continue;
        }

        const isolatedFriendlyId = convertArcFriendlyIdPrefixToIsolated(arc.friendlyId);
        const selectedBookArcId = isolatedArcIdByFriendlyId.get(isolatedFriendlyId);
        if (!selectedBookArcId) {
          ctx.log
            .withMetadata({
              placeName: place.name,
              arcFriendlyId: arc.friendlyId,
              isolatedFriendlyId
            })
            .warn('Could not find isolated arc for place, skipping');
          continue;
        }

        const imageUrl = await generateSimplePlaceImage(
          {
            placeId: place.id,
            placeName: place.name,
            description: arc.content,
            artStyle: settings?.artStyle ?? null
          },
          ctx
        );

        placeEntries.push({
          place,
          imageUrl,
          description: arc.content,
          selectedBookArcId
        });
      }

      if (placeEntries.length === 0) {
        throw new UnrecoverableError('No place images could be generated');
      }

      ctx.log.info('Creating simple place book interactive record');
      const [bookInteractive] = await createBookInteractives([
        {
          id: interactiveId,
          bookId: book.id,
          type,
          status: 'draft',
          url: null,
          width: null,
          height: null,
          videoUrl: null
        }
      ]);

      const interactiveEntities: NewBookInteractiveEntity[] = placeEntries.map(
        ({ place, imageUrl, description, selectedBookArcId }) => ({
          id: v7(),
          bookId: book.id,
          bookInteractiveId: bookInteractive.id,
          bookEntityId: place.id,
          selectedBookArcId,
          clickArea: null,
          headArea: null,
          imageUrl,
          segmentClass: 'place',
          position: null,
          description,
          headImageUrl: null
        })
      );

      await createBookInteractiveEntities(interactiveEntities);

      ctx.log
        .withMetadata({
          bookId: book.id,
          interactiveId: bookInteractive.id,
          entityCount: interactiveEntities.length
        })
        .info('Successfully created simple place interactive with entities');

      return Response.json({
        bookId: book.id,
        interactiveId: bookInteractive.id
      });
    }

    const plan = await generatePlacePlan(
      {
        type,
        places
      },
      ctx
    );
    const { interactiveUrl, width, height, clickAreas, imageData } =
      await generatePlaceInteractive(
        {
          places,
          plan,
          bookId: book.id,
          interactiveId,
          type,
          existingImageUrl,
          artStyle: settings?.artStyle ?? null
        },
        ctx
      );

    // Create BookInteractive record
    ctx.log.info('Creating book interactive record');
    const [bookInteractive] = await createBookInteractives([
      {
        id: interactiveId,
        bookId: book.id,
        type,
        status: 'draft',
        url: interactiveUrl,
        width,
        height,
        videoUrl: existingVideoUrl ?? null // Will be populated by finalize step if not provided
      }
    ]);

    // Create BookInteractiveEntity records with cropped images
    ctx.log.info('Cropping and saving entity images');
    const jimpImage = await Jimp.read(imageData.slice().buffer);
    const interactiveEntities: NewBookInteractiveEntity[] = [];

    for (const clickArea of clickAreas) {
      const id = v7();

      const bbox = getBoundingBox(clickArea.points);

      const croppedImage = jimpImage.clone().crop({
        x: bbox.x,
        y: bbox.y,
        w: bbox.width,
        h: bbox.height
      });

      const croppedBuffer = await croppedImage.getBuffer('image/png');

      const key = `book-interactive-entities/${id}`;
      const imageUrl = buildAssetUrl(key, 'image/png');
      await ctx.fs.write(parseAssetUrl(imageUrl).relPath, new Uint8Array(croppedBuffer));

      ctx.log
        .withMetadata({ entityId: clickArea.entityId, imageUrl, bbox })
        .info('Saved cropped entity image');

      if (!clickArea.selectedBookArcId) {
        ctx.log
          .withMetadata({ entityId: clickArea.entityId })
          .warn('No selectedBookArcId for entity, skipping');
        continue;
      }

      interactiveEntities.push({
        id,
        bookId: book.id,
        bookInteractiveId: bookInteractive.id,
        bookEntityId: clickArea.entityId,
        selectedBookArcId: clickArea.selectedBookArcId,
        clickArea: clickArea.points,
        headArea: null,
        imageUrl,
        segmentClass: clickArea.segmentClass,
        position: clickArea.position,
        description: clickArea.description,
        headImageUrl: null
      });
    }

    ctx.log
      .withMetadata({ entityCount: interactiveEntities.length })
      .info('Creating book interactive entity records');

    await createBookInteractiveEntities(interactiveEntities);

    ctx.log
      .withMetadata({
        bookId: book.id,
        interactiveId: bookInteractive.id,
        entityCount: interactiveEntities.length
      })
      .info('Successfully created interactive with entities');

    return Response.json({
      bookId: book.id,
      interactiveId: bookInteractive.id
    });
  }
);

/**
 * Generate one image for a single place from its appearance arc content.
 * Used by PLACE_SIMPLE where each place gets its own image instead of being
 * one window in a composite.
 */
async function generateSimplePlaceImage(
  {
    placeId,
    placeName,
    description,
    artStyle
  }: {
    placeId: string;
    placeName: string;
    description: string;
    artStyle: string | null;
  },
  ctx: WorkflowContext
): Promise<string> {
  const prompt: StructuredPrompt = {
    prefix: '',
    content: dedent`
      Create an illustration of ${placeName}.

      ${description}`,
    suffix: dedent`
      Requirements:
      - Render the place itself (no characters or named figures)
      - Rendered in a ${resolveArtStyle(artStyle)}
      - Do not include any text, labels, or names`
  };

  ctx.log
    .withMetadata({ placeName, prompt: assemblePrompt(prompt) })
    .info('Generating simple place image');

  const { data: imageData, mimeType } = await generateOneShotImage(
    getProvider('image_generation_reference'),
    {
      prompt: assemblePrompt(prompt),
      aspectRatio: '16:9'
    }
  );

  await debugImage(encode(imageData), `Simple Place: ${placeName}`);

  const key = `book-interactive-entities/${placeId}-simple`;
  const imageUrl = buildAssetUrl(key, mimeType);
  await ctx.fs.write(parseAssetUrl(imageUrl).relPath, imageData);

  ctx.log
    .withMetadata({ placeId, placeName, url: imageUrl })
    .info('Saved simple place image');

  return imageUrl;
}

async function fetchPlacesWithArcs(bookId: string) {
  // Fetch primary places
  const places = await getBookEntitiesByBookIdAndTypesAndSignificanceTiers(
    bookId,
    ['PLACE'],
    ['PRIMARY']
  );

  if (places.length === 0) {
    throw new UnrecoverableError('No primary places found');
  }

  const allArcs = await getBookArcsByBookIdAndTypesAndEntityIds(
    bookId,
    ['APPEARANCE'],
    places.map((place) => place.id)
  );

  // Group arcs by place ID
  const arcsByPlaceId = allArcs.reduce<Record<string, typeof allArcs>>((acc, arc) => {
    arc.bookEntityIds.forEach((id) => {
      if (!acc[id]) {
        acc[id] = [];
      }
      acc[id].push(arc);
    });
    return acc;
  }, {});

  // Map places with all their arcs
  return places.map((place) => ({
    id: place.id,
    friendlyId: place.friendlyId,
    name: place.name,
    arcs: (arcsByPlaceId[place.id] || [])
      .sort((a, b) => a.friendlyIdIdx - b.friendlyIdIdx)
      .map((arc) => ({
        id: arc.id,
        friendlyId: arc.friendlyId,
        content: arc.content
      }))
  }));
}

const PlacePlanOutputSchema = v.object({
  room_style: v.string(),
  placements: v.array(
    v.object({
      location_id: v.string(),
      placement: v.string(),
      frame_style: v.string(),
      architectural_details: v.string()
    })
  )
});

async function generatePlacePlan(
  {
    type,
    places
  }: {
    type: BookInteractive['type'];
    places: Array<{
      id: string;
      friendlyId: string;
      name: string;
      arcs: Array<{ content: string }>;
    }>;
  },
  ctx: WorkflowContext
) {
  const { model, apiKey, reasoning } = ctx.getPiModel('text');

  const promptText = planPlaceInteractive.render({
    type: type === 'PLACE_HORIZONTAL' ? 'HORIZONTAL' : 'VERTICAL',
    places
  });

  const message = await completeOrThrow(
    model,
    {
      messages: [
        {
          role: 'user',
          content: promptText,
          timestamp: Date.now()
        }
      ]
    },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);

  const text = getAssistantText(message);
  const xmlStart = text.indexOf('<place_plan>');
  const xml = xmlStart >= 0 ? text.slice(xmlStart) : '';

  if (!xml) {
    throw new RecoverableError('No place_plan found in response');
  }

  const ast = parse(xml);
  const planNode = querySelector(ast, 'place_plan');

  if (!planNode) {
    throw new RecoverableError('No place_plan element found in response');
  }

  const placementNodes = querySelectorAll(planNode, 'placement');

  const data = {
    room_style: getText(querySelector(planNode, 'room_style')).trim(),
    placements: placementNodes.map((node) => ({
      location_id: getAttribute(node, 'location_id') || '',
      placement: getText(querySelector(node, 'placement_description')).trim(),
      frame_style: getText(querySelector(node, 'frame_style')).trim(),
      architectural_details: getText(querySelector(node, 'architectural_details')).trim()
    }))
  };

  const validatedData = v.safeParse(PlacePlanOutputSchema, data);

  if (!validatedData.success) {
    ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
    throw new RecoverableError(
      `Failed to parse place plan: ${v.summarize(validatedData.issues)}`
    );
  }

  return validatedData.output;
}

const RewrittenPromptSchema = v.object({
  rewritten_prompt: v.string()
});

async function rewritePromptWithFeedback(
  {
    originalPrompt,
    issues
  }: {
    originalPrompt: string;
    issues: string;
  },
  ctx: WorkflowContext
): Promise<string> {
  const { model, apiKey, reasoning } = ctx.getPiModel('text');

  const rewriteInstructions = `Rewrite the following image generation prompt to incorporate the feedback. Keep the overall structure, style, and intent intact. Modify only what's needed to address the feedback, and restrict your changes to the earlier parts of the prompt. In particular, the final sentences (the closing instructions/summary at the end) must remain exactly as written, word-for-word.

**Prompt:**
${originalPrompt}

**Feedback:**
${issues}

Respond with the rewritten prompt wrapped in a single \`<rewritten_prompt>\` XML element. Output only that element — no surrounding prose, no JSON, no code fences.`;

  const message = await completeOrThrow(
    model,
    {
      messages: [{ role: 'user', content: rewriteInstructions, timestamp: Date.now() }]
    },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);

  const text = getAssistantText(message);
  const xmlStart = text.indexOf('<rewritten_prompt>');
  const xml = xmlStart >= 0 ? text.slice(xmlStart) : '';

  if (!xml) {
    throw new RecoverableError('No rewritten_prompt found in response');
  }

  const ast = parse(xml);
  const data = {
    rewritten_prompt: getInnerHtml(querySelector(ast, 'rewritten_prompt')).trim()
  };

  const parsed = v.parse(RewrittenPromptSchema, data);

  ctx.log
    .withMetadata({ rewrittenPrompt: parsed.rewritten_prompt })
    .info('Rewrote place interactive prompt with coverage feedback');

  return parsed.rewritten_prompt;
}

async function generatePlaceInteractive(
  {
    places,
    plan,
    bookId,
    interactiveId,
    type,
    existingImageUrl,
    artStyle
  }: {
    places: Array<{
      id: string;
      friendlyId: string;
      name: string;
      arcs: Array<{ id: string; friendlyId: string; content: string }>;
    }>;
    plan: {
      room_style: string;
      placements: Array<{
        location_id: string;
        placement: string;
        frame_style: string;
        architectural_details: string;
      }>;
    };
    bookId: string;
    interactiveId: string;
    type: BookInteractive['type'];
    existingImageUrl?: string;
    artStyle: string | null;
  },
  ctx: WorkflowContext
) {
  // Merge places with their placements
  const placementMap = new Map(
    plan.placements.map((p) => [
      p.location_id,
      {
        placement: p.placement,
        frame_style: p.frame_style,
        architectural_details: p.architectural_details
      }
    ])
  );

  const placesWithPlacements = places.map((place) => {
    const placementData = placementMap.get(place.friendlyId);
    return {
      name: place.name,
      placement: placementData?.placement || '(unknown)',
      frame_style: placementData?.frame_style || '(unknown)',
      architectural_details: placementData?.architectural_details || '(unknown)',
      arcs: place.arcs
    };
  });

  // Render the prompt with the places data
  const prompt = placeInteractive.render({
    roomStyle: plan.room_style,
    artStyle,
    places: placesWithPlacements
  });

  console.log('place prompt', prompt);

  void bookId;

  let segResult!: Awaited<ReturnType<typeof segmentAndNumberImage>>;
  let imgData!: Awaited<ReturnType<typeof generateImage>>['imageData'];

  if (existingImageUrl) {
    ctx.log
      .withMetadata({ existingImageUrl })
      .info('Using existing image, skipping generation');
    const { relPath, mimeType } = parseAssetUrl(existingImageUrl);
    const existingBytes = await ctx.fs.read(relPath);
    imgData = { data: existingBytes, mimeType };

    const chat = createImageChatSession(getProvider('image_generation_interactive'), {});
    await chat.sendMessage({
      text: 'Here is the illustration I generated.',
      images: [{ mimeType, data: encode(existingBytes) }]
    });

    segResult = await segmentAndNumberImage(
      {
        segmentationProvider: getSegmentationProvider(),
        imageData: existingBytes,
        chat,
        places,
        plan
      },
      ctx
    );
  } else {
    // Generate image and segment with coverage self-check.
    // If segmentation doesn't adequately cover windows, rewrite the prompt to
    // naturally incorporate the feedback and regenerate from scratch.
    const MAX_COVERAGE_RETRIES = 2;
    let currentPrompt = prompt;

    for (
      let coverageAttempt = 0;
      coverageAttempt <= MAX_COVERAGE_RETRIES;
      coverageAttempt++
    ) {
      const generateResult = await generateImage(
        {
          bookId,
          prompt: currentPrompt,
          type,
          expectedWindowCount: places.length
        },
        ctx
      );
      imgData = generateResult.imageData;

      segResult = await segmentAndNumberImage(
        {
          segmentationProvider: getSegmentationProvider(),
          imageData: imgData.data,
          chat: generateResult.chat,
          places,
          plan
        },
        ctx
      );

      const coverageResult = await checkSegmentCoverage(
        {
          numberedImageBase64: segResult.numberedImageBase64,
          expectedCount: places.length
        },
        ctx
      );

      if (coverageResult.ok) {
        ctx.log.info('Segment coverage self-check passed');
        break;
      }

      // On last attempt, fail instead of silently accepting bad segmentation
      if (coverageAttempt === MAX_COVERAGE_RETRIES) {
        throw new RecoverableError(
          `Segment coverage check failed after ${MAX_COVERAGE_RETRIES + 1} attempts: ` +
            `expected ${places.length} covered windows but segmentation could not achieve full coverage`
        );
      }

      const hasIssues =
        coverageResult.issues && coverageResult.issues.toLowerCase() !== 'none';

      ctx.log
        .withMetadata({
          attempt: coverageAttempt + 1,
          maxRetries: MAX_COVERAGE_RETRIES,
          issues: coverageResult.issues,
          willRewritePrompt: hasIssues
        })
        .info('Segment coverage self-check failed, regenerating image from scratch');

      if (hasIssues) {
        // Always rewrite from the ORIGINAL prompt so drift doesn't compound
        currentPrompt = await rewritePromptWithFeedback(
          { originalPrompt: prompt, issues: coverageResult.issues },
          ctx
        );
      }
    }
  }

  const {
    numberedImageBase64,
    positions,
    descriptions,
    symmetrizedPredictions,
    width,
    height
  } = segResult;
  const imageData = imgData;

  // Match segments to place entities
  ctx.log.info('Matching segments to place entities');
  const positionDescription = positions
    .map((p) => `*   **${p.name}:** ${p.description}`)
    .join('\n');

  const detectionToEntityId = await matchSegmentsToEntities(
    {
      numberedImageBase64,
      positionDescription,
      predictions: symmetrizedPredictions,
      entities: places,
      entityType: 'place'
    },
    ctx
  );

  // Create maps for position, description, and arc lookup - keyed by friendlyId
  const positionByFriendlyId = new Map(
    positions.filter((p) => p.friendlyId).map((p) => [p.friendlyId, p.description])
  );
  const arcFriendlyIdByFriendlyId = new Map(
    positions.filter((p) => p.friendlyId).map((p) => [p.friendlyId, p.arcFriendlyId])
  );
  const descriptionByFriendlyId = new Map(
    descriptions
      .map((d, i) => [positions[i].friendlyId, d.description] as const)
      .filter(([fid]) => fid)
  );
  const friendlyIdByEntityId = new Map(places.map((p) => [p.id, p.friendlyId]));
  const nameByEntityId = new Map(places.map((p) => [p.id, p.name]));

  // Fetch APPEARANCE_ISOLATED arcs to get actual database IDs
  const isolatedArcs = await getBookArcsByBookIdAndTypesAndEntityIds(
    bookId,
    ['APPEARANCE_ISOLATED'],
    places.map((p) => p.id)
  );

  // Create map from isolated friendlyId to real arc ID
  const isolatedArcIdByFriendlyId = new Map(
    isolatedArcs.map((arc) => [arc.friendlyId, arc.id])
  );

  // Build click areas array (places don't have heads)
  const clickAreas: Array<{
    entityId: string;
    points: Point[];
    segmentClass: string;
    position: string;
    description: string | null;
    selectedBookArcId: string | null;
  }> = [];

  for (let i = 0; i < symmetrizedPredictions.length; i++) {
    const prediction = symmetrizedPredictions[i];
    const detectionNum = (i + 1).toString();
    const entityId = detectionToEntityId[detectionNum];

    if (!entityId) {
      ctx.log.withMetadata({ detectionNum }).warn('No entity match found for detection');
      continue;
    }

    // Look up position, description, and arc: entityId -> friendlyId -> position/description/arcFriendlyId
    const entityName = nameByEntityId.get(entityId);
    const friendlyId = friendlyIdByEntityId.get(entityId);
    const position = friendlyId ? positionByFriendlyId.get(friendlyId) : undefined;
    const description = friendlyId
      ? (descriptionByFriendlyId.get(friendlyId) ?? null)
      : null;
    const arcFriendlyId = friendlyId ? arcFriendlyIdByFriendlyId.get(friendlyId) : null;
    // Convert APPEARANCE friendlyId to APPEARANCE_ISOLATED friendlyId and look up actual arc ID
    const isolatedFriendlyId = arcFriendlyId
      ? convertArcFriendlyIdPrefixToIsolated(arcFriendlyId)
      : null;
    const selectedBookArcId = isolatedFriendlyId
      ? (isolatedArcIdByFriendlyId.get(isolatedFriendlyId) ?? null)
      : null;

    if (arcFriendlyId && !selectedBookArcId) {
      ctx.log
        .withMetadata({
          entityId,
          entityName,
          arcFriendlyId,
          isolatedFriendlyId
        })
        .warn('Could not find isolated arc ID for place');
    }

    if (!position) {
      throw new RecoverableError(
        `No position found for entity ${entityName ?? entityId} (friendlyId: ${friendlyId ?? 'unknown'})`
      );
    }

    clickAreas.push({
      entityId,
      points: prediction.points,
      segmentClass: prediction.class,
      position,
      description,
      selectedBookArcId
    });
  }

  if (clickAreas.length === 0) {
    throw new UnrecoverableError('No matched entities found for interactive');
  }

  let interactiveUrl: string;
  if (existingImageUrl) {
    interactiveUrl = existingImageUrl;
  } else {
    interactiveUrl = buildAssetUrl(
      `book-interactive/${interactiveId}`,
      imageData.mimeType
    );
    await ctx.fs.write(parseAssetUrl(interactiveUrl).relPath, imageData.data);
  }

  ctx.log
    .withMetadata({
      totalClickAreas: clickAreas.length,
      uniqueEntities: new Set(clickAreas.map((ca) => ca.entityId)).size,
      interactiveUrl,
      width,
      height
    })
    .info('Successfully matched place entities to click areas');

  return {
    interactiveUrl,
    width,
    height,
    clickAreas,
    imageData: imageData.data
  };
}

async function generateImage(
  {
    bookId,
    prompt,
    type,
    expectedWindowCount
  }: {
    bookId: string;
    prompt: string;
    type: string;
    expectedWindowCount: number;
  },
  ctx: WorkflowContext
) {
  void bookId;
  const chat = createImageChatSession(getProvider('image_generation_interactive'), {
    aspectRatio: type === 'PLACE_HORIZONTAL' ? '16:9' : '9:16',
    onRetry: (error, attempt, max) =>
      ctx.log.info(
        `Place image generation error (${error.message}), retrying (attempt ${attempt}/${max})`
      )
  });

  ctx.log.info('Generating place interactive');
  const response1 = await chat.sendMessage(prompt, { expectImage: true });
  let imageData = response1.image;

  // Step 2: Self-check the generated image for correct window count
  const MAX_REVISION_ATTEMPTS = 2;

  for (let attempt = 0; attempt < MAX_REVISION_ATTEMPTS; attempt++) {
    ctx.log.info(
      `Running place image self-check (attempt ${attempt + 1}/${MAX_REVISION_ATTEMPTS})`
    );

    const selfCheckPrompt = `You are reviewing a generated illustration of a wall with portal windows, each showing a different location.

**Your tasks:**
1. Count the number of primary portal windows on the wall
2. Check if the image contains any text, numbers, or labels

**Important for counting windows:**
- Count only the primary portal windows mounted on/in the wall itself
- Do NOT count windows that appear *within* the scenes visible through the portals (e.g., if a portal shows a library, and that library has windows, don't count those interior windows)
- Each portal window should show a distinctly different scene/location through it

**Important for text detection:**
- Look for any numbers, labels, captions, or text overlaid on the image
- This includes numbered labels on windows, location names, etc.

**Response Format:**
Respond with exactly this XML format:
<review>
<window_count>[number]</window_count>
<has_text>[true/false]</has_text>
</review>

For example:
<review>
<window_count>4</window_count>
<has_text>false</has_text>
</review>`;

    const { model: evalModel, apiKey: evalApiKey } = getImageEvaluationPiModel();
    const selfCheckMessage = await completeOrThrow(
      evalModel,
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: selfCheckPrompt },
              {
                type: 'image',
                data: encode(imageData.data),
                mimeType: imageData.mimeType
              }
            ],
            timestamp: Date.now()
          }
        ]
      },
      { apiKey: evalApiKey, sessionId: uuidv7() }
    );
    ctx.trackUsage(selfCheckMessage);
    const reviewText = getAssistantText(selfCheckMessage);
    ctx.log.withMetadata({ reviewText }).info('Place self-check review result');

    // Extract window count and text detection from response
    const placeReviewAst = parse(reviewText);
    const countText = getText(querySelector(placeReviewAst, 'window_count')).trim();
    const detectedCount = countText ? parseInt(countText, 10) : -1;
    const hasText =
      getText(querySelector(placeReviewAst, 'has_text')).trim().toLowerCase() === 'true';

    ctx.log
      .withMetadata({ detectedCount, expectedWindowCount, hasText })
      .info('Place self-check results');

    const correctWindowCount = detectedCount === expectedWindowCount;
    const noTextInImage = !hasText;

    if (correctWindowCount && noTextInImage) {
      ctx.log.info('Image passed self-check validation');
      break;
    }

    // Build rejection reasons for the regeneration prompt
    const issues: string[] = [];
    if (!correctWindowCount) {
      issues.push(
        `had ${detectedCount} windows but should have exactly ${expectedWindowCount}`
      );
    }
    if (!noTextInImage) {
      issues.push('contained text, numbers, or labels which should not be present');
    }

    ctx.log
      .withMetadata({ issues, attempt })
      .info('Self-check failed, regenerating image');

    // Regenerate the image entirely
    const revisionResponse = await chat.sendMessage(
      `The previous image ${issues.join(' and ')}. Please regenerate the entire image with exactly ${expectedWindowCount} distinct portal windows (one for each location) and no text, numbers, or labels anywhere in the image.`,
      { expectImage: true }
    );
    imageData = revisionResponse.image;
  }

  return { imageData, chat };
}

async function segmentAndNumberImage(
  {
    segmentationProvider,
    chat,
    places,
    plan,
    imageData
  }: {
    segmentationProvider: SegmentationProvider;
    chat: ImageChatSession;
    places: Array<{
      id: string;
      friendlyId: string;
      name: string;
      arcs: Array<{
        friendlyId: string;
      }>;
    }>;
    plan: Awaited<ReturnType<typeof generatePlacePlan>>;
    imageData: Uint8Array<ArrayBufferLike>;
  },
  ctx: WorkflowContext
) {
  // Step 2: Get place positions
  const positionsPrompt = placePositions.render({
    places,
    placeNames: places.map((p) => p.name)
  });

  ctx.log.withMetadata({ positionsPrompt }).info('Requesting place positions');
  const response2 = await chat.sendMessage(positionsPrompt);
  const positionsXml = response2.text;

  if (!positionsXml) {
    throw new UnrecoverableError('No place positions returned in second response');
  }

  // Parse XML response
  const windowPositionsAst = parse(positionsXml);

  // Extract window positions
  const windowElements = querySelectorAll(
    windowPositionsAst,
    'window_positions > window'
  );
  const positions: Array<
    InteractiveEntityPosition & {
      friendlyId: string | null;
      arcFriendlyId: string | null;
    }
  > = [];

  for (const el of windowElements) {
    const name = getAttribute(el, 'name');
    const friendlyId = getAttribute(el, 'id') || null;
    const segmentClass = getAttribute(el, 'frame_type');
    const arcFriendlyId = getAttribute(el, 'arc_id') || null;
    const description = getText(el).trim();

    if (name && description && segmentClass) {
      positions.push({
        name,
        description,
        segmentClass,
        friendlyId,
        arcFriendlyId
      });
    }
  }

  if (positions.length === 0) {
    throw new UnrecoverableError('No window descriptions found in response');
  }

  // Build descriptions with architectural details from plan, keyed by friendlyId
  const architecturalDetailsByFriendlyId = new Map(
    plan.placements.map((p) => [p.location_id, p.architectural_details])
  );

  const descriptions = positions.map((p) => ({
    name: p.name,
    description: p.friendlyId
      ? (architecturalDetailsByFriendlyId.get(p.friendlyId) ?? null)
      : null
  }));

  // Log place descriptions
  ctx.log
    .withMetadata({
      roomStyle: plan.room_style,
      placeCount: descriptions.length
    })
    .info('Place interactive descriptions');

  for (const desc of descriptions) {
    ctx.log
      .withMetadata({
        placeName: desc.name,
        architecturalDetails: desc.description
      })
      .info('Place architectural details');
  }

  // Step 3: Segment the image and match to entities
  ctx.log.info('Segmenting interactive image');
  const segmentClasses = [...new Set(positions.map((p) => p.segmentClass))].join(',');
  const { predictions, width, height } = await segmentImage(
    segmentationProvider,
    imageData,
    segmentClasses,
    ctx
  );

  // Filter predictions by area and confidence
  const MIN_POLYGON_AREA = 400;
  const MIN_CONFIDENCE_FOR_SMALL = 0.8;
  const SMALL_DETECTION_THRESHOLD = 1000;

  const filteredPredictions = predictions.filter((p, index) => {
    const area = calculatePolygonArea(p.points);

    let passed = area >= MIN_POLYGON_AREA;
    let reason = '';

    if (passed && area < SMALL_DETECTION_THRESHOLD) {
      if (p.confidence < MIN_CONFIDENCE_FOR_SMALL) {
        passed = false;
        reason = `(low conf for small area)`;
      }
    }

    if (DEBUG_MODE) {
      console.log(
        `#${index + 1}: ${passed ? '✓' : '✗'} | ` +
          `Area: ${area.toFixed(0)}px² | ` +
          `BBox: ${p.width.toFixed(0)}×${p.height.toFixed(0)} | ` +
          `Conf: ${(p.confidence * 100).toFixed(1)}% | ` +
          `Class: ${p.class}` +
          (reason ? ` ${reason}` : '')
      );
    }

    return passed;
  });

  if (DEBUG_MODE) {
    console.log(`\nFiltered: ${predictions.length} -> ${filteredPredictions.length}`);
  }

  ctx.log
    .withMetadata({
      totalPredictions: predictions.length,
      filteredPredictions: filteredPredictions.length
    })
    .info('Filtered segmentation predictions');

  // Merge overlapping predictions
  const mergedPredictions = smoothByMergingIntersections(filteredPredictions, ctx);

  ctx.log
    .withMetadata({
      beforeMerge: filteredPredictions.length,
      afterMerge: mergedPredictions.length
    })
    .info('Merged overlapping predictions');

  // Symmetrize each prediction's polygon
  const symmetrizedPredictionsRaw = mergedPredictions.map((prediction) => ({
    ...prediction,
    points: symmetrizeShape(prediction.points)
  }));

  // Merge again after symmetrization - but conservatively, only merge if >30% overlap
  // to avoid collapsing distinct adjacent windows that slightly touch after symmetrization
  const symmetrizedPredictions = smoothByMergingIntersections(
    symmetrizedPredictionsRaw,
    ctx,
    0.3
  );

  ctx.log
    .withMetadata({
      beforeSymmetrize: mergedPredictions.length,
      afterSymmetrize: symmetrizedPredictions.length
    })
    .info('Symmetrized and re-merged prediction polygons');

  // Create numbered overlay image
  ctx.log.info('Creating numbered overlay image');
  const jimpImage = await Jimp.read(imageData.slice().buffer);

  const items = symmetrizedPredictions.map((prediction, idx) => ({
    points: prediction.points,
    number: idx + 1
  }));

  const numberedImageBase64 = await createNumberedOverlayImage(jimpImage, items);
  await debugImage(numberedImageBase64, 'NUMBERED COMPOSITE IMAGE');

  return {
    numberedImageBase64,
    descriptions,
    symmetrizedPredictions,
    width,
    height,
    positions
  };
}

async function checkSegmentCoverage(
  {
    numberedImageBase64,
    expectedCount
  }: {
    numberedImageBase64: string;
    expectedCount: number;
  },
  ctx: WorkflowContext
): Promise<{ ok: boolean; issues: string }> {
  ctx.log.info('Running segment coverage self-check');

  const coveragePrompt = `You are reviewing an illustration of a wall with portal windows. Each window has been detected by a segmentation model and overlaid with a semi-transparent colored area and a number.

**Your task:**
For each numbered colored overlay, check whether it fully covers the main scene visible through the corresponding portal window. The colored area should cover the entire view/scene within the window frame. Minor exclusions of shutters, frames, or decorative elements around the window are acceptable — what matters is that the scene INSIDE the window is fully covered by the colored overlay.

Also check: are there any portal windows in the image that have NO colored overlay at all? These would be windows missed entirely by detection.

Expected number of portal windows: ${expectedCount}

**Response Format:**
Respond with exactly this XML format:
<coverage_review>
<all_covered>[true/false]</all_covered>
<covered_count>[number of windows with adequate coverage]</covered_count>
<issues>[feedback for the image generator describing what to fix about the window frames, or "none" — see guidelines below]</issues>
</coverage_review>

Set all_covered to true ONLY if every portal window's scene is adequately covered by its colored overlay and no windows were missed.

**Writing the <issues> field:**
The issues field will be sent as feedback directly to the image generation model, which has no knowledge of segmentation or overlays. Describe all problems in terms of the windows in the illustration:

- Partial coverage usually means the window frame is too asymmetrical or irregularly shaped. Suggest making that window's frame more symmetrical and regular.
- A completely missed window usually means the frame doesn't look like a recognizable window — it may resemble a magical portal, part of the furniture, a fireplace, or another room element. Describe what it currently looks like and suggest making it a more obvious, recognizable window frame.
- Identify each problematic window by the scene/location visible through it.`;

  const { model: evalModel, apiKey: evalApiKey } = getImageEvaluationPiModel();
  const coverageMessage = await completeOrThrow(
    evalModel,
    {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: coveragePrompt },
            { type: 'image', data: numberedImageBase64, mimeType: 'image/png' }
          ],
          timestamp: Date.now()
        }
      ]
    },
    { apiKey: evalApiKey, sessionId: uuidv7() }
  );
  ctx.trackUsage(coverageMessage);
  const reviewText = getAssistantText(coverageMessage);
  ctx.log.withMetadata({ reviewText }).info('Segment coverage review result');

  const reviewAst = parse(reviewText);
  const allCovered =
    getText(querySelector(reviewAst, 'all_covered')).trim().toLowerCase() === 'true';
  const coveredCountText = getText(querySelector(reviewAst, 'covered_count')).trim();
  const coveredCount = coveredCountText ? parseInt(coveredCountText, 10) : 0;
  const issues = getText(querySelector(reviewAst, 'issues')).trim();

  ctx.log
    .withMetadata({ allCovered, coveredCount, expectedCount, issues })
    .info('Segment coverage check results');

  return { ok: allCovered && coveredCount >= expectedCount, issues };
}
