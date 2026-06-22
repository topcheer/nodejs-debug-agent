# Node.js Debug Agent

[![@ggaiteam/node-debug-agent](https://img.shields.io/npm/v/@ggaiteam/node-debug-agent.svg)](https://www.npmjs.com/package/@ggaiteam/node-debug-agent)
![Tools](https://img.shields.io/badge/tools-70-blue)
![Inspectors](https://img.shields.io/badge/inspectors-28-green)
![Node](https://img.shields.io/badge/Node.js-18%2B-339933)
![npm](https://img.shields.io/badge/npm-latest-CB3837)

An AI-powered runtime debugging agent that embeds directly into your Node.js application. Add one dependency, configure an LLM key, and chat with your live app at `/agent` to inspect heap, event loop, active handles, loaded modules, process info, database pools, Redis, Express/Fastify routes, Mongoose models, BullMQ queues, cluster workers, HTTP requests, and more — **56 diagnostic tools across 23 inspectors**.

## Version Support

| Node.js Version | Status |
|-----------------|--------|
| 16.x            | Not supported |
| 18.x (LTS)      | Minimum supported (built-in `fetch`) |
| 20.x (LTS)      | Supported |
| 22.x (LTS)      | Supported |
| 24.x            | Supported |
| 26.x            | Tested |

> Requires Node.js 18+ for built-in `fetch()`, optional chaining (`?.`), and nullish coalescing (`??`).

## Quick Start

### 1. Install

```bash
npm install @ggaiteam/node-debug-agent
```

### 2. Integrate (Express)

```javascript
const express = require('express');
const { DebugAgent } = require('@ggaiteam/node-debug-agent');

const app = express();
app.use(express.json());

// One line to integrate
app.use('/agent', DebugAgent.middleware());

app.listen(3000);
```

### 3. Configure LLM

```bash
export LLM_API_KEY=your-key
export LLM_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4  # default
export LLM_MODEL=glm-5.2                                          # default
```

Supports any OpenAI-compatible endpoint.

### 4. Run and open

```
http://localhost:3000/agent
```

## Features

- **Streaming AI responses** with real-time tool call badges (pending / success / error)
- **Context compression** — automatically summarizes old conversation when token limit is approached
- **Dark-themed chat UI** with full markdown rendering (tables, code blocks, lists)
- **Max tool rounds** (25) with forced final summary when limit is reached
- **56 diagnostic tools** across **23 inspectors**
- Zero external dependencies (no Datadog, no Grafana, no APM)

## Inspectors & Tools (56)

### Runtime Inspector
| Tool | Description |
|------|-------------|
| `get_memory_usage` | process.memoryUsage() — RSS, heap, external |
| `get_cpu_usage` | process.cpuUsage() — user and system time |
| `get_uptime` | Process uptime and Node.js version |
| `get_event_loop_lag` | Event loop lag via perf_hooks |

### V8 Heap Inspector
| Tool | Description |
|------|-------------|
| `get_heap_stats` | v8.getHeapStatistics() — total/used/available heap |
| `get_heap_space_stats` | v8.getHeapSpaceStatistics() — per-space breakdown |
| `get_heap_code_stats` | v8.getHeapCodeStatistics() — code and bytecode stats |

### Active Handles Inspector
| Tool | Description |
|------|-------------|
| `get_active_handles` | List active libuv handles (timers, sockets, servers) |
| `get_active_requests` | List active libuv requests |
| `get_handle_summary` | Count handles by type |

### Process Inspector
| Tool | Description |
|------|-------------|
| `get_process_info` | PID, platform, arch, Node version, uptime |
| `get_resource_usage` | process.resourceUsage() details |
| `get_env_variables` | Environment variables (masked secrets) |

### Modules Inspector
| Tool | Description |
|------|-------------|
| `get_loaded_modules` | List loaded modules from require.cache |
| `get_module_count` | Total loaded module count |

### Database Inspector
| Tool | Description |
|------|-------------|
| `get_db_pool_status` | Connection pool stats (pg, mysql2, mongodb) |
| `get_db_query_stats` | Query count, avg duration, slow query detection |

### Framework Inspector
| Tool | Description |
|------|-------------|
| `get_routes` | List Express/Fastify routes |
| `get_middleware` | List middleware stack |
| `get_app_config` | Application configuration |

### HTTP Tracker Inspector
| Tool | Description |
|------|-------------|
| `get_recent_requests` | Recent HTTP requests ring buffer |
| `get_slow_requests` | Slowest requests by duration |
| `get_error_requests` | Error requests (4xx/5xx) |
| `get_request_stats` | P50/P95/P99 latency, error rate |

### System Inspector
| Tool | Description |
|------|-------------|
| `get_system_info` | Hostname, load average, CPU cores |
| `get_disk_usage` | Disk usage for working directory |
| `get_os_uptime` | OS uptime, free memory, load averages |

### Redis Inspector
| Tool | Description |
|------|-------------|
| `get_redis_info` | Redis server info: memory, connected clients, role |
| `get_redis_keys` | Scan Redis keyspace with pattern and count |
| `get_redis_slowlog` | Redis slow query log entries |
| `get_redis_client_stats` | Per-client connection stats and command stats |

### Express Routes Inspector
| Tool | Description |
|------|-------------|
| `get_express_routes` | List all Express routes with methods, paths, and params |
| `get_express_middleware` | List Express middleware stack with mount paths |

### Fastify Inspector
| Tool | Description |
|------|-------------|
| `get_fastify_routes` | List Fastify routes with constraints and schemas |
| `get_fastify_plugins` | List registered Fastify plugins and decorators |

### Mongoose Inspector
| Tool | Description |
|------|-------------|
| `get_mongoose_models` | List Mongoose models with schema field definitions |
| `get_mongoose_indexes` | List indexes and connection state per model |

### BullMQ Inspector
| Tool | Description |
|------|-------------|
| `get_bullmq_queues` | List BullMQ queues with job counts (active, waiting, completed) |
| `get_bullmq_jobs` | Inspect jobs in a queue with status filter and payload |

### Cluster Inspector
| Tool | Description |
|------|-------------|
| `get_cluster_workers` | List cluster workers with PID, state, and isPrimary flag |
| `get_worker_resource_usage` | Per-worker memory and CPU usage |

### Logging Inspector
| Tool | Description |
|------|-------------|
| `get_log_buffer` | Recent log entries from the built-in ring buffer (console capture) |
| `get_log_level` | Current log level for registered loggers (winston, pino, bunyan) |
| `set_log_level` | Dynamically change the log level of a registered logger |
| `get_log_transports` | List configured transports/handlers for registered loggers |

### Cache Inspector
| Tool | Description |
|------|-------------|
| `get_cache_stats` | Stats for registered caches (hit rate, miss count, key count) |
| `get_cache_keys` | List keys from a registered cache with optional prefix filter |
| `clear_cache` | Clear all entries from a registered cache |

### Outbound HTTP Inspector
| Tool | Description |
|------|-------------|
| `get_http_agents` | List http.Agent/https.Agent instances with connection pool stats |
| `get_outbound_summary` | Summary of outbound HTTP calls (total, avg latency, error rate, top hosts) |

### File Descriptor Inspector
| Tool | Description |
|------|-------------|
| `get_fd_info` | Open file descriptor count and system limits (RLIMIT_NOFILE) |

### Metrics Inspector
| Tool | Description |
|------|-------------|
| `get_registered_metrics` | List registered Prometheus metrics from prom-client |
| `get_metric_value` | Get the value of a specific registered Prometheus metric by name |

### Sockets Inspector
| Tool | Description |
|------|-------------|
| `get_socket_info` | List active net.Socket connections (remote address, bytes read/written, state) |

### Streams Inspector
| Tool | Description |
|------|-------------|
| `get_stream_status` | List active readable/writable/transform streams with their state |

### Performance Inspector
| Tool | Description |
|------|-------------|
| `get_perf_entries` | PerformanceObserver entries (GC, function, measure marks) |

## Custom Tools

```javascript
const { DebugAgent } = require('@ggaiteam/node-debug-agent');

DebugAgent.registerTool('check_redis', 'Check Redis connection', async () => {
    return { connected: true };
});
```

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `LLM_BASE_URL` | `https://open.bigmodel.cn/api/coding/paas/v4` | LLM endpoint |
| `LLM_API_KEY` | (required) | API key |
| `LLM_MODEL` | `glm-5.2` | Model name |
| `LLM_MAX_TOOL_ROUNDS` | `25` | Max tool-calling rounds |
| `LLM_CONTEXT_WINDOW_TOKENS` | `100000` | Context window size |

## Run the Demo

The demo uses **Express** + **ioredis** + **better-sqlite3** + **BullMQ**. Start Redis with Docker Compose first:

### Docker Compose

```yaml
# docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --save 60 1 --loglevel warning
```

```bash
docker compose up -d
```

### Start the app

```bash
export LLM_API_KEY=your-key
cd demo && npm install && node app.js
# Open http://localhost:3000/agent
```

## npm

[![@ggaiteam/node-debug-agent](https://img.shields.io/npm/v/@ggaiteam/node-debug-agent.svg)](https://www.npmjs.com/package/@ggaiteam/node-debug-agent)

## License

MIT
