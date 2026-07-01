#!/usr/bin/env node

import { readFileSync } from "node:fs";

const strict = process.env.RELEASE_CHECK_STRICT === "true" || process.env.NODE_ENV === "production";
const profile = env("RELEASE_CHECK_PROFILE", strict ? "core" : "local").toLowerCase();
const issues = [];
const warnings = [];

checkNodeVersion();
checkOpenApiCoverage();
checkExternalFrontendDependencies();
checkProductionEnv();
checkProductionProfile();

for (const warning of warnings) {
  console.warn(`[warn] ${warning}`);
}
for (const issue of issues) {
  console.error(`[fail] ${issue}`);
}

if (issues.length) {
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, strict, profile, warnings: warnings.length }, null, 2));

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(major) || major < 20) {
    warnings.push(`Node ${process.versions.node} is below the declared engine >=20`);
  }
}

function checkOpenApiCoverage() {
  const controller = read("apps/api/src/core/core.controller.ts");
  const main = read("apps/api/src/main.ts");
  const controllerRoutes = extractControllerRoutes(controller);
  const openApiRoutes = extractOpenApiRoutes(main);
  const missing = [...controllerRoutes].filter((route) => !openApiRoutes.has(route));
  if (missing.length) {
    issues.push(`OpenAPI route list is missing controller routes: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? " ..." : ""}`);
  }
}

function checkExternalFrontendDependencies() {
  const html = read("apps/web/index.html");
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html)) {
    issues.push("apps/web/index.html still depends on Google Fonts; use system/local fonts for production");
  }
}

function checkProductionEnv() {
  if (!strict) {
    return;
  }
  const required = [
    ["DATABASE_URL", 1],
    ["CORS_ORIGIN", 1],
    ["API_AUTH_TOKEN", 24],
    ["AUTH_SESSION_SECRET", 32],
    ["WECOM_CALLBACK_SECRET", 32],
    ["WEBHOOK_SECRET", 32],
  ];
  for (const [name, minLength] of required) {
    const value = env(name);
    if (!value) {
      issues.push(`${name} is required for production release`);
    } else if (value.length < minLength) {
      issues.push(`${name} must be at least ${minLength} characters`);
    }
  }
  if (env("API_AUTH_TOKEN") && env("API_AUTH_TOKEN") === env("AUTH_SESSION_SECRET")) {
    issues.push("AUTH_SESSION_SECRET must be distinct from API_AUTH_TOKEN");
  }
  if (env("NOTIFICATION_PROVIDER_MODE") === "mock") {
    issues.push("NOTIFICATION_PROVIDER_MODE=mock is forbidden for production release");
  }
  if (!env("SEED_ADMIN_PASSWORD_HASH") && env("SEED_ADMIN_PASSWORD", "ChangeMe123!") === "ChangeMe123!") {
    issues.push("SEED_ADMIN_PASSWORD must be changed or SEED_ADMIN_PASSWORD_HASH must be provided");
  }
  const corsOrigin = env("CORS_ORIGIN");
  if (corsOrigin === "*" || corsOrigin.toLowerCase() === "true") {
    issues.push("CORS_ORIGIN must be an explicit production origin");
  }
}

function checkProductionProfile() {
  if (!strict) {
    return;
  }

  const productionProfile = profile === "production" || profile === "full";
  if (!productionProfile && profile !== "core") {
    warnings.push(`Unknown RELEASE_CHECK_PROFILE=${profile}; only core and production have explicit rules`);
    return;
  }
  if (!productionProfile) {
    return;
  }

  requireUrl("HERMES_AGENT_URL", "production profile requires a real Hermes/OpenAI-compatible agent URL");
  requireEnv("HERMES_AGENT_API_KEY", 16, "production profile requires HERMES_AGENT_API_KEY");

  const embeddingProvider = env("EMBEDDING_PROVIDER", "local").toLowerCase();
  if (embeddingProvider === "local") {
    issues.push("production profile requires EMBEDDING_PROVIDER to be openai or openai-compatible, not local");
  }
  if (!env("EMBEDDING_API_KEY") && !env("OPENAI_API_KEY")) {
    issues.push("production profile requires EMBEDDING_API_KEY or OPENAI_API_KEY");
  }
  if (embeddingProvider === "openai-compatible") {
    requireUrl("EMBEDDING_BASE_URL", "openai-compatible embeddings require EMBEDDING_BASE_URL");
  }

  const channelUrls = [
    "WECOM_WEBHOOK_URL",
    "WECHAT_WEBHOOK_URL",
    "FEISHU_WEBHOOK_URL",
    "DINGTALK_WEBHOOK_URL",
    "NOTIFICATION_WEBHOOK_URL",
  ];
  if (!channelUrls.some((name) => env(name))) {
    issues.push(`production profile requires at least one outbound notification webhook: ${channelUrls.join(", ")}`);
  }
  if (flag("REQUIRE_ALL_CHANNEL_WEBHOOKS")) {
    for (const name of ["WECOM_WEBHOOK_URL", "WECHAT_WEBHOOK_URL", "FEISHU_WEBHOOK_URL", "DINGTALK_WEBHOOK_URL"]) {
      requireUrl(name, `REQUIRE_ALL_CHANNEL_WEBHOOKS=true requires ${name}`);
    }
  }

  requireUri("OBJECT_STORAGE_URI", "production profile requires OBJECT_STORAGE_URI for backup retention");
  requireUri("WAL_ARCHIVE_URI", "production profile requires WAL_ARCHIVE_URI for point-in-time recovery");
  requireEnv("RESTORE_DRILL_EVIDENCE", 1, "production profile requires RESTORE_DRILL_EVIDENCE from the latest restore drill");

  requireEnv("ACCESS_SCOPE_MODEL_EVIDENCE", 1, "production profile requires explicit organization/member/class/campus/guardian authorization evidence");
  requireEnv("PAYMENT_CHANNEL_PROVIDER", 1, "production profile requires a real payment channel provider");
  requireEnv("INVOICE_NUMBER_RULE", 1, "production profile requires an invoice numbering rule");
  requireEnv("FINANCE_ACCEPTANCE_EVIDENCE", 1, "production profile requires finance export/reconciliation acceptance evidence");

  const webhookPort = env("WEBHOOK_PORT", "127.0.0.1:9000");
  if (!isLoopbackPortBinding(webhookPort)) {
    issues.push("WEBHOOK_PORT must bind to loopback, for example 127.0.0.1:9000, and be exposed only through controlled proxy/network access");
  }
  requireEnv("WEBHOOK_ACCESS_CONTROL_EVIDENCE", 1, "production profile requires webhook reverse-proxy/network access-control evidence");
}

function extractControllerRoutes(source) {
  const routes = new Set();
  const pattern = /@(Get|Post|Patch|Delete)\("([^"]*)"\)/g;
  for (const match of source.matchAll(pattern)) {
    routes.add(`${match[1].toLowerCase()} ${normalizePath(`/api/v1/${match[2]}`)}`);
  }
  return routes;
}

function extractOpenApiRoutes(source) {
  const routes = new Set();
  const pattern = /\["([^"]+)",\s*"(get|post|patch|delete)"\]/g;
  for (const match of source.matchAll(pattern)) {
    routes.add(`${match[2]} ${normalizePath(match[1])}`);
  }
  return routes;
}

function normalizePath(value) {
  return value
    .replace(/\/+/g, "/")
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}")
    .replace(/\/$/, "");
}

function read(path) {
  return readFileSync(path, "utf8");
}

function env(name, fallback = "") {
  return (process.env[name] ?? fallback).trim();
}

function requireEnv(name, minLength = 1, message) {
  const value = env(name);
  if (!value) {
    issues.push(message ?? `${name} is required`);
    return false;
  }
  if (value.length < minLength) {
    issues.push(`${name} must be at least ${minLength} characters`);
    return false;
  }
  return true;
}

function requireUrl(name, message) {
  const value = env(name);
  if (!value) {
    issues.push(message ?? `${name} is required`);
    return false;
  }
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      issues.push(`${name} must be an http(s) URL`);
      return false;
    }
  } catch {
    issues.push(`${name} must be a valid URL`);
    return false;
  }
  return true;
}

function requireUri(name, message) {
  const value = env(name);
  if (!value) {
    issues.push(message ?? `${name} is required`);
    return false;
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^[\w.-]+:/.test(value)) {
    issues.push(`${name} must be a URI, for example s3://bucket/path or rclone-remote:path`);
    return false;
  }
  return true;
}

function flag(name) {
  return /^(1|true|yes|on)$/i.test(env(name));
}

function isLoopbackPortBinding(value) {
  return value.startsWith("127.0.0.1:") || value.startsWith("localhost:") || value.startsWith("[::1]:");
}
