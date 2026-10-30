/**
 * Migration Script: visible -> inAppVisibility (actions collection)
 *
 * Requirements:
 * - Replaces boolean field `visible` with `inAppVisibility` (true = "In app", false = "Hidden").
 * - Sets inAppVisibility = (visible !== false) and deletes `visible`.
 * - Idempotent: safe to run multiple times.
 * - Batches writes (<= 500 per batch).
 * - Detailed logging with counts.
 * - Supports dry-run flag: `--dry-run`.
 * - Does NOT touch the `revisions` subcollection.
 *
 * Usage:
 *   node admin/migrate-visible.js [--dry-run]
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

async function runMigration() {
  console.log("============================================================");
  console.log(`Starting migration: actions collection (visible -> inAppVisibility)`);
  console.log(`Mode: ${isDryRun ? "DRY RUN (no writes will be performed)" : "LIVE"}`);
  console.log("============================================================\n");

  const actionsRef = db.collection("actions");
  const snapshot = await actionsRef.get();

  const totalDocs = snapshot.size;
  console.log(`Found ${totalDocs} total action document(s) in 'actions' collection.`);

  let needMigrationCount = 0;
  let alreadyMigratedCount = 0;
  const updates = [];

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const hasVisible = Object.prototype.hasOwnProperty.call(data, "visible");
    const hasInAppVisibility = Object.prototype.hasOwnProperty.call(data, "inAppVisibility");

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

  const BATCH_SIZE = 450; // Firestore limit is 500
  let committedCount = 0;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const item of chunk) {
      if (!isDryRun) {
        batch.update(item.ref, {
          inAppVisibility: item.targetVisibility,
          visible: FieldValue.delete()
        });
      }
    }

    if (!isDryRun) {
      await batch.commit();
      committedCount += chunk.length;
      console.log(`Committed batch ${Math.floor(i / BATCH_SIZE) + 1} (${chunk.length} docs, total committed: ${committedCount}/${needMigrationCount})`);
    } else {
      console.log(`[DRY RUN] Would commit batch ${Math.floor(i / BATCH_SIZE) + 1} (${chunk.length} docs)`);
    }
  }

  console.log("\n============================================================");
  if (isDryRun) {
    console.log(`DRY RUN COMPLETE: ${needMigrationCount} document(s) would be migrated.`);
    console.log("Run without --dry-run to apply changes.");
  } else {
    console.log(`MIGRATION SUCCESSFUL: ${committedCount} document(s) updated.`);
  }
  console.log("============================================================");
}

runMigration().catch((err) => {
  console.error("Migration failed with error:", err);
  process.exit(1);
});
