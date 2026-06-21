'use strict';

/**
 * Framework integration middleware.
 *
 * Provides Express router, Fastify plugin, and raw HTTP handler
 * that serve the chat UI and SSE streaming endpoints.
 *
 * SSE events (matching Spring agent):
 *   content, tool_start, tool_result, done, error, context_compressed
 *
 * Endpoints:
 *   GET  /agent          — Chat UI
 *   POST /agent/api/chat — SSE streaming chat
 *   POST /agent/api/clear — Clear conversation
 *   GET  /agent/api/health — Health check
 *   GET  /agent/api/tools — List available tools
 */

const { AgentConfig } = require('./config');
const { DebugEngine } = require('./engine');
const { render } = require('./web/chat-page');

// Shared engine instance (lazy init)
let _engine = null;

function getEngine(config) {
  if (!_engine) {
    const cfg = config || AgentConfig.fromEnv();
    _engine = new DebugEngine(cfg);
  }
  return _engine;
}

/**
 * Create the SSE callback object that bridges engine → SSE response.
 */
function createSseCallback(res, writeFn) {
  const write = writeFn || ((event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
  });

  return {
    onContent(chunk) {
      // JSON-encode so newlines survive SSE transport
      write('content', JSON.stringify(chunk));
    },
    onToolStart(toolName, arguments_) {
      write('tool_start', toolName);
    },
    onToolResult(toolName, result) {
      write('tool_result', toolName + ': ' + result);
    },
    onComplete() {
      write('done', '');
    },
    onError(message) {
      write('error', message);
    },
    onContextCompressed(originalTokens, compressedTokens, removedRounds) {
      write('context_compressed', JSON.stringify({ originalTokens, compressedTokens, removedRounds }));
    },
  };
}

/**
 * Create an Express router with all debug agent endpoints.
 */
function createExpressRouter(config) {
  const express = require('express');
  const router = express.Router();
  const cfg = new AgentConfig(config || {});
  const basePath = cfg.basePath;
  const engine = getEngine(cfg);

  // Chat UI
  router.get(basePath, (req, res) => {
    const contextPath = req.baseUrl || '';
    const base = (contextPath + basePath).replace(/\/+/g, '/');
    res.type('html').send(render(base));
  });
  router.get(basePath + '/', (req, res) => {
    const contextPath = req.baseUrl || '';
    const base = (contextPath + basePath).replace(/\/+/g, '/');
    res.type('html').send(render(base));
  });

  // SSE streaming chat
  router.post(basePath + '/api/chat', async (req, res) => {
    const { message, sessionId } = req.body;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sid = sessionId || ('session-' + Date.now());
    const callback = createSseCallback(res);

    try {
      await engine.chat(message, sid, callback);
    } catch (e) {
      callback.onError('Internal error: ' + e.message);
    }
    res.end();
  });

  // Clear conversation
  router.post(basePath + '/api/clear', (req, res) => {
    const { sessionId } = req.body;
    if (sessionId) engine.clearSession(sessionId);
    res.json({ status: 'cleared' });
  });

  // Health check
  router.get(basePath + '/api/health', (req, res) => {
    res.json({ status: 'ok', agent: 'nodejs-debug-agent' });
  });

  // List tools
  router.get(basePath + '/api/tools', (req, res) => {
    res.json({ tools: engine.tools.allSchemas() });
  });

  return router;
}

/**
 * Create a plain HTTP handler function (for use with http.createServer).
 */
function createHttpHandler(config) {
  const cfg = new AgentConfig(config || {});
  const engine = getEngine(cfg);

  return async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const base = cfg.basePath;

    // Chat UI
    if ((path === base || path === base + '/') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(render(base));
      return true;
    }

    // SSE streaming chat
    if (path === base + '/api/chat' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { message, sessionId } = JSON.parse(body);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const sid = sessionId || ('session-' + Date.now());
      const callback = createSseCallback(res);

      try {
        await engine.chat(message, sid, callback);
      } catch (e) {
        callback.onError('Internal error: ' + e.message);
      }
      res.end();
      return true;
    }

    // Clear conversation
    if (path === base + '/api/clear' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { sessionId } = JSON.parse(body);
      if (sessionId) engine.clearSession(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'cleared' }));
      return true;
    }

    // Health check
    if (path === base + '/api/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', agent: 'nodejs-debug-agent' }));
      return true;
    }

    // List tools
    if (path === base + '/api/tools' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tools: engine.tools.allSchemas() }));
      return true;
    }

    return false;
  };
}

/**
 * Fastify plugin.
 */
function createFastifyPlugin(config) {
  const cfg = new AgentConfig(config || {});
  const engine = getEngine(cfg);

  return async function (fastify, opts) {
    fastify.get(cfg.basePath, async (req, reply) => {
      reply.type('html').send(render(cfg.basePath));
    });

    fastify.post(cfg.basePath + '/api/chat', async (req, reply) => {
      const { message, sessionId } = req.body;
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });

      const sid = sessionId || ('session-' + Date.now());
      const callback = createSseCallback(reply.raw);

      try {
        await engine.chat(message, sid, callback);
      } catch (e) {
        callback.onError('Internal error: ' + e.message);
      }
      reply.raw.end();
    });

    fastify.post(cfg.basePath + '/api/clear', async (req, reply) => {
      const { sessionId } = req.body;
      if (sessionId) engine.clearSession(sessionId);
      return { status: 'cleared' };
    });

    fastify.get(cfg.basePath + '/api/health', async (req, reply) => {
      return { status: 'ok', agent: 'nodejs-debug-agent' };
    });

    fastify.get(cfg.basePath + '/api/tools', async (req, reply) => {
      return { tools: engine.tools.allSchemas() };
    });
  };
}

module.exports = { createExpressRouter, createHttpHandler, createFastifyPlugin, getEngine };
