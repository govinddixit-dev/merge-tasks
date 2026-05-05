import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../server/db";
import { products } from "../../drizzle/schema";
import { runAnalysisAndPersist } from "../../server/services/webstore-imprint-placement";
import { fanOutRenderForProduct } from "../../server/services/webstore-render-orchestrator";

const TARGETS = [77, 2232];

async function main() {
  const db = await getDb();
  if (!db) throw new Error("no db");

  // Mirror analyzeWebstoreImprintPlacement procedure (server/routers/products.ts:542-569).
  // tRPC scope is for HTTP auth boundaries; server-side script uses sql`1=1` (no scope).
  const noScope = sql`1=1`;

  for (const productId of TARGETS) {
    const [product] = await db
      .select({
        id: products.id,
        imageUrl: products.imageUrl,
        webstoreImprintPlacementSource: products.webstoreImprintPlacementSource,
        supplierCode: products.supplierCode,
        name: products.name,
      })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!product) {
      console.log(`pId=${productId}: NOT FOUND`);
      continue;
    }
    console.log(`pId=${productId}: starting analysis (imageUrl=${product.imageUrl?.slice(0, 70)}...)`);
    const result = await runAnalysisAndPersist(db, product, noScope, false);
    console.log(`pId=${productId}: ${JSON.stringify(result, null, 2)}`);

    if (result.status === "ok") {
      console.log(`pId=${productId}: fanning out render to all storeProducts bindings...`);
      // fanOutRenderForProduct is fire-and-forget (void); awaiting it
      // ensures we don't exit the process before its async work finishes.
      await fanOutRenderForProduct(db, productId);
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
