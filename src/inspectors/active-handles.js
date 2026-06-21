'use strict';

const { debugTool } = require('../tool-registry');

// get_active_handles — list active libuv handles keeping the process alive
debugTool('get_active_handles', 'List active libuv handles (timers, sockets, servers) keeping the process alive, with type and details', {})(
  async function getActiveHandles() {
    const handles = process._getActiveHandles();
    const details = handles.map(h => {
      const info = { type: h.constructor.name };
      if (h.address && typeof h.address === 'function') {
        try {
          const addr = h.address();
          if (addr) info.address = addr;
        } catch (e) {}
      }
      if (h._idleTimeout !== undefined) info.timeout_ms = h._idleTimeout;
      if (h.fd !== undefined) info.fd = h.fd;
      if (h.remoteAddress) info.remote = h.remoteAddress;
      if (h.localAddress) info.local = h.localAddress;
      return info;
    });
    return { active_handles: details, handle_count: handles.length };
  }
);

// get_active_requests — list active libuv requests (pending operations)
debugTool('get_active_requests', 'List active libuv requests (pending I/O operations) via process._getActiveRequests()', {})(
  async function getActiveRequests() {
    const requests = process._getActiveRequests();
    const details = requests.map(r => ({
      type: r.constructor.name,
      fd: r.fd !== undefined ? r.fd : undefined,
    }));
    return { active_requests: details, request_count: requests.length };
  }
);

// get_handle_summary — count handles/requests by type for quick overview
debugTool('get_handle_summary', 'Count active libuv handles and requests grouped by type for a quick overview', {})(
  async function getHandleSummary() {
    const handles = process._getActiveHandles();
    const requests = process._getActiveRequests();

    const handleByType = {};
    for (const h of handles) {
      const name = h.constructor.name;
      handleByType[name] = (handleByType[name] || 0) + 1;
    }

    const requestByType = {};
    for (const r of requests) {
      const name = r.constructor.name;
      requestByType[name] = (requestByType[name] || 0) + 1;
    }

    return {
      total_handles: handles.length,
      total_requests: requests.length,
      handles_by_type: handleByType,
      requests_by_type: requestByType,
    };
  }
);
