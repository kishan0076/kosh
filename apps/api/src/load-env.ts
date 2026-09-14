import { fileURLToPath } from "node:url";

/**
 * Load the repo-root `.env` into process.env before anything reads config.
 * Imported first in server.ts. No-ops when the file is absent (production, where the
 * host injects env vars directly) or on older runtimes without process.loadEnvFile.
 */
try {
  const envPath = fileURLToPath(new URL("../../../.env", import.meta.url)); // apps/api/{src,dist}/ → repo root
  (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile?.(envPath);
} catch {
  /* no .env file — rely on the ambient environment */
}
