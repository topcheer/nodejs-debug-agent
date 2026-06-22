'use strict';

const inspector = require('inspector');
const { debugTool } = require('../tool-registry');

// --- Stored heap snapshots ---
const heapSnapshots = new Map();
let snapshotCounter = 0;

/**
 * Take a heap snapshot via V8 inspector and extract type statistics.
 */
function captureHeapSnapshot() {
  return new Promise((resolve, reject) => {
    let session;
    try {
      session = new inspector.Session();
      session.connect();
    } catch (e) {
      return reject(new Error(`Cannot connect to inspector: ${e.message}`));
    }

    const memUsage = process.memoryUsage();

    // Collect snapshot chunks
    const chunks = [];

    session.on('HeapProfiler.addHeapSnapshotChunk', (m) => {
      chunks.push(m.params.chunk);
    });

    session.post('HeapProfiler.enable', (enableErr) => {
      if (enableErr) {
        try { session.disconnect(); } catch (_) {}
        return reject(new Error(`HeapProfiler.enable failed: ${enableErr.message}`));
      }

      session.post('HeapProfiler.takeHeapSnapshot', { reportProgress: false }, (snapErr) => {
        if (snapErr) {
          try { session.disconnect(); } catch (_) {}
          return reject(new Error(`takeHeapSnapshot failed: ${snapErr.message}`));
        }

        try { session.disconnect(); } catch (_) {}

        const rawSnapshot = chunks.join('');
        const typeStats = extractTypeStats(rawSnapshot);

        resolve({
          rawLength: rawSnapshot.length,
          typeStats,
          memUsage,
        });
      });
    });
  });
}

/**
 * Extract node type statistics from a heap snapshot JSON.
 */
function extractTypeStats(rawJson) {
  let snapshot;
  try {
    snapshot = JSON.parse(rawJson);
  } catch (e) {
    return { error: `Failed to parse snapshot JSON: ${e.message}` };
  }

  const nodes = snapshot.nodes || [];
  const typeStrings = [];
  let typeFieldIdx = 0;

  // Meta info for decoding nodes array
  const meta = snapshot.snapshot && snapshot.snapshot.meta
    ? snapshot.snapshot.meta
    : snapshot.meta;

  if (meta && meta.node_types && meta.node_fields) {
    // node_types[0] is an array of type strings for the 'type' field
    typeFieldIdx = meta.node_fields.indexOf('type');
    if (typeFieldIdx >= 0 && meta.node_types[typeFieldIdx]) {
      typeStrings.push(...meta.node_types[typeFieldIdx]);
    }
  }

  const selfSizeIdx = meta && meta.node_fields ? meta.node_fields.indexOf('self_size') : 1;
  const nodeFieldCount = meta && meta.node_fields ? meta.node_fields.length : 7;

  // Count by type
  const byType = {};
  for (let i = 0; i + typeFieldIdx < nodes.length; i += nodeFieldCount) {
    const typeIdx = nodes[i + typeFieldIdx];
    const selfSize = nodes[i + selfSizeIdx] || 0;
    const typeName = typeStrings[typeIdx] || `type_${typeIdx}`;

    if (!byType[typeName]) {
      byType[typeName] = { count: 0, size: 0 };
    }
    byType[typeName].count++;
    byType[typeName].size += selfSize;
  }

  // Convert to sorted array
  const result = Object.entries(byType)
    .map(([type, stats]) => ({
      type,
      count: stats.count,
      size_bytes: stats.size,
      size_mb: parseFloat((stats.size / 1024 / 1024).toFixed(4)),
    }))
    .sort((a, b) => b.size_bytes - a.size_bytes);

  return {
    total_nodes: nodes.length / nodeFieldCount | 0,
    type_count: result.length,
    types: result.slice(0, 50), // top 50 by size
  };
}

/**
 * take_heap_snapshot — Record current heap state.
 */
debugTool('take_heap_snapshot', 'Record current V8 heap state: memory usage (rss, heap used/total/external), object type counts from heap snapshot. Returns snapshot ID and summary.', {})(
  async function takeHeapSnapshot() {
    try {
      const result = await captureHeapSnapshot();

      snapshotCounter++;
      const id = `heap-${snapshotCounter}`;

      const entry = {
        id,
        timestamp: new Date().toISOString(),
        memUsage: result.memUsage,
        typeStats: result.typeStats,
      };

      heapSnapshots.set(id, entry);

      const mem = result.memUsage;
      const toMB = v => (v / 1024 / 1024).toFixed(2);

      return {
        snapshot_id: id,
        timestamp: entry.timestamp,
        heap_summary: {
          rss_mb: toMB(mem.rss),
          heap_total_mb: toMB(mem.heapTotal),
          heap_used_mb: toMB(mem.heapUsed),
          external_mb: toMB(mem.external),
          array_buffers_mb: toMB(mem.arrayBuffers),
        },
        type_stats: result.typeStats.error
          ? { error: result.typeStats.error }
          : {
              total_nodes: result.typeStats.total_nodes,
              type_count: result.typeStats.type_count,
              top_types_by_size: result.typeStats.types.slice(0, 15),
            },
        total_snapshots: heapSnapshots.size,
      };
    } catch (e) {
      return { error: e.message };
    }
  }
);

/**
 * compare_heap_snapshots — Compare two heap snapshots.
 */
debugTool('compare_heap_snapshots', 'Compare two heap snapshots by ID. Returns per-type: count_delta, size_delta, growth_percentage. Sorted by size_delta.', {
  snapshot_id_1: { type: 'string', description: 'First (earlier) snapshot ID', required: true },
  snapshot_id_2: { type: 'string', description: 'Second (later) snapshot ID', required: true },
})(
  async function compareHeapSnapshots({ snapshot_id_1, snapshot_id_2 }) {
    const snap1 = heapSnapshots.get(snapshot_id_1);
    const snap2 = heapSnapshots.get(snapshot_id_2);

    if (!snap1) return { error: `Snapshot not found: ${snapshot_id_1}` };
    if (!snap2) return { error: `Snapshot not found: ${snapshot_id_2}` };

    if (snap1.typeStats.error || snap2.typeStats.error) {
      return { error: 'One or both snapshots have invalid type statistics' };
    }

    // Build type maps
    const types1 = {};
    for (const t of snap1.typeStats.types) {
      types1[t.type] = t;
    }
    const types2 = {};
    for (const t of snap2.typeStats.types) {
      types2[t.type] = t;
    }

    const allTypes = new Set([...Object.keys(types1), ...Object.keys(types2)]);
    const deltas = [];

    for (const type of allTypes) {
      const t1 = types1[type] || { count: 0, size_bytes: 0 };
      const t2 = types2[type] || { count: 0, size_bytes: 0 };

      const countDelta = t2.count - t1.count;
      const sizeDelta = t2.size_bytes - t1.size_bytes;
      const growthPct = t1.size_bytes > 0
        ? parseFloat(((sizeDelta / t1.size_bytes) * 100).toFixed(2))
        : null;

      deltas.push({
        type,
        count_1: t1.count,
        count_2: t2.count,
        count_delta: countDelta,
        size_1_bytes: t1.size_bytes,
        size_2_bytes: t2.size_bytes,
        size_delta: sizeDelta,
        size_delta_mb: parseFloat((sizeDelta / 1024 / 1024).toFixed(4)),
        growth_percentage: growthPct,
      });
    }

    deltas.sort((a, b) => b.size_delta - a.size_delta);

    // Memory usage comparison
    const mem1 = snap1.memUsage;
    const mem2 = snap2.memUsage;
    const toMB = v => parseFloat((v / 1024 / 1024).toFixed(2));

    return {
      snapshot_1: snap1.id,
      snapshot_2: snap2.id,
      timestamp_1: snap1.timestamp,
      timestamp_2: snap2.timestamp,
      memory_delta: {
        rss_mb: toMB(mem2.rss - mem1.rss),
        heap_used_mb: toMB(mem2.heapUsed - mem1.heapUsed),
        heap_total_mb: toMB(mem2.heapTotal - mem1.heapTotal),
        external_mb: toMB(mem2.external - mem1.external),
      },
      type_deltas: deltas.slice(0, 50),
      growing_types: deltas.filter(d => d.size_delta > 0).length,
      shrinking_types: deltas.filter(d => d.size_delta < 0).length,
    };
  }
);

/**
 * get_leak_candidates — Types with consistent growth across snapshots.
 */
debugTool('get_leak_candidates', 'Identify potential memory leak candidates: types with consistent growth across stored snapshots and large retained sizes', {})(
  async function getLeakCandidates() {
    const ids = Array.from(heapSnapshots.keys());

    if (ids.length < 2) {
      return {
        error: 'At least 2 heap snapshots are needed for leak detection. Use take_heap_snapshot multiple times.',
        available_snapshots: ids.length,
      };
    }

    // Compare consecutive snapshots to find types that grow consistently
    const typeGrowthHistory = {}; // type → [{ delta, pct }]

    for (let i = 1; i < ids.length; i++) {
      const prev = heapSnapshots.get(ids[i - 1]);
      const curr = heapSnapshots.get(ids[i]);

      if (prev.typeStats.error || curr.typeStats.error) continue;

      const typesPrev = {};
      for (const t of prev.typeStats.types) typesPrev[t.type] = t;
      const typesCurr = {};
      for (const t of curr.typeStats.types) typesCurr[t.type] = t;

      const allTypes = new Set([...Object.keys(typesPrev), ...Object.keys(typesCurr)]);
      for (const type of allTypes) {
        const t1 = typesPrev[type] || { size_bytes: 0 };
        const t2 = typesCurr[type] || { size_bytes: 0 };
        const delta = t2.size_bytes - t1.size_bytes;

        if (!typeGrowthHistory[type]) typeGrowthHistory[type] = [];
        typeGrowthHistory[type].push({
          delta,
          pct: t1.size_bytes > 0 ? parseFloat(((delta / t1.size_bytes) * 100).toFixed(2)) : null,
        });
      }
    }

    // Find types that grew in ALL comparisons
    const candidates = [];
    for (const [type, history] of Object.entries(typeGrowthHistory)) {
      const allGrowing = history.every(h => h.delta > 0);
      const totalGrowth = history.reduce((sum, h) => sum + h.delta, 0);
      const comparisons = history.length;

      if (allGrowing && comparisons > 0) {
        // Get latest size
        const lastSnap = heapSnapshots.get(ids[ids.length - 1]);
        const lastType = lastSnap.typeStats.types.find(t => t.type === type);

        candidates.push({
          type,
          consecutive_growths: comparisons,
          total_size_delta_bytes: totalGrowth,
          total_size_delta_mb: parseFloat((totalGrowth / 1024 / 1024).toFixed(4)),
          current_size_bytes: lastType ? lastType.size_bytes : 0,
          current_count: lastType ? lastType.count : 0,
          growth_history: history,
        });
      }
    }

    candidates.sort((a, b) => b.total_size_delta_bytes - a.total_size_delta_bytes);

    return {
      snapshot_count: ids.length,
      comparisons: ids.length - 1,
      candidate_count: candidates.length,
      leak_candidates: candidates.slice(0, 20),
    };
  }
);
