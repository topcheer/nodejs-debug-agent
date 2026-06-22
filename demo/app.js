'use strict';

/**
 * Node.js Debug Agent — Enhanced Demo Application
 *
 * Features:
 *   • Express web server with CRUD for /api/orders
 *   • better-sqlite3 for persistent local storage (no extra container)
 *   • ioredis for caching on GET /api/orders/:id
 *   • BullMQ queue for background order processing
 *   • Registers Redis client + Bull queue with debug agent inspectors
 */

const express = require('express');
const morgan = require('morgan');

// Debug Agent integration
const { createExpressRouter } = require('../src');
const { recordRequest } = require('../src/inspectors/http-tracker');
const { registerRedisClient } = require('../src/inspectors/redis');
const { registerBullQueue } = require('../src/inspectors/bullmq');

// ── Optional dependencies (loaded with graceful fallback) ──────────
let Redis = null;
let Database = null;
let Queue = null;
let Worker = null;

try { Redis = require('ioredis'); } catch { console.log('  [warn] ioredis not installed'); }
try { Database = require('better-sqlite3'); } catch { console.log('  [warn] better-sqlite3 not installed'); }
try { ({ Queue, Worker } = require('bullmq')); } catch { console.log('  [warn] bullmq not installed'); }

// ── App setup ─────────────────────────────────────────────────────
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ── Debug Agent: one line to integrate ────────────────────────────
app.use(createExpressRouter());

// ── Request tracking middleware (for HTTP inspector) ──────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    recordRequest(req.method, req.path, res.statusCode, Date.now() - start, req.ip);
  });
  next();
});

// ── SQLite Database ───────────────────────────────────────────────
let db = null;
let redis = null;
let orderQueue = null;
let orderWorker = null;

if (Database) {
  db = new Database(':memory:'); // In-memory for demo; use file path for persistence
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer TEXT NOT NULL,
      product TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      price REAL DEFAULT 0,
      total REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    )
  `);
}

// ── Redis client ──────────────────────────────────────────────────
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

if (Redis) {
  redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });

  redis.on('connect', () => console.log(`  [redis] Connected to ${REDIS_HOST}:${REDIS_PORT}`));
  redis.on('error', (err) => console.log(`  [redis] Error: ${err.message}`));

  // Register with debug agent inspector
  registerRedisClient('default', redis);
}

// ── BullMQ Queue + Worker ─────────────────────────────────────────
const QUEUE_NAME = 'orders';

if (Queue) {
  const connection = redis ? {
    host: REDIS_HOST,
    port: REDIS_PORT,
  } : { host: REDIS_HOST, port: REDIS_PORT };

  orderQueue = new Queue(QUEUE_NAME, { connection });
  registerBullQueue('orders', orderQueue);

  if (Worker) {
    orderWorker = new Worker(QUEUE_NAME, async (job) => {
      const { orderId, action } = job.data;
      console.log(`  [worker] Processing order #${orderId} (${action})`);

      // Simulate processing time
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));

      // Mark order as processed in SQLite
      if (db) {
        const update = db.prepare('UPDATE orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?');
        update.run('processed', orderId);
      }

      console.log(`  [worker] Order #${orderId} processed`);
    }, { connection, concurrency: 2 });

    orderWorker.on('completed', (job) => {
      console.log(`  [worker] Job ${job.id} completed`);
    });
    orderWorker.on('failed', (job, err) => {
      console.log(`  [worker] Job ${job?.id} failed: ${err.message}`);
    });
  }
}

// ── Seed sample orders ────────────────────────────────────────────
function seedOrders() {
  if (!db) return;
  const insert = db.prepare(
    'INSERT INTO orders (customer, product, quantity, price, total, status) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const samples = [
    ['Alice Johnson', 'Laptop Pro 15', 1, 1899.99, 'shipped'],
    ['Bob Smith', 'Wireless Mouse', 3, 29.99, 'processing'],
    ['Carol White', 'USB-C Hub', 2, 49.99, 'delivered'],
  ];

  const tx = db.transaction((rows) => {
    for (const [customer, product, qty, price, status] of rows) {
      insert.run(customer, product, qty, price, +(qty * price).toFixed(2), status);
    }
  });
  tx(samples);
  console.log(`  [sqlite] Seeded ${samples.length} sample orders`);
}

// ── CRUD: Orders API ──────────────────────────────────────────────

// GET /api/orders — list all orders
app.get('/api/orders', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  res.json({ count: orders.length, data: orders });
});

// POST /api/orders — create a new order
app.post('/api/orders', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  const { customer, product, quantity, price, status } = req.body;
  if (!customer || !product) {
    return res.status(400).json({ error: 'customer and product are required' });
  }

  const qty = quantity || 1;
  const prc = price || 0;
  const total = +(qty * prc).toFixed(2);

  const insert = db.prepare(
    'INSERT INTO orders (customer, product, quantity, price, total, status) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const result = insert.run(customer, product, qty, prc, total, status || 'pending');
  const orderId = result.lastInsertRowid;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);

  // Invalidate Redis cache
  if (redis) {
    try { await redis.del('orders:list'); } catch {}
  }

  // Add to BullMQ queue for background processing
  if (orderQueue) {
    try {
      await orderQueue.add('process-order', { orderId, action: 'process' });
    } catch (e) {
      console.log(`  [queue] Failed to add job: ${e.message}`);
    }
  }

  res.status(201).json(order);
});

// GET /api/orders/:id — get a single order (with Redis caching)
app.get('/api/orders/:id', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  const id = Number(req.params.id);
  const cacheKey = `order:${id}`;

  // Try Redis cache first
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return res.json({ source: 'cache', data: JSON.parse(cached) });
      }
    } catch {}
  }

  // Query SQLite
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  // Cache for 60 seconds
  if (redis) {
    try { await redis.setex(cacheKey, 60, JSON.stringify(order)); } catch {}
  }

  res.json({ source: 'db', data: order });
});

// PUT /api/orders/:id — update an order
app.put('/api/orders/:id', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  const id = Number(req.params.id);

  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const { customer, product, quantity, price, status } = req.body;
  const updated = {
    customer: customer ?? existing.customer,
    product: product ?? existing.product,
    quantity: quantity ?? existing.quantity,
    price: price ?? existing.price,
    status: status ?? existing.status,
  };
  updated.total = +(updated.quantity * updated.price).toFixed(2);

  db.prepare(`
    UPDATE orders
    SET customer = ?, product = ?, quantity = ?, price = ?, total = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(updated.customer, updated.product, updated.quantity, updated.price, updated.total, updated.status, id);

  // Invalidate cache
  if (redis) {
    try { await redis.del(`order:${id}`); await redis.del('orders:list'); } catch {}
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  res.json(order);
});

// DELETE /api/orders/:id — delete an order
app.delete('/api/orders/:id', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  const id = Number(req.params.id);

  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Order not found' });
  }

  db.prepare('DELETE FROM orders WHERE id = ?').run(id);

  // Invalidate cache
  if (redis) {
    try { await redis.del(`order:${id}`); await redis.del('orders:list'); } catch {}
  }

  res.json({ deleted: id });
});

// ── Utility endpoints ─────────────────────────────────────────────

// GET /api/health — health check with Redis + DB status
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'UP',
    uptime: Math.round(process.uptime()),
    memory_mb: +(process.memoryUsage().rss / 1024 / 1024).toFixed(2),
    services: {},
  };

  // Check SQLite
  if (db) {
    try {
      const count = db.prepare('SELECT COUNT(*) as count FROM orders').get();
      health.services.sqlite = { status: 'UP', order_count: count.count };
    } catch (e) {
      health.services.sqlite = { status: 'ERROR', error: e.message };
    }
  } else {
    health.services.sqlite = { status: 'NOT_INSTALLED' };
  }

  // Check Redis
  if (redis) {
    try {
      const pong = await redis.ping();
      health.services.redis = { status: pong === 'PONG' ? 'UP' : 'ERROR', response: pong };
    } catch (e) {
      health.services.redis = { status: 'ERROR', error: e.message };
    }
  } else {
    health.services.redis = { status: 'NOT_INSTALLED' };
  }

  // Check BullMQ
  if (orderQueue) {
    try {
      const counts = await orderQueue.getJobCounts();
      health.services.bullmq = { status: 'UP', jobs: counts };
    } catch (e) {
      health.services.bullmq = { status: 'ERROR', error: e.message };
    }
  } else {
    health.services.bullmq = { status: 'NOT_INSTALLED' };
  }

  res.json(health);
});

// GET /api/slow — artificial delay (500ms)
app.get('/api/slow', (req, res) => {
  setTimeout(() => {
    res.json({ message: 'This was slow', delay_ms: 500 });
  }, 500);
});

// GET /api/error — trigger a 500 error
app.get('/api/error', (req, res) => {
  res.status(500).json({ error: 'Intentional error for demo purposes' });
});

// ── Start server ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  seedOrders();
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║   Node.js Debug Agent — Enhanced Demo        ║
  ║   Order Management API                       ║
  ╠══════════════════════════════════════════════╣
  ║   Chat UI:  http://localhost:${PORT}/agent          ║
  ║   API:      http://localhost:${PORT}/api/orders     ║
  ║   Health:   http://localhost:${PORT}/api/health     ║
  ╠══════════════════════════════════════════════╣
  ║   SQLite:  ${db ? '✓ In-memory' : '✗ Not installed'}${' '.repeat(Math.max(0, 24 - (db ? 11 : 15)))}║
  ║   Redis:   ${redis ? '✓ ioredis' : '✗ Not installed'}${' '.repeat(Math.max(0, 24 - (redis ? 10 : 15)))}║
  ║   BullMQ:  ${orderQueue ? '✓ Queue + Worker' : '✗ Not installed'}${' '.repeat(Math.max(0, 24 - (orderQueue ? 16 : 15)))}║
  ╚══════════════════════════════════════════════╝
  `);
});
