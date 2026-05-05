import "dotenv/config";
import { getDb } from "../../server/db";
import { products, storeProducts } from "../../drizzle/schema";
import { isNotNull, eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.error("no db"); process.exit(1); }

  // Post-0099: render columns live on storeProducts (per-binding).
  const rendered = await db
    .select({
      spId: storeProducts.id,
      storeId: storeProducts.storeId,
      productId: storeProducts.productId,
      productName: products.name,
      status: storeProducts.webstoreRenderStatus,
      url: storeProducts.webstoreRenderedImageUrl,
      renderedAt: storeProducts.webstoreRenderedAt,
      decoration: storeProducts.webstoreRenderDecoration,
      model: storeProducts.webstoreRenderModel,
    })
    .from(storeProducts)
    .leftJoin(products, eq(storeProducts.productId, products.id))
    .where(isNotNull(storeProducts.webstoreRenderedImageUrl));

  console.log("storeProducts with renders:", rendered.length);
  for (const r of rendered) console.log(r);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
