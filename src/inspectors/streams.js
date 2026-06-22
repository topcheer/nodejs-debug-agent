'use strict';

const { debugTool } = require('../tool-registry');

// get_stream_status — list active readable/writable/transform streams
debugTool('get_stream_status', 'List active readable/writable/transform streams with their state (flowing, paused, ended, destroyed, etc.)', {
  stream_type: { type: 'string', description: 'Filter by stream type (readable, writable, transform, duplex)', required: false },
})(
  async function getStreamStatus({ stream_type }) {
    const streams = [];

    try {
      const handles = process._getActiveHandles ? process._getActiveHandles() : [];

      for (const handle of handles) {
        try {
          if (!handle || typeof handle !== 'object') continue;

          // Detect streams: objects that have readable/writable or pipe methods
          const isStream =
            (typeof handle.read === 'function' || typeof handle.write === 'function') &&
            (handle.readable !== undefined || handle.writable !== undefined ||
             (handle._readableState !== undefined || handle._writableState !== undefined));

          if (!isStream) continue;

          const constructorName = handle.constructor ? handle.constructor.name : 'Stream';

          // Skip raw sockets (covered by sockets inspector) unless they're wrapped
          if (constructorName === 'Socket' || constructorName === 'TLSSocket') continue;

          const info = {
            type: constructorName,
            readable: handle.readable !== undefined ? handle.readable : null,
            writable: handle.writable !== undefined ? handle.writable : null,
            destroyed: handle.destroyed || false,
            ended: handle.readableEnded || handle.writableEnded || false,
          };

          // Determine stream category
          const isReadable = typeof handle.read === 'function' && handle._readableState !== undefined;
          const isWritable = typeof handle.write === 'function' && handle._writableState !== undefined;
          const isTransform = constructorName.includes('Transform') ||
            (isReadable && isWritable && typeof handle._transform === 'function');
          const isDuplex = isReadable && isWritable;

          if (isTransform) info.category = 'transform';
          else if (isDuplex) info.category = 'duplex';
          else if (isReadable) info.category = 'readable';
          else if (isWritable) info.category = 'writable';
          else info.category = 'unknown';

          // Readable state details
          if (isReadable && handle._readableState) {
            const rs = handle._readableState;
            info.readable_state = {
              flowing: rs.flowing,
              paused: rs.flowing === false && !rs.pipesCount,
              ended: rs.ended,
              pipes: rs.pipesCount || 0,
              buffer_length: rs.length || 0,
              high_water_mark: rs.highWaterMark || 0,
              object_mode: rs.objectMode || false,
            };
          }

          // Writable state details
          if (isWritable && handle._writableState) {
            const ws = handle._writableState;
            info.writable_state = {
              ended: ws.ended,
              finishing: ws.finished || false,
              buffer_length: ws.length || 0,
              high_water_mark: ws.highWaterMark || 0,
              object_mode: ws.objectMode || false,
              corked: ws.corked || 0,
            };
          }

          streams.push(info);
        } catch (e) {
          // skip individual handles
        }
      }
    } catch (e) {
      return { error: e.message };
    }

    let filtered = streams;
    if (stream_type) {
      filtered = streams.filter(s => s.category === stream_type);
    }

    // Summary
    const byCategory = {};
    for (const s of streams) {
      byCategory[s.category] = (byCategory[s.category] || 0) + 1;
    }

    return {
      total_streams: streams.length,
      streams_by_category: byCategory,
      streams: filtered,
    };
  }
);
