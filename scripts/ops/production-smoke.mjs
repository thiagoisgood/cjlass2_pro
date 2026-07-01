#!/usr/bin/env node

const baseUrl = env("PRODUCTION_BASE_URL") || env("API_BASE_URL") || env("BASE_URL");
const apiToken = env("API_AUTH_TOKEN");
const timeoutMs = Number(env("SMOKE_TIMEOUT_MS", "8000"));
const requireHermes = env("SMOKE_REQUIRE_HERMES", "true") !== "false";
const checks = [];

if (!baseUrl) {
  fail("PRODUCTION_BASE_URL, API_BASE_URL, or BASE_URL is required");
}
if (!apiToken) {
  fail("API_AUTH_TOKEN is required for authenticated production smoke checks");
}

const apiBase = normalizeApiBase(baseUrl);

await check("health uses production PostgreSQL runtime", async () => {
  const health = await requestJson("/health");
  assert(health.ok === true, "health.ok must be true");
  assert(health.databaseMode === true, "health.databaseMode must be true");
  assert(health.runtime?.nodeMajorOk === true, "health.runtime.nodeMajorOk must be true");
  assert(health.runtime?.productionConfigReady !== false, "health.runtime.productionConfigReady must not be false");
});

await check("OpenAPI exposes registered routes", async () => {
  const openapi = await requestJson("/openapi.json");
  assert(openapi.openapi, "OpenAPI document is missing openapi version");
  assert(openapi.paths?.["/api/v1/mcp/tools"]?.get, "OpenAPI is missing /api/v1/mcp/tools");
  assert(openapi.paths?.["/api/v1/knowledge-search"]?.post, "OpenAPI is missing /api/v1/knowledge-search");
});

await check("authenticated session is accepted", async () => {
  const session = await requestJson("/auth/session", { auth: true });
  assert(session.tenantId, "session.tenantId is missing");
  assert(session.role, "session.role is missing");
});

await check("MCP tools include high-priority finance operations", async () => {
  const tools = await requestJson("/mcp/tools", { auth: true });
  assert(Array.isArray(tools), "MCP tools response must be an array");
  const toolNames = new Set(tools.map((tool) => tool.name));
  for (const name of ["invoice_issue", "refund_request", "payroll_generate", "payroll_settle"]) {
    assert(toolNames.has(name), `MCP tool is missing: ${name}`);
  }
});

await check("Hermes status is configured", async () => {
  const status = await requestJson("/agent/hermes-status", { auth: true });
  if (requireHermes) {
    assert(status.configured === true, "Hermes must be configured for production smoke");
  }
});

await check("RAG search returns a valid result envelope", async () => {
  const result = await requestJson("/knowledge-search", {
    auth: true,
    method: "POST",
    body: { query: env("SMOKE_RAG_QUERY", "退款规则"), limit: 3 },
  });
  assert(Array.isArray(result.results), "knowledge-search.results must be an array");
  assert(result.tenantId, "knowledge-search.tenantId is missing");
});

await check("channel integration list is readable", async () => {
  const integrations = await requestJson("/channel-integrations", { auth: true });
  assert(Array.isArray(integrations), "channel-integrations response must be an array");
});

console.log(JSON.stringify({ ok: true, apiBase, checks }, null, 2));

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
    console.error(JSON.stringify({ ok: false, apiBase, checks }, null, 2));
    process.exit(1);
  }
}

async function requestJson(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBase}${path}`, {
      method: options.method ?? "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(options.auth ? { authorization: `Bearer ${apiToken}` } : {}),
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`${path} returned non-JSON response: ${text.slice(0, 160)}`);
    }
    if (!response.ok) {
      throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 240)}`);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeApiBase(value) {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fail(message) {
  console.error(`[fail] ${message}`);
  process.exit(1);
}

function env(name, fallback = "") {
  return (process.env[name] ?? fallback).trim();
}
