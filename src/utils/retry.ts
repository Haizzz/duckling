import { toMessage } from './error-utils';

export async function withRetry<T>(
  operation: () => Promise<T>,
  context: string,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error as Error;
      console.log(
        `${context} failed (attempt ${attempt}/${maxRetries}):`,
        error
      );

      if (attempt === maxRetries) {
        throw new Error(
          `${context} failed after ${maxRetries} attempts: ${toMessage(lastError)}`
        );
      }

      // Exponential backoff with jitter
      const delay = 1000 * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 0.1 * delay;
      await sleep(delay + jitter);
    }
  }

  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
