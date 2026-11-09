/**
 * Audit Script: Published Niyyah Scope Rule Audit
 *
 * Requirements:
 * - Read-only admin script in the same style as cleanup-actions.js.
 * - Dry run only: strictly ZERO writes performed.
 * - Inspects all documents in the 'niyyahs' collection.
 * - A niyyah that has at least one published language is valid only if it has at least ONE of:
 *     1. An action in "Actions for this niyyah" (actionIds)
 *     2. An action in a chain's before/after steps (situations[].beforeActionIds / afterActionIds)
 *     3. "Fits any action" (general === true)
 *     4. An event (eventIds)
 * - Lists all published niyyahs that fail this rule with full details for bulk review.
 *
 * Usage:
 *   node scripts/audit-niyyahs.js
 *
 * Prerequisites:
 *   npm install firebase-admin
 *   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
 *   (or set FIRESTORE_EMULATOR_HOST="localhost:8080" for local emulator)
 */

const admin = require("firebase-admin");

if (!admin.apps.length) {
  const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "niyyah-4618a";
  admin.initializeApp({
    projectId
  });
}

const db = admin.firestore();

function niyyahHasScope(item = {}) {
  if (!item) return false;
  if (item.general) return true;
  if (Array.isArray(item.actionIds) && item.actionIds.length > 0) return true;
  const eventOn = item.eventOn !== undefined ? item.eventOn : true;
  if (eventOn && Array.isArray(item.eventIds) && item.eventIds.length > 0) return true;
  const chainOn = item.chainOn !== undefined ? item.chainOn : true;
  if (chainOn) {
    if (Array.isArray(item.situations) && item.situations.some(s => (s.beforeActionIds?.length || 0) > 0 || (s.afterActionIds?.length || 0) > 0)) return true;
    if ((item.beforeActionIds?.length || 0) > 0 || (item.afterActionIds?.length || 0) > 0) return true;
  }
  return false;
}

function getPublishedLangs(item = {}) {
  const langs = [];
  if (item.translations && typeof item.translations === "object") {
    for (const [code, tr] of Object.entries(item.translations)) {
      if (tr && tr.status === "published") {
        langs.push(code);
      }
    }
  }
  if (item.statuses && typeof item.statuses === "object") {
    for (const [code, st] of Object.entries(item.statuses)) {
      if (st === "published" && !langs.includes(code)) {
        langs.push(code);
      }
    }
  }
  if (!langs.length && item.published) {
    langs.push("(doc-level published)");
  }
  return langs;
}

function getSnippet(item = {}) {
  if (item.translations && typeof item.translations === "object") {
    for (const tr of Object.values(item.translations)) {
      if (tr && tr.text && tr.text.trim()) {
        const t = tr.text.trim();
        return t.length > 70 ? t.slice(0, 67) + "..." : t;
      }
    }
  }
  return "(no text)";
}

async function runAudit() {
  console.log("============================================================");
  console.log("Niyyah Scope Rule Audit (Published Niyyahs)");
  console.log("Mode: READ-ONLY (no writes)");
  console.log("============================================================\n");

  const niyyahsRef = db.collection("niyyahs");
  const snapshot = await niyyahsRef.get();

  const totalNiyyahs = snapshot.size;
  console.log(`Scanned ${totalNiyyahs} total niyyah document(s) in 'niyyahs' collection.\n`);

  let publishedCount = 0;
  let compliantCount = 0;
  const failingNiyyahs = [];

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const id = docSnap.id;
    const pubLangs = getPublishedLangs(data);
    const isPublished = pubLangs.length > 0;

    if (!isPublished) continue;
    publishedCount++;

    const hasScope = niyyahHasScope(data);
    if (hasScope) {
      compliantCount++;
    } else {
      failingNiyyahs.push({
        id,
        number: data.number != null ? data.number : "–",
        publishedLangs: pubLangs,
        snippet: getSnippet(data),
        actionCount: (data.actionIds || []).length,
        eventCount: (data.eventIds || []).length,
        situationsCount: (data.situations || []).length,
        general: !!data.general
      });
    }
  }

  if (failingNiyyahs.length === 0) {
    console.log("✓ SUCCESS: All published niyyahs satisfy the scope rule (have an action, event, chain, or general).\n");
  } else {
    console.log(`⚠️ FOUND ${failingNiyyahs.length} PUBLISHED NIYYAH(S) VIOLATING THE SCOPE RULE:\n`);
    failingNiyyahs.forEach((item, idx) => {
      console.log(`[${idx + 1}] Niyyah #${item.number} (Doc ID: ${item.id})`);
      console.log(`    Published Languages : [${item.publishedLangs.join(", ")}]`);
      console.log(`    Scope State         : general=${item.general}, actions=${item.actionCount}, events=${item.eventCount}, chain situations=${item.situationsCount}`);
      console.log(`    Snippet             : "${item.snippet}"\n`);
    });
  }

  console.log("============================================================");
  console.log("Audit Summary:");
  console.log(`  Total Niyyahs        : ${totalNiyyahs}`);
  console.log(`  Published Niyyahs    : ${publishedCount}`);
  console.log(`  Compliant Niyyahs    : ${compliantCount}`);
  console.log(`  Failing Rule         : ${failingNiyyahs.length}`);
  console.log("============================================================");
}

runAudit().catch(err => {
  console.error("Audit failed:", err);
  process.exit(1);
});
