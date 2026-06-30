import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  fail("DATABASE_URL is required for pg_dump backup");
}

const backupDir = resolve(process.env.BACKUP_DIR || "backups/postgres");
mkdirSync(backupDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupFile = resolve(process.env.BACKUP_FILE || join(backupDir, `cjlass2-${timestamp}.dump`));
const manifestFile = `${backupFile}.manifest.json`;

run("pg_dump", [
  "--format=custom",
  "--no-owner",
  "--no-privileges",
  "--file",
  backupFile,
  databaseUrl,
]);

const manifest = {
  createdAt: new Date().toISOString(),
  backupFile,
  format: "pg_dump custom",
  sha256: sha256File(backupFile),
  sizeBytes: readFileSync(backupFile).byteLength,
  databaseUrl: redactDatabaseUrl(databaseUrl),
  walArchiveUri: process.env.WAL_ARCHIVE_URI || "",
  objectStorageUri: process.env.OBJECT_STORAGE_URI || "",
};
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

if (process.env.OBJECT_STORAGE_URI) {
  uploadToObjectStorage(backupFile, manifestFile, process.env.OBJECT_STORAGE_URI);
}

console.log(JSON.stringify({ ok: true, backupFile, manifestFile, sha256: manifest.sha256 }, null, 2));

function uploadToObjectStorage(file, manifest, uri) {
  if (uri.startsWith("s3://")) {
    const target = `${uri.replace(/\/+$/, "")}/`;
    run("aws", ["s3", "cp", file, `${target}${basename(file)}`]);
    run("aws", ["s3", "cp", manifest, `${target}${basename(manifest)}`]);
    return;
  }
  run("rclone", ["copyto", file, `${uri.replace(/\/+$/, "")}/${basename(file)}`]);
  run("rclone", ["copyto", manifest, `${uri.replace(/\/+$/, "")}/${basename(manifest)}`]);
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

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
  console.error(`[backup-postgres] ${message}`);
  process.exit(1);
}
