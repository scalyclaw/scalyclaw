/**
 * Normalize text for comparison: lowercase, collapse whitespace, trim.
 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Use single-row optimization
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val = Math.min(
        row[j] + 1,       // deletion
        row[j - 1] + 1,   // insertion
        prev + cost,       // substitution
      );
      prev = row[j];
      row[j] = val;
    }
  }

  return row[n];
}

/**
 * Compute similarity between two strings (0 = completely different, 1 = identical).
 * Normalizes both strings before comparison.
 */
const MAX_SIMILARITY_INPUT = 10_000;

export function similarity(a: string, b: string): number {
  const na = normalize(a).slice(0, MAX_SIMILARITY_INPUT);
  const nb = normalize(b).slice(0, MAX_SIMILARITY_INPUT);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}
