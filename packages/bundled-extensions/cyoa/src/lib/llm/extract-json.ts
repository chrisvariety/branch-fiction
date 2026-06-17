// Strip a markdown code fence (```json ... ```) from an LLM response, if present.
export function extractJsonFromResponse(content: string): string {
  const jsonMatch = content.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  return jsonMatch ? jsonMatch[1] : content;
}
