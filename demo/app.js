'use strict';

/**
 * Node.js Debug Agent — Enhanced Demo Application (v0.5.0)
 *
 * Features:
 *   • Express web server with CRUD for /api/orders
 *   • better-sqlite3 for persistent local storage (no extra container)
 *   • ioredis for caching on GET /api/orders/:id
 *   • BullMQ queue for background order processing
 *   • API Key auth middleware (security inspector)
 *   • Express-session middleware (security inspector)
 *   • Health checks: database, redis, memory (health inspector)
 *   • Scheduled job: clean expired sessions every 30s (scheduler inspector)
 *   • Error capture middleware + /api/panic endpoint (error-tracking inspector)
 *   • WebSocket echo server at /ws (websocket inspector)
 *   • Registers all components with debug agent inspectors
 */

const express = require('express');
const morgan = require('morgan');

// Debug Agent integration
const { createExpressRouter } = require('../src');
const { recordRequest } = require('../src/inspectors/http-tracker');
const { registerRedisClient } = require('../src/inspectors/redis');
const { registerBullQueue } = require('../src/inspectors/bullmq');
const { registerExpressApp } = require('../src/inspectors/express');
const { registerAuthConfig, registerSessionStore, registerApiKey } = require('../src/inspectors/security');
const { registerHealthCheck } = require('../src/inspectors/health');
const { registerScheduledJob, recordJobExecution } = require('../src/inspectors/scheduler');
const { captureError, errorTrackingMiddleware } = require('../src/inspectors/error-tracking');
const { registerWSServer } = require('../src/inspectors/websocket');

// ── Optional dependencies (loaded with graceful fallback) ──────────
let Redis = null;
let Database = null;
let Queue = null;
let Worker = null;
let session = null;
let WebSocketServer = null;

try { Redis = require('ioredis'); } catch { console.log('  [warn] ioredis not installed'); }
try { Database = require('better-sqlite3'); } catch { console.log('  [warn] better-sqlite3 not installed'); }
try { ({ Queue, Worker } = require('bullmq')); } catch { console.log('  [warn] bullmq not installed'); }
try { session = require('express-session'); } catch { console.log('  [warn] express-session not installed'); }
try { ({ WebSocketServer } = require('ws')); } catch { console.log('  [warn] ws not installed'); }

// ── API Keys for auth demo ────────────────────────────────────────
const VALID_API_KEYS = {
  'sk-demo-1234567890abcdef': { name: 'demo-client', scope: 'full', permissions: ['read', 'write'] },
  'sk-admin-9876543210fedcba': { name: 'admin-client', scope: 'admin', permissions: ['read', 'write', 'delete'] },
};

// Register API keys with security inspector (masked display)
for (const [key, info] of Object.entries(VALID_API_KEYS)) {
  registerApiKey(info.name, { key, scope: info.scope, permissions: info.permissions });
}

// Register auth config for security inspector
registerAuthConfig('api-key', {
  type: 'api-key',
  header: 'x-api-key',
  valid_keys: VALID_API_KEYS,
  protected_routes: ['/api/orders', '/api/auth-check'],
});
registerAuthConfig('session', {
  type: 'express-session',
  secret: 'demo-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 3600000 },
});

// ── App setup ─────────────────────────────────────────────────────
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ── Express-session middleware ────────────────────────────────────
let sessionStore = null;
if (session) {
  sessionStore = new session.MemoryStore();
  const sessionMiddleware = session({
    store: sessionStore,
    secret: 'demo-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 3600000 },
  });
  app.use(sessionMiddleware);
  registerSessionStore('express-session', sessionStore);
  console.log('  [session] express-session registered with security inspector');
}

// ── Debug Agent: one line to integrate ────────────────────────────
app.use(createExpressRouter());

// ── Register Express app for route inspection ─────────────────────
registerExpressApp('demo', app);

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
  try {
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
  } catch (e) {
    console.log(`  [warn] better-sqlite3 native module failed: ${e.message.split('\n')[0]}`);
    db = null;
  }
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

// ── API Key Auth Middleware ───────────────────────────────────────
function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    captureError(new Error('Missing API key'), 'express-middleware', {
      url: req.url, method: req.method, status: 401,
    });
    return res.status(401).json({ error: 'x-api-key header is required' });
  }
  const keyInfo = VALID_API_KEYS[apiKey];
  if (!keyInfo) {
    captureError(new Error('Invalid API key'), 'express-middleware', {
      url: req.url, method: req.method, status: 403,
    });
    return res.status(403).json({ error: 'Invalid API key' });
  }
  req.apiClient = keyInfo;
  next();
}

// ── CRUD: Orders API (protected with API Key) ─────────────────────

// Apply API key auth to all /api/orders routes
app.use('/api/orders', requireApiKey);

// GET /api/orders — list all orders
app.get('/api/orders', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  res.json({ count: orders.length, data: orders, requested_by: req.apiClient?.name });
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

// ── Auth check endpoint (requires API key) ────────────────────────
app.get('/api/auth-check', requireApiKey, (req, res) => {
  res.json({
    authenticated: true,
    client: req.apiClient?.name,
    scope: req.apiClient?.scope,
    permissions: req.apiClient?.permissions,
    session: req.session ? {
      id: req.sessionID,
      user: req.session.user || null,
    } : null,
  });
});

// ── Panic endpoint (triggers error for error tracking demo) ──────
app.get('/api/panic', (req, res, next) => {
  const err = new Error('Intentional panic for error tracking demo!');
  err.code = 'DEMO_PANIC';
  err.status = 500;
  captureError(err, 'express-middleware', { url: req.url, method: req.method });
  next(err);
});

// ── Health Checks (registered with health inspector) ──────────────
// Database health check
if (db) {
  registerHealthCheck('database', async () => {
    const start = Date.now();
    try {
      const result = db.prepare('SELECT 1 as ok').get();
      return {
        status: 'up',
        detail: { response_ms: Date.now() - start, type: 'sqlite', ok: result.ok === 1 },
      };
    } catch (e) {
      return { status: 'down', detail: { error: e.message } };
    }
  });
}

// Redis health check
registerHealthCheck('redis', async () => {
  if (!redis) return { status: 'up', detail: { note: 'Redis not installed (demo mode)' } };
  const start = Date.now();
  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ]);
    return {
      status: pong === 'PONG' ? 'up' : 'down',
      detail: { response_ms: Date.now() - start, pong },
    };
  } catch (e) {
    return { status: 'down', detail: { error: e.message } };
  }
});

// Memory health check
registerHealthCheck('memory', async () => {
  const mem = process.memoryUsage();
  const heapUsedMB = +(mem.heapUsed / 1024 / 1024).toFixed(2);
  const heapTotalMB = +(mem.heapTotal / 1024 / 1024).toFixed(2);
  const rssMB = +(mem.rss / 1024 / 1024).toFixed(2);
  const thresholdMB = 512; // 512MB threshold
  const isHealthy = rssMB < thresholdMB;
  return {
    status: isHealthy ? 'up' : 'down',
    detail: {
      heap_used_mb: heapUsedMB,
      heap_total_mb: heapTotalMB,
      rss_mb: rssMB,
      threshold_mb: thresholdMB,
      heap_usage_percent: +(mem.heapUsed / mem.heapTotal * 100).toFixed(1),
    },
  };
});

console.log('  [health] Registered 3 health checks: database, redis, memory');

// ── Scheduled Job: clean expired sessions every 30s ───────────────
const cleanupInterval = setInterval(() => {
  const jobName = 'clean-expired-sessions';
  const start = Date.now();
  try {
    // Simulate session cleanup
    let cleaned = 0;
    if (sessionStore && sessionStore.sessions) {
      const now = Date.now();
      if (sessionStore.sessions instanceof Map) {
        for (const [sid, sess] of sessionStore.sessions) {
          let parsed = sess;
          if (typeof sess === 'string') { try { parsed = JSON.parse(sess); } catch {} }
          if (parsed?.cookie?.expires && new Date(parsed.cookie.expires).getTime() < now) {
            sessionStore.sessions.delete(sid);
            cleaned++;
          }
        }
      }
    }
    recordJobExecution(jobName, 'success', Date.now() - start);
    if (cleaned > 0) {
      console.log(`  [scheduler] Cleaned ${cleaned} expired sessions`);
    }
  } catch (e) {
    recordJobExecution(jobName, 'error', Date.now() - start, e.message);
    console.log(`  [scheduler] Session cleanup failed: ${e.message}`);
  }
}, 30000);

registerScheduledJob('clean-expired-sessions', 'every 30s', {
  type: 'setInterval',
  interval_ms: 30000,
  description: 'Cleans expired sessions from the express-session MemoryStore',
  status: 'active',
});
console.log('  [scheduler] Registered scheduled job: clean-expired-sessions (every 30s)');

// ── WebSocket Echo Server ─────────────────────────────────────────
let wss = null;
const httpServer = require('http').createServer(app);

if (WebSocketServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  registerWSServer('echo', wss);

  wss.on('connection', (ws, req) => {
    const remoteAddr = req.socket.remoteAddress;
    console.log(`  [ws] New connection from ${remoteAddr}`);
    ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to echo server', timestamp: Date.now() }));

    ws.on('message', (data) => {
      // Echo is handled by the websocket inspector's connection tracking
      // But we also do explicit echo here for clarity
      try {
        ws.send(data.toString());
      } catch (e) {}
    });

    ws.on('close', () => {
      console.log(`  [ws] Connection closed from ${remoteAddr}`);
    });
  });

  console.log('  [ws] WebSocket echo server registered at /ws');
}

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

// ── Error tracking middleware (must be last, before server start) ─
// Capture errors into the error-tracking inspector ring buffer
app.use(errorTrackingMiddleware());

// Final JSON error handler (returns clean JSON instead of Express HTML)
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message,
    code: err.code || undefined,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack?.split('\n').slice(0, 5).join('\n'),
  });
});

// ── Start server ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  seedOrders();
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║   Node.js Debug Agent — Enhanced Demo v0.5.0 ║
  ║   Order Management API                       ║
  ╠══════════════════════════════════════════════╣
  ║   Chat UI:  http://localhost:${PORT}/agent          ║
  ║   API:      http://localhost:${PORT}/api/orders     ║
  ║   Health:   http://localhost:${PORT}/api/health     ║
  ║   WS Echo:  ws://localhost:${PORT}/ws              ║
  ║   Panic:    http://localhost:${PORT}/api/panic      ║
  ╠══════════════════════════════════════════════╣
  ║   SQLite:  ${db ? '✓ In-memory' : '✗ Not installed'}${' '.repeat(Math.max(0, 24 - (db ? 11 : 15)))}║
  ║   Redis:   ${redis ? '✓ ioredis' : '✗ Not installed'}${' '.repeat(Math.max(0, 24 - (redis ? 10 : 15)))}║
  ║   BullMQ:  ${orderQueue ? '✓ Queue + Worker' : '✗ Not installed'}${' '.repeat(Math.max(0, 24 - (orderQueue ? 16 : 15)))}║
  ║   Session: ${session ? '✓ express-session' : '✗ Not installed'}${' '.repeat(Math.max(0, 24 - (session ? 16 : 15)))}║
  ║   WS:      ${wss ? '✓ Echo server' : '✗ Not installed'}${' '.repeat(Math.max(0, 24 - (wss ? 13 : 15)))}║
  ╠══════════════════════════════════════════════╣
  ║   Auth: x-api-key header required for /api/* ║
  ║         Try: sk-demo-1234567890abcdef       ║
  ╚══════════════════════════════════════════════╝
  `);
});
