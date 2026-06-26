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
  teacher: ["read:*", "write:lessons", "write:attendance", "write:notifications", "write:business_tasks"],
  finance: ["read:*", "write:orders", "write:payments", "write:notifications", "write:business_tasks"],
  assistant: ["read:*", "write:students", "write:lessons", "write:notifications", "write:business_tasks"],
  readonly: ["read:*"],
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
  const expectedToken = process.env.API_AUTH_TOKEN;
  const authorization = readHeader(headers, "authorization");
  if (!expectedToken && !authorization) return;
  if (expectedToken && authorization === `Bearer ${expectedToken}`) return;
  if (authorization?.startsWith("Bearer ")) {
    verifySessionToken(authorization.slice("Bearer ".length));
    return;
  }
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
  const signature = createHmac("sha256", sessionSecret()).update(`${TOKEN_VERSION}.${encodedPayload}`).digest("base64url");
  return `${TOKEN_VERSION}.${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string): { sub: string; tid: string; email: string; name: string; role: UserRole; exp: number } {
  const [version, encodedPayload, signature] = token.split(".");
  if (version !== TOKEN_VERSION || !encodedPayload || !signature) {
    throw new UnauthorizedException("Invalid session token");
  }
  const expectedSignature = createHmac("sha256", sessionSecret()).update(`${version}.${encodedPayload}`).digest("base64url");
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
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
  if (process.env.API_AUTH_TOKEN && token === process.env.API_AUTH_TOKEN) return null;
  return verifySessionToken(token);
}

function sessionSecret(): string {
  return process.env.AUTH_SESSION_SECRET || process.env.API_AUTH_TOKEN || "dev-session-secret-change-before-production";
}

function decodeHeaderText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
