import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.E2E_WEB_PORT ?? 5183);
const apiPort = Number(process.env.E2E_API_PORT ?? 3011);
const webUrl = process.env.WEB_URL ?? `http://127.0.0.1:${webPort}`;
const apiBaseUrl = process.env.E2E_API_BASE_URL ?? `http://127.0.0.1:${apiPort}/api/v1`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: { baseURL: webUrl },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: [
          `WEB_PORT=${webPort}`,
          `PORT=${apiPort}`,
          `E2E_API_PORT=${apiPort}`,
          `E2E_WEB_PORT=${webPort}`,
          "API_AUTH_TOKEN=e2e-api-token",
          "AUTH_SESSION_SECRET=e2e-session-secret",
          `VITE_API_BASE_URL=${apiBaseUrl}`,
          `VITE_API_PROXY_TARGET=http://127.0.0.1:${apiPort}`,
          "node apps/web/scripts/e2e-server.mjs",
        ].join(" "),
        cwd: "../..",
        url: webUrl,
        reuseExistingServer: false,
        timeout: 30_000,
      },
});
