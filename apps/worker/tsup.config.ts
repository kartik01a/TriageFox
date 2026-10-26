import { defineConfig } from "tsup";

// The workspace packages are TypeScript source, so they are bundled in. Every other dependency stays
// external and is installed in the Docker image (pnpm deploy), which keeps native/wasm packages intact.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    keys: "scripts/keys.ts",
    migrate: "../../packages/db/src/migrate.ts",
  },
  format: ["esm"],
  target: "node22",
  clean: true,
  noExternal: [/^@triagefox\//],
  external: [/^(?!@triagefox\/)[^./].*/],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
