import { Agent } from '@earendil-works/pi-agent-core';
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
import { RecoverableError, UnrecoverableError } from '@/lib/error-types';
import { convertArcFriendlyIdPrefixToIsolated } from '@/lib/lit/arc-types';
import {
  createLookupRelatedEntityAppearanceTool,
  getRelatedEntitiesFromArcs
} from '@/lib/lit/related-entities';
import { completeOrThrow, getAssistantText, watchAgent } from '@/lib/llm/agent';
import {
  getAttribute,
  getText,
  parse,
  querySelector,
  querySelectorAll
} from '@/lib/llm/xml';
import { cropToPolygon, getBoundingBox } from '@/lib/media/bounding-box';
import { segmentAndFilter } from '@/lib/media/character-crops';
import { debugImage } from '@/lib/media/debug';
import { detectHeads, MIN_HEAD_POLYGON_AREA } from '@/lib/media/head';
import { createImageChatSession } from '@/lib/media/image-chat-session';
import { createNumberedOverlayImage } from '@/lib/media/numbered-overlay';
import { createCharacterReferenceGrid } from '@/lib/media/reference-grid';
import { buildAssetUrl, parseAssetUrl } from '@/lib/media/transform-url';
import characterDynamics from '@/lib/prompts/interactive/character-dynamics';
import { matchSegmentsToEntities } from '@/lib/segment/match';
import { RoboflowPrediction } from '@/lib/segment/prediction';
import { getBookArcsByBookIdAndTypesAndEntityIds } from '@/worker/db/models/book-arc/get-book-arc';
import { getBookEntitiesByBookIdAndTypesAndSignificanceTiers } from '@/worker/db/models/book-entity/get-book-entity';
import { createBookInteractiveEntities } from '@/worker/db/models/book-interactive-entity/create-book-interactive-entity';
import { createBookInteractives } from '@/worker/db/models/book-interactive/create-book-interactive';
import { getBookSettings } from '@/worker/db/models/book-settings/get-book-settings';
import { getBookById } from '@/worker/db/models/book/get-book';
import { getCharacterRefsByBookIdAndCharacterIds } from '@/worker/db/models/character-ref/get-character-ref';
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
  },
  {
    book: NonNullable<Awaited<ReturnType<typeof getBookById>>>;
    type: BookInteractive['type'];
  }
>(
  {
    name: ({ book }, retryCount) =>
      `Generate Interactive ${book.title}${retryCount > 0 ? `, ${addOrdinalSuffix(retryCount + 1)} attempt` : ''}`,
    payload: async ({ bookId, type }) => {
      const book = await getBookById(bookId);
      if (!book) throw new UnrecoverableError('Book not found');

      return { book, type };
    }
  },
  async ({ book, type: inputType }, ctx) => {
    const settings = await getBookSettings(book.id);
    // The book settings character_interactive_type opts into CHARACTER_SIMPLE
    // regardless of what the orchestrator passed in.
    const type: BookInteractive['type'] =
      settings?.characterInteractiveType === 'CHARACTER_SIMPLE' &&
      (inputType === 'CHARACTER_HORIZONTAL' || inputType === 'CHARACTER_VERTICAL')
        ? 'CHARACTER_SIMPLE'
        : inputType;

    ctx.log
      .withMetadata({
        bookId: book.id,
        bookTitle: book.title,
        bookType: type
      })
      .info('Starting Interactive generation');

    const interactiveId = v7();

    if (type === 'CHARACTER_SIMPLE') {
      const primaryCharacters = await getBookEntitiesByBookIdAndTypesAndSignificanceTiers(
        book.id,
        ['CHARACTER'],
        ['PRIMARY']
      );
      if (primaryCharacters.length === 0) {
        throw new UnrecoverableError(`No primary characters found`);
      }

      const charactersWithArcIds = await resolveCharactersWithArcIds(
        book.id,
        primaryCharacters,
        ctx
      );

      const segmentClassByCharacterId = await classifyCharacterSegmentClasses(
        charactersWithArcIds,
        ctx
      );

      ctx.log.info('Creating simple book interactive record');
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

      const interactiveEntities: NewBookInteractiveEntity[] = charactersWithArcIds.map(
        (c) => ({
          id: v7(),
          bookId: book.id,
          bookInteractiveId: bookInteractive.id,
          bookEntityId: c.id,
          selectedBookArcId: c.selectedArcId,
          clickArea: null,
          headArea: null,
          imageUrl: null,
          segmentClass: segmentClassByCharacterId.get(c.id) ?? 'person',
          position: null,
          description: c.description,
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
        .info('Successfully created simple interactive with entities');

      return Response.json({
        bookId: book.id,
        interactiveId: bookInteractive.id
      });
    }

    if (type === 'CHARACTER_HORIZONTAL' || type === 'CHARACTER_VERTICAL') {
      const primaryCharacters = await getBookEntitiesByBookIdAndTypesAndSignificanceTiers(
        book.id,
        ['CHARACTER'],
        ['PRIMARY']
      );
      if (primaryCharacters.length === 0) {
        throw new UnrecoverableError(`No primary characters found`);
      }

      const charactersWithArcIds = await resolveCharactersWithArcIds(
        book.id,
        primaryCharacters,
        ctx
      );

      // Step 2: Generate character dynamics (uses selectedArcId from reference image URLs)
      const dynamics = await generateCharacterDynamics(
        {
          type,
          bookId: book.id,
          artStyle: settings?.artStyle ?? null,
          characters: charactersWithArcIds
        },
        ctx
      );

      // Step 3-4: Generate scene image and segment it
      const { interactiveUrl, width, height, clickAreas } =
        await generateCharacterInteractive(
          {
            characters: charactersWithArcIds,
            dynamics,
            type,
            interactiveId,
            bookId: book.id,
            artStyle: settings?.artStyle ?? null
          },
          ctx
        );

      // Step 5: Create BookInteractive record
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
          videoUrl: null
        }
      ]);

      // Step 6: Create BookInteractiveEntity records
      const interactiveEntities: NewBookInteractiveEntity[] = clickAreas.map(
        (clickArea) => ({
          id: v7(),
          bookId: book.id,
          bookInteractiveId: bookInteractive.id,
          bookEntityId: clickArea.entityId,
          selectedBookArcId: clickArea.selectedArcId,
          clickArea: clickArea.points,
          headArea: clickArea.headArea,
          imageUrl: null,
          segmentClass: clickArea.segmentClass,
          position: clickArea.position,
          description: clickArea.description,
          headImageUrl: null
        })
      );

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

    throw new UnrecoverableError(`Not implemented: ${type}`);
  }
);

const CharacterDynamicsOutputSchema = v.object({
  characters: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      description: v.string()
    })
  ),
  scene: v.string()
});

type PrimaryCharacter = Awaited<
  ReturnType<typeof getBookEntitiesByBookIdAndTypesAndSignificanceTiers>
>[number];

async function resolveCharactersWithArcIds(
  bookId: string,
  primaryCharacters: PrimaryCharacter[],
  ctx: WorkflowContext
) {
  const refs = await getCharacterRefsByBookIdAndCharacterIds(
    bookId,
    primaryCharacters.map((c) => c.id)
  );
  const refByCharacterId = new Map(refs.map((r) => [r.characterId, r]));

  const charactersForInteractive = primaryCharacters.flatMap((c) => {
    const ref = refByCharacterId.get(c.id);
    if (!ref) return [];
    return [
      {
        id: c.id,
        friendlyId: c.friendlyId,
        name: c.name,
        label: c.label,
        pronouns: c.pronouns,
        description: c.description,
        imageUrl: ref.imageUrl,
        selectedArcFriendlyId: ref.selectedArcFriendlyId
      }
    ];
  });

  if (charactersForInteractive.length === 0) {
    throw new UnrecoverableError(
      'No characters with reference images found. Run generate-character-reference-images first.'
    );
  }

  const isolatedArcs = await getBookArcsByBookIdAndTypesAndEntityIds(
    bookId,
    ['APPEARANCE_ISOLATED'],
    charactersForInteractive.map((c) => c.id)
  );

  const friendlyIdToArcId = new Map(isolatedArcs.map((arc) => [arc.friendlyId, arc.id]));

  const charactersWithArcIds = charactersForInteractive
    .map((c) => {
      const isolatedFriendlyId = convertArcFriendlyIdPrefixToIsolated(
        c.selectedArcFriendlyId
      );
      const actualArcId = friendlyIdToArcId.get(isolatedFriendlyId);
      if (!actualArcId) {
        ctx.log
          .withMetadata({
            characterId: c.id,
            characterName: c.name,
            friendlyId: c.selectedArcFriendlyId,
            isolatedFriendlyId
          })
          .warn('Could not find actual arc ID for friendlyId');
      }
      return { ...c, selectedArcId: actualArcId || null };
    })
    .filter((c): c is typeof c & { selectedArcId: string } => !!c.selectedArcId);

  if (charactersWithArcIds.length === 0) {
    throw new UnrecoverableError('No characters with valid arc IDs found after mapping');
  }

  return charactersWithArcIds;
}

async function generateCharacterDynamics(
  {
    type,
    bookId,
    artStyle,
    characters
  }: {
    type: 'CHARACTER_HORIZONTAL' | 'CHARACTER_VERTICAL';
    bookId: string;
    artStyle: string | null;
    characters: {
      id: string;
      friendlyId: string;
      name: string;
      label?: string | null;
      pronouns: string | null;
      description: string | null;
      imageUrl: string;
      selectedArcFriendlyId: string;
    }[];
  },
  ctx: WorkflowContext
): Promise<v.InferOutput<typeof CharacterDynamicsOutputSchema>> {
  // Fetch relationship arcs involving the characters with chapter information
  const characterIds = characters.map((character) => character.id);
  const allRelationshipArcs = await getBookArcsByBookIdAndTypesAndEntityIds(
    bookId,
    ['RELATIONSHIP'],
    characterIds,
    {
      includeChapters: true,
      includeEntities: true
    }
  );

  // Fetch isolated appearance arcs for all characters with chapter information
  const appearanceArcsWithChapters = await getBookArcsByBookIdAndTypesAndEntityIds(
    bookId,
    ['APPEARANCE_ISOLATED'],
    characterIds,
    { includeChapters: true }
  );

  // Group arcs by character ID
  const arcsByCharacterId = appearanceArcsWithChapters.reduce<
    Record<string, typeof appearanceArcsWithChapters>
  >((acc, arc) => {
    arc.bookEntityIds.forEach((entityId) => {
      if (!acc[entityId]) {
        acc[entityId] = [];
      }
      acc[entityId].push(arc);
    });
    return acc;
  }, {});

  // Map characters with their selected appearance arc (from reference image) and track end chapters
  const characterMaxChapters = new Map<string, number>();
  const charactersWithArc = characters.map((character) => {
    const allArcs = arcsByCharacterId[character.id] || [];

    const isolatedArcId = convertArcFriendlyIdPrefixToIsolated(
      character.selectedArcFriendlyId
    );
    const selectedArc =
      allArcs.find((arc) => arc.friendlyId === isolatedArcId) ?? allArcs[0];

    // Track the end chapter for this character's selected arc
    const endChapter = selectedArc?.endChapterIdx ?? 0;
    characterMaxChapters.set(character.id, endChapter);

    return {
      ...character,
      arc: selectedArc?.content ?? null
    };
  });

  // Filter relationships to only include those that start within the chapter range
  // of all involved entities
  // (e.g. don't include a relationship that hasn't happened yet when compared to the appearance arcs)

  const relationshipArcs = allRelationshipArcs.filter((arc) => {
    const arcStartChapter = arc.startChapterIdx ?? 0;
    // Check if the relationship starts within the chapter range for all involved entities
    const keep = arc.bookEntityIds.every((entityId) => {
      const entityMaxChapter = characterMaxChapters.get(entityId);
      // If we don't have a max chapter for this entity, keep the relationship
      if (entityMaxChapter === undefined) return true;
      // Include the relationship if it starts before the entity's max chapter
      return arcStartChapter < entityMaxChapter;
    });

    return keep;
  });

  // Get related entities from RELATED_RELATIONSHIP arcs
  const searchText = charactersWithArc
    .map((c) => c.arc || '')
    .filter(Boolean)
    .join(' ');

  const relatedEntitiesResult = await getRelatedEntitiesFromArcs({
    bookId,
    bookEntityIds: characterIds,
    searchTextForMentions: searchText
  });

  // Fetch place information
  const place = (
    await getBookEntitiesByBookIdAndTypesAndSignificanceTiers(
      bookId,
      ['PLACE'],
      ['PRIMARY']
    )
  )[0];

  if (!place) {
    throw new UnrecoverableError(`No primary place found`);
  }

  const placeArcs = await getBookArcsByBookIdAndTypesAndEntityIds(
    bookId,
    ['APPEARANCE_ISOLATED'],
    [place.id],
    { includeChapters: true }
  );

  if (!placeArcs.length) {
    throw new UnrecoverableError(`No isolated appearance arc found for primary place`);
  }

  const placeArcsWithSpan = getArcsWithPercentageChapterSpan(placeArcs);
  const placeArc =
    placeArcsWithSpan.length > 0
      ? placeArcsWithSpan.reduce((max, arc) =>
          arc.percentageChapterSpan > max.percentageChapterSpan ? arc : max
        )
      : null;

  if (!placeArc) {
    throw new UnrecoverableError(`No isolated appearance arc found for primary place`);
  }

  // Filter out CHARACTER and PLACE entities (already provided separately in the prompt)
  const filteredRelatedEntities = relatedEntitiesResult.entities.filter(
    (entity) => entity.type !== 'CHARACTER' && entity.type !== 'PLACE'
  );

  const { model, apiKey, reasoning } = ctx.getPiModel('text');
  const agent = new Agent({
    sessionId: uuidv7(),
    initialState: {
      model,
      thinkingLevel: reasoning,
      tools: [
        createLookupRelatedEntityAppearanceTool(
          bookId,
          relatedEntitiesResult.contextEntityIds,
          'appearance',
          `visual appearance in a few concise sentences. If the data describes this entity as it appears on multiple different characters, write a generalized description of its common form and note any variation in how it manifests — do not tie the description to any specific character. If it belongs to a single character, include all specific visual details.`,
          ctx
        )
      ]
    },
    getApiKey: () => apiKey
  });

  const watcher = watchAgent(agent, ctx, 'scene_description');

  const promptText = characterDynamics.render({
    type,
    artStyle,
    characters: charactersWithArc,
    relationships: relationshipArcs.map((arc) => ({
      title: arc.title,
      content: arc.content,
      entities: (arc.bookEntities || []).map(
        (e) => `${e.name}${e.label ? ` (${e.label})` : ''}`
      )
    })),
    place: {
      name: place.name,
      description: place.description,
      arc: placeArc.content
    },
    relatedEntities:
      filteredRelatedEntities.length > 0 ? filteredRelatedEntities : undefined
  });

  try {
    await agent.prompt(promptText);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      ctx.log.warn('Character dynamics aborted');
    } else {
      throw e;
    }
  }

  if (agent.state.errorMessage) {
    ctx.log.warn(`Agent ended with error: ${agent.state.errorMessage}`);
  }

  const sceneDescriptionXml = watcher.xml;
  if (!sceneDescriptionXml) {
    throw new UnrecoverableError('No scene_description found in response');
  }

  const ast = parse(sceneDescriptionXml);

  // Extract individual <character id="..."> elements and <scene>
  const characterElements = querySelectorAll(
    ast,
    'scene_description > characters > character'
  );
  // Build lookup from friendlyId -> name for mapping LLM output back
  const friendlyIdToName = new Map(charactersWithArc.map((c) => [c.friendlyId, c.name]));

  const parsedCharacters: Array<{
    id: string;
    name: string;
    description: string;
  }> = [];
  for (const el of characterElements) {
    const id = getAttribute(el, 'id');
    const description = getText(el).trim();
    if (id && description) {
      const name = friendlyIdToName.get(id);
      if (name) {
        parsedCharacters.push({ id, name, description });
      }
    }
  }

  const data = {
    characters: parsedCharacters,
    scene: getText(querySelector(ast, 'scene_description > scene')).trim()
  };

  const validatedData = v.safeParse(CharacterDynamicsOutputSchema, data);

  if (!validatedData.success) {
    ctx.log.error(`Validation error: ${v.summarize(validatedData.issues)}`);
    throw new RecoverableError(
      `Failed to parse scene description: ${v.summarize(validatedData.issues)}`
    );
  }

  return validatedData.output;
}

async function generateCharacterInteractive(
  {
    type,
    characters,
    interactiveId,
    dynamics,
    bookId,
    artStyle
  }: {
    characters: Array<{
      id: string;
      friendlyId: string;
      name: string;
      description: string | null;
      imageUrl: string;
      selectedArcId: string;
    }>;
    type: 'CHARACTER_HORIZONTAL' | 'CHARACTER_VERTICAL';
    interactiveId: string;
    dynamics: v.InferOutput<typeof CharacterDynamicsOutputSchema>;
    bookId: string;
    artStyle: string | null;
  },
  ctx: WorkflowContext
) {
  const aspectRatio = type === 'CHARACTER_HORIZONTAL' ? '16:9' : '9:16';

  // Step 1: Create character reference grid
  ctx.log.info('Creating character reference grid');
  const charactersWithBytes = await Promise.all(
    characters.map(async (c) => {
      const { relPath, mimeType } = parseAssetUrl(c.imageUrl);
      const data = await ctx.fs.read(relPath);
      return { name: c.name, imageBytes: data, mimeType };
    })
  );
  const { gridBase64 } = await createCharacterReferenceGrid(charactersWithBytes);
  void debugImage(gridBase64, 'Reference Grid');

  // Build character descriptions from dynamics (already enhanced by character-dynamics prompt)
  const characterDescriptions = dynamics.characters
    .map(
      (
        c /* may have been a temporary Google thing, but including id="${c.id}" here led to INTERNAL_ERROR in Googleverse */
      ) => `<character name="${c.name}">${c.description}</character>`
    )
    .join('\n');

  const prompt = `<scene_description>
NOTE: Character appearances can be cross-referenced with the provided reference grid image below. Use the visual references for accurate depictions of each named character.

<characters>
${characterDescriptions}
</characters>

<scene>
${dynamics.scene}
</scene>
</scene_description>

${artStyle ? `Please generate this scene in ${artStyle}` : 'Please generate this illustrated scene'}, placing the characters from the reference grid in their specified poses and positions within the described environment.`;

  console.log('generate', prompt);

  void bookId;
  const chat = createImageChatSession(getProvider('image_generation_interactive'), {
    aspectRatio,
    onRetry: (error, attempt, max) =>
      ctx.log.info(
        `Image generation error (${error.message}), retrying (attempt ${attempt}/${max})`
      )
  });

  // Step 2: Generate image with reference grid
  ctx.log.info('Generating character interactive');

  const response1 = await chat.sendMessage(
    {
      text: prompt,
      images: [
        {
          mimeType: 'image/png',
          data: gridBase64
        }
      ]
    },
    { expectImage: true }
  );
  let imageData = response1.image;

  void debugImage(encode(imageData.data), 'Generated Scene (Original)');

  const revisedCharacterDescriptions = await reviseCharacterDescriptions(
    dynamics.characters,
    ctx
  );

  // Step 3: Self-check the generated image for consistency issues
  const MAX_REVISION_ATTEMPTS = 2;
  for (let attempt = 0; attempt < MAX_REVISION_ATTEMPTS; attempt++) {
    ctx.log.info(
      `Running image self-check (attempt ${attempt + 1}/${MAX_REVISION_ATTEMPTS})`
    );

    const selfCheckPrompt = `You are reviewing a generated illustration for character consistency issues. Compare the generated scene image against the reference grid of character headshots.

${revisedCharacterDescriptions}

<scene_layout>
${dynamics.scene}
</scene_layout>

**Review the generated image for these specific issues:**

1. **Character Consistency**: Does each character in the scene match their reference headshot? Check for:
   - Gender presentation
   - Hair color/style mismatches
   - Skin tone inconsistencies
   - Eye color differences
   - Missing or incorrect distinctive features (scars, tattoos, relics, etc.)

2. **Duplicate Characters**: Are there any extra figures that appear to be duplicates or unintended additions? Check for:
   - Two figures that look like the same character
   - Extra people/creatures not in the character list
   - Background figures that too closely resemble named characters

**Response Format:**

If the image looks correct with no significant issues, respond with exactly:
<review_result>IMAGE_APPROVED</review_result>

If there are issues that need fixing, respond with:
<review_result>
<issues>
<issue location="[position in image, e.g., 'mid-ground left']" character="[character name or 'unknown']">[Specific description of the problem and how to fix it]</issue>
...
</issues>
</review_result>

Be specific about locations and what needs to change. Focus only on significant visual inconsistencies, not minor stylistic differences.`;

    console.log('selfCheckPrompt', selfCheckPrompt);

    const { model: evalModel, apiKey: evalApiKey } = getImageEvaluationPiModel();
    const selfCheckMessage = await completeOrThrow(
      evalModel,
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: selfCheckPrompt },
              { type: 'image', data: gridBase64, mimeType: 'image/png' },
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
    ctx.log.withMetadata({ reviewText }).info('Self-check review result');

    // Check if image was approved
    if (reviewText.includes('IMAGE_APPROVED')) {
      ctx.log.info('Image passed self-check validation');
      break;
    }

    // Extract issues from the review
    const reviewAst = parse(reviewText);
    const issueNodes = querySelectorAll(reviewAst, 'issue');

    const issues: string[] = [];
    for (const el of issueNodes) {
      const location = getAttribute(el, 'location') || 'unknown location';
      const character = getAttribute(el, 'character') || 'unknown';
      const description = getText(el).trim();
      if (description) {
        issues.push(`- ${location} (${character}): ${description}`);
      }
    }

    if (issues.length === 0) {
      ctx.log.info('No parseable issues found in review, treating as approved');
      break;
    }

    ctx.log
      .withMetadata({ issues, attempt })
      .info('Issues found, requesting image revision');

    // Request a revised image from the original chat
    const revisionPrompt = `The generated image has some consistency issues that need to be fixed. Please generate a revised version of the scene with these corrections:

${issues.join('\n')}

Keep everything else the same - same composition, poses, and environment. Only fix the specific issues listed above.`;
    console.log('revisionPrompt', revisionPrompt);
    const revisionResponse = await chat.sendMessage(revisionPrompt, {
      expectImage: true
    });

    imageData = revisionResponse.image;
    void debugImage(encode(imageData.data), `Generated Scene (Revision ${attempt + 1})`);
    ctx.log.info('Received revised image');
  }

  const interactiveUrl = buildAssetUrl(
    `book-interactive/${interactiveId}`,
    imageData.mimeType
  );
  await ctx.fs.write(parseAssetUrl(interactiveUrl).relPath, imageData.data);

  // Step 4: Get character positions
  const characterNames = characters.map((c) => c.name).join(', ');
  const positionsPrompt = `Please provide a detailed text description listing each character by name and their specific location in the image you just generated. For each character, describe:
- Their depth position (foreground/mid-ground/background)
- Their horizontal position (left/center/right)
- Their posture, action, and what they're doing
- Key visual details about their appearance or state

Format your response as XML:

<character_positions>
<character name="Character Name" type="entity_type">[Depth] [horizontal position], [detailed description of posture, action, and visual details].</character>
...
</character_positions>

For the type attribute, use high-level entity types for whole beings (e.g., "person", "dragon", "robot", "alien", "creature", "animal", etc.).

Example:
<character_positions>
<character name="Eldrin" type="person">Center foreground, standing with staff raised high, robes billowing in magical wind around him.</character>
<character name="Kara" type="person">Right mid-ground, crouched behind a stone pillar with bow drawn, watching the approaching enemy.</character>
<character name="Shadowfang" type="animal">Left foreground, massive wolf lying at Eldrin's feet, ears alert and watching the surroundings.</character>
</character_positions>

Include all characters (${characterNames}).`;

  ctx.log.info('Requesting character positions');
  const response2 = await chat.sendMessage(positionsPrompt);
  const positionsXml = response2.text;

  if (!positionsXml) {
    throw new UnrecoverableError('No character positions returned in second response');
  }

  // Parse XML response
  const positionsAst = parse(positionsXml);

  // Extract character positions
  const positionElements = querySelectorAll(
    positionsAst,
    'character_positions > character'
  );
  const positions: InteractiveEntityPosition[] = [];

  for (const el of positionElements) {
    const name = getAttribute(el, 'name');
    const segmentClass = getAttribute(el, 'type');
    const description = getText(el).trim();

    if (name && description && segmentClass) {
      positions.push({ name, description, segmentClass });
    }
  }

  if (positions.length === 0) {
    throw new UnrecoverableError('No character descriptions found in response');
  }

  // Step 5: Get refined character descriptions based on what's actually visible in the generated image
  ctx.log.info('Requesting refined character descriptions');

  // Build the canonical descriptions XML
  const canonicalDescriptionsXml = dynamics.characters
    .map((c) => `<character name="${c.name}">${c.description}</character>`)
    .join('\n');

  const refinedDescriptionsPrompt = `Now, please create refined character descriptions by starting from the canonical descriptions below and adjusting them to match what was actually generated in the image. The refined descriptions must be AT LEAST as long and detailed as the canonical originals — your goal is to preserve the canonical's richness while correcting any details that differ in the generated image.

Here are the canonical descriptions that were used to generate the image:

<canonical_descriptions>
${canonicalDescriptionsXml}
</canonical_descriptions>

## YOUR TASK

For each character, start from their canonical description and produce a refined version that reconciles it with the generated image. The refined description should read as a complete, standalone visual reference with enough detail for an artist to faithfully recreate the character. Follow these guidelines:

1. **Start from the canonical and preserve its depth** — Use the canonical description as your foundation. Every specific detail in the canonical (textures, materials, weathering, fit, construction details, physical qualities) should carry over into the refined version unless the image clearly contradicts it. If the canonical says "supple reinforced leather showing subtle wear from intensified conflicts," keep that level of textural specificity — do not reduce it to just "leather." Your refined description should be comparable in length and specificity to the canonical input.

2. **Correct only what the image changed** — If the generated image shows something different from the canonical (different color, different garment, missing or added equipment), describe what the image actually shows, but with the same granular detail the canonical used. For example, if the canonical describes black leathers but the image shows brown, write the same rich description but with "brown" instead of "black."

3. **Define in-world terms visually** — Any in-world terms (e.g., "relic", "sigil", "warden's mark") must include a visual definition in parentheses immediately after the term. For example: "wears a silver glyph (a coin-sized magical symbol etched into a metal disc that glows faintly blue) on his lapel" or "bears the warden's mark (a pale branching scar pattern resembling lightning across the left shoulder)." Each description will be read independently, so define terms every time they appear, even if already defined for another character.

4. **Describe the full spatial extent of visible features** — When a feature like a tattoo, scar, or marking is visible, describe its COMPLETE visible coverage using the canonical as a guide for what to look for. If a tattoo covers the arm AND extends up the neck, include both areas.

5. **Preserve canonical details for features that are hard to see** — Eye color, gender, skin tone, hair color/style, age, height, body type/build, and hidden markings (tattoos, scars, relics under clothing) should be kept from the canonical even if not perfectly visible in the stylized image. Physical bearing and presence (e.g., "towering," "powerfully muscled," "radiating combat readiness") are visual qualities that should be preserved.

---

## WHAT TO INCLUDE

Treat the canonical description as a checklist — every detail in it should appear in your refined version (adjusted if needed) plus any new details visible in the image. Specifically:

- **Physical features**: height, build, musculature, skin tone, complexion, scars, tattoos, markings, hair color/style, eye color, age, gender, physical bearing and presence
- **Clothing and armor**: every garment, its material, color, fit, texture, wear, construction details, and how it sits on the body — use the canonical's level of detail, corrected where the image differs
- **Equipment and accessories**: weapons, jewelry, insignia, sashes, medals, straps, scabbards — with full material and condition detail
- **Distinctive features**: anything that makes this character visually unique

**Do not include** action verbs describing what the character is doing in the scene (e.g., "charging forward," "raising a sword") — poses and actions are captured separately. However, DO include static physical qualities like bearing, posture type, and presence (e.g., "unyieldingly erect military posture," "powerful combatant's build") as these are intrinsic to the character's appearance.

---

## EXAMPLE

**Canonical input:**
Lean wiry elf of indeterminate ancient age sharp angular features high cheekbones; skin pale silvery faint luminescent undertone catching ambient light; eyes deep violet almost black flecks of gold visible in direct light; hair stark white flowing past shoulders partially gathered in intricate braided crown woven through with thin copper wire and tiny glass vials containing luminescent blue liquid; wears long layered robes deep indigo fabric threadbare at hems and cuffs stained with alchemical residue splotches of ochre verdigris silver; leather bandolier strapped across chest holding array of stoppered glass vials filled with liquids varying colors amber to deep crimson; fingers perpetually stained dark at tips decades of reagent work nails trimmed short practical; thin silver circlet resting on brow set with single cracked amethyst pulsing faint inner light.

**BAD refined output** (too short, lost most detail):
Lean elf with white hair and violet eyes; wears purple robes with a leather bandolier of vials across the chest and a silver circlet.

**GOOD refined output** (preserves canonical depth, adjusts only what the image changed):
Lean wiry elf of indeterminate ancient age with sharp angular features and high cheekbones; skin pale silvery with faint luminescent undertone; eyes deep violet almost black with flecks of gold visible in direct light; hair stark white flowing past shoulders partially gathered in intricate braided crown woven through with thin copper wire and tiny glass vials containing luminescent blue liquid; wears long layered robes of deep plum-purple fabric threadbare at hems and cuffs stained with alchemical residue in splotches of ochre verdigris and silver; worn leather bandolier strapped across chest holding an array of stoppered glass vials filled with liquids of varying colors from amber to deep crimson; fingers perpetually stained dark at tips from decades of reagent work with nails trimmed short and practical; thin silver circlet resting on brow set with single cracked amethyst pulsing with faint inner light; leather satchel at the hip bulging with rolled parchments not present in the canonical description but visible in the generated image.

Notice the good output preserved every detail from the canonical (luminescent undertone, braided crown with copper wire and vials, threadbare hems, ochre/verdigris/silver stains, stained fingertips, cracked amethyst), changed only "deep indigo" to "deep plum-purple" to match the image, and added the satchel that appeared in the image — all at the same level of specificity.

---

## OUTPUT FORMAT

<refined_descriptions>
<character name="Character Name">Detailed visual description as flowing prose using semicolons to separate major sections (physical features; clothing and armor; equipment and accessories). The description must be at least as long as the canonical input — do not summarize or condense.</character>
...
</refined_descriptions>

Include all characters (${characterNames}).`;

  const response3 = await chat.sendMessage(refinedDescriptionsPrompt);
  const refinedXml = response3.text;

  const refinedDescriptions: Array<{ name: string; description: string }> = [];

  if (refinedXml) {
    const refinedAst = parse(refinedXml);
    const refinedElements = querySelectorAll(
      refinedAst,
      'refined_descriptions > character'
    );

    for (const el of refinedElements) {
      const name = getAttribute(el, 'name');
      const description = getText(el).trim();

      if (name && description) {
        refinedDescriptions.push({ name, description });
      }
    }

    ctx.log
      .withMetadata({ count: refinedDescriptions.length })
      .info('Extracted refined character descriptions');

    // Log comparison of original vs refined descriptions
    for (const refined of refinedDescriptions) {
      const original = dynamics.characters.find((c) => c.name === refined.name);
      if (original) {
        ctx.log
          .withMetadata({
            characterName: refined.name,
            originalDescription: original.description,
            refinedDescription: refined.description
          })
          .info('Character description refinement');
      }
    }
  } else {
    ctx.log.warn('No refined descriptions returned');
  }

  // Step 6: Segment the image and match to entities
  ctx.log.info('Segmenting interactive image');
  const segmentClasses = [...new Set(positions.map((p) => p.segmentClass))].join(',');
  const {
    predictions: mergedPredictions,
    width,
    height
  } = await segmentAndFilter(
    getSegmentationProvider(),
    imageData.data,
    segmentClasses,
    ctx
  );

  // Create numbered overlay image
  ctx.log.info('Creating numbered overlay image');
  const jimpImage = await Jimp.read(imageData.data.slice().buffer);

  const items = mergedPredictions.map((prediction, idx) => ({
    points: prediction.points,
    number: idx + 1
  }));

  const numberedImageBase64 = await createNumberedOverlayImage(jimpImage, items);
  await debugImage(numberedImageBase64, 'NUMBERED COMPOSITE IMAGE');

  // Match segments to character entities
  ctx.log.info('Matching segments to character entities');
  const positionDescription = positions
    .map((p) => `*   **${p.name}:** ${p.description}`)
    .join('\n');

  const detectionToEntityId = await matchSegmentsToEntities(
    {
      numberedImageBase64,
      positionDescription,
      predictions: mergedPredictions,
      entities: characters,
      entityType: 'character'
    },
    ctx
  );

  // Create maps for position and description lookup
  const positionByName = new Map(positions.map((p) => [p.name, p.description]));
  const descriptionByName = new Map(
    refinedDescriptions.map((d) => [d.name, d.description])
  );
  const nameByEntityId = new Map(characters.map((c) => [c.id, c.name]));
  const characterById = new Map(characters.map((c) => [c.id, c]));

  // Detect heads for each matched character
  ctx.log.info('Detecting heads for matched characters');
  const detectionToHeadPoints = new Map<string, Point[]>();

  for (let i = 0; i < mergedPredictions.length; i++) {
    const prediction = mergedPredictions[i];
    const detectionNum = (i + 1).toString();
    const entityId = detectionToEntityId[detectionNum];

    if (!entityId) {
      continue; // Skip unmatched detections
    }

    // Get entity details for head matching
    const character = characterById.get(entityId);
    if (!character) {
      ctx.log.withMetadata({ entityId }).warn('Character not found for head detection');
      continue;
    }

    // Get bounding box for this character's body
    const bbox = getBoundingBox(prediction.points);

    // Crop the character from the composite image using polygon mask
    const croppedImage = cropToPolygon(jimpImage, prediction.points);
    const croppedImageData = await croppedImage.getBuffer('image/png');

    // Detect head in the cropped area (will use LLM if multiple heads found)
    const headPoints = await detectHeadInCrop(
      croppedImageData,
      bbox.x,
      bbox.y,
      {
        name: character.name
      },
      ctx
    );

    if (headPoints) {
      detectionToHeadPoints.set(detectionNum, headPoints);
      ctx.log
        .withMetadata({ detectionNum, entityId })
        .info('Head detected for character');
    } else {
      ctx.log
        .withMetadata({ detectionNum, entityId })
        .warn('No head detected for character');
    }
  }

  // Build click areas array with heads attached
  const clickAreas: Array<{
    entityId: string;
    points: Point[];
    headArea: Point[] | null;
    segmentClass: string;
    position: string;
    description: string | null;
    selectedArcId: string;
  }> = [];

  // Create lookup for selectedArcId by entityId
  const selectedArcIdByEntityId = new Map(characters.map((c) => [c.id, c.selectedArcId]));

  for (let i = 0; i < mergedPredictions.length; i++) {
    const prediction = mergedPredictions[i];
    const detectionNum = (i + 1).toString();
    const entityId = detectionToEntityId[detectionNum];

    if (!entityId) {
      continue; // Skip unmatched detections
    }

    // Look up position and description: entityId -> name -> position/description
    const entityName = nameByEntityId.get(entityId);
    const position = entityName ? positionByName.get(entityName) : undefined;
    const description = entityName ? (descriptionByName.get(entityName) ?? null) : null;
    const selectedArcId = selectedArcIdByEntityId.get(entityId);

    if (!position || !selectedArcId) {
      ctx.log
        .withMetadata({
          entityId,
          entityName,
          hasPosition: !!position,
          hasArcId: !!selectedArcId
        })
        .warn('Missing position or selectedArcId for entity, skipping');
      continue;
    }

    const headArea = detectionToHeadPoints.get(detectionNum) || null;

    clickAreas.push({
      entityId,
      points: prediction.points,
      headArea,
      segmentClass: prediction.class,
      position,
      description,
      selectedArcId
    });
  }

  if (clickAreas.length === 0) {
    throw new UnrecoverableError('No matched entities found for interactive');
  }

  // Count head detection stats
  const headsDetected = clickAreas.filter((ca) => ca.headArea !== null).length;

  ctx.log
    .withMetadata({
      totalClickAreas: clickAreas.length,
      uniqueEntities: new Set(clickAreas.map((ca) => ca.entityId)).size,
      headsDetected,
      bodiesWithoutHeads: clickAreas.length - headsDetected,
      interactiveUrl,
      width,
      height
    })
    .info('Successfully matched character entities to click areas');

  return { interactiveUrl, width, height, clickAreas };
}

/**
 * Classify each character's segmentClass (e.g. "person", "dragon", "robot")
 * from their description. Used by CHARACTER_SIMPLE where no scene image exists
 * to observe positions from.
 */
async function classifyCharacterSegmentClasses(
  characters: { id: string; name: string; description: string | null }[],
  ctx: WorkflowContext
): Promise<Map<string, string>> {
  const { model, apiKey, reasoning } = ctx.getPiModel('text');
  const message = await completeOrThrow(
    model,
    {
      messages: [
        {
          role: 'user',
          content: dedent`Classify each character below by the high-level entity type
          that best describes their whole being. Examples: "person", "dragon", "robot",
          "alien", "creature", "animal". Use "person" for humans, elves, vampires, and
          other broadly humanoid characters.

          <characters>
          ${characters
            .map(
              (c) =>
                `<character id="${c.id}" name="${c.name}">${c.description ?? ''}</character>`
            )
            .join('\n')}
          </characters>

          Respond with XML:
          <classifications>
            <character id="..." type="person" />
            <!-- repeat for all ${characters.length} characters -->
          </classifications>`,
          timestamp: Date.now()
        }
      ]
    },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);

  const xml = getAssistantText(message);
  const ast = parse(xml);
  const elements = querySelectorAll(ast, 'classifications > character');
  const result = new Map<string, string>();
  for (const el of elements) {
    const id = getAttribute(el, 'id');
    const type = getAttribute(el, 'type');
    if (id && type) result.set(id, type);
  }
  return result;
}

async function reviseCharacterDescriptions(
  characterDescriptions: {
    name: string;
    description: string;
  }[],
  ctx: WorkflowContext
) {
  const { model, apiKey, reasoning } = ctx.getPiModel('text');
  const message = await completeOrThrow(
    model,
    {
      messages: [
        {
          role: 'user',
          content: dedent`Please extract the following details from the following character descriptions:

          <character_descriptions>
          ${characterDescriptions.map((cd) => `<character name="${cd.name}" description="${cd.description}" />`).join('\n')}
          </character_descriptions>

          Details to extract:

          - Gender presentation
          - Hair color/style
          - Skin tone
          - Eye color
          - Distinctive features (scars, tattoos, relics, etc.)

          Return your response in XML format e.g.
          <characters>
            <character name="John Doe" gender="male" hair="brown" skin="light" eyes="blue" features="big scar across forehead" />
            <!-- repeat for all ${characterDescriptions.length} characters -->
          </characters>
          `,
          timestamp: Date.now()
        }
      ]
    },
    { apiKey, reasoning, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);
  return getAssistantText(message);
}

/**
 * Returns arcs with their percentage chapter span calculated.
 * The percentage is relative to the total chapters covered (max end chapter + 1).
 */
function getArcsWithPercentageChapterSpan<
  T extends { startChapterIdx?: number | null; endChapterIdx?: number | null }
>(arcs: T[]): Array<T & { percentageChapterSpan: number }> {
  if (arcs.length === 0) return [];

  // Find the max end chapter to calculate percentage against total book span
  const maxEndChapter = Math.max(...arcs.map((a) => a.endChapterIdx ?? 0));
  const totalChapters = maxEndChapter + 1;

  return arcs.map((arc) => {
    const startIdx = arc.startChapterIdx ?? 0;
    const endIdx = arc.endChapterIdx ?? 0;
    const chapterSpan = Math.abs(endIdx - startIdx) + 1;
    const percentageChapterSpan =
      totalChapters > 0 ? (chapterSpan / totalChapters) * 100 : 0;
    return { ...arc, percentageChapterSpan };
  });
}

/**
 * Detect head within a cropped character image.
 * Returns head points translated back to full image coordinates.
 * When multiple heads are found, picks the topmost one (smallest Y centroid)
 * since the head attached to a body is always above it.
 */
async function detectHeadInCrop(
  croppedImageData: Uint8Array,
  offsetX: number,
  offsetY: number,
  entity: {
    name: string;
  },
  ctx: WorkflowContext
): Promise<Point[] | null> {
  ctx.log
    .withMetadata({ entityName: entity.name })
    .info('Detecting head in cropped character');

  const validHeads = await detectHeads(getSegmentationProvider(), croppedImageData, ctx, {
    minArea: MIN_HEAD_POLYGON_AREA,
    minConfidence: 0.3
  });

  if (validHeads.length === 0) {
    ctx.log.warn('No valid heads found in cropped image');
    return null;
  }

  let selectedHead: RoboflowPrediction;

  if (validHeads.length === 1) {
    selectedHead = validHeads[0];
    ctx.log.info('Single head detected, using it');
  } else {
    // Multiple heads — pick the topmost one (smallest average Y).
    // The head belonging to this body segment is always on top of it;
    // other detections are neighboring characters bleeding into the crop.
    ctx.log
      .withMetadata({ headCount: validHeads.length, entityName: entity.name })
      .info('Multiple heads detected, picking topmost');

    selectedHead = validHeads.reduce((best, head) => {
      const avgY = (p: Point[]) => p.reduce((s, pt) => s + pt.y, 0) / p.length;
      return avgY(head.points) < avgY(best.points) ? head : best;
    });

    ctx.log
      .withMetadata({
        entityName: entity.name,
        selectedY: (
          selectedHead.points.reduce((s, p) => s + p.y, 0) / selectedHead.points.length
        ).toFixed(0),
        totalHeads: validHeads.length
      })
      .info('Selected topmost head');
  }

  // Translate points back to full image coordinates
  const translatedPoints = selectedHead.points.map((p) => ({
    x: p.x + offsetX,
    y: p.y + offsetY
  }));

  ctx.log
    .withMetadata({
      confidence: selectedHead.confidence,
      pointCount: translatedPoints.length
    })
    .info('Head detected successfully');

  return translatedPoints;
}
