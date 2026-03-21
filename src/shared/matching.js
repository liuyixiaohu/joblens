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
