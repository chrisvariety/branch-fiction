import { completeOrThrow, getAssistantText } from '@branch-fiction/extension-sdk/pi-ai';
import { UnrecoverableError } from '@branch-fiction/extension-sdk/worker/error-types';
import { v7 as uuidv7 } from 'uuid';

import { extractJsonFromResponse } from '@/lib/llm/extract-json';
import { DEBUG_MODE } from '@/lib/media/debug';
import { type WorkflowContext } from '@/worker/handler';
import { getImageEvaluationPiModel } from '@/worker/providers';

import { RoboflowPrediction } from './prediction';

export type EntityType = 'character' | 'place';

export interface MatchableEntity {
  id: string;
  friendlyId: string;
  name: string;
}

// Match numbered segmentation predictions to entities using LLM vision.
//
// Takes a numbered overlay image and position descriptions, then uses an LLM
// to match each numbered polygon to the corresponding entity based on
// spatial relationships described in the positions.
//
// Rreturns Record mapping detection numbers (1-indexed strings) to entity IDs
export async function matchSegmentsToEntities(
  {
    numberedImageBase64,
    positionDescription,
    predictions,
    entities,
    entityType
  }: {
    numberedImageBase64: string;
    positionDescription: string;
    predictions: RoboflowPrediction[];
    entities: MatchableEntity[];
    entityType: EntityType;
  },
  ctx: WorkflowContext
): Promise<Record<string, string>> {
  const entityLabel = entityType === 'character' ? 'character' : 'location';

  // Build a mapping of entity friendlyIds to names
  const entityMapping = entities
    .map((entity) => `- **${entity.name}** (ID: ${entity.friendlyId})`)
    .join('\n');

  // Build example output for the prompt
  const exampleIds = entities.slice(0, 3).map((entity) => entity.friendlyId);
  const exampleOutput =
    exampleIds.length >= 2
      ? `{"1": "${exampleIds[0]}", "2": "${exampleIds[1]}"${exampleIds[2] ? `, "3": "${exampleIds[2]}"` : ''}}`
      : `{"1": "${entityLabel}-id", "2": "${entityLabel}-id"}`;

  const prompt = `You are matching numbered detections to ${entityLabel} IDs based on their positions.

The image shows a composite scene with numbered shaded polygons. Each polygon has a colored outline, a shaded semi-transparent fill, and a white circle with a number in the center.

Here are the ${entityLabel} positions in the scene:
${positionDescription}

${entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1)} ID mapping:
${entityMapping}

Your task:
1. Match each numbered polygon to its corresponding ${entityLabel} based on the position descriptions
${
  entityType === 'character'
    ? `2. If multiple numbered polygons match the same ${entityLabel}, select only the BEST one based on this priority:
   - Choose the polygon that contains the MOST REPRESENTATIVE version of the ${entityLabel}
   - Ideally, this should be the LARGEST area that includes their HEAD (if applicable)
3. Each ${entityLabel} ID should appear at most once in your output`
    : `2. Each ${entityLabel} ID should appear at most once in your output`
}

Output a JSON object mapping detection numbers (1-${predictions.length}) to ${entityLabel} IDs.
Example: ${exampleOutput}

Output ONLY the JSON object, no other text.`;

  if (DEBUG_MODE) {
    console.log(`\n=== ${entityType.toUpperCase()} MATCHING PROMPT ===`);
    console.log(prompt);
    console.log('=====================================\n');
  }

  const friendlyIdToEntityId = new Map(
    entities.map((entity) => [entity.friendlyId, entity.id])
  );

  const { model, apiKey } = getImageEvaluationPiModel();
  const message = await completeOrThrow(
    model,
    {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', data: numberedImageBase64, mimeType: 'image/png' }
          ],
          timestamp: Date.now()
        }
      ]
    },
    { apiKey, sessionId: uuidv7() }
  );
  ctx.trackUsage(message);
  const content = getAssistantText(message);
  if (!content) {
    throw new UnrecoverableError('No response from LLM for matching');
  }

  const jsonStr = extractJsonFromResponse(content);
  const matches = JSON.parse(jsonStr) as Record<string, string>;

  const detectionToEntityId: Record<string, string> = {};
  for (const [detectionNum, identifier] of Object.entries(matches)) {
    const entityId = friendlyIdToEntityId.get(identifier);
    if (entityId) {
      detectionToEntityId[detectionNum] = entityId;
    } else {
      ctx.log
        .withMetadata({ detectionNum, identifier })
        .warn('No entity found for matched identifier');
    }
  }

  ctx.log
    .withMetadata({
      matchCount: Object.keys(detectionToEntityId).length,
      entityType
    })
    .info(
      `${entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1)} matching complete`
    );

  if (DEBUG_MODE) {
    console.log('\n=== MATCHING RESULTS ===');
    console.log(`Total detections: ${predictions.length}`);
    console.log(`Matched detections: ${Object.keys(detectionToEntityId).length}`);
    console.log('Mappings:', JSON.stringify(detectionToEntityId, null, 2));
    console.log('========================\n');
  }

  return detectionToEntityId;
}
