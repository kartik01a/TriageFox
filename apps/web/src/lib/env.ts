import "server-only";
import { parseEnv, type WebEnv, webEnvSchema } from "@triagefox/shared";

let cached: WebEnv | undefined;

/** Validated server environment. Throws once, with every problem listed, if anything is missing. */
export function env(): WebEnv {
  cached ??= parseEnv(webEnvSchema);
  return cached;
}
