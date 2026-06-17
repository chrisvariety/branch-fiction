export function parseDbCount(count: string | number | bigint | undefined) {
  if (typeof count === 'string') {
    return Number.parseInt(count, 10);
  }

  if (!count) {
    return 0;
  }

  if (typeof count === 'bigint') {
    return Number(count);
  }

  return count;
}
