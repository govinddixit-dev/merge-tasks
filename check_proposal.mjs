import { db } from './server/db.ts';
import { proposals } from './drizzle/schema.ts';
import { like } from 'drizzle-orm';

async function main() {
  const r = await db.select({
    id: proposals.id,
    title: proposals.title,
    clientName: proposals.clientName,
    viewToken: proposals.viewToken,
    fulfillmentRequestedAt: proposals.fulfillmentRequestedAt,
    notes: proposals.notes
  }).from(proposals).where(like(proposals.viewToken, '%9HpSGpnQ%'));
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}
main();
