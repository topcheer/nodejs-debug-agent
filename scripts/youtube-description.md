# YouTube Video Description

## Title

Node.js Debug Agent — AI-Powered In-Process Diagnostics (41 Tools / 15 Inspectors)

## Description

Chat with your LIVE Node.js application at runtime. The Node.js Debug Agent embeds directly into your app and gives an AI assistant access to 41 diagnostic tools across 15 inspectors — V8 heap, event loop, active handles, process info, database pools, Redis, Express/Fastify routes, Mongoose models, BullMQ queues, cluster workers, HTTP requests, and more.

No external agents. No attach-to-process. No separate monitoring stack. Just one npm install, one line of code, and you're chatting with your running app.

### What you'll see in this demo

**Section 1 — Node.js Runtime Deep Dive**
Memory usage (RSS, heap, external), CPU time, event loop lag, and process uptime — all through natural language.

**Section 2 — V8 Heap + Active Handles**
Heap statistics, per-space breakdown, code stats, active libuv handles and requests with type summary.

**Section 3 — HTTP Requests + Express Routes**
Discovering all Express routes and middleware, analyzing recent HTTP traffic, identifying slow and error requests.

**Section 4 — Database + Redis**
Inspecting database connection pool stats, Redis server info, keyspace scan, and slow log.

**Section 5 — Mongoose + BullMQ**
Listing Mongoose models with schema definitions, BullMQ queue depth and job inspection.

**Section 6 — Cluster Workers + System**
Enumerating cluster workers with PID and state, per-worker resource usage, system info and disk.

**Section 7 — Comprehensive Debugging**
Multi-tool correlation: memory + heap + event loop + Redis + BullMQ + routes + requests — all in one analysis.

### Quick Start

```javascript
const express = require('express');
const { DebugAgent } = require('@ggaiteam/node-debug-agent');

const app = express();
app.use('/agent', DebugAgent.middleware());
app.listen(3000);
```

Open `http://localhost:3000/agent` and start chatting with your app.

### Features

- 41 diagnostic tools across 15 inspectors
- Streaming AI responses with real-time tool call badges
- LLM-based context compression for long conversations
- Custom tool registration via DebugAgent.registerTool()
- Works with any OpenAI-compatible LLM endpoint
- Zero external dependencies (no Datadog, no Grafana, no APM)
- Dark-themed chat UI built-in (single HTML page, no frontend framework)

### Inspector Coverage

| Inspector | Tools | What it inspects |
|-----------|-------|-----------------|
| Runtime | 4 | Memory, CPU, uptime, event loop lag |
| V8 Heap | 3 | Heap stats, space stats, code stats |
| Active Handles | 3 | libuv handles, requests, summary |
| Process | 3 | Process info, resource usage, env vars |
| Modules | 2 | Loaded modules, count |
| Database | 2 | Pool status, query stats |
| Framework | 3 | Routes, middleware, app config |
| HTTP Tracker | 4 | Requests, slow, errors, stats |
| System | 3 | System info, disk, OS uptime |
| Redis | 4 | Server info, keys, slowlog, client stats |
| Express Routes | 2 | Express routes, middleware stack |
| Fastify | 2 | Routes, plugins/decorators |
| Mongoose | 2 | Models with schemas, indexes |
| BullMQ | 2 | Queues with job counts, job inspection |
| Cluster | 2 | Workers, per-worker resource usage |

### GitHub

github.com/topcheer/nodejs-debug-agent

### Tags

#nodejs #nodejsdebugging #AI #Diagnostics #Express #Fastify #Redis #Mongoose #BullMQ #V8 #EventLoop #LLM #GLM #DeveloperTools #DevOps #ApplicationMonitoring #JavaScript #AIOps #Observability

## Chapters

00:00 Introduction
00:11 Node.js Runtime — Memory, CPU, Event Loop
00:41 V8 Heap + Active Handles
01:11 HTTP Requests + Express Routes
01:41 Database + Redis
02:12 Mongoose + BullMQ
02:42 Cluster Workers + System
03:12 Comprehensive Multi-Tool Debugging

---

## Thumbnail Text (for image)

Node.js Debug Agent
Chat with your LIVE app
41 tools / 15 inspectors

---

## Playlist

AI Debug Agents Collection
(Spring / .NET / Go / Node.js / Python / Ruby)

---

## Category

Science & Technology

## Language

English

## Visibility

Public

## Made for Kids

No
