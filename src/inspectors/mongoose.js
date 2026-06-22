'use strict';

const { debugTool } = require('../tool-registry');

// Registry of Mongoose instances for inspection
const mongooseInstances = new Map();

/**
 * Register a Mongoose instance for inspection.
 * @param {string|object} nameOrMongoose - Instance name (string) or the Mongoose instance itself
 * @param {object} [mongoose] - The Mongoose instance (when name is provided)
 */
function registerMongoose(nameOrMongoose, mongoose) {
  if (typeof nameOrMongoose === 'string') {
    mongooseInstances.set(nameOrMongoose, mongoose);
  } else {
    mongooseInstances.set('default', nameOrMongoose);
  }
}

// ── get_mongoose_models ───────────────────────────────────────────
debugTool('get_mongoose_models', 'List all registered Mongoose models with name, collection, schema paths, and indexes', {
  instance_name: { type: 'string', description: 'Name of the registered Mongoose instance. If omitted, auto-detects from require.cache.', required: false },
})(
  async function getMongooseModels({ instance_name }) {
    const mongoose = resolveMongoose(instance_name);
    if (!mongoose) {
      return { error: 'Mongoose is not installed or no Mongoose instance registered' };
    }

    const models = [];
    const modelMap = mongoose.models || {};

    for (const [name, model] of Object.entries(modelMap)) {
      const info = {
        name,
        collection_name: model.collection?.name || model.collectionName || 'unknown',
        db_name: model.collection?.conn?.name || model.db?.name || 'unknown',
      };

      // Extract schema paths
      try {
        const schema = model.schema;
        if (schema) {
          info.schema_paths = Object.keys(schema.paths).map(pathName => {
            const path = schema.paths[pathName];
            return {
              name: pathName,
              type: path.instance || path.options?.type?.name || 'Mixed',
              required: !!path.isRequired,
              unique: !!path.unique,
              default: path.defaultValue !== undefined ? formatDefault(path.defaultValue) : undefined,
              select: path.selected !== undefined ? path.selected : undefined,
            };
          });

          // Extract indexes
          if (schema.indexes) {
            info.indexes = schema.indexes().map(idx => {
              const fields = idx[0];
              const options = idx[1] || {};
              return {
                fields: Object.keys(fields).map(k => ({
                  key: k,
                  order: fields[k],
                })),
                unique: options.unique || false,
                sparse: options.sparse || false,
                name: options.name,
                expire_after_seconds: options.expires,
              };
            });
          }

          // Virtuals
          if (schema.virtuals) {
            const virtuals = Object.keys(schema.virtuals);
            if (virtuals.length > 0) info.virtuals = virtuals;
          }
        }
      } catch (e) {
        info.schema_error = e.message;
      }

      models.push(info);
    }

    return {
      framework: 'mongoose',
      model_count: models.length,
      models,
    };
  }
);

// ── get_mongoose_connections ──────────────────────────────────────
debugTool('get_mongoose_connections', 'List Mongoose connection states (readyState, host, port, db name) for all connections', {
  instance_name: { type: 'string', description: 'Name of the registered Mongoose instance. If omitted, auto-detects from require.cache.', required: false },
})(
  async function getMongooseConnections({ instance_name }) {
    const mongoose = resolveMongoose(instance_name);
    if (!mongoose) {
      return { error: 'Mongoose is not installed or no Mongoose instance registered' };
    }

    const connections = [];

    // Mongoose v6+ uses connections array/map
    const connMap = mongoose.connections || [];
    const connArray = Array.isArray(connMap) ? connMap : Object.values(connMap);

    // Also check the default connection
    const defaultConn = mongoose.connection;
    const allConns = defaultConn && !connArray.includes(defaultConn) ? [defaultConn, ...connArray] : connArray;

    const readyStateMap = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
      4: 'uninitialized',
    };

    for (const conn of allConns) {
      if (!conn) continue;

      const info = {
        name: conn.name || 'unknown',
        host: conn.host || 'unknown',
        port: conn.port || 'unknown',
        db_name: conn.name || 'unknown',
        ready_state: conn.readyState,
        ready_state_label: readyStateMap[conn.readyState] || 'unknown',
      };

      // Connection pool stats
      try {
        if (conn.client && typeof conn.client.db === 'function') {
          info.client = {
            constructor: conn.client.constructor?.name || 'MongoClient',
          };
        }
      } catch (e) {}

      // Additional connection details
      if (conn.config) {
        info.config = {
          buffer_max_entries: conn.config.bufferMaxEntries,
          auto_index: conn.config.autoIndex,
        };
      }

      // Check for models on this connection
      if (conn.models) {
        info.model_count = Object.keys(conn.models).length;
        info.model_names = Object.keys(conn.models);
      }

      connections.push(info);
    }

    return {
      framework: 'mongoose',
      connection_count: connections.length,
      connections,
    };
  }
);

// ── Helpers ───────────────────────────────────────────────────────

function resolveMongoose(name) {
  if (name) return mongooseInstances.get(name);
  // Check registered instances first
  for (const [, m] of mongooseInstances) {
    if (m && m.models) return m;
  }
  // Auto-detect from require.cache
  return safeRequire('mongoose');
}

function formatDefault(val) {
  if (val === null) return null;
  if (val === undefined) return undefined;
  if (typeof val === 'function') return '[function]';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function safeRequire(name) {
  try { return require(name); } catch { return null; }
}

module.exports = { registerMongoose, mongooseInstances };
