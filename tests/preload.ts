// Loaded before every test file (see bunfig.toml).
import { afterAll, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testRoot = mkdtempSync(join(tmpdir(), "convertx-tests-"));

// Tests must never touch ./data/mydb.sqlite or a DB_PATH from the developer's shell.
process.env.DB_PATH = join(testRoot, "test.sqlite");
process.env.CONVERTX_TEST_ROOT = testRoot;
// Keep cumulative quota regressions small and independent of host configuration.
process.env.MAX_JOB_UPLOAD_SIZE_MB = "1";
process.env.MAX_JOB_OUTPUT_SIZE_MB = "1";

// Settings from the developer's shell or a .env file (which Bun loads automatically) must
// not change what the tests see, e.g. WEBROOT would move every page. src/helpers/env.ts
// reads them once at import; tests switch them with setEnv() from tests/pages/helpers/app.ts.
for (const name of [
  "ACCOUNT_REGISTRATION",
  "HTTP_ALLOWED",
  "ALLOW_UNAUTHENTICATED",
  "AUTO_DELETE_EVERY_N_HOURS",
  "HIDE_HISTORY",
  "BRANDING",
  "WEBROOT",
  "LANGUAGE",
  "MAX_CONVERT_PROCESS",
  "UNAUTHENTICATED_USER_SHARING",
]) {
  delete process.env[name];
}

// TZ is read as TIMEZONE for the times on the history page. Deleting it would not help:
// Bun would fall back to the system timezone instead of bun test's UTC default (or keep
// the shell's zone). Assigning it switches the runtime timezone as well, so pin it.
process.env.TZ = "UTC";

// Several pages import uploadsDir/outputDir from src/index.tsx. Importing the real module
// would start the server, spawn every converter's --version and schedule the job cleanup,
// and its relative ./data paths would mix test files with real conversions. Provide the
// constants directly, pointing at the temp directory.
mock.module("../src/index", () => ({
  uploadsDir: `${join(testRoot, "uploads")}/`,
  outputDir: `${join(testRoot, "output")}/`,
}));

// a preload's afterAll runs once after all test files (and once per file with --isolate)
afterAll(async () => {
  // Windows cannot remove an open SQLite database file.
  const { default: db } = await import("../src/db/db");
  db.close();
  rmSync(testRoot, { recursive: true, force: true });
});
