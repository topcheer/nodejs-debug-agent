'use strict';

const { debugTool } = require('../tool-registry');

// get_socket_info — list active net.Socket connections
debugTool('get_socket_info', 'List active net.Socket connections with remoteAddress, remotePort, bytesRead, bytesWritten, and state', {
  state: { type: 'string', description: 'Filter by socket state (connected, closed, etc.)', required: false },
})(
  async function getSocketInfo({ state }) {
    const sockets = [];

    try {
      // Get all active handles and filter for sockets
      const handles = process._getActiveHandles ? process._getActiveHandles() : [];

      for (const handle of handles) {
        try {
          // Check if it's a socket-like object
          if (!handle || typeof handle !== 'object') continue;

          // net.Socket instances have remoteAddress/remotePort
          const isSocket = handle.remoteAddress !== undefined ||
            (handle.constructor && (
              handle.constructor.name === 'Socket' ||
              handle.constructor.name === 'TLSSocket'
            ));

          if (!isSocket) continue;

          const info = {
            type: handle.constructor ? handle.constructor.name : 'Socket',
            remoteAddress: handle.remoteAddress || null,
            remotePort: handle.remotePort || null,
            localAddress: handle.localAddress || null,
            localPort: handle.localPort || null,
            bytesRead: handle.bytesRead || 0,
            bytesWritten: handle.bytesWritten || 0,
            state: handle.destroyed ? 'destroyed' : (handle.writable && handle.readable ? 'connected' : 'closing'),
            fd: handle.fd !== undefined ? handle.fd : undefined,
            timeout: handle.timeout !== undefined ? handle.timeout : undefined,
          };

          // TLS specific info
          if (handle.constructor && handle.constructor.name === 'TLSSocket') {
            try {
              if (handle.encrypted !== undefined) info.encrypted = handle.encrypted;
              if (typeof handle.getCipher === 'function') {
                const cipher = handle.getCipher();
                if (cipher) info.cipher = cipher.name;
              }
              if (typeof handle.getProtocol === 'function') {
                info.tls_protocol = handle.getProtocol();
              }
            } catch (e) {}
          }

          sockets.push(info);
        } catch (e) {
          // skip individual bad handles
        }
      }
    } catch (e) {
      return { error: e.message };
    }

    let filtered = sockets;
    if (state) {
      filtered = sockets.filter(s => s.state === state);
    }

    // Summary stats
    const totalBytesRead = sockets.reduce((sum, s) => sum + (s.bytesRead || 0), 0);
    const totalBytesWritten = sockets.reduce((sum, s) => sum + (s.bytesWritten || 0), 0);

    const byType = {};
    for (const s of sockets) {
      byType[s.type] = (byType[s.type] || 0) + 1;
    }

    return {
      total_sockets: sockets.length,
      total_bytes_read: totalBytesRead,
      total_bytes_written: totalBytesWritten,
      sockets_by_type: byType,
      sockets: filtered,
    };
  }
);
