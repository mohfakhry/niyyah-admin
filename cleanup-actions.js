/**
 * Cleanup Script: Clean up actions collection
 *
 * Requirements:
 * - Uses writeBatch in chunks of 400 docs.
 * - Deletes obsolete notification template fields:
 *   titleTemplates, bodyTemplates, titleTemplate, bodyTemplate.
 * - Deletes legacy `visible` field; if document lacks `inAppVisibility`, converts
 *   it first (inAppVisibility = visible !== false) before deleting `visible`.
 * - For Action Parents (parentId is empty "" or missing): deletes `restricted`.
 *   Leaves `parentId: ""` untouched.
 * - Does NOT write `updatedAt` to preserve locks and last-edited timestamps.
 * - Idempotent: safe to run multiple times without unintended side-effects.
 * - Supports dry run via `--dry-run` flag.
 * - Does NOT touch the `revisions` subcollection.
 *
 * Usage:
 *   node cleanup-actions.js           (Dry run by default)
 *   node cleanup-actions.js --live    (Apply changes to Firestore)
 *
 * Prerequisites:
 *   npm install firebase-admin
 *   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
 *   (or set FIRESTORE_EMULATOR_HOST="localhost:8080" for local emulator)
 */

const { parseArgs, initAdmin, has, chunk, printBanner } = require("./admin-lib");

const { isDryRun } = parseArgs();
const { db, FieldValue } = initAdmin();

// Obsolete notification-template fields removed from every action document.
const OBSOLETE_TEMPLATE_FIELDS = ["titleTemplates", "bodyTemplates", "titleTemplate", "bodyTemplate"];
const BATCH_SIZE = 400; // Firestore hard limit is 500 writes per batch

async function runCleanup() {
  printBanner("Starting Action Cleanup (Notification Templates, Visible, Parent Restricted)", isDryRun);

  const actionsRef = db.collection("actions");
  const snapshot = await actionsRef.get();

  const totalDocs = snapshot.size;
  console.log(`Found ${totalDocs} total action document(s) in 'actions' collection.`);

  let needCleanupCount = 0;
  let alreadyCleanCount = 0;
  let templateFieldsCount = 0;
  let visibleDeletedCount = 0;
  let visibleConvertedCount = 0;
  let parentRestrictedFieldsCount = 0;

  const updates = [];

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const isParent = !data.parentId;

        const hasVisible = has(data, "visible");
    const hasInAppVisibility = has(data, "inAppVisibility");
    const hasParentRestricted = isParent && has(data, "restricted");

    const updatePayload = {};

    for (const field of OBSOLETE_TEMPLATE_FIELDS) {
      if (has(data, field)) {
        updatePayload[field] = FieldValue.delete();
        templateFieldsCount++;
      }
    }
    if (hasVisible) {
      if (!hasInAppVisibility) {
        updatePayload.inAppVisibility = data.visible !== false;
        updatePayload.visible = FieldValue.delete();
        visibleConvertedCount++;
      } else {
        updatePayload.visible = FieldValue.delete();
        visibleDeletedCount++;
      }
    }
    if (hasParentRestricted) {
      updatePayload.restricted = FieldValue.delete();
      parentRestrictedFieldsCount++;
    }

    if (Object.keys(updatePayload).length > 0) {
      needCleanupCount++;
      updates.push({
        ref: docSnap.ref,
        id: docSnap.id,
        name: data.name || "(unnamed)",
        isParent,
        updatePayload
      });
    } else {
      alreadyCleanCount++;
    }
  }

  console.log(`Documents already clean: ${alreadyCleanCount}`);
  console.log(`Documents needing cleanup: ${needCleanupCount}`);
  console.log(`- Obsolete template fields to remove: ${templateFieldsCount}`);
  console.log(`- Legacy visible fields converted to inAppVisibility: ${visibleConvertedCount}`);
  console.log(`- Legacy visible fields to remove (already had inAppVisibility): ${visibleDeletedCount}`);
  console.log(`- Obsolete Action Parent restricted fields to remove: ${parentRestrictedFieldsCount}\n`);

  if (needCleanupCount === 0) {
    console.log("All action documents are already clean. Nothing to do.");
    return;
  }

  if (isDryRun) {
    console.log("[DRY RUN] Sample of documents that would be cleaned:");
    updates.slice(0, 10).forEach((u, i) => {
      const parts = [];
      if (has(u.updatePayload, "inAppVisibility")) {
        parts.push(`convert visible -> inAppVisibility: ${u.updatePayload.inAppVisibility}`);
      }
      const deletedKeys = Object.keys(u.updatePayload).filter(k => k !== "inAppVisibility");
      if (deletedKeys.length > 0) {
        parts.push(`deleting: ${deletedKeys.join(", ")}`);
      }
      console.log(`  ${i + 1}. [${u.id}] "${u.name}" (isParent: ${u.isParent}) -> ${parts.join("; ")}`);
    });
    if (updates.length > 10) {
      console.log(`  ... and ${updates.length - 10} more document(s).`);
    }
    console.log("\n[DRY RUN] Completed without writing changes.");
    console.log("Run with --live to commit changes to Firestore.");
    return;
  }

  const chunks = chunk(updates, BATCH_SIZE);
  let batchesCommitted = 0;

  for (const group of chunks) {
    const batch = db.batch();
    group.forEach((item) => batch.update(item.ref, item.updatePayload));
    console.log(`Committing batch ${batchesCommitted + 1} with ${group.length} document(s)...`);
    await batch.commit();
    batchesCommitted++;
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
