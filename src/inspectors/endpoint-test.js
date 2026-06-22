'use strict';

const { debugTool } = require('../tool-registry');

// --- Registry of routes tested and their base URL ---
const testedRoutes = new Set(); // 'METHOD /path'
let _baseUrl = null;

/**
 * Set the base URL for endpoint testing.
 * @param {string} url - Base URL (e.g. 'http://localhost:3000')
 */
function setBaseUrl(url) {
  _baseUrl = url;
}

/**
 * Get the base URL for endpoint testing.
 * Falls back to process.env.PORT or localhost:3000.
 */
function getBaseUrl() {
  if (_baseUrl) return _baseUrl;
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`;
}

/**
 * Register a tested route (called internally by test_endpoint).
 */
function recordTestedRoute(method, path) {
  testedRoutes.add(`${method.toUpperCase()} ${path}`);
}

/**
 * Attempt to extract routes from registered Express apps.
 */
function getRegisteredRoutes() {
  const routes = [];
  try {
    const { expressApps } = require('./express');
    for (const [appName, app] of expressApps) {
      const router = app._router || app.router;
      if (router && router.stack) {
        walkExpressStack(router.stack, '', routes);
      }
    }
  } catch {}
  return routes;
}

function walkExpressStack(stack, basePath, routes) {
  for (const layer of stack) {
    if (layer.route) {
      const path = basePath + layer.route.path;
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
      for (const method of methods) {
        routes.push({ method, path });
      }
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      const prefix = extractMountPath(layer, basePath);
      walkExpressStack(layer.handle.stack, prefix, routes);
    }
  }
}

function extractMountPath(layer, basePath) {
  if (!layer.regexp || !layer.regexp.source) return basePath;
  const src = layer.regexp.source;
  const match = src.match(/^\/\^([^?]*?)\\\/?(?=\$|\(|\\\?)/);
  if (match) {
    let path = match[1].replace(/\\\//g, '/').replace(/\\\./g, '.');
    return basePath + '/' + path.replace(/^\//, '');
  }
  return basePath;
}

// ── test_endpoint ───────────────────────────────────────────────
debugTool('test_endpoint', 'Make an HTTP request to your own application and return status, headers, body, and response time. Uses built-in fetch (Node 18+).', {
  method: { type: 'string', description: 'HTTP method: GET, POST, PUT, PATCH, DELETE, HEAD. Default: GET.', required: false },
  path: { type: 'string', description: 'Request path (e.g. /api/health). Will be prefixed with the app base URL.' },
  headers: { type: 'object', description: 'Request headers as a JSON object (e.g. {"x-api-key": "..."}).', required: false },
  body: { type: 'string', description: 'Request body as a string (will be sent as-is). For JSON, pass a JSON string.', required: false },
})(
  async function testEndpoint({ method, path, headers, body }) {
    if (!path) {
      return { error: 'path is required (e.g. /api/health)' };
    }

    const httpMethod = (method || 'GET').toUpperCase();
    const baseUrl = getBaseUrl();
    const url = path.startsWith('http') ? path : `${baseUrl}${path}`;
    const start = Date.now();

    const fetchOptions = { method: httpMethod, headers: {} };

    // Merge custom headers
    if (headers && typeof headers === 'object') {
      Object.assign(fetchOptions.headers, headers);
    }

    // Set body for methods that support it
    if (body && ['POST', 'PUT', 'PATCH'].includes(httpMethod)) {
      fetchOptions.body = body;
      // Set content-type to JSON if not already set and body looks like JSON
      if (!fetchOptions.headers['content-type'] && !fetchOptions.headers['Content-Type']) {
        const trimmed = body.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          fetchOptions.headers['content-type'] = 'application/json';
        }
      }
    }

    try {
      const response = await fetch(url, fetchOptions);
      const duration_ms = Date.now() - start;

      // Read response body
      let responseBody;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          responseBody = await response.json();
        } catch {
          responseBody = await response.text();
        }
      } else {
        responseBody = await response.text();
        // Try to parse as JSON anyway
        if (responseBody.trim().startsWith('{') || responseBody.trim().startsWith('[')) {
          try { responseBody = JSON.parse(responseBody); } catch {}
        }
      }

      // Record tested route
      recordTestedRoute(httpMethod, path);

      // Collect response headers as object
      const responseHeaders = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        status: response.status,
        status_text: response.statusText,
        headers: responseHeaders,
        body: responseBody,
        duration_ms,
        url,
        method: httpMethod,
      };
    } catch (e) {
      return {
        error: e.message,
        url,
        method: httpMethod,
        duration_ms: Date.now() - start,
        hint: `Ensure the app is running and listening on ${baseUrl}.`,
      };
    }
  }
);

// ── batch_test_endpoints ────────────────────────────────────────
debugTool('batch_test_endpoints', 'Run multiple endpoint tests in sequence. Each test can specify method, path, headers, body, and an optional expected_status assertion. Returns pass/fail per test.', {
  tests: { type: 'array', description: 'Array of test specs: [{ method?, path, headers?, body?, expected_status? }]' },
})(
  async function batchTestEndpoints({ tests }) {
    if (!tests || !Array.isArray(tests) || tests.length === 0) {
      return { error: 'tests array is required. Each item: { method?, path, headers?, body?, expected_status? }' };
    }

    const results = [];
    let passCount = 0;
    let failCount = 0;

    for (let i = 0; i < tests.length; i++) {
      const test = tests[i];
      const testResult = { index: i, test };

      try {
        const httpMethod = (test.method || 'GET').toUpperCase();
        const baseUrl = getBaseUrl();
        const url = test.path.startsWith('http') ? test.path : `${baseUrl}${test.path}`;
        const start = Date.now();

        const fetchOptions = {
          method: httpMethod,
          headers: test.headers || {},
        };

        if (test.body && ['POST', 'PUT', 'PATCH'].includes(httpMethod)) {
          fetchOptions.body = test.body;
          if (!fetchOptions.headers['content-type'] && !fetchOptions.headers['Content-Type']) {
            const trimmed = test.body.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
              fetchOptions.headers['content-type'] = 'application/json';
            }
          }
        }

        const response = await fetch(url, fetchOptions);
        const duration_ms = Date.now() - start;
        const status = response.status;

        // Record tested route
        recordTestedRoute(httpMethod, test.path);

        // Read body (truncated for batch)
        let body;
        try {
          body = await response.text();
          if (body.length > 500) body = body.substring(0, 500) + '... (truncated)';
          try { body = JSON.parse(body); } catch {}
        } catch {
          body = null;
        }

        // Assert expected status
        const expected = test.expected_status;
        const passed = expected === undefined || status === expected;

        if (passed) passCount++; else failCount++;

        testResult.method = httpMethod;
        testResult.path = test.path;
        testResult.status = status;
        testResult.duration_ms = duration_ms;
        testResult.body = body;
        testResult.expected_status = expected;
        testResult.passed = passed;
        if (!passed) {
          testResult.failure_reason = `Expected status ${expected}, got ${status}`;
        }
      } catch (e) {
        failCount++;
        testResult.method = (test.method || 'GET').toUpperCase();
        testResult.path = test.path;
        testResult.error = e.message;
        testResult.passed = false;
        testResult.failure_reason = e.message;
      }

      results.push(testResult);
    }

    return {
      total: results.length,
      passed: passCount,
      failed: failCount,
      pass_rate: results.length > 0 ? `${(passCount / results.length * 100).toFixed(1)}%` : '0%',
      results,
    };
  }
);

// ── get_endpoint_coverage ───────────────────────────────────────
debugTool('get_endpoint_coverage', 'Compare registered application routes against tested routes to show endpoint coverage. Reports which routes have been tested and which have not.', {})(
  async function getEndpointCoverage() {
    const registered = getRegisteredRoutes();
    const tested = [...testedRoutes];

    // Normalize: remove parameter values, keep parameter placeholders
    const normalizePath = (p) => p.replace(/\/\d+/g, '/:id').replace(/\/[0-9a-f]{8,}/gi, '/:id');

    const registeredSet = new Set(registered.map(r => `${r.method} ${normalizePath(r.path)}`));
    const testedSet = new Set(tested.map(t => {
      const [method, ...pathParts] = t.split(' ');
      return `${method} ${normalizePath(pathParts.join(' '))}`;
    }));

    const testedAndRegistered = [...registeredSet].filter(r => testedSet.has(r));
    const registeredNotTested = [...registeredSet].filter(r => !testedSet.has(r));
    const testedNotRegistered = [...testedSet].filter(t => !registeredSet.has(t));

    const coveragePercent = registeredSet.size > 0
      ? (testedAndRegistered.length / registeredSet.size * 100).toFixed(1)
      : '0.0';

    return {
      registered_route_count: registeredSet.size,
      tested_route_count: testedSet.size,
      coverage_percent: `${coveragePercent}%`,
      tested: testedAndRegistered.map(r => {
        const [method, ...pathParts] = r.split(' ');
        return { method, path: pathParts.join(' ') };
      }),
      untested: registeredNotTested.map(r => {
        const [method, ...pathParts] = r.split(' ');
        return { method, path: pathParts.join(' ') };
      }),
      extra_tested: testedNotRegistered.map(t => {
        const [method, ...pathParts] = t.split(' ');
        return { method, path: pathParts.join(' ') };
      }),
      hint: registeredSet.size === 0
        ? 'No routes detected from registered Express apps. Call registerExpressApp(name, app) or test endpoints via test_endpoint.'
        : null,
    };
  }
);

module.exports = { setBaseUrl, getBaseUrl, testedRoutes };
