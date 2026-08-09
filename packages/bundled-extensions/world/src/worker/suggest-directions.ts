import { getText, parse, querySelectorAll } from '@branch-fiction/extension-sdk/llm/xml';
import { completeOrThrow, getAssistantText } from '@branch-fiction/extension-sdk/pi-ai';
import { v7 as uuidv7 } from 'uuid';

import oysterDirectingNextActions from '@/lib/prompts/oyster-directing-next-actions';
import { createWorkflowFunction } from '@/worker/handler';

export interface SuggestDirectionsPayload {
  worldPrompt: string;
  priorDirections: string[];
  latestDirection: string;
}

export interface SuggestDirectionsResult {
  suggestedActions: string[];
}

export async function suggestDirections(
  payload: SuggestDirectionsPayload
): Promise<SuggestDirectionsResult> {
  return runSuggestDirections({ executionId: uuidv7(), payload });
}

const runSuggestDirections = createWorkflowFunction<
  SuggestDirectionsPayload,
  SuggestDirectionsPayload,
  SuggestDirectionsResult
>(
  { name: 'Suggest next directions' },
  async (
    { worldPrompt, priorDirections, latestDirection },
    ctx
  ): Promise<SuggestDirectionsResult> => {
    const promptText = oysterDirectingNextActions.render({
      worldPrompt,
      priorDirections,
      latestDirection
    });

    const { model, apiKey, reasoning } = ctx.getPiModel('text');
    const message = await completeOrThrow(
      model,
      { messages: [{ role: 'user', content: promptText, timestamp: Date.now() }] },
      { apiKey, reasoning, sessionId: uuidv7() }
    );
    ctx.trackUsage(message);

    const ast = parse(getAssistantText(message));
    const suggestedActions = querySelectorAll(ast, 'suggested_actions action')
      .map((node) => getText(node).trim())
      .filter(Boolean);

    ctx.log
      .withMetadata({ latestDirection, suggestedActions })
      .info('Next directions suggested');

    return { suggestedActions };
  }
);
