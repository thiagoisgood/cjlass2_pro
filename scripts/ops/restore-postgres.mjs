import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const backupFile = process.env.BACKUP_FILE ? resolve(process.env.BACKUP_FILE) : "";
const databaseUrl = process.env.RESTORE_DATABASE_URL || process.env.DATABASE_URL;
const dryRun = process.env.RESTORE_DRY_RUN === "true";

if (!backupFile || !existsSync(backupFile)) {
  fail("BACKUP_FILE must point to an existing pg_dump custom-format file");
}
if (!databaseUrl && !dryRun) {
  fail("RESTORE_DATABASE_URL or DATABASE_URL is required unless RESTORE_DRY_RUN=true");
}

if (dryRun) {
  run("pg_restore", ["--list", backupFile]);
  console.log(JSON.stringify({ ok: true, dryRun: true, backupFile }, null, 2));
  process.exit(0);
}

run("pg_restore", [
  "--clean",
  "--if-exists",
  "--no-owner",
  "--no-privileges",
  "--jobs",
  process.env.RESTORE_JOBS || "2",
  "--dbname",
  databaseUrl,
  backupFile,
]);

console.log(JSON.stringify({ ok: true, restoredTo: redactDatabaseUrl(databaseUrl), backupFile }, null, 2));

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    fail(`${command} failed with exit code ${result.status}`);
  }
}

function redactDatabaseUrl(url) {
  return url.replace(/:\/\/([^:@]+):([^@]+)@/, "://$1:***@");
}

function fail(message) {
  console.error(`[restore-postgres] ${message}`);
  process.exit(1);
}
