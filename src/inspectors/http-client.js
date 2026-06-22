'use strict';

const http = require('http');
const https = require('https');
const { debugTool } = require('../tool-registry');

// --- Outbound call tracking ---
const outboundStats = new Map(); // host -> {count, totalLatency, errors, statusCodes}
const trackedAgents = new Set();

function ensureHostStats(host) {
  if (!outboundStats.has(host)) {
    outboundStats.set(host, {
      count: 0,
      totalLatency: 0,
      errors: 0,
      statusCodes: {},
    });
  }
  return outboundStats.get(host);
}

// Wrap http/https.request to track outbound calls
let _httpPatched = false;
function patchHttp() {
  if (_httpPatched) return;
  _httpPatched = true;

  function wrapRequest(mod, protocol) {
    const origRequest = mod.request;
    mod.request = function (...args) {
      let options;
      let host = 'unknown';

      try {
        if (typeof args[0] === 'string') {
          const parsed = new URL(args[0]);
          host = parsed.hostname;
        } else if (args[0] instanceof URL) {
          host = args[0].hostname;
        } else if (args[0] && args[0].hostname) {
          host = args[0].hostname;
        } else if (args[0] && args[0].host) {
          host = typeof args[0].host === 'string' ? args[0].host.split(':')[0] : 'unknown';
        }
      } catch (e) {
        // ignore
      }

      const startTime = Date.now();
      const stats = ensureHostStats(host);
      stats.count++;

      const req = origRequest.apply(mod, args);

      req.on('response', (res) => {
        stats.totalLatency += Date.now() - startTime;
        const code = String(res.statusCode || 0);
        stats.statusCodes[code] = (stats.statusCodes[code] || 0) + 1;
      });

      req.on('error', (err) => {
        stats.totalLatency += Date.now() - startTime;
        stats.errors++;
        stats.statusCodes['error'] = (stats.statusCodes['error'] || 0) + 1;
      });

      return req;
    };
  }

  try {
    wrapRequest(http, 'http');
  } catch (e) {}
  try {
    wrapRequest(https, 'https');
  } catch (e) {}

  // Also track default agents
  try {
    if (http.globalAgent) trackedAgents.add({ agent: http.globalAgent, protocol: 'http' });
  } catch (e) {}
  try {
    if (https.globalAgent) trackedAgents.add({ agent: https.globalAgent, protocol: 'https' });
  } catch (e) {}
}

// Patch on load
patchHttp();

/**
 * Register an http.Agent or https.Agent for tracking.
 */
function registerAgent(agent, protocol) {
  trackedAgents.add({ agent, protocol: protocol || 'http' });
}

function getAgentInfo(entry) {
  const { agent, protocol } = entry;
  const info = { protocol };

  try {
    info.class = agent.constructor ? agent.constructor.name : 'Agent';
    info.keepAlive = agent.keepAlive !== undefined ? agent.keepAlive : undefined;
    info.maxSockets = agent.maxSockets !== undefined ? agent.maxSockets : undefined;
    info.keepAliveMsecs = agent.keepAliveMsecs !== undefined ? agent.keepAliveMsecs : undefined;

    // Connection pool stats
    const sockets = agent.sockets || {};
    const socketCount = Object.values(sockets).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    info.active_sockets = socketCount;
    info.sockets_by_host = Object.fromEntries(
      Object.entries(sockets).map(([host, arr]) => [host, Array.isArray(arr) ? arr.length : 0])
    );

    const pendingRequests = agent.requests || {};
    const pendingCount = Object.values(pendingRequests).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    info.pending_requests = pendingCount;
    info.pending_by_host = Object.fromEntries(
      Object.entries(pendingRequests).map(([host, arr]) => [host, Array.isArray(arr) ? arr.length : 0])
    );

    const freeSockets = agent.freeSockets || {};
    const freeCount = Object.values(freeSockets).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    info.free_sockets = freeCount;
  } catch (e) {
    info.error = e.message;
  }

  return info;
}

// get_http_agents — list http.Agent/https.Agent instances with connection pool stats
debugTool('get_http_agents', 'List http.Agent/https.Agent instances with connection pool stats (sockets, pending requests, keepAlive)', {})(
  async function getHttpAgents() {
    const agents = [];
    const seen = new Set();

    for (const entry of trackedAgents) {
      try {
        const key = entry.agent;
        if (seen.has(key)) continue;
        seen.add(key);
        agents.push(getAgentInfo(entry));
      } catch (e) {
        agents.push({ error: e.message });
      }
    }

    return {
      agent_count: agents.length,
      agents,
    };
  }
);

// get_outbound_summary — summary of outbound HTTP calls
debugTool('get_outbound_summary', 'Get a summary of outbound HTTP calls: total, average latency, error rate, top hosts', {})(
  async function getOutboundSummary() {
    let totalCount = 0;
    let totalLatency = 0;
    let totalErrors = 0;
    const hosts = [];

    for (const [host, stats] of outboundStats) {
      totalCount += stats.count;
      totalLatency += stats.totalLatency;
      totalErrors += stats.errors;

      hosts.push({
        host,
        count: stats.count,
        avg_latency_ms: stats.count > 0 ? Math.round(stats.totalLatency / stats.count) : 0,
        errors: stats.errors,
        error_rate: stats.count > 0 ? `${(stats.errors / stats.count * 100).toFixed(1)}%` : 'N/A',
        status_codes: stats.statusCodes,
      });
    }

    hosts.sort((a, b) => b.count - a.count);

    return {
      total_requests: totalCount,
      avg_latency_ms: totalCount > 0 ? Math.round(totalLatency / totalCount) : 0,
      total_errors: totalErrors,
      error_rate: totalCount > 0 ? `${(totalErrors / totalCount * 100).toFixed(1)}%` : 'N/A',
      unique_hosts: outboundStats.size,
      top_hosts: hosts.slice(0, 10),
    };
  }
);

module.exports = { registerAgent };
