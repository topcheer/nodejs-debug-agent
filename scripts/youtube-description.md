# YouTube Video Description

## Title

Node.js Debug Agent — AI-Powered In-Process Diagnostics for Express/Node.js (9 Inspectors / 27 Tools)

## Description

Chat with your LIVE Node.js application at runtime. The Node.js Debug Agent embeds directly into your app and gives an AI assistant access to 27 diagnostic tools across 9 inspectors — V8 heap & memory, event loop, active libuv handles, process info, loaded modules, Express routes, HTTP request tracking, system resources, and database connection pools.

No external agents. No attach-to-process. No separate monitoring stack. Just one npm install, one line of code, and you're chatting with your running app.

### What you'll see in this demo

**Section 1 — Node.js Runtime + Memory Deep Dive**
Heap statistics, V8 heap space breakdown (new space, old space, code space), heap code statistics, system info, V8 engine flags, and forcing garbage collection — all through natural language.

**Section 2 — Process + Event Loop + Active Handles**
Process info (PID, Node version, platform, CPU, memory), event loop lag measurement with histogram stats, active libuv handles (timers, sockets, servers), active requests, resource usage, and handle summary by type.

**Section 3 — Framework + Routes + Middleware**
Discovering all registered Express routes with methods and paths, listing the middleware stack, inspecting installed npm packages, and viewing environment variables with secret masking.

**Section 4 — HTTP Requests + Modules**
Recent HTTP requests from the in-memory ring buffer, request statistics (P50/P95/P99 latency, error rate), slowest and error requests, loaded module count grouped by package.

**Section 5 — System Resources**
CPU info (cores, model, load average), disk usage for the working directory, and process/system uptime.

**Section 6 — Database Connection Pool**
Auto-detecting loaded database drivers (pg, mysql2, mongodb) and inspecting connection pool stats (total/idle/waiting connections).

**Section 7 — Comprehensive Debugging**
Multi-tool correlation: memory + GC + event loop + handles + HTTP requests + routes + modules — all in one analysis.

### Quick Start

```javascript
// app.js
const express = require('express');
const { createExpressRouter } = require('@debug-agent/node');

const app = express();
app.use(express.json());

// One line to integrate the debug agent
app.use(createExpressRouter());

// Your routes...
app.get('/api/orders', (req, res) => res.json(orders));
app.listen(3000);
```

Open `http://localhost:3000/agent` and start chatting with your app.

### Features

- 27 diagnostic tools across 9 inspectors
- Streaming AI responses (SSE) with real-time tool call badges
- LLM-based context compression for long conversations
- Custom tool registration via debugTool() decorator
- Works with any OpenAI-compatible LLM endpoint (Z.ai GLM-5.2, OpenAI, Ollama, vLLM, etc.)
- Zero external dependencies (no Datadog, no New Relic, no Grafana)
- Dark-themed chat UI built-in (single HTML page, no frontend framework)
- Express router, Fastify plugin, and raw HTTP handler support

### Inspector Coverage

| Inspector | Tools | What it inspects |
|-----------|-------|-----------------|
| Runtime (V8) | 4 | Heap stats, GC trigger, system info, V8 flags |
| V8 Heap | 3 | Heap snapshot stats, space stats, code stats |
| Active Handles | 3 | Active handles, active requests, handle summary |
| Process | 3 | Process info, event loop lag, resource usage |
| Modules | 2 | Loaded modules, module count by package |
| Framework | 4 | Routes, middleware, packages, environment vars |
| HTTP Requests | 4 | Recent requests, slow requests, errors, stats |
| System | 3 | CPU info, disk usage, uptime |
| Database | 1 | Connection pool status (pg/mysql2/mongodb) |

### GitHub

https://github.com/topcheer/nodejs-debug-agent

### Tags

#nodejs #javascript #AI #Debugging #Diagnostics #Express #LLM #GLM #DeveloperTools #DevOps #ApplicationMonitoring #V8 #EventLoop #AIOps #Observability #NodeJS

## Chapters

00:00 Introduction
01:15 Node.js Runtime — Memory, GC, V8 Stats
03:20 Process + Event Loop + Active Handles
05:30 Framework + Routes + Middleware
07:10 HTTP Requests + Module Inspection
09:15 System Resources (CPU, Disk)
10:50 Database Connection Pool Detection
12:20 Comprehensive Multi-Tool Debugging
14:00 Summary + Quick Start Guide

---

## Thumbnail Text (for image)

Node.js Debug Agent
Chat with your LIVE app
27 tools / 9 inspectors

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
