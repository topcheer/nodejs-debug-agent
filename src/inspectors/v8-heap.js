'use strict';

const v8 = require('v8');
const { debugTool } = require('../tool-registry');

// get_heap_snapshot_stats — detailed V8 heap statistics
debugTool('get_heap_snapshot_stats', 'Get detailed V8 heap statistics: total, used, free, external memory, and V8 internal counts', {})(
  async function getHeapSnapshotStats() {
    const stats = v8.getHeapStatistics();
    const toMB = v => (v / 1024 / 1024).toFixed(2);
    return {
      total_heap_size_mb: toMB(stats.total_heap_size),
      total_heap_size_executable_mb: toMB(stats.total_heap_size_executable),
      total_physical_size_mb: toMB(stats.total_physical_size),
      used_heap_size_mb: toMB(stats.used_heap_size),
      heap_size_limit_mb: toMB(stats.heap_size_limit),
      malloced_memory_mb: toMB(stats.malloced_memory),
      peak_malloced_memory_mb: toMB(stats.peak_malloced_memory),
      does_zap_garbage: stats.does_zap_garbage,
      number_of_native_contexts: stats.number_of_native_contexts,
      number_of_detached_contexts: stats.number_of_detached_contexts,
      total_global_handles: stats.total_global_handles,
      used_global_handles: stats.used_global_handles,
      external_memory_mb: toMB(stats.external_memory),
    };
  }
);

// get_heap_space_stats — per-heap-space breakdown (new space, old space, etc.)
debugTool('get_heap_space_stats', 'Get V8 heap space statistics with per-space breakdown (new space, old space, code space, large object space, etc.)', {})(
  async function getHeapSpaceStats() {
    const spaces = v8.getHeapSpaceStatistics();
    const toMB = v => (v / 1024 / 1024).toFixed(2);
    return spaces.map(s => ({
      space_name: s.space_name,
      physical_space_size_mb: toMB(s.physical_space_size),
      space_size_mb: toMB(s.space_size),
      space_used_size_mb: toMB(s.space_used_size),
      space_available_size_mb: toMB(s.space_available_size),
    }));
  }
);

// get_heap_code_stats — V8 code and bytecode statistics
debugTool('get_heap_code_stats', 'Get V8 heap code statistics: code and bytecode size on the heap', {})(
  async function getHeapCodeStats() {
    const stats = v8.getHeapCodeStatistics();
    const toMB = v => (v / 1024 / 1024).toFixed(2);
    return {
      code_and_metadata_size_mb: toMB(stats.code_and_metadata_size),
      bytecode_and_metadata_size_mb: toMB(stats.bytecode_and_metadata_size),
      external_script_source_size_mb: toMB(stats.external_script_source_size),
      cpu_profiler_metadata_size_mb: toMB(stats.cpu_profiler_metadata_size),
    };
  }
);
