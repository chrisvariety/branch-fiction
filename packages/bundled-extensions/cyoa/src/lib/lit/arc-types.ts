export type ArcType =
  | 'CHARACTER'
  | 'RELATIONSHIP'
  | 'RELATED_RELATIONSHIP'
  | 'PLACE'
  | 'APPEARANCE'
  | 'APPELLATION';

type OneLetterString = string;

export function getArcTypePrefix(type: ArcType): string {
  const prefixMap: Record<string, OneLetterString> = {
    CHARACTER: 'C',
    RELATIONSHIP: 'R',
    RELATED_RELATIONSHIP: 'E',
    PLACE: 'P',
    APPEARANCE: 'A',
    APPELLATION: 'L'
  };
  return prefixMap[type] || 'X';
}

export function convertArcFriendlyIdPrefixToIsolated(friendlyIdPrefix: string): string {
  const prefix = friendlyIdPrefix.charAt(0); // one of getArcTypePrefix
  const rest = friendlyIdPrefix.slice(1);
  return `${prefix}I${rest}`;
}
