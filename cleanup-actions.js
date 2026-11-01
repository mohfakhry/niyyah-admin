/**
 * Cleanup Script: Clean up actions collection
 *
 * Requirements:
 * - Uses writeBatch in chunks of 400 docs.
 * - Deletes obsolete notification template fields:
 *   titleTemplates, bodyTemplates, titleTemplate, bodyTemplate.
 * - Deletes legacy `visible` field if still present.
 * - For Action Parents (parentId is empty "" or missing): deletes `restricted`.
 *   Leaves `parentId: ""` untouched.
 * - Does NOT write `updatedAt` to preserve locks and last-edited timestamps.
 * - Idempotent: safe to run multiple times without unintended side-effects.
 * - Supports dry run via `--dry-run` flag.
 * - Does NOT touch the `revisions` subcollection.
 *
 * Usage:
 *   node cleanup-actions.js [--dry-run]
 *
 * Prerequisites:
 *   npm install firebase-admin
 *   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
 *   (or set FIRESTORE_EMULATOR_HOST="localhost:8080" for local emulator)
 */

const admin = require("firebase-admin");

const isDryRun = process.argv.includes("--dry-run");

if (!admin.apps.length) {
  const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "niyyah-4618a";
  admin.initializeApp({
    projectId
  });
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

async function runCleanup() {
  console.log("============================================================");
  console.log("Starting Action Cleanup (Notification Templates, Visible, Parent Restricted)");
  console.log(`Mode: ${isDryRun ? "DRY RUN (no writes will be performed)" : "LIVE"}`);
  console.log("============================================================\n");

  const actionsRef = db.collection("actions");
  const snapshot = await actionsRef.get();

  const totalDocs = snapshot.size;
  console.log(`Found ${totalDocs} total action document(s) in 'actions' collection.`);

  let needCleanupCount = 0;
  let alreadyCleanCount = 0;
  let templateFieldsCount = 0;
  let visibleFieldsCount = 0;
  let parentRestrictedFieldsCount = 0;

  const updates = [];

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const isParent = !data.parentId;

    const hasTitleTemplates = Object.prototype.hasOwnProperty.call(data, "titleTemplates");
    const hasBodyTemplates = Object.prototype.hasOwnProperty.call(data, "bodyTemplates");
    const hasTitleTemplate = Object.prototype.hasOwnProperty.call(data, "titleTemplate");
    const hasBodyTemplate = Object.prototype.hasOwnProperty.call(data, "bodyTemplate");
    const hasVisible = Object.prototype.hasOwnProperty.call(data, "visible");
    const hasParentRestricted = isParent && Object.prototype.hasOwnProperty.call(data, "restricted");

    const deletePayload = {};

    if (hasTitleTemplates) {
      deletePayload.titleTemplates = FieldValue.delete();
      templateFieldsCount++;
    }
    if (hasBodyTemplates) {
      deletePayload.bodyTemplates = FieldValue.delete();
      templateFieldsCount++;
    }
    if (hasTitleTemplate) {
      deletePayload.titleTemplate = FieldValue.delete();
      templateFieldsCount++;
    }
    if (hasBodyTemplate) {
      deletePayload.bodyTemplate = FieldValue.delete();
      templateFieldsCount++;
    }
    if (hasVisible) {
      deletePayload.visible = FieldValue.delete();
      visibleFieldsCount++;
    }
    if (hasParentRestricted) {
      deletePayload.restricted = FieldValue.delete();
      parentRestrictedFieldsCount++;
    }

    if (Object.keys(deletePayload).length > 0) {
      needCleanupCount++;
      updates.push({
        ref: docSnap.ref,
        id: docSnap.id,
        name: data.name || "(unnamed)",
        isParent,
        deletePayload
      });
    } else {
      alreadyCleanCount++;
    }
  }

  console.log(`Documents already clean: ${alreadyCleanCount}`);
  console.log(`Documents needing cleanup: ${needCleanupCount}`);
  console.log(`- Obsolete template fields to remove: ${templateFieldsCount}`);
  console.log(`- Legacy visible fields to remove: ${visibleFieldsCount}`);
  console.log(`- Obsolete Action Parent restricted fields to remove: ${parentRestrictedFieldsCount}\n`);

  if (needCleanupCount === 0) {
    console.log("All action documents are already clean. Nothing to do.");
    return;
  }

  if (isDryRun) {
    console.log("[DRY RUN] Sample of documents that would be cleaned:");
    updates.slice(0, 10).forEach((u, i) => {
      console.log(`  ${i + 1}. [${u.id}] "${u.name}" (isParent: ${u.isParent}) -> deleting: ${Object.keys(u.deletePayload).join(", ")}`);
    });
    if (updates.length > 10) {
      console.log(`  ... and ${updates.length - 10} more document(s).`);
    }
    console.log("\n[DRY RUN] Completed without writing changes.");
    return;
  }

  // Chunk batches by 400
  const BATCH_SIZE = 400;
  let batch = db.batch();
  let countInBatch = 0;
  let batchesCommitted = 0;

  for (let i = 0; i < updates.length; i++) {
    const item = updates[i];
    batch.update(item.ref, item.deletePayload);
    countInBatch++;

    if (countInBatch >= BATCH_SIZE || i === updates.length - 1) {
      console.log(`Committing batch ${batchesCommitted + 1} with ${countInBatch} document(s)...`);
      await batch.commit();
      batchesCommitted++;
      countInBatch = 0;
      batch = db.batch();
    }
  }

  console.log(`\nCleanup complete! Updated ${updates.length} document(s) across ${batchesCommitted} batch(es).`);
  console.log("Safe to re-run: subsequent runs will detect 0 documents needing changes.");
}

runCleanup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Cleanup error:", err);
    process.exit(1);
  });
