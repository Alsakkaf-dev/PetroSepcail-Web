// SF-02 (FR-SF02-001): "bilingual, diacritic/digit-tolerant" matching.
// Strips Arabic diacritics (tashkeel) and any character that isn't a plain
// Latin/Arabic letter or digit — so "20W-50" and "20w50" compare equal (the
// dash/case difference disappears), and Arabic text compares equal with or
// without diacritics. Applied identically to the query and to the stored
// text server-side (routes/catalog.ts), so this is the single normalization
// used on both sides of the match.
const ARABIC_DIACRITICS = /[ً-ْٰـ]/g; // tashkeel + tatweel
const NON_ALPHANUMERIC = /[^a-z0-9؀-ۿ]/g;

export function normalizeSearchText(input: string): string {
  return input.toLowerCase().replace(ARABIC_DIACRITICS, "").replace(NON_ALPHANUMERIC, "");
}
