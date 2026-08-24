#!/usr/bin/env node
// One command for the whole round trip: collect the apps' working documents,
// check them, put the bytes in the remote, and record the pointer in git.
//
//   npm run sync              -- pack, validate, push, commit, push
//   npm run sync -- --dry-run -- everything except the two pushes and the commit
//
// Every step is a gate. Nothing reaches the remote that has not validated, and
// nothing reaches GitHub that is not already in the remote. If a step fails,
// this stops there and says which one — it never carries on to the next.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const dry = process.argv.includes("--dry-run");
const POINTER = "data/wedding.trousseau.json.dvc";
const BUNDLE = "data/wedding.trousseau.json";

/** Run a command, streaming its output. Returns true on exit 0. */
function run(label, cmd, args) {
  console.log(`\n── ${label} ${"─".repeat(Math.max(0, 60 - label.length))}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  return r.status === 0;
}

function stop(why) {
  console.error(`\nsync stopped: ${why}`);
  process.exit(1);
}

const pointerNow = () => (existsSync(POINTER) ? readFileSync(POINTER, "utf8") : "");
const before = pointerNow();

// 1. Collect. Refuses on its own if the bundle would lose a slice, and flags
//    any source file that is days older than the rest.
if (!run("collecting the apps' working documents", "node", ["scripts/bundle.mjs", "pack", "--working", "-o", BUNDLE])) {
  stop("could not build the bundle");
}

// 2. Check. The cross-slice invariants no single app can see.
if (!run("checking it", "node", ["scripts/validate-wedding.mjs", BUNDLE])) {
  stop("the wedding did not validate — nothing has been pushed");
}

// 3. Re-hash. dvc add rewrites the pointer if the bytes changed.
if (!run("hashing", "python", ["-m", "dvc", "add", BUNDLE, "data/exports"])) {
  stop("dvc add failed");
}

if (pointerNow() === before) {
  console.log("\nNothing changed since the last sync. Done.");
  process.exit(0);
}

if (dry) {
  console.log("\n--dry-run: the bundle changed, but nothing was pushed or committed.");
  process.exit(0);
}

// 4. Bytes first, always. A pointer on GitHub naming bytes nobody has is the
//    one state this ordering makes unreachable.
if (!run("sending the data", "python", ["-m", "dvc", "push"])) {
  stop("dvc push failed — nothing has been committed, so nothing is inconsistent");
}

// 5. Then the pointer.
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
if (!run("recording the pointer", "git", ["add", "data"])) stop("git add failed");
if (!run("committing", "git", ["commit", "-m", `Sync the wedding data (${stamp})`])) {
  stop("git commit failed");
}
if (!run("publishing", "git", ["push"])) {
  stop("git push failed — the data is in the remote, so re-run `git push` when you can");
}

console.log("\nSynced. The other machine gets it with: git pull && npm run data:pull");
