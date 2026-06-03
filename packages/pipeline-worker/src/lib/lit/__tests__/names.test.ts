import { describe, expect, test } from 'vitest';

import { entityNamesFormatted } from '../names';

describe('entityNamesFormatted', () => {
  test('should return primary name when no additional names', () => {
    const entity = { name: 'John', names: ['John'] };
    const result = entityNamesFormatted(entity);
    expect(result).toBe('John');
  });

  test('should return primary name even when type is present', () => {
    const entity = { name: 'John', names: ['John'], type: 'CHARACTER' };
    const result = entityNamesFormatted(entity);
    expect(result).toBe('John');
  });

  test('should format single alias without type', () => {
    const entity = { name: 'John', names: ['John', 'Johnny'] };
    const result = entityNamesFormatted(entity);
    expect(result).toBe('John (Alias: Johnny)');
  });

  test('should format single alias without including type', () => {
    const entity = { name: 'John', names: ['John', 'Johnny'], type: 'CHARACTER' };
    const result = entityNamesFormatted(entity);
    expect(result).toBe('John (Alias: Johnny)');
  });

  test('should format multiple aliases without type', () => {
    const entity = { name: 'John', names: ['John', 'Johnny', 'Jack'] };
    const result = entityNamesFormatted(entity);
    expect(result).toBe('John (Aliases: Johnny, Jack)');
  });

  test('should format multiple aliases without including type', () => {
    const entity = { name: 'John', names: ['John', 'Johnny', 'Jack'], type: 'CHARACTER' };
    const result = entityNamesFormatted(entity);
    expect(result).toBe('John (Aliases: Johnny, Jack)');
  });

  test('should format aliases even when type is missing', () => {
    const entity = { name: 'John', names: ['John', 'Johnny'] };
    const result = entityNamesFormatted(entity);
    expect(result).toBe('John (Alias: Johnny)');
  });
});
