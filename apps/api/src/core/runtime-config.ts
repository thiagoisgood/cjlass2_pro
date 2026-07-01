const DEFAULT_SESSION_SECRET = "dev-session-secret-change-before-production";
const DEFAULT_ADMIN_PASSWORD = "ChangeMe123!";
const MIN_TOKEN_LENGTH = 24;
const MIN_SECRET_LENGTH = 32;

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function productionConfigIssues(): string[] {
  if (!isProductionRuntime()) {
    return [];
  }

  const issues: string[] = [];
  const apiToken = env("API_AUTH_TOKEN");
  const sessionSecret = env("AUTH_SESSION_SECRET");

  requireEnv(issues, "DATABASE_URL");
  requireEnv(issues, "CORS_ORIGIN");
  requireEnv(issues, "API_AUTH_TOKEN", MIN_TOKEN_LENGTH);
  requireEnv(issues, "AUTH_SESSION_SECRET", MIN_SECRET_LENGTH);
  requireEnv(issues, "WECOM_CALLBACK_SECRET", MIN_SECRET_LENGTH);

  if (apiToken && sessionSecret && apiToken === sessionSecret) {
    issues.push("AUTH_SESSION_SECRET must be distinct from API_AUTH_TOKEN");
  }

  if (env("NOTIFICATION_PROVIDER_MODE") === "mock") {
    issues.push("NOTIFICATION_PROVIDER_MODE=mock is forbidden in production");
  }

  if (!env("SEED_ADMIN_PASSWORD_HASH") && env("SEED_ADMIN_PASSWORD", DEFAULT_ADMIN_PASSWORD) === DEFAULT_ADMIN_PASSWORD) {
    issues.push("SEED_ADMIN_PASSWORD must be changed or SEED_ADMIN_PASSWORD_HASH must be provided");
  }

  return issues;
}

export function assertProductionConfig(): void {
  const issues = productionConfigIssues();
  if (issues.length) {
    throw new Error(`Production configuration is not ready:\n- ${issues.join("\n- ")}`);
  }
}

export function runtimeStatus() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const productionIssues = productionConfigIssues();
  return {
    nodeMajorOk: Number.isInteger(nodeMajor) && nodeMajor >= 20,
    environment: process.env.NODE_ENV || "development",
    productionConfigReady: isProductionRuntime() ? productionIssues.length === 0 : null,
    productionIssueCount: isProductionRuntime() ? productionIssues.length : 0,
  };
}

function requireEnv(issues: string[], name: string, minLength = 1): void {
  const value = env(name);
  if (!value) {
    issues.push(`${name} is required`);
    return;
  }
  if (value.length < minLength) {
    issues.push(`${name} must be at least ${minLength} characters`);
  }
}

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}
