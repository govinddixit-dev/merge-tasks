import { getDb } from "/home/ubuntu/mergetasks/server/db.ts";
import { organizations, suppliers, orgMembers } from "/home/ubuntu/mergetasks/drizzle/schema.ts";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("no db");

  const orgs = await db.select({ id: organizations.id, name: organizations.name, ownerId: organizations.ownerId }).from(organizations).limit(5);
  console.log("orgs:", JSON.stringify(orgs, null, 2));

  const sup1 = await db.select().from(suppliers).where(eq(suppliers.id, 1)).limit(1);
  console.log("supplier id=1:", JSON.stringify(sup1, null, 2));

  const allSanmar = await db.select({ id: suppliers.id, userId: suppliers.userId, organizationId: suppliers.organizationId, normalizedName: suppliers.normalizedName }).from(suppliers).where(eq(suppliers.normalizedName, "sanmar"));
  console.log("all sanmar suppliers:", JSON.stringify(allSanmar, null, 2));

  const oms = await db.select().from(orgMembers).limit(10);
  console.log("orgMembers (first 10):", JSON.stringify(oms, null, 2));

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
