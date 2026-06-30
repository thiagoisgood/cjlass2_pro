#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const message = args.message ?? process.env.COMMIT_MESSAGE ?? readGit(["log", "-1", "--pretty=%B"]);
const branch = args.branch ?? process.env.GITHUB_REF_NAME ?? process.env.BRANCH_NAME ?? readGit(["branch", "--show-current"]);
const event = args.event ?? process.env.GITHUB_EVENT_NAME ?? "push";
const subject = firstNonEmptyLine(message);
const decision = decideDeployment({ subject, branch, event });

if (args.format === "env") {
  console.log(`DEPLOY_SHOULD_RUN=${decision.shouldDeploy ? "true" : "false"}`);
  console.log(`DEPLOY_REASON=${shellEscape(decision.reason)}`);
  console.log(`DEPLOY_MODE=${decision.mode}`);
  process.exit(0);
}

console.log(JSON.stringify(decision, null, 2));

function decideDeployment({ subject, branch, event }) {
  const normalizedSubject = subject.trim();
  const normalizedBranch = branch.trim();
  const tag = normalizedSubject.match(/^\[([a-z-]+)\]\s*/i)?.[1]?.toLowerCase() ?? "";

  if (tag === "deploy") {
    return {
      shouldDeploy: true,
      mode: "force",
      reason: "[deploy] prefix forces deployment",
      subject: normalizedSubject,
      branch: normalizedBranch,
      event,
    };
  }

  if (tag === "skip-deploy") {
    return {
      shouldDeploy: false,
      mode: "skip",
      reason: "[skip-deploy] prefix skips deployment",
      subject: normalizedSubject,
      branch: normalizedBranch,
      event,
    };
  }

  if (tag === "docs") {
    return {
      shouldDeploy: false,
      mode: "docs",
      reason: "[docs] prefix is documentation-only and skips deployment",
      subject: normalizedSubject,
      branch: normalizedBranch,
      event,
    };
  }

  if (event === "push" && normalizedBranch === "main") {
    return {
      shouldDeploy: true,
      mode: "default",
      reason: "push to main deploys by default",
      subject: normalizedSubject,
      branch: normalizedBranch,
      event,
    };
  }

  return {
    shouldDeploy: false,
    mode: "skip",
    reason: "not a forced deploy and not a push to main",
    subject: normalizedSubject,
    branch: normalizedBranch,
    event,
  };
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = rawArgs[index + 1] && !rawArgs[index + 1].startsWith("--") ? rawArgs[++index] : "true";
    parsed[key] = value;
  }
  return parsed;
}

function firstNonEmptyLine(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function readGit(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
