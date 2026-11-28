/** Trello object ids (members, boards) are 24 hex characters. */
export const isTrelloId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v);

/** Trimmed string within a length range, or null. */
export function cleanText(v: unknown, max: number, min = 1): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (s.length < min || s.length > max) return null;
  return s;
}

/** Optional multi-line text (keeps line breaks), or null when empty. */
export function cleanLongText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\r\n/g, '\n').trim();
  if (!s || s.length > max) return null;
  return s;
}

/** Largest dashboard config accepted for saving or sharing. */
export const MAX_CONFIG_BYTES = 200_000;
