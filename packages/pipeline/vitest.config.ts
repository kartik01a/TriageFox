import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const envFile = join(import.meta.dirname, "..", "..", ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({ test: { testTimeout: 30000 } });
