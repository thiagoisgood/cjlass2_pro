import { Injectable, UnauthorizedException } from "@nestjs/common";
import { TENANT_ID } from "@cjlass2/shared";
import { normalizeEmail, verifyPassword } from "./auth-credentials.js";
import { JsonStateStore } from "./json-state.store.js";
import { scopesForRole, signSessionToken, verifySessionToken, type UserRole } from "./request-context.js";

export interface LoginRequest {
  email?: string;
  password?: string;
}

export interface SessionUser {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: UserRole;
  scopes: string[];
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: SessionUser;
}

const TOKEN_TTL_SECONDS = Number(process.env.AUTH_SESSION_TTL_SECONDS ?? 60 * 60 * 12);

@Injectable()
export class AuthService {
  constructor(private readonly store: JsonStateStore) {}

  async login(input: LoginRequest): Promise<LoginResponse> {
    const email = normalizeEmail(input.email);
    const password = input.password ?? "";
    if (!email || !password) {
      throw new UnauthorizedException("Email and password are required");
    }

    const user = await this.store.findUserByEmail(TENANT_ID, email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const expiresAtSeconds = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const payload = {
      sub: user.userId,
      tid: user.tenantId,
      email: user.email,
      name: user.displayName,
      role: user.role,
      exp: expiresAtSeconds,
    };
    return {
      token: signSessionToken(payload),
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      user: toSessionUser(user),
    };
  }

  async sessionFromToken(token: string): Promise<SessionUser> {
    const payload = verifySessionToken(token);
    const user = await this.store.findUserById(payload.tid, payload.sub);
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("Session user is inactive");
    }
    return toSessionUser(user);
  }
}

function toSessionUser(user: Awaited<ReturnType<JsonStateStore["findUserByEmail"]>> & NonNullable<unknown>): SessionUser {
  return {
    userId: user.userId,
    tenantId: user.tenantId,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    scopes: scopesForRole(user.role),
  };
}
