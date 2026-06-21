const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Node.js Debug Agent — Full demo recording (27 tools / 9 inspectors)
 *
 * 7 sections using NATURAL LANGUAGE prompts (no explicit tool names).
 * The LLM must autonomously decide which tools to invoke.
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

// ─── Section 1: Node.js Runtime + Memory ──────────────────────────────────
// Tools: get_heap_stats, trigger_gc, get_heap_snapshot_stats, get_v8_flags,
//        get_system_info, get_process_info, get_uptime

async function section1_runtime(page) {
  console.log('  [1/7] Node.js Runtime + Memory Deep Dive');
  await typeMessage(page, "My app feels sluggish. Can you check the overall runtime health — heap memory usage, V8 stats, and how long the process has been running?");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Show me detailed V8 heap statistics — the per-space breakdown like new space, old space, code space. Also show heap code statistics.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "What's the system info — CPU count, total memory, load average? And what V8 engine flags are currently set?");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Try forcing a garbage collection — I want to see how much memory can be reclaimed.");
  await sendAndWait(page);
  await pause(page, 5000);
}

// ─── Section 2: Process + Event Loop + Active Handles ─────────────────────
// Tools: get_process_info, get_event_loop_lag, get_resource_usage,
//        get_active_handles, get_active_requests, get_handle_summary

async function section2_process(page) {
  console.log('  [2/7] Process + Event Loop + Active Handles');
  await typeMessage(page, "Show me the process info — PID, Node version, platform, CPU and memory usage. Also measure the event loop lag.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "What active libuv handles are keeping the process alive? List timers, sockets, servers — and summarize them by type.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Are there any pending libuv requests (active I/O operations)? Show me process resource usage details too.");
  await sendAndWait(page);
  await pause(page, 5000);
}

// ─── Section 3: Framework + Routes + Middleware ───────────────────────────
// Tools: get_routes, get_middleware, get_installed_packages, get_environment_variables

async function section3_framework(page) {
  console.log('  [3/7] Framework + Routes + Middleware');
  await typeMessage(page, "What API endpoints does this Express application expose? List all the registered routes with methods and paths.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Show me the Express middleware stack — what middleware is installed?");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "What npm packages are installed? Also show me the environment variables (with secrets masked).");
  await sendAndWait(page);
  await pause(page, 5000);
}

// ─── Section 4: HTTP Requests + Modules ───────────────────────────────────
// Tools: get_recent_requests, get_slow_requests, get_error_requests,
//        get_request_stats, get_loaded_modules, get_module_count

async function section4_http(page) {
  console.log('  [4/7] HTTP Requests + Modules');
  await typeMessage(page, "What HTTP requests have come in recently? Show me request statistics — P50, P95, P99 latency and error rate.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "Show me the slowest requests and any error requests (4xx, 5xx status codes).");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "How many Node.js modules are currently loaded? Show me the module count grouped by package.");
  await sendAndWait(page);
  await pause(page, 5000);
}

// ─── Section 5: System + CPU + Disk ───────────────────────────────────────
// Tools: get_cpu_info, get_disk_usage, get_uptime

async function section5_system(page) {
  console.log('  [5/7] System Resources');
  await typeMessage(page, "Give me the CPU info — core count, model, speed, and load average for the last 1, 5, and 15 minutes.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "What's the disk usage for the current working directory? How much space is free?");
  await sendAndWait(page);
  await pause(page, 5000);
}

// ─── Section 6: Database Pool Detection ───────────────────────────────────
// Tools: get_db_pool_status

async function section6_database(page) {
  console.log('  [6/7] Database Connection Pool');
  await typeMessage(page, "Is there a database driver loaded (pg, mysql2, or mongodb)? If so, check the connection pool status.");
  await sendAndWait(page);
  await pause(page, 4000);

  await typeMessage(page, "List all loaded modules that contain 'express' or 'morgan' in their path. Show me the cache contents.");
  await sendAndWait(page);
  await pause(page, 5000);
}

// ─── Section 7: Comprehensive Debugging ───────────────────────────────────
// Cross-cutting scenario that exercises multiple inspectors together

async function section7_comprehensive(page) {
  console.log('  [7/7] Comprehensive Debugging Scenario');
  await typeMessage(page, "I'm debugging a performance issue. Give me a comprehensive overview: heap memory, GC status, event loop lag, active handles, recent HTTP requests with errors, and process resource usage — all in one summary.");
  await sendAndWait(page);
  await pause(page, 6000);

  await typeMessage(page, "Now check: how many routes are registered, what's the module count, and are there any slow or error requests? Summarize the app's overall state.");
  await sendAndWait(page);
  await pause(page, 5000);
}

// ─── Main ─────────────────────────────────────────────────────────────────

(async () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Node.js Debug Agent — Demo Recording                        ║
║  27 tools / 9 inspectors                                     ║
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
    { name: '01-runtime', fn: section1_runtime },
    { name: '02-process', fn: section2_process },
    { name: '03-framework', fn: section3_framework },
    { name: '04-http', fn: section4_http },
    { name: '05-system', fn: section5_system },
    { name: '06-database', fn: section6_database },
    { name: '07-comprehensive', fn: section7_comprehensive },
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
