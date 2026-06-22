# YouTube Video Description

## Title

Node.js Debug Agent v0.5.0 — Security, Health, Scheduler, Error Tracking, WebSocket (70 Tools)

## Description

Chat with your LIVE Node.js application at runtime. The Node.js Debug Agent embeds directly into your app and gives an AI assistant access to 70 diagnostic tools across 28 inspectors — V8 heap, event loop, active handles, process info, database pools, Redis, Express/Fastify routes, Mongoose models, BullMQ queues, security and auth, health checks, scheduled jobs, error tracking, WebSocket connections, and more.

No external agents. No attach-to-process. No separate monitoring stack. Just one npm install, one line of code, and you are chatting with your running app.

Version 0.5.0 adds five new inspectors: Security, Health, Scheduler, Error Tracking, and WebSocket — bringing the total from 56 to 70 tools.

### What is new in v0.5.0

**Security Inspector (3 tools)**
Inspect auth configurations — passport strategies, JWT settings, session middleware, CORS. List active sessions from express-session stores with session IDs, users, and expiry. View registered API keys with masked values for safe debugging.

**Health Inspector (3 tools)**
Run all registered health checks and get aggregate UP/DOWN status per component. Drill into individual checks for detailed diagnostics. Register custom health checks at runtime for databases, caches, APIs, memory thresholds.

**Scheduler Inspector (2 tools)**
List registered cron jobs and scheduled tasks from node-cron, node-schedule, or custom timers. View execution history per job with timestamps, status, duration, and errors.

**Error Tracking Inspector (3 tools)**
Capture uncaught exceptions and unhandled rejections automatically via process listeners. View recent errors with stack traces and context. Get error statistics — total count, rate per minute, top error types. Identify recurring patterns grouped by normalized signatures.

**WebSocket Inspector (3 tools)**
List active WebSocket connections from the ws library or Socket.IO with remote address, uptime, and message counts. Get aggregate stats — total connections, active now, messages sent and received. Inspect Socket.IO rooms with member counts.

### Demo Walkthrough

Section 1 — Runtime: Memory, CPU, event loop lag, uptime
Section 2 — V8 Heap and Active Handles
Section 3 — HTTP Requests and Express Routes
Section 4 — Database, Redis, and Caching
Section 5 — Mongoose, BullMQ, and Queues
Section 6 — Security: Auth configs, sessions, masked API keys (NEW)
Section 7 — Health Checks: Database, Redis, memory (NEW)
Section 8 — Scheduler: Cron jobs and execution history (NEW)
Section 9 — Error Tracking: Capture, stats, patterns via /api/panic (NEW)
Section 10 — WebSocket: Echo server connections and stats (NEW)
Section 11 — Comprehensive Multi-Tool Debugging

### Quick Start

```javascript
const express = require('express');
const { DebugAgent } = require('@ggaiteam/node-debug-agent');
const app = express();
app.use('/agent', DebugAgent.middleware());
app.listen(3000);
```

Open http://localhost:3000/agent and start chatting with your app.

### Inspector Coverage — 70 tools, 28 inspectors

Runtime(4) V8Heap(3) ActiveHandles(3) Process(3) Modules(2) Database(1) Framework(3) HTTPTracker(4) System(3) Redis(4) Express(2) Fastify(2) Mongoose(2) BullMQ(2) Cluster(2) Logging(4) Cache(3) HTTPClient(2) FD(1) Metrics(2) Perf(2) Sockets(1) Streams(1) Security(3) Health(3) Scheduler(2) ErrorTracking(3) WebSocket(3)

### GitHub

github.com/topcheer/nodejs-debug-agent

### Tags

#nodejs #security #healthcheck #websocket #errorhandling #cron #express

## Chapters

00:00 Introduction
00:06 Runtime Memory + V8 Heap + Event Loop
00:39 Active Handles + Process + FD
01:12 Express Routes + Middleware
01:45 HTTP Requests + Database + Redis
02:18 Logging + Cache + Metrics
02:51 Security — Auth, Sessions, CORS
03:24 Health Checks + Scheduler
03:57 Error Tracking + WebSocket
04:30 Outbound HTTP + Perf + Sockets
05:03 Comprehensive Multi-Tool Debugging

---

## Thumbnail Text

Node.js Debug Agent v0.5.0
Chat with your LIVE app
70 tools / 28 inspectors

---

## Playlist

AI Debug Agents Collection

## Category

Science and Technology

## Language

English

## Visibility

Public

## Made for Kids

No
