'use strict';

const { AgentConfig } = require('./config');
const { registry, debugTool, ToolParam } = require('./tool-registry');
const { LLMClient, StreamHandler } = require('./llm-client');
const { DebugEngine } = require('./engine');
const { ChatSession } = require('./chat-session');
const { SystemPromptBuilder } = require('./system-prompt-builder');
const { ContextCompressor, CompressionResult } = require('./context-compressor');
const { createExpressRouter, createFastifyPlugin, createHttpHandler } = require('./middleware');

// Load built-in inspectors
require('./inspectors');

module.exports = {
  AgentConfig,
  debugTool,
  ToolParam,
  registry,
  LLMClient,
  StreamHandler,
  DebugEngine,
  ChatSession,
  SystemPromptBuilder,
  ContextCompressor,
  CompressionResult,
  createExpressRouter,
  createFastifyPlugin,
  createHttpHandler,
};
