'use strict';

const express = require('express');
const morgan = require('morgan');
const cache = require('memory-cache');
const { createExpressRouter } = require('../src');
const { recordRequest } = require('../src/inspectors/http-tracker');

const app = express();

// ── Middleware ──────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ── Debug Agent: one line to integrate ──────────────────────────
app.use(createExpressRouter());

// ── Request tracking middleware (for HTTP inspector) ─────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    recordRequest(req.method, req.path, res.statusCode, Date.now() - start, req.ip);
  });
  next();
});

// ── In-memory order storage ─────────────────────────────────────
const orders = new Map();
let nextId = 1;

// ── Seed sample orders on startup ───────────────────────────────
function seedOrders() {
  const samples = [
    { customer: 'Alice Johnson', product: 'Laptop Pro 15', quantity: 1, price: 1899.99, status: 'shipped' },
    { customer: 'Bob Smith', product: 'Wireless Mouse', quantity: 3, price: 29.99, status: 'processing' },
    { customer: 'Carol White', product: 'USB-C Hub', quantity: 2, price: 49.99, status: 'delivered' },
  ];
  for (const s of samples) {
    const id = nextId++;
    orders.set(id, { id, ...s, total: +(s.quantity * s.price).toFixed(2), createdAt: new Date().toISOString() });
  }
  console.log(`  Seeded ${orders.size} sample orders`);
}

// ── CRUD: Orders API ────────────────────────────────────────────

// GET /api/orders — list all (with caching)
app.get('/api/orders', (req, res) => {
  const cached = cache.get('all_orders');
  if (cached) {
    return res.json({ source: 'cache', data: cached });
  }
  const all = [...orders.values()];
  cache.put('all_orders', all, 60000); // cache for 60s
  res.json({ source: 'db', data: all });
});

// POST /api/orders — create
app.post('/api/orders', (req, res) => {
  const { customer, product, quantity, price, status } = req.body;
  if (!customer || !product) {
    return res.status(400).json({ error: 'customer and product are required' });
  }
  const id = nextId++;
  const qty = quantity || 1;
  const prc = price || 0;
  const order = {
    id,
    customer,
    product,
    quantity: qty,
    price: prc,
    status: status || 'pending',
    total: +(qty * prc).toFixed(2),
    createdAt: new Date().toISOString(),
  };
  orders.set(id, order);
  cache.del('all_orders'); // invalidate cache
  res.status(201).json(order);
});

// GET /api/orders/:id — get single order
app.get('/api/orders/:id', (req, res) => {
  const id = Number(req.params.id);
  const cacheKey = `order_${id}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ source: 'cache', data: cached });
  }
  const order = orders.get(id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  cache.put(cacheKey, order, 60000);
  res.json({ source: 'db', data: order });
});

// PUT /api/orders/:id — update
app.put('/api/orders/:id', (req, res) => {
  const id = Number(req.params.id);
  const order = orders.get(id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  const { customer, product, quantity, price, status } = req.body;
  if (customer !== undefined) order.customer = customer;
  if (product !== undefined) order.product = product;
  if (quantity !== undefined) order.quantity = quantity;
  if (price !== undefined) order.price = price;
  if (status !== undefined) order.status = status;
  order.total = +(order.quantity * order.price).toFixed(2);
  order.updatedAt = new Date().toISOString();
  cache.del('all_orders');
  cache.del(`order_${id}`);
  res.json(order);
});

// DELETE /api/orders/:id — delete
app.delete('/api/orders/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!orders.has(id)) {
    return res.status(404).json({ error: 'Order not found' });
  }
  orders.delete(id);
  cache.del('all_orders');
  cache.del(`order_${id}`);
  res.json({ deleted: id });
});

// ── Utility endpoints ───────────────────────────────────────────

// GET /api/health
app.get('/api/health', (req, res) => {
  res.json({
    status: 'UP',
    uptime: Math.round(process.uptime()),
    order_count: orders.size,
    cache_size: cache.size(),
    memory_mb: +(process.memoryUsage().rss / 1024 / 1024).toFixed(2),
  });
});

// GET /api/slow — simulated slow response (500ms)
app.get('/api/slow', (req, res) => {
  setTimeout(() => {
    res.json({ message: 'This was slow', delay_ms: 500 });
  }, 500);
});

// GET /api/error — intentional 500 error for demo
app.get('/api/error', (req, res) => {
  res.status(500).json({ error: 'Intentional error for demo purposes' });
});

// ── Start server ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  seedOrders();
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   Node.js Debug Agent Demo               ║
  ║   Order Management API                   ║
  ╠══════════════════════════════════════════╣
  ║   Chat UI:  http://localhost:${PORT}/agent       ║
  ║   API:      http://localhost:${PORT}/api/orders  ║
  ║   Health:   http://localhost:${PORT}/api/health  ║
  ╚══════════════════════════════════════════╝
  `);
});
