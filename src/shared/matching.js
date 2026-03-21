// Sift — keyword matching utilities

/**
 * Build a case-insensitive regex from an array of keyword strings.
 * Special regex characters in keywords are escaped.
 */
export function keywordsToRegex(keywords) {
  return new RegExp(
    keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    "i"
  );
}

/**
 * Check if text contains any of the given keywords (case-insensitive substring match).
 * Returns the first matching keyword, or null if none match.
 */
export function matchesFeedKeyword(text, keywords) {
  if (!keywords || keywords.length === 0) return null;
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    if (kw && lower.includes(kw.toLowerCase())) return kw;
  }
  return null;
}
