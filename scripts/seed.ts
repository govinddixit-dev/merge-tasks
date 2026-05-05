/**
 * Database Seed Script
 *
 * Creates a realistic local development dataset so new developers can
 * start working immediately without manual data entry.
 *
 * Usage:
 *   pnpm seed
 *
 * What it creates:
 *   - 1 distributor user (admin@mergetasks.dev / password: seed1234)
 *   - 1 organization (Acme Promo Co.)
 *   - 5 clients across different industries
 *   - 10 products (mix of apparel, drinkware, tech)
 *   - 3 proposals (draft, sent, accepted)
 *   - 1 webstore
 *   - 2 orders
 *   - 1 distributor branding profile
 *
 * Safe to run multiple times — checks for existing seed data first.
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import {
  users, clients, products, proposals, proposalProducts,
  orders, orderItems, stores, storeProducts, distributorProfiles,
  organizations, orgMembers,
} from "../drizzle/schema";
import { eq } from "drizzle-orm";

const SEED_EMAIL = "admin@mergetasks.dev";
const SEED_PASSWORD = "seed1234";

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER || "mergetasks",
    password: process.env.DB_PASSWORD || "mergetasks_pass",
    database: process.env.DB_NAME || "mergetasks",
    socketPath: process.env.DB_SOCKET,
  });

  const db = drizzle(connection);

  //  Check for existing seed data 
  const existing = await db.select().from(users).where(eq(users.email, SEED_EMAIL)).limit(1);
  if (existing.length > 0) {
    console.log("✓ Seed data already exists. Skipping.");
    await connection.end();
    return;
  }

  console.log("Seeding database...");

  //  User 
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  const [userResult] = await db.insert(users).values({
    openId: nanoid(32),
    name: "Alex Distributor",
    email: SEED_EMAIL,
    loginMethod: "password",
    role: "user",
    passwordHash,
    subscriptionTier: "pro",
    subscriptionStatus: "active",
  });
  const userId = userResult.insertId as number;
  console.log(`  ✓ User created (id=${userId})`);

  //  Organization 
  const [orgResult] = await db.insert(organizations).values({
    name: "Acme Promo Co.",
    slug: "acme-promo",
    ownerId: userId,
    plan: "pro",
  });
  const orgId = orgResult.insertId as number;

  await db.insert(orgMembers).values({
    organizationId: orgId,
    userId,
    role: "owner",
    status: "active",
  });
  console.log(`  ✓ Organization created (id=${orgId})`);

  //  Distributor Profile 
  await db.insert(distributorProfiles).values({
    userId,
    organizationId: orgId,
    companyName: "Acme Promo Co.",
    contactEmail: SEED_EMAIL,
    contactPhone: "555-123-4567",
    website: "https://acmepromo.example.com",
    primaryColor: "#6C2BD9",
    tagline: "Branded merchandise that makes an impression.",
  });
  console.log("  ✓ Distributor profile created");

  //  Clients 
  const clientData = [
    { companyName: "TechCorp Inc.", industry: "Technology", contactName: "Sarah Chen", contactEmail: "sarah@techcorp.example.com", status: "active" as const },
    { companyName: "Riverside Hospital", industry: "Healthcare", contactName: "Dr. Marcus Webb", contactEmail: "mwebb@riverside.example.com", status: "active" as const },
    { companyName: "Lincoln University", industry: "Education", contactName: "Prof. Diana Park", contactEmail: "dpark@lincoln.example.edu", status: "active" as const },
    { companyName: "Summit Financial", industry: "Finance", contactName: "James Okafor", contactEmail: "jokafor@summit.example.com", status: "active" as const },
    { companyName: "GreenLeaf Retail", industry: "Retail", contactName: "Priya Sharma", contactEmail: "priya@greenleaf.example.com", status: "prospect" as const },
  ];

  const clientIds: number[] = [];
  for (const c of clientData) {
    const [r] = await db.insert(clients).values({ ...c, userId, organizationId: orgId, contactPhone: "555-000-0000" });
    clientIds.push(r.insertId as number);
  }
  console.log(`  ✓ ${clientIds.length} clients created`);

  //  Products 
  const productData = [
    { name: "Classic Polo Shirt", category: "apparel" as const, basePrice: "18.50", supplier: "SanMar", sku: "POL-001", status: "active" as const },
    { name: "Insulated Tumbler 20oz", category: "drinkware" as const, basePrice: "12.00", supplier: "ACCO Brands", sku: "TUM-020", status: "active" as const },
    { name: "Wireless Charging Pad", category: "tech" as const, basePrice: "22.00", supplier: "Cutter & Buck", sku: "CHG-WL1", status: "active" as const },
    { name: "Canvas Tote Bag", category: "bags" as const, basePrice: "6.50", supplier: "Bag Makers", sku: "TOT-CAN", status: "active" as const },
    { name: "Soft-Touch Pen", category: "writing" as const, basePrice: "1.25", supplier: "BIC", sku: "PEN-ST1", status: "active" as const },
    { name: "Performance Quarter-Zip", category: "apparel" as const, basePrice: "32.00", supplier: "SanMar", sku: "QZ-PERF", status: "active" as const },
    { name: "Ceramic Coffee Mug 11oz", category: "drinkware" as const, basePrice: "7.00", supplier: "Norwood", sku: "MUG-C11", status: "active" as const },
    { name: "Bluetooth Speaker", category: "tech" as const, basePrice: "28.00", supplier: "Cutter & Buck", sku: "SPK-BT1", status: "active" as const },
    { name: "Drawstring Backpack", category: "bags" as const, basePrice: "5.00", supplier: "Bag Makers", sku: "BAG-DS1", status: "active" as const },
    { name: "Sticky Note Set", category: "office" as const, basePrice: "3.50", supplier: "3M", sku: "STK-SET", status: "active" as const },
  ];

  const productIds: number[] = [];
  for (const p of productData) {
    const [r] = await db.insert(products).values({ ...p, userId, organizationId: orgId, type: "promotional", source: "manual", currency: "USD" });
    productIds.push(r.insertId as number);
  }
  console.log(`  ✓ ${productIds.length} products created`);

  //  Proposals 
  // Draft proposal
  const [draftResult] = await db.insert(proposals).values({
    userId, organizationId: orgId,
    clientId: clientIds[0],
    title: "TechCorp Q2 Branded Merch Package",
    status: "draft",
    proposalType: "promo",
    deliveryMethod: "email",
    viewToken: nanoid(32),
  });
  const draftId = draftResult.insertId as number;

  await db.insert(proposalProducts).values([
    { proposalId: draftId, productId: productIds[0], quantity: 50, unitPrice: "18.50", totalPrice: "925.00", productName: "Classic Polo Shirt" },
    { proposalId: draftId, productId: productIds[2], quantity: 25, unitPrice: "22.00", totalPrice: "550.00", productName: "Wireless Charging Pad" },
  ]);

  // Sent proposal
  const [sentResult] = await db.insert(proposals).values({
    userId, organizationId: orgId,
    clientId: clientIds[1],
    title: "Riverside Hospital Staff Appreciation Kit",
    status: "sent",
    proposalType: "promo",
    deliveryMethod: "email",
    viewToken: nanoid(32),
    sentAt: new Date(),
  });
  const sentId = sentResult.insertId as number;

  await db.insert(proposalProducts).values([
    { proposalId: sentId, productId: productIds[1], quantity: 100, unitPrice: "12.00", totalPrice: "1200.00", productName: "Insulated Tumbler 20oz" },
    { proposalId: sentId, productId: productIds[4], quantity: 200, unitPrice: "1.25", totalPrice: "250.00", productName: "Soft-Touch Pen" },
  ]);

  // Accepted proposal
  const [acceptedResult] = await db.insert(proposals).values({
    userId, organizationId: orgId,
    clientId: clientIds[2],
    title: "Lincoln University Welcome Week Package",
    status: "accepted",
    proposalType: "promo",
    deliveryMethod: "email",
    viewToken: nanoid(32),
    sentAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    acceptedAt: new Date(),
  });
  const acceptedId = acceptedResult.insertId as number;

  await db.insert(proposalProducts).values([
    { proposalId: acceptedId, productId: productIds[3], quantity: 300, unitPrice: "6.50", totalPrice: "1950.00", productName: "Canvas Tote Bag" },
    { proposalId: acceptedId, productId: productIds[8], quantity: 300, unitPrice: "5.00", totalPrice: "1500.00", productName: "Drawstring Backpack" },
  ]);

  console.log("  ✓ 3 proposals created (draft, sent, accepted)");

  //  Webstore 
  const [storeResult] = await db.insert(stores).values({
    userId, organizationId: orgId,
    clientId: clientIds[2],
    name: "Lincoln University Spirit Store",
    slug: "lincoln-spirit",
    storeType: "permanent",
    primaryColor: "#003087",
    status: "active",
    requireAuth: false,
  });
  const storeId = storeResult.insertId as number;

  await db.insert(storeProducts).values([
    { storeId, productId: productIds[3], featured: true, sortOrder: 1 },
    { storeId, productId: productIds[8], featured: false, sortOrder: 2 },
    { storeId, productId: productIds[5], featured: true, sortOrder: 3 },
  ]);
  console.log("  ✓ 1 webstore created");

  //  Orders 
  const [order1Result] = await db.insert(orders).values({
    userId, organizationId: orgId,
    clientId: clientIds[2],
    storeId,
    proposalId: acceptedId,
    orderNumber: `ORD-${nanoid(8).toUpperCase()}`,
    status: "processing",
    subtotal: "3450.00",
    tax: "276.00",
    shipping: "45.00",
    total: "3771.00",
    shippingName: "Prof. Diana Park",
    shippingAddress: "100 University Ave, Lincoln, NE 68501",
  });
  const order1Id = order1Result.insertId as number;

  await db.insert(orderItems).values([
    { orderId: order1Id, productId: productIds[3], quantity: 300, unitPrice: "6.50", totalPrice: "1950.00" },
    { orderId: order1Id, productId: productIds[8], quantity: 300, unitPrice: "5.00", totalPrice: "1500.00" },
  ]);

  const [order2Result] = await db.insert(orders).values({
    userId, organizationId: orgId,
    clientId: clientIds[0],
    orderNumber: `ORD-${nanoid(8).toUpperCase()}`,
    status: "delivered",
    subtotal: "1475.00",
    tax: "118.00",
    shipping: "25.00",
    total: "1618.00",
    shippingName: "Sarah Chen",
    shippingAddress: "500 Tech Blvd, San Francisco, CA 94105",
    trackingNumber: "1Z999AA10123456784",
  });
  const order2Id = order2Result.insertId as number;

  await db.insert(orderItems).values([
    { orderId: order2Id, productId: productIds[0], quantity: 50, unitPrice: "18.50", totalPrice: "925.00" },
    { orderId: order2Id, productId: productIds[2], quantity: 25, unitPrice: "22.00", totalPrice: "550.00" },
  ]);

  //  Additional historical orders
  // The AI insights tests assert ≥10 orders, ≥20 line items, and ≥5 unique
  // client-product combinations in the reorder-prediction groupings. The two
  // "showcase" orders above aren't enough, so generate a synthetic history
  // spread across clients, products, and dates. Order dates go back a year
  // so the churn-signal and predictive-reorder tests have realistic spans.
  const day = 24 * 60 * 60 * 1000;
  const historyOrders = [
    { clientIdx: 0, items: [{ productIdx: 0, qty: 75, price: "18.50" }, { productIdx: 6, qty: 100, price: "7.00" }], daysAgo: 365, status: "delivered" as const },
    { clientIdx: 0, items: [{ productIdx: 2, qty: 30, price: "22.00" }, { productIdx: 7, qty: 15, price: "28.00" }, { productIdx: 4, qty: 250, price: "1.25" }], daysAgo: 300, status: "delivered" as const },
    { clientIdx: 1, items: [{ productIdx: 1, qty: 150, price: "12.00" }, { productIdx: 4, qty: 300, price: "1.25" }], daysAgo: 280, status: "delivered" as const },
    { clientIdx: 1, items: [{ productIdx: 6, qty: 120, price: "7.00" }], daysAgo: 200, status: "delivered" as const },
    { clientIdx: 2, items: [{ productIdx: 3, qty: 200, price: "6.50" }, { productIdx: 8, qty: 200, price: "5.00" }, { productIdx: 5, qty: 40, price: "32.00" }], daysAgo: 240, status: "delivered" as const },
    { clientIdx: 2, items: [{ productIdx: 3, qty: 150, price: "6.50" }], daysAgo: 120, status: "delivered" as const },
    { clientIdx: 3, items: [{ productIdx: 5, qty: 60, price: "32.00" }, { productIdx: 2, qty: 40, price: "22.00" }], daysAgo: 180, status: "delivered" as const },
    { clientIdx: 3, items: [{ productIdx: 1, qty: 80, price: "12.00" }, { productIdx: 9, qty: 500, price: "3.50" }], daysAgo: 90, status: "delivered" as const },
    { clientIdx: 4, items: [{ productIdx: 4, qty: 400, price: "1.25" }, { productIdx: 9, qty: 200, price: "3.50" }], daysAgo: 60, status: "delivered" as const },
    { clientIdx: 0, items: [{ productIdx: 0, qty: 40, price: "18.50" }, { productIdx: 5, qty: 20, price: "32.00" }], daysAgo: 30, status: "processing" as const },
  ];

  for (const ord of historyOrders) {
    const itemsTotal = ord.items.reduce((s, it) => s + it.qty * parseFloat(it.price), 0);
    const [res] = await db.insert(orders).values({
      userId, organizationId: orgId,
      clientId: clientIds[ord.clientIdx],
      orderNumber: `ORD-${nanoid(8).toUpperCase()}`,
      status: ord.status,
      subtotal: itemsTotal.toFixed(2),
      tax: (itemsTotal * 0.08).toFixed(2),
      shipping: "25.00",
      total: (itemsTotal * 1.08 + 25).toFixed(2),
      shippingName: clientData[ord.clientIdx].contactName,
      shippingAddress: "See client on file",
      createdAt: new Date(Date.now() - ord.daysAgo * day),
    });
    const oid = res.insertId as number;
    await db.insert(orderItems).values(ord.items.map(it => ({
      orderId: oid,
      productId: productIds[it.productIdx],
      quantity: it.qty,
      unitPrice: it.price,
      totalPrice: (it.qty * parseFloat(it.price)).toFixed(2),
    })));
  }

  console.log(`  ✓ ${2 + historyOrders.length} orders created`);

  await connection.end();

  console.log("\n✅ Seed complete!");
  console.log("");
  console.log(`  Login:    ${SEED_EMAIL}`);
  console.log(`  Password: ${SEED_PASSWORD}`);
  console.log("");
}

main().catch(err => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
