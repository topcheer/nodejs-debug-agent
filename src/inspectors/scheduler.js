'use strict';

const { debugTool } = require('../tool-registry');

// Registry of scheduled jobs and their execution history
const scheduledJobs = new Map();
const jobHistory = new Map(); // jobId -> array of { time, status, duration_ms, error? }
const MAX_HISTORY = 20;

/**
 * Register a scheduled/cron job for inspection.
 * @param {string} name - Identifier for this job
 * @param {string} schedule - Cron expression or interval description (e.g. every 30 min cron, '30s')
 * @param {object} jobObj - Job object or timer reference { id?, fn?, lastRun?, nextRun? }
 */
function registerScheduledJob(name, schedule, jobObj) {
  const entry = {
    name,
    schedule,
    registeredAt: new Date().toISOString(),
    lastRun: null,
    nextRun: null,
    runCount: 0,
    ...jobObj,
  };
  scheduledJobs.set(name, entry);
  if (!jobHistory.has(name)) jobHistory.set(name, []);
}

/**
 * Record a job execution in the history ring buffer.
 */
function recordJobExecution(name, status, durationMs, error) {
  if (!jobHistory.has(name)) jobHistory.set(name, []);
  const history = jobHistory.get(name);
  history.push({
    time: new Date().toISOString(),
    status,
    duration_ms: durationMs,
    error: error || undefined,
  });
  // Ring buffer: keep last MAX_HISTORY entries
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  // Update the job's runCount and lastRun
  const job = scheduledJobs.get(name);
  if (job) {
    job.runCount = (job.runCount || 0) + 1;
    job.lastRun = history[history.length - 1].time;
  }
}

// ── get_scheduled_jobs ────────────────────────────────────────────
debugTool('get_scheduled_jobs', 'List registered cron/scheduled jobs from node-cron, node-schedule, or custom timers. Shows schedule, run count, last/next run, and status.', {})(
  async function getScheduledJobs() {
    // Also auto-discover node-cron and node-schedule tasks
    autoDiscoverJobs();

    if (scheduledJobs.size === 0) {
      return { status: 'No scheduled jobs registered. Call registerScheduledJob(name, schedule, jobObj) first.' };
    }

    const jobs = [];
    for (const [name, job] of scheduledJobs) {
      const history = jobHistory.get(name) || [];
      const lastRun = history.length > 0 ? history[history.length - 1] : null;

      jobs.push({
        name,
        schedule: job.schedule,
        run_count: job.runCount || 0,
        last_run: job.lastRun || null,
        next_run: job.nextRun || null,
        status: job.status || (lastRun ? lastRun.status : 'idle'),
        registered_at: job.registeredAt,
        last_status: lastRun?.status || null,
        last_duration_ms: lastRun?.duration_ms || null,
      });
    }

    return {
      job_count: jobs.length,
      jobs,
    };
  }
);

// ── get_job_history ───────────────────────────────────────────────
debugTool('get_job_history', 'Get recent execution history for a scheduled job. Shows last N runs with timestamp, status, duration, and errors.', {
  job_name: { type: 'string', description: 'Name of the scheduled job. If omitted, returns history for all jobs.', required: false },
})(
  async function getJobHistory({ job_name }) {
    if (job_name) {
      const history = jobHistory.get(job_name);
      if (!history) {
        return { error: `Job "${job_name}" not found`, registered_jobs: [...scheduledJobs.keys()] };
      }
      return {
        job_name,
        entry_count: history.length,
        history,
      };
    }

    // All jobs
    const all = [];
    for (const [name, history] of jobHistory) {
      all.push({ job_name: name, entry_count: history.length, history });
    }

    if (all.length === 0) {
      return { status: 'No job execution history recorded yet.' };
    }

    return { job_count: all.length, jobs: all };
  }
);

// ── Auto-discovery ────────────────────────────────────────────────

function autoDiscoverJobs() {
  // Try node-cron
  try {
    const cron = require('node-cron');
    // node-cron doesn't expose registered tasks publicly, but we check require.cache
    for (const [id, mod] of Object.entries(require.cache)) {
      if (id.includes('node-cron') && mod.exports) {
        // Tasks are usually stored by the user; we can't introspect them directly
      }
    }
  } catch {}

  // Try node-schedule
  try {
    const schedule = require('node-schedule');
    if (schedule && typeof schedule.scheduledJobs === 'object') {
      for (const [name, job] of Object.entries(schedule.scheduledJobs)) {
        if (!scheduledJobs.has(name) && job) {
          scheduledJobs.set(name, {
            name,
            schedule: job.name || 'unknown',
            source: 'node-schedule',
            runCount: 0,
            lastRun: null,
            nextRun: job.nextInvocation ? safeNextInvocation(job) : null,
          });
          if (!jobHistory.has(name)) jobHistory.set(name, []);
        }
      }
    }
  } catch {}
}

function safeNextInvocation(job) {
  try {
    const next = typeof job.nextInvocation === 'function' ? job.nextInvocation() : null;
    return next ? next.toISOString() : null;
  } catch { return null; }
}

module.exports = { registerScheduledJob, recordJobExecution, scheduledJobs, jobHistory };
