import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";

/**
 * Connections need the worker (it is the only thing that decrypts credentials), so end-to-end runs
 * start one. Set E2E_NO_WORKER=1 to use a worker you already run yourself.
 */
export default async function globalSetup() {
  if (process.env.E2E_NO_WORKER) return;
  const root = join(import.meta.dirname, "..", "..", "..");
  const child: ChildProcess = spawn(
    "pnpm",
    ["exec", "tsx", `--env-file=${join(root, ".env")}`, "src/index.ts"],
    {
      cwd: join(root, "apps", "worker"),
      env: process.env,
    },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The worker did not become ready in 40s")),
      40_000,
    );
    let out = "";
    child.stdout?.on("data", (d) => {
      out += String(d);
      if (out.includes("worker ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr?.on("data", (d) => {
      out += String(d);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`The worker exited early (code ${code}):\n${out.slice(-800)}`));
    });
  });
  return async () => {
    child.removeAllListeners("exit");
    child.kill("SIGTERM");
  };
}
