import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Direct Dexie writes are banned outside `lib/db/mutations.ts`.
 *
 * The whole offline design rests on one property: a local row change and its
 * outbox record are written in the same transaction, so "local state changed but
 * nothing got queued" cannot happen. A single stray `db.tasks.put()` in a
 * component breaks that silently, and the symptom shows up days later as a task
 * that exists on one device and nowhere else. A convention in a doc does not
 * survive contact with a hurry; a lint error does.
 */
const WRITE_METHODS = "put|add|update|delete|bulkPut|bulkAdd|bulkUpdate|bulkDelete|clear";

const bannedDexieWrites = {
  files: ["**/*.ts", "**/*.tsx"],
  ignores: [
    "lib/db/mutations.ts",
    // The sync engine applies canonical server rows, which by definition must not
    // generate outbox records. It gets the same exemption when it lands.
    "lib/sync/apply.ts",
    "**/*.test.ts",
    "**/*.test.tsx",
  ],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: `CallExpression > MemberExpression[property.name=/^(${WRITE_METHODS})$/] > MemberExpression[object.name="db"]`,
        message:
          "Write through lib/db/mutations.ts. Direct Dexie writes skip the outbox, so the change never syncs.",
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  bannedDexieWrites,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
