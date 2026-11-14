/**
 * Shared helpers for the Niyyah admin maintenance scripts.
 * Single place for: Firebase project id, CLI flags, Admin SDK init, small utilities.
 *
 * Usage in a script:
 *   const { isDryRun, db, FieldValue, has, chunk } = require("./admin-lib");
 */

const admin = require("firebase-admin");

const DEFAULT_PROJECT_ID = "niyyah-4618a";

/** --live / --apply turn writes on. Anything else is a dry run (default). */
function parseArgs(argv = process.argv) {
  const isLive = argv.includes("--live") || argv.includes("--apply");
  const isDryRun = !isLive || argv.includes("--dry-run");
  return { isLive, isDryRun };
}

/** Initialise the Admin SDK once and return the Firestore handles scripts need. */
function initAdmin() {
  if (!admin.apps.length) {
    const projectId =
      process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
    admin.initializeApp({ projectId });
  }
  return { db: admin.firestore(), FieldValue: admin.firestore.FieldValue };
}

/** Own-property check (safe for Firestore data objects). */
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** Split an array into fixed-size chunks (for Firestore write batches). */
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Print a standard banner so every script reports its mode the same way. */
function printBanner(title, isDryRun) {
  console.log("============================================================");
  console.log(title);
  console.log(`Mode: ${isDryRun ? "DRY RUN (no writes will be performed)" : "LIVE"}`);
  console.log("============================================================\n");
}

module.exports = { DEFAULT_PROJECT_ID, parseArgs, initAdmin, has, chunk, printBanner };
