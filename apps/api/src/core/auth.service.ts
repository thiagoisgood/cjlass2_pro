import { Injectable, UnauthorizedException } from "@nestjs/common";
import { TENANT_ID, type AuditLog } from "@cjlass2/shared";
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
      await this.auditLogin(email || "unknown", false, "缺少邮箱或密码");
      throw new UnauthorizedException("Email and password are required");
    }

    const user = await this.store.findUserByEmail(TENANT_ID, email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      await this.auditLogin(email, false, "邮箱或密码错误");
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
    await this.auditLogin(email, true, `用户 ${user.displayName} 登录成功`, user.displayName);
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

  private async auditLogin(email: string, success: boolean, summary: string, actor?: string) {
    const previous = await this.store.load();
    const log: AuditLog = {
      id: `audit-login-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      time: nowText(),
      actor: actor || email,
      action: success ? "登录成功" : "登录失败",
      summary,
      status: success ? "已完成" : "已拒绝",
    };
    await this.store.saveIncremental(previous, {
      ...previous,
      auditLogs: [log, ...previous.auditLogs],
    });
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

function nowText(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 16);
}
