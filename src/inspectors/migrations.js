'use strict';

const { debugTool } = require('../tool-registry');

// --- Registry of migration providers ---
const migrationProviders = new Map();

/**
 * Register a migration provider for inspection.
 * @param {string} name - Identifier for this provider (e.g. 'knex', 'prisma', 'sequelize')
 * @param {object} provider - { current: fn, pending: fn, history: fn }
 *   Each property can be a value or an async function returning the data.
 */
function registerMigrationProvider(name, provider) {
  migrationProviders.set(name, provider);
}

async function resolveValue(val) {
  if (typeof val === 'function') return await val();
  return val;
}

/**
 * Auto-discover migration providers from require.cache.
 * Detects knex, prisma, sequelize, and typeorm.
 */
function autoDiscoverProviders() {
  const discovered = [];

  // ── Knex ──
  try {
    for (const [id, mod] of Object.entries(require.cache)) {
      if (id.includes('/knex/') && mod.exports) {
        const exp = mod.exports;
        // knex instance has .migrate property
        if (exp.migrate && typeof exp.migrate.currentVersion === 'function') {
          const src = id.split('/').slice(-2).join('/');
          if (!migrationProviders.has('knex')) {
            migrationProviders.set('knex', {
              detected: true,
              source: src,
              current: async () => {
                try { return await exp.migrate.currentVersion(); }
                catch (e) { return { error: e.message }; }
              },
              pending: async () => {
                try {
                  const [completed, all] = await Promise.all([
                    exp.migrate._listCompleted(),
                    exp.migrate._migrationData ? exp.migrate._migrationData().then(d => d.all || d.directory?.migrations || []) : [],
                  ]);
                  const pending = all.filter(m => !completed.includes(m));
                  return pending;
                } catch (e) { return { error: e.message }; }
              },
              history: async () => {
                try { return await exp.migrate._listCompleted(); }
                catch (e) { return { error: e.message }; }
              },
            });
            discovered.push({ name: 'knex', source: src });
            break;
          }
        }
      }
    }
  } catch {}

  // ── Prisma ──
  try {
    for (const [id, mod] of Object.entries(require.cache)) {
      if (id.includes('@prisma/client') || id.includes('/prisma/')) {
        const exp = mod.exports;
        // Prisma client has $connect, $disconnect, $queryRaw
        if (exp && typeof exp.$queryRaw === 'function' && !migrationProviders.has('prisma')) {
          const src = id.split('/').slice(-2).join('/');
          migrationProviders.set('prisma', {
            detected: true,
            source: src,
            current: async () => {
              try {
                const rows = await exp.$queryRaw`SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1`;
                return rows[0]?.migration_name || 'none';
              } catch (e) { return { error: e.message }; }
            },
            pending: async () => {
              try {
                const rows = await exp.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL`;
                return rows.map(r => r.migration_name);
              } catch (e) { return { error: e.message }; }
            },
            history: async () => {
              try {
                const rows = await exp.$queryRaw`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at ASC`;
                return rows.map(r => ({
                  name: r.migration_name,
                  applied_at: r.finished_at,
                  rolled_back: !!r.rolled_back_at,
                }));
              } catch (e) { return { error: e.message }; }
            },
          });
          discovered.push({ name: 'prisma', source: src });
          break;
        }
      }
    }
  } catch {}

  // ── Sequelize ──
  try {
    for (const [id, mod] of Object.entries(require.cache)) {
      if (id.includes('/sequelize/') && mod.exports) {
        const exp = mod.exports;
        // Sequelize instance has .getQueryInterface, .config
        if (exp && typeof exp.getQueryInterface === 'function' && !migrationProviders.has('sequelize')) {
          const src = id.split('/').slice(-2).join('/');
          migrationProviders.set('sequelize', {
            detected: true,
            source: src,
            current: async () => {
              try {
                const qi = exp.getQueryInterface();
                const rows = await qi.sequelize.query(
                  'SELECT name FROM "SequelizeMeta" ORDER BY name DESC LIMIT 1',
                  { type: 'SELECT' }
                );
                return rows[0]?.name || 'none';
              } catch (e) { return { error: e.message }; }
            },
            pending: async () => {
              try {
                const qi = exp.getQueryInterface();
                const rows = await qi.sequelize.query(
                  'SELECT name FROM "SequelizeMeta" ORDER BY name ASC',
                  { type: 'SELECT' }
                );
                return rows.map(r => r.name);
              } catch (e) { return { error: e.message }; }
            },
            history: async () => {
              try {
                const qi = exp.getQueryInterface();
                const rows = await qi.sequelize.query(
                  'SELECT name FROM "SequelizeMeta" ORDER BY name ASC',
                  { type: 'SELECT' }
                );
                return rows.map(r => ({ name: r.name, applied: true }));
              } catch (e) { return { error: e.message }; }
            },
          });
          discovered.push({ name: 'sequelize', source: src });
          break;
        }
      }
    }
  } catch {}

  // ── TypeORM ──
  try {
    for (const [id, mod] of Object.entries(require.cache)) {
      if (id.includes('/typeorm/') && mod.exports) {
        const exp = mod.exports;
        // DataSource or EntityManager has .query, .migrations
        if (exp && typeof exp.query === 'function' && exp.migrations && !migrationProviders.has('typeorm')) {
          const src = id.split('/').slice(-2).join('/');
          migrationProviders.set('typeorm', {
            detected: true,
            source: src,
            current: async () => {
              try {
                const rows = await exp.query(
                  'SELECT timestamp, name FROM migrations ORDER BY timestamp DESC LIMIT 1'
                );
                return rows[0]?.name || 'none';
              } catch (e) { return { error: e.message }; }
            },
            pending: async () => {
              try {
                const rows = await exp.query('SELECT name FROM migrations ORDER BY timestamp ASC');
                return rows.map(r => r.name);
              } catch (e) { return { error: e.message }; }
            },
            history: async () => {
              try {
                const rows = await exp.query('SELECT timestamp, name FROM migrations ORDER BY timestamp ASC');
                return rows.map(r => ({ name: r.name, applied_at: new Date(r.timestamp).toISOString() }));
              } catch (e) { return { error: e.message }; }
            },
          });
          discovered.push({ name: 'typeorm', source: src });
          break;
        }
      }
    }
  } catch {}

  return discovered;
}

// ── get_migration_status ────────────────────────────────────────
debugTool('get_migration_status', 'Get current database migration state from knex, prisma, sequelize, or typeorm. Shows current migration version for each detected provider.', {})(
  async function getMigrationStatus() {
    // Auto-discover providers if none registered
    autoDiscoverProviders();

    if (migrationProviders.size === 0) {
      return {
        status: 'No migration providers detected. Register via registerMigrationProvider(name, {current, pending, history}) or ensure knex/prisma/sequelize/typeorm is loaded.',
      };
    }

    const providers = [];
    for (const [name, provider] of migrationProviders) {
      try {
        const current = await resolveValue(provider.current);
        providers.push({
          name,
          source: provider.source || provider.detected ? provider.source : 'registered',
          current_version: current,
        });
      } catch (e) {
        providers.push({ name, error: e.message });
      }
    }

    return {
      provider_count: providers.length,
      providers,
    };
  }
);

// ── get_pending_migrations ──────────────────────────────────────
debugTool('get_pending_migrations', 'Get unapplied/pending migrations from knex, prisma, sequelize, or typeorm. Lists migration names that have not yet been applied.', {})(
  async function getPendingMigrations() {
    autoDiscoverProviders();

    if (migrationProviders.size === 0) {
      return { status: 'No migration providers detected.' };
    }

    const results = [];
    for (const [name, provider] of migrationProviders) {
      try {
        const pending = await resolveValue(provider.pending);
        const pendingList = Array.isArray(pending) ? pending : [];
        results.push({
          name,
          pending_count: pendingList.length,
          pending: pendingList,
        });
      } catch (e) {
        results.push({ name, error: e.message });
      }
    }

    return {
      provider_count: results.length,
      providers: results,
    };
  }
);

// ── get_migration_history ───────────────────────────────────────
debugTool('get_migration_history', 'Get applied migration history log from knex, prisma, sequelize, or typeorm. Shows chronologically ordered list of applied migrations.', {})(
  async function getMigrationHistory() {
    autoDiscoverProviders();

    if (migrationProviders.size === 0) {
      return { status: 'No migration providers detected.' };
    }

    const results = [];
    for (const [name, provider] of migrationProviders) {
      try {
        const history = await resolveValue(provider.history);
        const historyList = Array.isArray(history) ? history : [];
        results.push({
          name,
          applied_count: historyList.length,
          history: historyList,
        });
      } catch (e) {
        results.push({ name, error: e.message });
      }
    }

    return {
      provider_count: results.length,
      providers: results,
    };
  }
);

module.exports = { registerMigrationProvider, migrationProviders };
