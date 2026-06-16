import pRetry from 'p-retry';

export async function withGenAIRetry<T>(
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number;
    onRetry?: (error: Error, attempt: number, maxRetries: number) => void;
  }
): Promise<T> {
  const { maxRetries = 3, onRetry } = options ?? {};

  return await pRetry(fn, {
    retries: maxRetries,
    onFailedAttempt: ({ error, attemptNumber }) => {
      if (!isRetryableGenAIError(error)) {
        throw error;
      }
      onRetry?.(error, attemptNumber, maxRetries);
    }
  });
}

function isRetryableGenAIError(error: Error): boolean {
  const retryableStatuses = new Set([429, 500, 502, 503, 524]);
  // Network failures (fetch-based providers like xAI/Fal throw this on transient errors).
  if (error instanceof TypeError && error.message === 'fetch failed') {
    return true;
  }
  return (
    error.message === 'IMAGE_OTHER' ||
    error.message === 'NO_IMAGE' ||
    ('status' in error && retryableStatuses.has((error as { status: number }).status))
  );
}
