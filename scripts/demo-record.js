const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Node.js Debug Agent v0.5.0 — Full demo recording (70 tools / 19 inspectors)
 *
 * 10 sections using NATURAL LANGUAGE prompts (no explicit tool names).
 * The LLM must autonomously decide which tools to invoke.
 *
 * New v0.5.0 inspectors: Security, Health, Scheduler, Error Tracking,
 * WebSocket, plus Redis, Express routes, ORM, queue, Logging, Cache,
 * Outbound HTTP, Metrics.
 *
 * Usage:
 *   1. Start demo: cd demo && LLM_API_KEY=... node app.js
 *   2. Run: node scripts/demo-record.js
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const OUTPUT_DIR = './demo-recordings';
const VERSION = 'v01';

// ─── Helpers ──────────────────────────────────────────────────────────────

async function typeMessage(page, text, charDelay = 8) {
  const input = page.locator('#input');
  await input.click();
  await input.pressSequentially(text, { delay: charDelay });
}

async function waitForAgentIdle(page, timeout = 120000) {
  // Wait for send button to be re-enabled
  try {
    await page.waitForFunction(() => {
      const btn = document.querySelector('#send');
      return btn && !btn.disabled;
    }, { timeout });
  } catch {
    console.log('  Warning: Agent still busy, waiting more...');
    await page.waitForFunction(() => {
      const btn = document.querySelector('#send');
      return btn && !btn.disabled;
    }, { timeout: 60000 }).catch(() => {
      console.log('  Warning: Force proceeding after extended wait');
    });
  }

  // Wait for DOM to stabilize (no new messages for 3s)
  let lastCount = 0;
  let stableTime = 0;
  let maxWait = 15000;
  const interval = 1000;
  while (stableTime < 3000 && maxWait > 0) {
    const count = await page.evaluate(() => document.querySelectorAll('.message, .tool-badge').length);
    if (count === lastCount) {
      stableTime += interval;
    } else {
      lastCount = count;
      stableTime = 0;
    }
    await page.waitForTimeout(interval);
    maxWait -= interval;
  }
  await page.waitForTimeout(1500);
}

async function sendAndWait(page, timeout = 120000) {
  await page.locator('#send').click();
  await waitForAgentIdle(page, timeout);
}

async function pause(page, ms = 3000) {
  await page.waitForTimeout(ms);
}

// ─── Section 1: Runtime Memory + V8 Heap + Event Loop ──────────────────────

async function section1_runtime(page) {
  console.log('  [1/10] Runtime Memory + V8 Heap + Event Loop');
  await typeMessage(page, "My Node.js app feels sluggish. Can you check the overall runtime health — heap memory usage, V8 statistics, and how long the process has been running?");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Show me detailed V8 heap statistics — the per-space breakdown like new space, old space, and code space. Also show the event loop lag.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Try forcing a garbage collection — I want to see how much memory can be reclaimed.");
  await sendAndWait(page);
  await pause(page, 5000);
  console.log('  → Transition: Active Handles + Process Info + FD');
}

// ─── Section 2: Active Handles + Process Info + FD ─────────────────────────

async function section2_process(page) {
  console.log('  [2/10] Active Handles + Process Info + FD');
  await typeMessage(page, "What active libuv handles are keeping the process alive? List timers, sockets, and servers — and summarize them by type.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Show me process info — PID, Node version, platform, CPU and memory usage. Also check how many file descriptors are open.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "What's the CPU info — core count, model, speed, and load average for the last 1, 5, and 15 minutes?");
  await sendAndWait(page);
  await pause(page, 5000);
  console.log('  → Transition: Express Routes + Middleware + Modules');
}

// ─── Section 3: Express Routes + Middleware + Modules ──────────────────────

async function section3_framework(page) {
  console.log('  [3/10] Express Routes + Middleware + Modules');
  await typeMessage(page, "What API endpoints does this Express application expose? List all the registered routes with methods and paths.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Show me the Express middleware stack — what middleware layers are installed?");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "How many Node.js modules are currently loaded? Show me the module count grouped by package, and list installed npm packages.");
  await sendAndWait(page);
  await pause(page, 5000);
  console.log('  → Transition: HTTP Requests + Database Pool + Redis');
}

// ─── Section 4: HTTP Requests + Database Pool + Redis ──────────────────────

async function section4_http_db(page) {
  console.log('  [4/10] HTTP Requests + Database Pool + Redis');
  await typeMessage(page, "What HTTP requests have come in recently? Show me request statistics — P50, P95, P99 latency and error rate.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Is there a database driver loaded (pg, mysql2, or mongodb)? If so, check the connection pool status — active, idle, and waiting connections.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Check the Redis connection pool — how many connections are active and idle? Show me any Redis slow queries.");
  await sendAndWait(page);
  await pause(page, 5000);
  console.log('  → Transition: Logging + Cache Stats + Metrics');
}

// ─── Section 5: Logging + Cache Stats + Metrics ───────────────────────────

async function section5_logging_cache(page) {
  console.log('  [5/10] Logging + Cache Stats + Metrics');
  await typeMessage(page, "Show me the logging configuration — what log level is set, what transport is used (console, file), and recent log entries.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "What's the cache status? Show me cache hit and miss rates, total keys, and memory usage for any in-memory caches.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Show me the application metrics — request counts, error rates, latency histograms, and any custom metrics.");
  await sendAndWait(page);
  await pause(page, 5000);
  console.log('  → Transition: Security (auth config, sessions, CORS)');
}

// ─── Section 6: Security (auth config, sessions, CORS) ─────────────────────

async function section6_security(page) {
  console.log('  [6/10] Security (auth config, sessions, CORS)');
  await typeMessage(page, "I'm doing a security audit. What authentication and authorization middleware is configured? Show me the auth settings and any JWT or passport configuration.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Are there any active sessions? Show me session details — how many are active and their expiry. Also show me the CORS configuration.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Check for potential security issues — are there any environment variables exposing secrets, insecure headers, or overly permissive CORS settings?");
  await sendAndWait(page);
  await pause(page, 5000);
  console.log('  → Transition: Health Checks + Scheduler');
}

// ─── Section 7: Health Checks + Scheduler ──────────────────────────────────

async function section7_health_scheduler(page) {
  console.log('  [7/10] Health Checks + Scheduler');
  await typeMessage(page, "Run a health check on the database connection — is it reachable and responding quickly? Also check the Redis connection health.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Are there any scheduled or cron jobs running? Show me the scheduler status, registered jobs, and upcoming executions.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Give me an overall readiness summary — are all critical dependencies healthy and are there any queue or background job issues?");
  await sendAndWait(page);
  await pause(page, 5000);
  console.log('  → Transition: Error Tracking + WebSocket Connections');
}

// ─── Section 8: Error Tracking + WebSocket Connections ─────────────────────

async function section8_errors_websocket(page) {
  console.log('  [8/10] Error Tracking + WebSocket Connections');
  await typeMessage(page, "Show me recent errors tracked by the application — any uncaught exceptions, unhandled promise rejections, or error-level log entries.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Are there any WebSocket connections active? Show me connection details — how many clients are connected and any connection errors.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Show me any recently caught application errors with their stack traces. Are there recurring error patterns?");
  await sendAndWait(page);
  await pause(page, 5000);
  console.log('  → Transition: Outbound HTTP + Perf Entries + Socket Info');
}

// ─── Section 9: Outbound HTTP + Perf Entries + Socket Info ─────────────────

async function section9_outbound_perf(page) {
  console.log('  [9/10] Outbound HTTP + Perf Entries + Socket Info');
  await typeMessage(page, "What outbound HTTP requests has the application made recently? Show me external API calls with their response times and status codes.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Show me performance entries — any timing measurements from the Performance API, and Node.js native module load times.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Show me active socket information — TCP connections, their states, and any sockets in TIME_WAIT or CLOSE_WAIT.");
  await sendAndWait(page);
  await pause(page, 5000);
  console.log('  → Transition: Comprehensive Multi-Tool Debugging');
}

// ─── Section 10: Comprehensive Multi-Tool Debugging ────────────────────────

async function section10_comprehensive(page) {
  console.log('  [10/10] Comprehensive Multi-Tool Debugging');
  await typeMessage(page, "I'm investigating a production incident. Give me a comprehensive overview: heap memory and GC status, event loop lag, active handles, recent HTTP requests with errors, database and Redis pool health, and any tracked errors — all in one summary.");
  await sendAndWait(page);
  await pause(page, 6000);

  await typeMessage(page, "Now check: how many routes are registered, what's the module count, are there any WebSocket connections with issues, and what do the security settings look like? Summarize the app's overall state and recommendations.");
  await sendAndWait(page);
  await pause(page, 5000);
}

// ─── Main ─────────────────────────────────────────────────────────────────

(async () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Node.js Debug Agent v0.5.0 — Demo Recording                  ║
║  70 tools / 19 inspectors                                      ║
╚══════════════════════════════════════════════════════════════╝
  `);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Verify app is running
  console.log(`Checking app at ${BASE_URL}/agent ...`);
  try {
    const resp = await fetch(`${BASE_URL}/agent/api/tools`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    console.log(`  Found ${data.tools.length} tools registered`);
  } catch (e) {
    console.error(`ERROR: Demo app not running at ${BASE_URL}. Start it first:\n  cd demo && LLM_API_KEY=... node app.js`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: OUTPUT_DIR, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();

  console.log(`Navigating to ${BASE_URL}/agent ...`);
  await page.goto(`${BASE_URL}/agent`);
  await pause(page, 2000);

  // Pre-generate some HTTP traffic for request tracking demos
  console.log('Generating HTTP traffic for demos...');
  const endpoints = [
    '/api/orders', '/api/orders/1', '/api/health',
    '/api/slow', '/api/error', '/api/orders',
    '/api/orders/1', '/api/health',
  ];
  for (const ep of endpoints) {
    try { await fetch(`${BASE_URL}${ep}`); } catch {}
  }

  // Pre-generate cache entries by hitting order endpoints
  try { await fetch(`${BASE_URL}/api/orders`); } catch {}
  try { await fetch(`${BASE_URL}/api/orders/1`); } catch {}

  await pause(page, 1000);

  const sections = [
    { name: '01-runtime-v8-eventloop', fn: section1_runtime },
    { name: '02-handles-process-fd', fn: section2_process },
    { name: '03-routes-middleware-modules', fn: section3_framework },
    { name: '04-http-db-redis', fn: section4_http_db },
    { name: '05-logging-cache-metrics', fn: section5_logging_cache },
    { name: '06-security', fn: section6_security },
    { name: '07-health-scheduler', fn: section7_health_scheduler },
    { name: '08-errors-websocket', fn: section8_errors_websocket },
    { name: '09-outbound-perf-socket', fn: section9_outbound_perf },
    { name: '10-comprehensive', fn: section10_comprehensive },
  ];

  const startTime = Date.now();

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
    console.log(`\n--- [${i + 1}/${sections.length}] ${section.name} (elapsed: ${elapsed} min) ---`);
    await section.fn(page);
    await page.screenshot({ path: `${OUTPUT_DIR}/${VERSION}-demo-${section.name}.png`, fullPage: true });
    console.log(`  Screenshot: ${VERSION}-demo-${section.name}.png`);
  }

  await pause(page, 3000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await pause(page, 2000);

  const video = page.video();
  const videoPath = await video.path();
  console.log(`\n  Video path: ${videoPath}`);

  await context.close();
  await browser.close();

  // Rename and convert video
  console.log('\n--- Finalizing video ---');
  const finalWebm = `${OUTPUT_DIR}/${VERSION}-full-demo.webm`;
  const finalMp4 = `${OUTPUT_DIR}/${VERSION}-full-demo.mp4`;

  try { fs.unlinkSync(finalWebm); } catch {}
  try { fs.unlinkSync(finalMp4); } catch {}

  if (videoPath && fs.existsSync(videoPath)) {
    fs.copyFileSync(videoPath, finalWebm);
    const size = fs.statSync(finalWebm).size;
    console.log(`  Saved: ${VERSION}-full-demo.webm (${(size / 1024 / 1024).toFixed(1)} MB)`);
  }

  // Convert to mp4
  try {
    console.log('\n--- Converting to mp4 ---');
    if (fs.existsSync(finalWebm)) {
      execSync(`ffmpeg -y -i "${finalWebm}" -c:v libx264 -preset fast -crf 23 -c:a aac "${finalMp4}"`, { stdio: 'pipe' });
      const size = fs.statSync(finalMp4).size;
      console.log(`  Done: ${VERSION}-full-demo.mp4 (${(size / 1024 / 1024).toFixed(1)} MB)`);
    }
  } catch (e) {
    console.log('  (ffmpeg conversion failed, keeping .webm)');
  }

  const totalMin = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`
======================================================
  Recording complete!
  Total time: ${totalMin} minutes
  Output: ${OUTPUT_DIR}/${VERSION}-full-demo.mp4
======================================================
  `);
})();
