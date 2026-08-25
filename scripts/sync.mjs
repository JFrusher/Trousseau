#!/usr/bin/env node
// One command for the whole round trip: collect the apps' working documents,
// check them, put the bytes in the remote, and record the pointer in git.
//
//   npm run sync              -- pack, validate, push, commit, push
//   npm run sync -- --dry-run -- everything except the two pushes and the commit
//   npm run sync -- --allow-shrink -- let a slice go, when you mean it
//
// Every step is a gate. Nothing reaches the remote that has not validated, and
// nothing reaches GitHub that is not already in the remote. If a step fails,
// this stops there and says which one — it never carries on to the next.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const dry = process.argv.includes("--dry-run");
// Passed through to pack. Needed when a slice is genuinely going away — an app
// whose file has not been exported yet, say — rather than missing by accident.
const allowShrink = process.argv.includes("--allow-shrink");
const POINTER = "data/wedding.trousseau.json.dvc";
const BUNDLE = "data/wedding.trousseau.json";

/**
 * Run a command, streaming its output. Returns true on exit 0.
 *
 * Deliberately not through a shell. On Windows `shell: true` re-splits the
 * arguments, which turned a commit message into a list of pathspecs and failed
 * the commit after the data had already been pushed. git, python and node are
 * all real executables, so they resolve without one.
 */
function run(label, cmd, args) {
  console.log(`\n── ${label} ${"─".repeat(Math.max(0, 60 - label.length))}`);
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.error) console.error(String(r.error.message ?? r.error));
  return r.status === 0;
}

function stop(why) {
  console.error(`\nsync stopped: ${why}`);
  process.exit(1);
}

/**
 * Whether the bundle differs from what the pointer currently names.
 *
 * Read from the files rather than inferred by running `dvc add`, so --dry-run
 * can answer the question without changing anything. It used to add first and
 * compare after, which meant a dry run left the pointer rewritten and the next
 * real run concluded nothing had changed and pushed nothing.
 */
function bundleChanged() {
  if (!existsSync(BUNDLE)) return false;
  const md5 = createHash("md5").update(readFileSync(BUNDLE)).digest("hex");
  if (!existsSync(POINTER)) return true;
  const pointed = /md5:\s*([0-9a-f]{32})/.exec(readFileSync(POINTER, "utf8"));
  return pointed === null || pointed[1] !== md5;
}

// 1. Collect. Refuses on its own if the bundle would lose a slice, and flags
//    any source file that is days older than the rest.
const packArgs = ["scripts/bundle.mjs", "pack", "--working", "-o", BUNDLE];
if (allowShrink) packArgs.push("--allow-shrink");
if (!run("collecting the apps' working documents", "node", packArgs)) {
  stop("could not build the bundle");
}

// 2. Check. The cross-slice invariants no single app can see.
if (!run("checking it", "node", ["scripts/validate-wedding.mjs", BUNDLE])) {
  stop("the wedding did not validate — nothing has been pushed");
}

// 3. Decide whether there is anything to do, before changing any state.
if (!bundleChanged()) {
  console.log("\nNothing changed since the last sync. Done.");
  process.exit(0);
}

if (dry) {
  console.log("\n--dry-run: the bundle changed. Nothing was hashed, pushed or committed.");
  process.exit(0);
}

// 4. Re-hash. dvc add rewrites the pointer to name the new bytes.
if (!run("hashing", "python", ["-m", "dvc", "add", BUNDLE, "data/exports"])) {
  stop("dvc add failed");
}

// 5. Bytes first, always. A pointer on GitHub naming bytes nobody has is the
//    one state this ordering makes unreachable.
if (!run("sending the data", "python", ["-m", "dvc", "push"])) {
  stop("dvc push failed — nothing has been committed, so nothing is inconsistent");
}

// 6. Then the pointer.
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
if (!run("recording the pointer", "git", ["add", "data"])) stop("git add failed");
if (!run("committing", "git", ["commit", "-m", `Sync the wedding data (${stamp})`])) {
  stop("git commit failed");
}
if (!run("publishing", "git", ["push"])) {
  stop("git push failed — the data is in the remote, so re-run `git push` when you can");
}

console.log("\nSynced. The other machine gets it with: git pull && npm run data:pull");
