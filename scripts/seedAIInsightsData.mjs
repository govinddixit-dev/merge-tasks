import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// First, add order items to existing orders
console.log('Adding order items to existing orders...');

// Order 1 (Acme Corp, $4686, processing)
await conn.execute(
  `INSERT IGNORE INTO orderItems (orderId, productId, quantity, unitPrice, totalPrice, decorationType, size, color) VALUES
    (1, 1, 50, '42.00', '2100.00', 'embroidery', 'L', 'Navy'),
    (1, 2, 30, '35.00', '1050.00', 'laser_engrave', NULL, 'Black'),
    (1, 5, 12, '99.00', '1188.00', 'embroidery', 'XL', 'Gray'),
    (1, 8, 41, '8.50', '348.50', 'screen_print', NULL, 'Natural')`
);

// Order 2 (Acme Corp, $2343, shipped)
await conn.execute(
  `INSERT IGNORE INTO orderItems (orderId, productId, quantity, unitPrice, totalPrice, decorationType, size, color) VALUES
    (2, 1, 30, '42.00', '1260.00', 'embroidery', 'M', 'White'),
    (2, 3, 25, '19.00', '475.00', 'deboss', NULL, 'Black'),
    (2, 6, 13, '45.00', '585.00', 'laser_engrave', NULL, 'Pacific')`
);

// Order 3 (Bright Labs, $1751, delivered)
await conn.execute(
  `INSERT IGNORE INTO orderItems (orderId, productId, quantity, unitPrice, totalPrice, decorationType, size, color) VALUES
    (3, 4, 20, '50.00', '1000.00', 'pad_print', NULL, 'Blue'),
    (3, 2, 15, '35.00', '525.00', 'laser_engrave', NULL, 'Stainless'),
    (3, 3, 10, '19.00', '190.00', 'deboss', NULL, 'Brown')`
);

// Order 4 (TechGlobal, $9812, pending)
await conn.execute(
  `INSERT IGNORE INTO orderItems (orderId, productId, quantity, unitPrice, totalPrice, decorationType, size, color) VALUES
    (4, 5, 80, '99.00', '7920.00', 'embroidery', 'L', 'Black'),
    (4, 1, 25, '42.00', '1050.00', 'embroidery', 'M', 'Navy'),
    (4, 6, 18, '45.00', '810.00', 'laser_engrave', NULL, 'Alpine')`
);

// Now add historical orders with varied dates for predictive reordering
console.log('Adding historical orders for predictive reordering...');

// Acme Corp — quarterly ordering pattern (every ~90 days)
const acmeOrders = [
  { date: '2025-07-15', total: '3200.00', status: 'delivered', num: 'ORD-2025-101' },
  { date: '2025-10-20', total: '4100.00', status: 'delivered', num: 'ORD-2025-102' },
  { date: '2026-01-10', total: '3800.00', status: 'delivered', num: 'ORD-2026-103' },
];

for (const o of acmeOrders) {
  const [result] = await conn.execute(
    `INSERT INTO orders (userId, clientId, storeId, orderNumber, orderStatus, subtotal, tax, shipping, total, createdAt, updatedAt) 
     VALUES (1, 1, 1, ?, ?, ?, '0.00', '0.00', ?, ?, ?)`,
    [o.num, o.status, o.total, o.total, o.date, o.date]
  );
  const orderId = result.insertId;
  
  // Add items to each historical order
  await conn.execute(
    `INSERT INTO orderItems (orderId, productId, quantity, unitPrice, totalPrice, decorationType, size, color) VALUES
      (?, 1, 40, '42.00', '1680.00', 'embroidery', 'L', 'Navy'),
      (?, 2, 25, '35.00', '875.00', 'laser_engrave', NULL, 'Black'),
      (?, 8, 50, '8.50', '425.00', 'screen_print', NULL, 'Natural')`,
    [orderId, orderId, orderId]
  );
}

// Bright Labs — monthly ordering pattern (every ~30 days)
const brightOrders = [
  { date: '2025-11-01', total: '1200.00', status: 'delivered', num: 'ORD-2025-201' },
  { date: '2025-12-05', total: '1400.00', status: 'delivered', num: 'ORD-2025-202' },
  { date: '2026-01-08', total: '1100.00', status: 'delivered', num: 'ORD-2026-203' },
  { date: '2026-02-10', total: '900.00', status: 'delivered', num: 'ORD-2026-204' },
  { date: '2026-03-05', total: '600.00', status: 'delivered', num: 'ORD-2026-205' },
];

for (const o of brightOrders) {
  const [result] = await conn.execute(
    `INSERT INTO orders (userId, clientId, storeId, orderNumber, orderStatus, subtotal, tax, shipping, total, createdAt, updatedAt) 
     VALUES (1, 2, 2, ?, ?, ?, '0.00', '0.00', ?, ?, ?)`,
    [o.num, o.status, o.total, o.total, o.date, o.date]
  );
  const orderId = result.insertId;
  
  await conn.execute(
    `INSERT INTO orderItems (orderId, productId, quantity, unitPrice, totalPrice, decorationType, size, color) VALUES
      (?, 4, 10, '50.00', '500.00', 'pad_print', NULL, 'Blue'),
      (?, 3, 15, '19.00', '285.00', 'deboss', NULL, 'Black')`,
    [orderId, orderId]
  );
}

// Summit Health — was active, went quiet (churn signal)
const summitOrders = [
  { date: '2025-06-01', total: '2500.00', status: 'delivered', num: 'ORD-2025-301' },
  { date: '2025-08-15', total: '1800.00', status: 'delivered', num: 'ORD-2025-302' },
  // No orders since August — 8 months gap = high churn risk
];

for (const o of summitOrders) {
  const [result] = await conn.execute(
    `INSERT INTO orders (userId, clientId, orderNumber, orderStatus, subtotal, tax, shipping, total, createdAt, updatedAt) 
     VALUES (1, 3, ?, ?, ?, '0.00', '0.00', ?, ?, ?)`,
    [o.num, o.status, o.total, o.total, o.date, o.date]
  );
  const orderId = result.insertId;
  
  await conn.execute(
    `INSERT INTO orderItems (orderId, productId, quantity, unitPrice, totalPrice, decorationType, size, color) VALUES
      (?, 1, 30, '42.00', '1260.00', 'embroidery', 'M', 'White'),
      (?, 6, 20, '45.00', '900.00', 'laser_engrave', NULL, 'Pacific')`,
    [orderId, orderId]
  );
}

// Green Valley Schools — single order only (needs nurturing signal)
const [gvsResult] = await conn.execute(
  `INSERT INTO orders (userId, clientId, orderNumber, orderStatus, subtotal, tax, shipping, total, createdAt, updatedAt) 
   VALUES (1, 5, 'ORD-2026-501', 'delivered', '800.00', '0.00', '0.00', '800.00', '2026-02-20', '2026-02-20')`
);
const gvsOrderId = gvsResult.insertId;
await conn.execute(
  `INSERT INTO orderItems (orderId, productId, quantity, unitPrice, totalPrice, decorationType, size, color) VALUES
    (?, 8, 80, '8.50', '680.00', 'screen_print', NULL, 'Natural'),
    (?, 3, 5, '19.00', '95.00', 'deboss', NULL, 'Blue')`,
  [gvsOrderId, gvsOrderId]
);

console.log('Done! Seeded historical orders and order items for AI insights demo.');

// Verify counts
const [orderCount] = await conn.query('SELECT COUNT(*) as cnt FROM orders');
const [itemCount] = await conn.query('SELECT COUNT(*) as cnt FROM orderItems');
console.log(`Total orders: ${orderCount[0].cnt}, Total items: ${itemCount[0].cnt}`);

await conn.end();
