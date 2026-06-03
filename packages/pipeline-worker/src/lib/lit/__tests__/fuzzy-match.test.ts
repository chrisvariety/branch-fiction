import { describe, expect, test } from 'vitest';

import { fuzzyMatchByKey } from '../fuzzy-match';

const entities = [
  { friendlyId: 'running_path' },
  { friendlyId: 'ancient_stone_castle' },
  { friendlyId: 'boat_dock' },
  { friendlyId: 'garden' },
  { friendlyId: 'the_table' },
  { friendlyId: 'silver_coin' },
  { friendlyId: 'wooden_chest' }
];

const ids = (results: { friendlyId: string }[]) => results.map((r) => r.friendlyId);

describe('fuzzyMatchByKey', () => {
  test('exact match', () => {
    const r = fuzzyMatchByKey(entities, 'boat_dock', (e) => e.friendlyId);
    expect(ids(r)).toContain('boat_dock');
  });

  test('single-char insertion in needle (boats_dock -> boat_dock)', () => {
    const r = fuzzyMatchByKey(entities, 'boats_dock', (e) => e.friendlyId);
    expect(ids(r)).toContain('boat_dock');
  });

  test('single-char deletion in needle (garde -> garden)', () => {
    const r = fuzzyMatchByKey(entities, 'garde', (e) => e.friendlyId);
    expect(ids(r)).toContain('garden');
  });

  test('partial-needle / extra component (the_castle -> ancient_stone_castle)', () => {
    const r = fuzzyMatchByKey(entities, 'the_castle', (e) => e.friendlyId);
    expect(ids(r)).toContain('ancient_stone_castle');
  });

  test('abbreviation / shortening (run_path -> running_path)', () => {
    const r = fuzzyMatchByKey(entities, 'run_path', (e) => e.friendlyId);
    expect(ids(r)).toContain('running_path');
  });

  test('returns empty for completely unrelated needle', () => {
    const r = fuzzyMatchByKey(entities, 'xyzzy', (e) => e.friendlyId);
    expect(r).toEqual([]);
  });

  test('still surfaces fuzzy candidates for hallucinated ids (LLM decides)', () => {
    // Option (2): we surface closest candidates even when the LLM made
    // something up; the model gets to pick one or say "none of these".
    const r = fuzzyMatchByKey(entities, 'tables', (e) => e.friendlyId);
    expect(ids(r)).toContain('the_table');
  });

  test('respects limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      friendlyId: `thing_out_${i}`
    }));
    const r = fuzzyMatchByKey(many, 'out', (e) => e.friendlyId, 3);
    expect(r.length).toBeLessThanOrEqual(3);
  });

  test('preserves extra attributes via key selector', () => {
    const items = [{ friendlyId: 'garden', extra: 42 }];
    const r = fuzzyMatchByKey(items, 'garde', (e) => e.friendlyId);
    expect(r[0].extra).toBe(42);
  });

  test('empty needle returns empty', () => {
    const r = fuzzyMatchByKey(entities, '', (e) => e.friendlyId);
    expect(r).toEqual([]);
  });
});
