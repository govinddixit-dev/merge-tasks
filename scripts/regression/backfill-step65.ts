import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { enqueueRenderForStoreProduct } from "../../server/services/webstore-render-orchestrator";
import { webstoreRenderQueue } from "../../server/queue/webstore-render-queue";

const BINDINGS: Array<{ spId: number; storeId: number; productId: number }> = [
  { spId: 1, storeId: 2, productId: 63 },
  { spId: 3, storeId: 3, productId: 64 },
  { spId: 5, storeId: 4, productId: 66 },
  { spId: 8, storeId: 3, productId: 77 },
  { spId: 9, storeId: 3, productId: 2232 },
];

async function main() {
  const db = await getDb();
  if (!db) throw new Error("no db");

  console.log("Pre-enqueue queue state:");
  console.log("  ", await webstoreRenderQueue.getJobCounts("wait", "active", "completed", "failed", "delayed", "paused"));

  for (const b of BINDINGS) {
    console.log(`Enqueueing sp.id=${b.spId} (storeId=${b.storeId} productId=${b.productId})...`);
    await enqueueRenderForStoreProduct(db, b.storeId, b.productId);
  }

  // Brief settle time for jobs to land in Redis before we poll.
  await new Promise(r => setTimeout(r, 500));

  console.log("\nPost-enqueue queue state:");
  console.log("  ", await webstoreRenderQueue.getJobCounts("wait", "active", "completed", "failed", "delayed", "paused"));

  const jobs = await webstoreRenderQueue.getJobs(["wait", "active", "delayed"], 0, 20);
  console.log("\nIn-flight jobs:");
  for (const j of jobs) {
    console.log(`  jobId=${j.id} storeId=${j.data.storeId} productId=${j.data.productId} method=${j.data.decorationMethod}`);
  }

  await webstoreRenderQueue.close();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
