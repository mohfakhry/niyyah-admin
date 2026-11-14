/**
 * Migration Script: visible -> inAppVisibility (actions collection)
 *
 * Requirements:
 * - Replaces boolean field `visible` with `inAppVisibility` (true = "In app", false = "Hidden").
 * - Sets inAppVisibility = (visible !== false) and deletes `visible`.
 * - Does NOT write `updatedAt` to preserve locks and last-edited timestamps.
 * - Idempotent: safe to run multiple times.
 * - Batches writes (<= 500 per batch).
 * - Detailed logging with counts.
 * - Supports dry-run flag: `--dry-run`.
 * - Does NOT touch the `revisions` subcollection.
 *
 * Usage:
 *   node admin/migrate-visible.js           (Dry run by default)
 *   node admin/migrate-visible.js --live    (Apply changes to Firestore)
 *
 * Prerequisites:
 *   npm install firebase-admin
 *   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
 *   (or set FIRESTORE_EMULATOR_HOST="localhost:8080" for local emulator)
 */

const { parseArgs, initAdmin, has, chunk, printBanner } = require("./admin-lib");

const { isDryRun } = parseArgs();
const { db, FieldValue } = initAdmin();

const BATCH_SIZE = 450; // Firestore hard limit is 500 writes per batch

async function runMigration() {
  printBanner("Starting migration: actions collection (visible -> inAppVisibility)", isDryRun);

  const actionsRef = db.collection("actions");
  const snapshot = await actionsRef.get();

  const totalDocs = snapshot.size;
  console.log(`Found ${totalDocs} total action document(s) in 'actions' collection.`);

  let needMigrationCount = 0;
  let alreadyMigratedCount = 0;
  const updates = [];

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const hasVisible = has(data, "visible");
    const hasInAppVisibility = has(data, "inAppVisibility");

    if (hasVisible || !hasInAppVisibility) {
      needMigrationCount++;
      const currentVisible = data.visible;
      const targetVisibility = hasVisible ? (currentVisible !== false) : (data.inAppVisibility ?? true);

      updates.push({
        ref: docSnap.ref,
        id: docSnap.id,
        name: data.name || "(unnamed)",
        currentVisible,
        targetVisibility
      });
    } else {
      alreadyMigratedCount++;
    }
  }

  console.log(`Documents already migrated: ${alreadyMigratedCount}`);
  console.log(`Documents needing migration: ${needMigrationCount}\n`);

  if (needMigrationCount === 0) {
    console.log("All documents are already migrated. Nothing to do.");
    return;
  }

  let committedCount = 0;

  const groups = chunk(updates, BATCH_SIZE);
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const batchNo = index + 1;

    if (isDryRun) {
      console.log(`[DRY RUN] Would commit batch ${batchNo} (${group.length} docs)`);
      continue;
    }

    const batch = db.batch();
    for (const item of group) {
      batch.update(item.ref, {
        inAppVisibility: item.targetVisibility,
        visible: FieldValue.delete()
      });
    }
    await batch.commit();
    committedCount += group.length;
    console.log(`Committed batch ${batchNo} (${group.length} docs, total committed: ${committedCount}/${needMigrationCount})`);
  }

  console.log("\n============================================================");
  if (isDryRun) {
    console.log(`DRY RUN COMPLETE: ${needMigrationCount} document(s) would be migrated.`);
    console.log("Run with --live or --apply to commit changes to Firestore.");
  } else {
    console.log(`MIGRATION SUCCESSFUL: ${committedCount} document(s) updated.`);
  }
  console.log("============================================================");
}

runMigration().catch((err) => {
  console.error("Migration failed with error:", err);
  process.exit(1);
});
