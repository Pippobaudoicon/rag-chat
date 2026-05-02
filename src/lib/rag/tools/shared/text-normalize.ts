/**
 * Text normalization helpers used across multiple RAG tools.
 *
 * Lowercases, strips diacritics, collapses non-alphanumeric characters to
 * spaces, and trims. This is intentionally permissive so that fuzzy matches
 * against scripture book names, speaker names, and titles work across
 * languages and punctuation variants.
 */
export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Stricter book-name normalization. Identical to {@link normalizeForMatch}
 * today, kept as a separate export so future scripture-specific tweaks (e.g.
 * mapping ordinal numerals) can land in one place without affecting other
 * tools.
 */
export function normalizeBookForStrictMatch(value: string): string {
  return normalizeForMatch(value).replace(/\s+/g, " ").trim();
}
