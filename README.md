# Node.js Debug Agent

An AI-powered runtime debugging agent that embeds directly into your Node.js application. Add one dependency, configure an LLM key, and chat with your live app at `/agent` to inspect heap, event loop, routes, HTTP requests, and more.

## Quick Start

### 1. Install

```bash
npm install @debug-agent/node
```

### 2. Integrate (Express)

```javascript
const express = require('express');
const { createExpressRouter } = require('@debug-agent/node');

const app = express();
app.use(express.json());

// One line to integrate
app.use(createExpressRouter());
```

### 3. Configure LLM

```bash
export LLM_API_KEY=your-key
export LLM_BASE_URL=https://api.openai.com/v1  # optional
export LLM_MODEL=gpt-4o                         # optional
```

### 4. Run and open

```
http://localhost:3000/agent
```

## Framework Integrations

### Express

```javascript
const { createExpressRouter } = require('@debug-agent/node');
app.use(createExpressRouter());
```

### Fastify

```javascript
const fastify = require('fastify')();
const { createFastifyPlugin } = require('@debug-agent/node');
fastify.register(createFastifyPlugin());
```

### Raw HTTP Server

```javascript
const http = require('http');
const { createHttpHandler } = require('@debug-agent/node');
const handler = createHttpHandler();
http.createServer((req, res) => {
  if (!handler(req, res)) {
    // your normal routing
  }
}).listen(3000);
```

## Built-in Tools (18+)

| Tool | Description |
|------|-------------|
| `get_heap_stats` | V8 heap statistics |
| `trigger_gc` | Force GC with before/after comparison |
| `get_event_loop_lag` | Event loop delay measurement |
| `get_process_info` | PID, uptime, memory, CPU usage |
| `get_system_info` | Hostname, CPUs, load average |
| `get_active_handles` | Active handles keeping process alive |
| `get_v8_flags` | V8 engine flags and Harmony features |
| `get_routes` | Express route listing |
| `get_middleware` | Express middleware stack |
| `get_installed_packages` | npm packages from node_modules |
| `get_environment_variables` | Environment variables (masked secrets) |
| `get_recent_requests` | HTTP request ring buffer |
| `get_slow_requests` | Slowest requests by duration |
| `get_error_requests` | Error requests (4xx/5xx) |
| `get_request_stats` | P50/P95/P99 latency, error rate |
| `get_cpu_info` | CPU cores, model, load average |
| `get_disk_usage` | Disk usage for working directory |
| `get_uptime` | Process and system uptime |
| `get_module_list` | Loaded Node.js modules |

## Custom Tools

```javascript
const { debugTool } = require('@debug-agent/node');

debugTool('check_redis', 'Check Redis connection stats', {
  host: { type: 'string', description: 'Redis host', required: false },
})(async function checkRedis({ host }) {
  return { connected: true, host: host || 'localhost' };
});
```

## Run the Demo

```bash
npm install express
LLM_API_KEY=your-key node demo/app.js
# Open http://localhost:3000/agent
```

## License

MIT
