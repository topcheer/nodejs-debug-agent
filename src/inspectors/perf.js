'use strict';

const { performance, PerformanceObserver, constants } = require('perf_hooks');
const { debugTool } = require('../tool-registry');

// --- Collected performance entries ---
const perfEntries = [];
const MAX_ENTRIES = 500;
let _observerSetup = false;

function setupObserver() {
  if (_observerSetup) return;
  _observerSetup = true;

  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        perfEntries.push({
          name: entry.name,
          type: entry.entryType,
          duration: Math.round(entry.duration * 100) / 100,
          startTime: Math.round(entry.startTime * 100) / 100,
          timestamp: Date.now(),
        });
      }
      if (perfEntries.length > MAX_ENTRIES) {
        perfEntries.splice(0, perfEntries.length - MAX_ENTRIES);
      }
    });

    // Observe all entry types
    obs.observe({ entryTypes: ['gc', 'function', 'measure', 'mark', 'resource', 'node'] });
  } catch (e) {
    // PerformanceObserver or entry types may not be fully supported
  }
}

// Set up on load
setupObserver();

// get_perf_entries — get PerformanceObserver entries
debugTool('get_perf_entries', 'Get PerformanceObserver entries (GC, function, measure marks). Shows entry type, name, duration, and startTime.', {
  entry_type: { type: 'string', description: 'Filter by entry type (gc, function, measure, mark, resource)', required: false },
  limit: { type: 'integer', description: 'Max results to return (most recent first)', required: false },
})(
  async function getPerfEntries({ entry_type, limit }) {
    let entries = [...perfEntries].reverse(); // most recent first

    if (entry_type) {
      entries = entries.filter(e => e.type === entry_type);
    }

    if (limit) {
      entries = entries.slice(0, limit);
    }

    // Also get any current Node.js performance marks/measures directly from the API
    let currentMarks = [];
    let currentMeasures = [];
    try {
      currentMarks = performance.getEntriesByType('mark').map(m => ({
        name: m.name,
        type: 'mark',
        startTime: Math.round(m.startTime * 100) / 100,
        duration: 0,
      }));
      currentMeasures = performance.getEntriesByType('measure').map(m => ({
        name: m.name,
        type: 'measure',
        startTime: Math.round(m.startTime * 100) / 100,
        duration: Math.round(m.duration * 100) / 100,
      }));
    } catch (e) {}
    // Group by type for summary
    const byType = {};
    for (const e of entries) {
      if (!byType[e.type]) {
        byType[e.type] = { count: 0, total_duration: 0, avg_duration: 0 };
      }
      byType[e.type].count++;
      byType[e.type].total_duration += e.duration;
    }
    for (const t of Object.keys(byType)) {
      byType[t].avg_duration = byType[t].count > 0
        ? Math.round((byType[t].total_duration / byType[t].count) * 100) / 100
        : 0;
    }

    return {
      total_collected: perfEntries.length,
      returned: entries.length,
      active_marks: currentMarks.length,
      active_measures: currentMeasures.length,
      entries,
      current_marks: currentMarks.slice(0, 20),
      current_measures: currentMeasures.slice(0, 20),
      summary_by_type: byType,
    };
  }
);
