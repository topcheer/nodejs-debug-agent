'use strict';

const inspector = require('inspector');
const { debugTool } = require('../tool-registry');

// --- CPU profiling state ---
let profilingSession = null;
let lastProfile = null;
let profileTimer = null;

/**
 * start_cpu_profile — Start V8 CPU profiling using the built-in inspector module.
 * Auto-stops after duration_seconds.
 */
debugTool('start_cpu_profile', 'Start V8 CPU profiling using the built-in inspector module (Profiler.start). Auto-stops after duration_seconds. Returns profile ID.', {
  duration_seconds: { type: 'integer', description: 'Duration in seconds before auto-stopping (default 10)', required: false },
})(
  async function startCpuProfile({ duration_seconds }) {
    const duration = duration_seconds || 10;

    if (profilingSession) {
      return { error: 'CPU profiling already in progress. Call stop_cpu_profile first.' };
    }

    profilingSession = new inspector.Session();

    try {
      profilingSession.connect();

      await new Promise((resolve, reject) => {
        profilingSession.post('Profiler.enable', (err) => {
          if (err) reject(err); else resolve();
        });
      });

      await new Promise((resolve, reject) => {
        profilingSession.post('Profiler.setSamplingInterval', { interval: 100 }, (err) => {
          if (err) reject(err); else resolve();
        });
      });

      await new Promise((resolve, reject) => {
        profilingSession.post('Profiler.start', (err) => {
          if (err) reject(err); else resolve();
        });
      });
    } catch (e) {
      try { profilingSession.disconnect(); } catch (_) {}
      profilingSession = null;
      return { error: `Failed to start profiling: ${e.message}` };
    }

    // Auto-stop after duration
    profileTimer = setTimeout(async () => {
      if (profilingSession) {
        try {
          const result = await stopProfiling();
          lastProfile = result;
        } catch (e) {
          // Auto-stop failed silently
        }
      }
    }, duration * 1000);
    profileTimer.unref();

    // Don't keep the process alive for the timer
    if (profileTimer.unref) profileTimer.unref();

    return {
      status: 'profiling',
      profile_id: 'current',
      duration_seconds: duration,
      sampling_interval_us: 100,
      message: `CPU profiling started, will auto-stop in ${duration}s`,
    };
  }
);

/**
 * Internal helper to stop profiling and parse the profile.
 */
function stopProfiling() {
  return new Promise((resolve, reject) => {
    if (!profilingSession) {
      return reject(new Error('No active profiling session'));
    }

    profilingSession.post('Profiler.stop', (err, params) => {
      try { profilingSession.disconnect(); } catch (_) {}
      profilingSession = null;

      if (err) return reject(err);
      if (profileTimer) {
        clearTimeout(profileTimer);
        profileTimer = null;
      }

      const profile = params && params.profile;
      if (!profile) return reject(new Error('No profile data returned'));

      const functions = parseProfile(profile);
      resolve({ profile, functions });
    });
  });
}

/**
 * Parse a V8 CPU profile into per-function stats.
 */
function parseProfile(profile) {
  const nodes = profile.nodes || [];
  const samples = profile.samples || [];
  const timeDeltas = profile.timeDeltas || [];

  // Build node map: id → node
  const nodeMap = {};
  for (const node of nodes) {
    nodeMap[node.id] = node;
  }

  // Compute hit counts per node from samples
  const hitCounts = {};
  for (const sample of samples) {
    hitCounts[sample] = (hitCounts[sample] || 0) + 1;
  }

  // Compute self time per node (sum of timeDeltas for samples in that node)
  const selfTimes = {};
  for (let i = 0; i < samples.length; i++) {
    const nodeId = samples[i];
    const delta = timeDeltas[i] || 0;
    selfTimes[nodeId] = (selfTimes[nodeId] || 0) + delta;
  }

  // Build children map for total time computation
  const childrenMap = {};
  for (const node of nodes) {
    if (node.children) {
      for (const childId of node.children) {
        if (!childrenMap[node.id]) childrenMap[node.id] = [];
        childrenMap[node.id].push(childId);
      }
    }
  }

  // Compute total time per node (self time + time in all descendants within the profile)
  // Use the samples approach: total time = sum of all samples in subtree
  // For efficiency, use the hit count approach as approximation
  const totalTimes = {};

  // Walk from root to compute subtree hit counts
  // Build parent map
  const parentMap = {};
  for (const node of nodes) {
    if (node.children) {
      for (const childId of node.children) {
        parentMap[childId] = node.id;
      }
    }
  }

  // Find root node (no parent)
  const rootNodes = nodes.filter(n => parentMap[n.id] === undefined);

  // Compute subtree times using post-order traversal
  const computed = {};
  function computeTotal(nodeId) {
    if (computed[nodeId]) return totalTimes[nodeId] || 0;
    computed[nodeId] = true;
    let total = selfTimes[nodeId] || 0;
    const node = nodeMap[nodeId];
    if (node && node.children) {
      for (const childId of node.children) {
        total += computeTotal(childId);
      }
    }
    totalTimes[nodeId] = total;
    return total;
  }

  for (const root of rootNodes) {
    computeTotal(root.id);
  }
  // Also compute for any unconnected nodes
  for (const node of nodes) {
    if (!computed[node.id]) computeTotal(node.id);
  }

  // Build function list
  const functions = [];
  for (const node of nodes) {
    const cf = node.callFrame || {};
    const fnName = cf.functionName || '(anonymous)';
    // Skip (root) and (idle) / (program) entries
    if (fnName === '(root)' || fnName === '(idle)' || fnName === '(program)') continue;

    functions.push({
      functionName: fnName,
      scriptId: cf.scriptId || '',
      url: cf.url || '',
      lineNumber: cf.lineNumber !== undefined ? cf.lineNumber : -1,
      selfTime: selfTimes[node.id] || 0,
      totalTime: totalTimes[node.id] || 0,
      hitCount: hitCounts[node.id] || 0,
    });
  }

  return functions;
}

/**
 * stop_cpu_profile — Stop active profiling, return top 20 functions.
 */
debugTool('stop_cpu_profile', 'Stop active V8 CPU profiling and return top 20 functions by self time. Each function includes: functionName, scriptId, url, lineNumber, selfTime, totalTime, hitCount.', {})(
  async function stopCpuProfile() {
    if (!profilingSession) {
      if (lastProfile) {
        return {
          status: 'already_stopped',
          message: 'Profiling has already been stopped. Use get_top_functions to retrieve results.',
          top_functions: lastProfile.functions
            .sort((a, b) => b.selfTime - a.selfTime)
            .slice(0, 20),
        };
      }
      return { error: 'No active CPU profiling session. Call start_cpu_profile first.' };
    }

    try {
      const result = await stopProfiling();
      lastProfile = result;

      const top = result.functions
        .sort((a, b) => b.selfTime - a.selfTime)
        .slice(0, 20);

      const totalSamples = (result.profile.samples || []).length;

      return {
        status: 'stopped',
        total_nodes: result.profile.nodes ? result.profile.nodes.length : 0,
        total_samples: totalSamples,
        profiled_functions: result.functions.length,
        top_functions: top,
      };
    } catch (e) {
      return { error: `Failed to stop profiling: ${e.message}` };
    }
  }
);

/**
 * get_top_functions — Return top functions from the last CPU profile.
 */
debugTool('get_top_functions', 'Return top functions from the last CPU profile. Sort by selfTime, totalTime, or hitCount.', {
  limit: { type: 'integer', description: 'Max number of functions to return (default 20)', required: false },
  sort_by: { type: 'string', description: 'Sort field: selfTime, totalTime, or hitCount (default selfTime)', required: false },
})(
  async function getTopFunctions({ limit, sort_by }) {
    if (!lastProfile) {
      return { error: 'No CPU profile available. Run start_cpu_profile then stop_cpu_profile first.' };
    }

    const sortBy = sort_by || 'selfTime';
    const max = limit || 20;

    const validSortFields = ['selfTime', 'totalTime', 'hitCount'];
    if (!validSortFields.includes(sortBy)) {
      return { error: `Invalid sort_by '${sortBy}'. Use: ${validSortFields.join(', ')}` };
    }

    const sorted = [...lastProfile.functions]
      .sort((a, b) => b[sortBy] - a[sortBy])
      .slice(0, max);

    return {
      sort_by: sortBy,
      total_functions: lastProfile.functions.length,
      returned: sorted.length,
      functions: sorted,
    };
  }
);
