'use strict';

const { debugTool } = require('../tool-registry');

// Registry of WebSocket servers (ws library) and Socket.IO instances
const wsServers = new Map();
const ioInstances = new Map();

// Per-connection tracking
const connectionRegistry = new Map(); // connId -> { id, serverName, remoteAddress, connectedAt, messagesSent, messagesReceived }
let connIdCounter = 0;

// Global stats
let totalConnectionsEver = 0;
let totalMessagesSent = 0;
let totalMessagesReceived = 0;

/**
 * Register a `ws` WebSocket.Server for inspection.
 * Automatically tracks connection lifecycle.
 * @param {string} name - Identifier for this WebSocket server
 * @param {object} wss - ws library WebSocket.Server instance
 */
function registerWSServer(name, wss) {
  wsServers.set(name, wss);

  // Track new connections
  wss.on('connection', (ws, req) => {
    const connId = ++connIdCounter;
    totalConnectionsEver++;

    const connInfo = {
      id: connId,
      serverName: name,
      remoteAddress: req?.socket?.remoteAddress || req?.connection?.remoteAddress || 'unknown',
      connectedAt: Date.now(),
      messagesSent: 0,
      messagesReceived: 0,
      _ws: ws,
    };

    connectionRegistry.set(connId, connInfo);

    // Track incoming messages
    ws.on('message', (data) => {
      connInfo.messagesReceived++;
      totalMessagesReceived++;

      // Echo back if it's an echo server (handled by the app normally)
      try {
        if (ws.readyState === 1) { // OPEN
          ws.send(data);
          connInfo.messagesSent++;
          totalMessagesSent++;
        }
      } catch {}
    });

    ws.on('close', () => {
      connectionRegistry.delete(connId);
    });

    ws.on('error', () => {
      connectionRegistry.delete(connId);
    });
  });
}

/**
 * Register a Socket.IO instance for inspection.
 * @param {string} name - Identifier for this Socket.IO instance
 * @param {object} io - socket.io Server instance
 */
function registerIO(name, io) {
  ioInstances.set(name, io);

  io.on('connection', (socket) => {
    const connId = ++connIdCounter;
    totalConnectionsEver++;

    const connInfo = {
      id: connId,
      serverName: name,
      remoteAddress: socket.handshake?.address || 'unknown',
      connectedAt: Date.now(),
      messagesSent: 0,
      messagesReceived: 0,
      rooms: new Set(),
      _socket: socket,
    };

    connectionRegistry.set(connId, connInfo);

    socket.onAny((event) => {
      connInfo.messagesReceived++;
      totalMessagesReceived++;
    });

    socket.conn.on('message', () => {
      // Count transport-level messages
    });

    socket.on('disconnect', () => {
      connectionRegistry.delete(connId);
    });
  });
}

// ── get_ws_connections ─────────────────────────────────────────────
debugTool('get_ws_connections', 'List active WebSocket connections from ws library or Socket.IO servers. Shows connection ID, remote address, uptime, and message counts.', {
  server_name: { type: 'string', description: 'Filter by server name. If omitted, shows connections from all registered servers.', required: false },
})(
  async function getWsConnections({ server_name }) {
    // Also auto-discover from registered servers
    autoDiscoverConnections();

    if (connectionRegistry.size === 0) {
      return {
        status: 'No active WebSocket connections. Register servers with registerWSServer(name, wss) or registerIO(name, io).',
        active_connections: 0,
      };
    }

    const now = Date.now();
    let connections = [];

    for (const [id, conn] of connectionRegistry) {
      connections.push({
        id: conn.id,
        server: conn.serverName,
        remote_address: conn.remoteAddress,
        uptime_seconds: Math.round((now - conn.connectedAt) / 1000),
        connected_at: new Date(conn.connectedAt).toISOString(),
        messages_sent: conn.messagesSent,
        messages_received: conn.messagesReceived,
        rooms: conn.rooms ? [...conn.rooms] : undefined,
      });
    }

    if (server_name) {
      connections = connections.filter(c => c.server === server_name);
    }

    return {
      active_connections: connections.length,
      servers: [...wsServers.keys(), ...ioInstances.keys()],
      connections,
    };
  }
);

// ── get_ws_stats ──────────────────────────────────────────────────
debugTool('get_ws_stats', 'Get WebSocket statistics: total connections ever, active connections now, and total messages sent/received across all registered servers.', {})(
  async function getWsStats() {
    // Count active connections per server
    const perServer = {};
    for (const [id, conn] of connectionRegistry) {
      perServer[conn.serverName] = (perServer[conn.serverName] || 0) + 1;
    }

    return {
      total_connections_ever: totalConnectionsEver,
      active_connections: connectionRegistry.size,
      total_messages_sent: totalMessagesSent,
      total_messages_received: totalMessagesReceived,
      registered_ws_servers: [...wsServers.keys()],
      registered_io_instances: [...ioInstances.keys()],
      active_per_server: perServer,
    };
  }
);

// ── get_ws_rooms ──────────────────────────────────────────────────
debugTool('get_ws_rooms', 'List Socket.IO rooms with member counts. Only applicable when Socket.IO is used.', {
  server_name: { type: 'string', description: 'Specific Socket.IO server name. If omitted, queries all registered IO instances.', required: false },
})(
  async function getWsRooms({ server_name }) {
    if (ioInstances.size === 0) {
      return {
        status: 'No Socket.IO instances registered. Use ws library instead (rooms are Socket.IO-specific).',
        has_socketio: false,
      };
    }

    const targets = server_name ? [[server_name, ioInstances.get(server_name)]] : [...ioInstances];
    const valid = targets.filter(([name, io]) => io);

    if (valid.length === 0) {
      return { error: `Socket.IO instance "${server_name}" not found` };
    }

    const results = [];

    for (const [name, io] of valid) {
      try {
        const rooms = [];

        // socket.io v4+: io.sockets.adapter.rooms
        const adapter = io.sockets?.adapter;
        if (adapter && adapter.rooms) {
          for (const [roomName, clients] of adapter.rooms) {
            // Skip the per-socket auto-rooms (socket IDs)
            if (adapter.sids) {
              let isSocketRoom = false;
              for (const [sid, sRooms] of adapter.sids) {
                if (sid === roomName) { isSocketRoom = true; break; }
              }
              if (isSocketRoom) continue;
            }

            rooms.push({
              room: roomName,
              member_count: clients.size || clients.length || 0,
            });
          }
        }

        results.push({
          server: name,
          connected_clients: io.sockets?.sockets?.size || 0,
          room_count: rooms.length,
          rooms,
        });
      } catch (e) {
        results.push({ server: name, error: e.message });
      }
    }

    return { io_count: results.length, servers: results };
  }
);

// ── Auto-discovery ────────────────────────────────────────────────

function autoDiscoverConnections() {
  // Try to find ws.WebSocketServer instances in require.cache
  try {
    const wsMod = require('ws');
    if (wsMod && wsMod.WebSocketServer) {
      for (const [id, mod] of Object.entries(require.cache)) {
        const exp = mod.exports;
        if (exp instanceof wsMod.WebSocketServer && !isWSSRegistered(exp)) {
          // Found an unregistered WSS — register it
          const name = shortPath(id);
          if (!wsServers.has(name)) {
            wsServers.set(name, exp);
          }
        }
      }
    }
  } catch {}

  // Try socket.io
  try {
    const ioMod = require('socket.io');
    if (ioMod) {
      for (const [id, mod] of Object.entries(require.cache)) {
        const exp = mod.exports;
        if (exp && exp.sockets && exp.engine && typeof exp.on === 'function' && !isIORegistered(exp)) {
          const name = shortPath(id);
          if (!ioInstances.has(name)) {
            ioInstances.set(name, exp);
          }
        }
      }
    }
  } catch {}
}

function isWSSRegistered(wss) {
  for (const [, registered] of wsServers) {
    if (registered === wss) return true;
  }
  return false;
}

function isIORegistered(io) {
  for (const [, registered] of ioInstances) {
    if (registered === io) return true;
  }
  return false;
}

function shortPath(id) {
  const parts = id.split('/');
  return parts.slice(-2).join('/');
}

module.exports = { registerWSServer, registerIO, wsServers, ioInstances };
