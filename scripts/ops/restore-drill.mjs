import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const backupFile = process.env.BACKUP_FILE ? resolve(process.env.BACKUP_FILE) : "";
const drillDatabaseUrl = process.env.DRILL_DATABASE_URL;

if (!backupFile || !existsSync(backupFile)) {
  fail("BACKUP_FILE must point to an existing pg_dump custom-format file");
}
if (!drillDatabaseUrl) {
  fail("DRILL_DATABASE_URL is required; never run restore drills against production");
}

run("pg_restore", ["--list", backupFile]);
run("pg_restore", [
  "--clean",
  "--if-exists",
  "--no-owner",
  "--no-privileges",
  "--jobs",
  process.env.RESTORE_JOBS || "2",
  "--dbname",
  drillDatabaseUrl,
  backupFile,
]);
run("psql", [
  drillDatabaseUrl,
  "--set",
  "ON_ERROR_STOP=1",
  "--command",
  "SELECT 'tenants' AS table_name, count(*) FROM tenants UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs UNION ALL SELECT 'knowledge_docs', count(*) FROM knowledge_docs;",
]);

console.log(JSON.stringify({ ok: true, drillDatabaseUrl: redactDatabaseUrl(drillDatabaseUrl), backupFile }, null, 2));

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
  console.error(`[restore-drill] ${message}`);
  process.exit(1);
}
