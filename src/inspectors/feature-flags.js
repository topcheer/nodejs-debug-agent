'use strict';

const { debugTool } = require('../tool-registry');

// --- Registry of feature flags ---
const featureFlags = new Map();

/**
 * Register a feature flag for inspection.
 * @param {string} name - Flag name
 * @param {object} flag - { enabled: boolean, variant?: string, reason?: string, evaluator?: fn }
 *   evaluator: optional async function(context) => { enabled, variant, reason }
 */
function registerFeatureFlag(name, flag) {
  featureFlags.set(name, {
    enabled: flag.enabled ?? false,
    variant: flag.variant || null,
    reason: flag.reason || null,
    evaluator: flag.evaluator || null,
    registeredAt: new Date().toISOString(),
  });
}

/**
 * Auto-discover feature flag providers from require.cache.
 * Detects unleash, launchdarkly, and openfeature.
 */
function autoDiscoverFlags() {
  const discovered = [];

  // ── Unleash ──
  try {
    const unleashMod = Object.entries(require.cache).find(
      ([id]) => id.includes('unleash') && !id.includes('node_modules/unleash-client')
    );
    const unleashClientMod = Object.entries(require.cache).find(
      ([id]) => id.includes('unleash-client')
    );
    if (unleashClientMod || unleashMod) {
      discovered.push({ provider: 'unleash', detected: true });
    }
  } catch {}

  // ── LaunchDarkly ──
  try {
    const ldMod = Object.entries(require.cache).find(
      ([id]) => id.includes('launchdarkly')
    );
    if (ldMod) {
      discovered.push({ provider: 'launchdarkly', detected: true });
    }
  } catch {}

  // ── OpenFeature ──
  try {
    const ofMod = Object.entries(require.cache).find(
      ([id]) => id.includes('@openfeature') || id.includes('openfeature')
    );
    if (ofMod) {
      discovered.push({ provider: 'openfeature', detected: true });
    }
  } catch {}

  // ── Statsig ──
  try {
    const statsigMod = Object.entries(require.cache).find(
      ([id]) => id.includes('statsig')
    );
    if (statsigMod) {
      discovered.push({ provider: 'statsig', detected: true });
    }
  } catch {}

  return discovered;
}

// ── get_feature_flags ───────────────────────────────────────────
debugTool('get_feature_flags', 'List all registered feature flags showing name, enabled state, variant, and evaluation reason. Auto-detects unleash, launchdarkly, openfeature, and statsig if loaded.', {})(
  async function getFeatureFlags() {
    const flags = [];

    for (const [name, flag] of featureFlags) {
      flags.push({
        name,
        enabled: flag.enabled,
        variant: flag.variant,
        reason: flag.reason,
        registered_at: flag.registeredAt,
      });
    }

    const detected = autoDiscoverFlags();

    return {
      flag_count: flags.length,
      flags,
      detected_providers: detected,
      hint: detected.length > 0 && flags.length === 0
        ? 'Feature flag provider detected in require.cache. Call registerFeatureFlag(name, {enabled, variant}) to register flags for inspection.'
        : null,
    };
  }
);

// ── evaluate_flag ───────────────────────────────────────────────
debugTool('evaluate_flag', 'Evaluate a feature flag for a specific user/context. If the flag has a registered evaluator function, it will be called with the context. Otherwise returns the registered state.', {
  flag_name: { type: 'string', description: 'Name of the feature flag to evaluate' },
  user_context: { type: 'object', description: 'User/evaluation context (e.g. { userId, attributes }). Pass as a JSON object.', required: false },
})(
  async function evaluateFlag({ flag_name, user_context }) {
    if (!flag_name) {
      return {
        error: 'flag_name is required',
        registered_flags: [...featureFlags.keys()],
      };
    }

    const flag = featureFlags.get(flag_name);
    if (!flag) {
      return {
        error: `Feature flag "${flag_name}" not found`,
        registered_flags: [...featureFlags.keys()],
      };
    }

    const context = user_context || {};

    // If an evaluator function is registered, call it
    if (flag.evaluator && typeof flag.evaluator === 'function') {
      try {
        const result = await flag.evaluator(context);
        return {
          flag_name,
          context,
          enabled: result.enabled ?? false,
          variant: result.variant || null,
          reason: result.reason || 'evaluated',
          source: 'evaluator',
        };
      } catch (e) {
        // Fall back to registered state on evaluator error
        return {
          flag_name,
          context,
          enabled: flag.enabled,
          variant: flag.variant,
          reason: `evaluator_error: ${e.message}`,
          source: 'fallback (evaluator failed)',
        };
      }
    }

    // Return registered state, potentially with context-based logic
    return {
      flag_name,
      context,
      enabled: flag.enabled,
      variant: flag.variant,
      reason: flag.reason || 'static_registration',
      source: 'registered',
    };
  }
);

module.exports = { registerFeatureFlag, featureFlags };
