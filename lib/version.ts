/**
 * What this bundle was built as.
 *
 * Inlined by `next.config.ts` from package.json, so it is a literal in the
 * shipped JS rather than a lookup. Empty outside a Next build, which is every
 * unit test: nothing here should treat that as a version, and the update check
 * skips its comparison when it sees one.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '';
