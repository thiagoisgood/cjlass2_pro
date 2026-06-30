import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const apiPort = String(process.env.E2E_API_PORT ?? process.env.PORT ?? 3011);
const webPort = String(process.env.E2E_WEB_PORT ?? process.env.WEB_PORT ?? 5183);
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiBaseUrl = process.env.E2E_API_BASE_URL ?? `${apiOrigin}/api/v1`;
const baseEnv = {
  ...process.env,
  API_AUTH_TOKEN: process.env.API_AUTH_TOKEN ?? "e2e-api-token",
  AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET ?? "e2e-session-secret",
  E2E_API_PORT: apiPort,
  E2E_WEB_PORT: webPort,
  E2E_API_BASE_URL: apiBaseUrl,
  VITE_API_BASE_URL: process.env.VITE_API_BASE_URL ?? apiBaseUrl,
  VITE_API_PROXY_TARGET: process.env.VITE_API_PROXY_TARGET ?? apiOrigin,
};

const children = new Set();
let shuttingDown = false;

function start(name, args, env) {
  const child = spawn("npm", args, {
    cwd: rootDir,
    env,
    stdio: "inherit",
  });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown && code !== 0) {
      console.error(`[e2e-server] ${name} exited with code ${code ?? signal}`);
      shutdown(1);
    }
  });
  return child;
}

function shutdown(exitCode = 0) {
  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    for (const child of children) {
      child.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 1500).unref();
}

async function waitForApi() {
  const deadline = Date.now() + 30_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBaseUrl}/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API did not become ready at ${apiBaseUrl}/health: ${lastError}`);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`[e2e-server] starting API on ${apiOrigin}`);
start("api", ["run", "dev", "-w", "@cjlass2/api"], { ...baseEnv, PORT: apiPort });
await waitForApi();

console.log(`[e2e-server] starting Web on ${webOrigin}`);
start("web", ["run", "dev", "-w", "@cjlass2/web"], { ...baseEnv, WEB_PORT: webPort });

await new Promise(() => {});
