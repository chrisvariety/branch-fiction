export const DEFAULT_ART_STYLE =
  'polished, semi-realistic digital illustration style (not photorealistic)';

export function resolveArtStyle(artStyle: string | null | undefined): string {
  return artStyle ?? DEFAULT_ART_STYLE;
}
