import {
  getText,
  parse,
  querySelector,
  querySelectorAll
} from '@branch-fiction/extension-sdk/llm/xml';
import { completeOrThrow, getAssistantText } from '@branch-fiction/extension-sdk/pi-ai';
import { v7 as uuidv7 } from 'uuid';

import heliosEvolve from '@/lib/prompts/helios-evolve';
import { createWorkflowFunction } from '@/worker/handler';

export interface EvolveHeliosPromptPayload {
  currentPrompt: string;
  userIntent: string;
}

export interface EvolveHeliosPromptResult {
  prompt: string;
  suggestedActions: string[];
}

export async function evolveHeliosPrompt(
  payload: EvolveHeliosPromptPayload
): Promise<EvolveHeliosPromptResult> {
  return runEvolveHeliosPrompt({ executionId: uuidv7(), payload });
}

const runEvolveHeliosPrompt = createWorkflowFunction<
  EvolveHeliosPromptPayload,
  EvolveHeliosPromptPayload,
  EvolveHeliosPromptResult
>(
  { name: 'Evolve helios prompt' },
  async ({ currentPrompt, userIntent }, ctx): Promise<EvolveHeliosPromptResult> => {
    const promptText = heliosEvolve.render({ currentPrompt, userIntent });

    const { model, apiKey, reasoning } = ctx.getPiModel('text');
    const message = await completeOrThrow(
      model,
      { messages: [{ role: 'user', content: promptText, timestamp: Date.now() }] },
      { apiKey, reasoning, sessionId: uuidv7() }
    );
    ctx.trackUsage(message);

    const text = getAssistantText(message);
    const ast = parse(text);
    const evolved = getText(querySelector(ast, 'world_prompt')).trim();
    if (!evolved) {
      throw new Error('LLM did not return a <world_prompt>');
    }

    const suggestedActions = querySelectorAll(ast, 'suggested_actions action')
      .map((node) => getText(node).trim())
      .filter(Boolean);

    // console.log(`[world] helios evolve:\n  intent: ${userIntent}\n  prompt: ${evolved}`);
    ctx.log.withMetadata({ userIntent, evolved }).info('Helios prompt evolved');

    return { prompt: evolved, suggestedActions };
  }
);
