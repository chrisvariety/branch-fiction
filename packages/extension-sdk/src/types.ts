export type ProviderAuthShape =
  | { kind: 'none' }
  | { kind: 'bearer'; headerPrefix?: string }
  | { kind: 'header'; header: string }
  | { kind: 'queryParam'; param: string }
  | { kind: 'body'; field: string };

// if you add a new slot, update all three
export type Slot = 'piText' | 'piTextLight';

export const SLOT_KEYS: readonly Slot[] = ['piText', 'piTextLight'];

export const SLOT_LABELS: Record<Slot, string> = {
  piText: 'Text model',
  piTextLight: 'Light text model'
};

export function isKnownSlot(s: string): s is Slot {
  return (SLOT_KEYS as readonly string[]).includes(s);
}
