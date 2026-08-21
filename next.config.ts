import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from "next";

/**
 * The version this build was cut at, inlined into both bundles.
 *
 * The update check compares what a running tab was built as against what the
 * deployment answering `/api/version` reports, so both halves have to read the
 * same number from the same place. package.json is that place: the release rule
 * already says to bump it on every change.
 *
 * Read from the working directory rather than through an import, because
 * `next.config.ts` is transpiled and neither a JSON import attribute nor
 * `import.meta.url` is guaranteed to survive that. Next always runs from the
 * project root.
 *
 * Nothing else belongs in here. A `webpack` key, including one a plugin adds,
 * makes `next build` exit under Turbopack.
 */
const { version } = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
) as { version: string };

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: version },
};

export default nextConfig;
