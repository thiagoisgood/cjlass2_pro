import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const digest = pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$120000$${salt}$${digest}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [, iterationsText, salt, digest] = storedHash.split("$");
  const iterations = Number(iterationsText);
  if (!salt || !digest || !Number.isFinite(iterations)) return false;
  const nextDigest = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const expected = Buffer.from(digest, "hex");
  return expected.length === nextDigest.length && timingSafeEqual(expected, nextDigest);
}

export function defaultAdminEmail(): string {
  return normalizeEmail(process.env.SEED_ADMIN_EMAIL) || "admin@cjlass.local";
}

export function defaultAdminPasswordHash(): string {
  if (process.env.SEED_ADMIN_PASSWORD_HASH) {
    return process.env.SEED_ADMIN_PASSWORD_HASH;
  }
  return hashPassword(process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!");
}

export function normalizeEmail(email?: string): string {
  return String(email || "").trim().toLowerCase();
}
