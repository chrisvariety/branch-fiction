import { estimateTokenCount } from 'tokenx';

export function estimateTokens(text: string): number {
  return estimateTokenCount(text);
}
