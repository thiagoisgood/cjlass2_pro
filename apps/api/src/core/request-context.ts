import { createHmac, timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { TENANT_ID } from "@cjlass2/shared";

export type UserRole = "admin" | "teacher" | "finance" | "assistant" | "readonly";

export interface RequestContext {
  tenantId: string;
  userId: string;
  email?: string;
  actorName: string;
  role: UserRole;
  scopes: string[];
}

export type HeaderBag = Record<string, string | string[] | undefined>;

const ROLE_SCOPES: Record<UserRole, string[]> = {
  admin: ["*"],
  teacher: [
    "read:snapshot",
    "read:session",
    "read:dashboard",
    "read:students",
    "read:households",
    "read:courses",
    "read:lessons",
    "read:lesson_ledger",
    "read:notifications",
    "read:reports",
    "read:business_tasks",
    "read:knowledge_docs",
    "read:agent_runs",
    "read:channel_integrations",
    "write:lessons",
    "write:attendance",
    "write:notifications",
    "write:business_tasks",
  ],
  finance: [
    "read:snapshot",
    "read:session",
    "read:dashboard",
    "read:students",
    "read:households",
    "read:courses",
    "read:orders",
    "read:payments",
    "read:notifications",
    "read:reports",
    "read:business_tasks",
    "read:audit_logs",
    "read:exports",
    "read:knowledge_docs",
    "read:agent_runs",
    "read:channel_integrations",
    "write:orders",
    "write:payments",
    "write:notifications",
    "write:business_tasks",
  ],
  assistant: [
    "read:snapshot",
    "read:session",
    "read:dashboard",
    "read:students",
    "read:households",
    "read:courses",
    "read:lessons",
    "read:lesson_ledger",
    "read:notifications",
    "read:reports",
    "read:business_tasks",
    "read:knowledge_docs",
    "read:agent_runs",
    "read:channel_integrations",
    "write:students",
    "write:lessons",
    "write:notifications",
    "write:business_tasks",
  ],
  readonly: [
    "read:snapshot",
    "read:session",
    "read:dashboard",
    "read:students",
    "read:households",
    "read:courses",
    "read:lessons",
    "read:lesson_ledger",
    "read:notifications",
    "read:reports",
    "read:business_tasks",
    "read:audit_logs",
    "read:knowledge_docs",
    "read:agent_runs",
    "read:channel_integrations",
  ],
};

const TOKEN_VERSION = "v1";

@Injectable()
export class ApiAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: HeaderBag; url?: string }>();
    if (isPublicRequest(request.url ?? "")) {
      return true;
    }
    validateAuthorization(request.headers);
    return true;
  }
}

function isPublicRequest(url: string): boolean {
  return url.endsWith("/auth/login")
    || url.endsWith("/health")
    || url.includes("/channels/wecom/callback");
}

export function requestContextFromHeaders(headers: HeaderBag = {}): RequestContext {
  validateAuthorization(headers);
  const session = sessionPayloadFromHeaders(headers);
  const role = session?.role ?? parseRole(readHeader(headers, "x-user-role") ?? "admin");
  return {
    tenantId: session?.tid ?? readHeader(headers, "x-tenant-id") ?? TENANT_ID,
    userId: session?.sub ?? readHeader(headers, "x-user-id") ?? "user-lin",
    email: session?.email,
    actorName: session?.name ?? decodeHeaderText(readHeader(headers, "x-actor-name")) ?? "林老师",
    role,
    scopes: ROLE_SCOPES[role],
  };
}

export function defaultRequestContext(): RequestContext {
  return {
    tenantId: TENANT_ID,
    userId: "user-lin",
    actorName: "林老师",
    role: "admin",
    scopes: ROLE_SCOPES.admin,
  };
}

export function assertScope(context: RequestContext, scope: string) {
  if (hasScope(context, scope)) return;
  throw new ForbiddenException(`Missing required scope: ${scope}`);
}

export function hasScope(context: RequestContext, scope: string): boolean {
  if (context.scopes.includes("*") || context.scopes.includes(scope)) return true;
  const [kind] = scope.split(":");
  return context.scopes.includes(`${kind}:*`);
}

export function scopesForRole(role: UserRole): string[] {
  return ROLE_SCOPES[role] ?? ROLE_SCOPES.readonly;
}

export function idempotencyKeyFrom(headers: HeaderBag, body?: Record<string, unknown>): string | undefined {
  const bodyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  return bodyKey || readHeader(headers, "idempotency-key") || readHeader(headers, "x-idempotency-key") || undefined;
}

export function expectedVersionFrom(body?: Record<string, unknown>): number | undefined {
  const value = body?.expectedVersion;
  if (value == null || value === "") return undefined;
  const version = Number(value);
  return Number.isFinite(version) ? version : undefined;
}

function validateAuthorization(headers: HeaderBag) {
  const authorization = readHeader(headers, "authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length);
    if (isApiBearerToken(token)) return;
    verifySessionToken(token);
    return;
  }
  if (!apiBearerTokens().length && !authorization) return;
  throw new UnauthorizedException("Missing or invalid API bearer token");
}

function parseRole(value: string): UserRole {
  if (value === "teacher" || value === "finance" || value === "assistant" || value === "readonly") {
    return value;
  }
  return "admin";
}

function readHeader(headers: HeaderBag, name: string): string | undefined {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(direct)) return direct[0];
  return direct;
}

export function signSessionToken(payload: Record<string, unknown>): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", sessionSecrets()[0]).update(`${TOKEN_VERSION}.${encodedPayload}`).digest("base64url");
  return `${TOKEN_VERSION}.${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string): { sub: string; tid: string; email: string; name: string; role: UserRole; exp: number } {
  const [version, encodedPayload, signature] = token.split(".");
  if (version !== TOKEN_VERSION || !encodedPayload || !signature) {
    throw new UnauthorizedException("Invalid session token");
  }
  if (!sessionSecrets().some((secret) => isValidSignature(secret, `${version}.${encodedPayload}`, signature))) {
    throw new UnauthorizedException("Invalid session signature");
  }
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
    sub?: string;
    tid?: string;
    email?: string;
    name?: string;
    role?: UserRole;
    exp?: number;
  };
  if (!payload.sub || !payload.tid || !payload.email || !payload.name || !payload.role || !payload.exp) {
    throw new UnauthorizedException("Incomplete session token");
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedException("Session expired");
  }
  return payload as { sub: string; tid: string; email: string; name: string; role: UserRole; exp: number };
}

function sessionPayloadFromHeaders(headers: HeaderBag): ReturnType<typeof verifySessionToken> | null {
  const authorization = readHeader(headers, "authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  if (isApiBearerToken(token)) return null;
  return verifySessionToken(token);
}

function isApiBearerToken(token: string): boolean {
  return apiBearerTokens().includes(token);
}

function apiBearerTokens(): string[] {
  return [
    process.env.API_AUTH_TOKEN,
    ...(process.env.API_AUTH_TOKEN_PREVIOUS || "").split(","),
  ].map((token) => token?.trim()).filter(Boolean) as string[];
}

function sessionSecrets(): string[] {
  return [
    process.env.AUTH_SESSION_SECRET || process.env.API_AUTH_TOKEN || "dev-session-secret-change-before-production",
    ...(process.env.AUTH_SESSION_PREVIOUS_SECRETS || "").split(","),
  ].map((secret) => secret?.trim()).filter(Boolean) as string[];
}

function isValidSignature(secret: string, payload: string, signature: string): boolean {
  const expectedSignature = createHmac("sha256", secret).update(payload).digest("base64url");
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function decodeHeaderText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
