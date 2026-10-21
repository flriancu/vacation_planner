const BASE_MS = 2000;
const MAX_MS = 60_000;

/**
 * How long to wait before retry number `attempt` (0, 1, 2…): 2 s, 4 s, 8 s… up to a minute,
 * plus up to a second of jitter so several tabs don't retry in step (Google's guidance for
 * Drive: exponential backoff on 429 and 5xx).
 */
export function retryDelay(attempt: number, random: () => number = Math.random): number {
  return Math.min(MAX_MS, BASE_MS * 2 ** attempt) + Math.floor(random() * 1000);
}
