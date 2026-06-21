'use strict';

/**
 * Basic smoke tests for @debug-agent/node.
 * Verifies that all modules load and built-in tools register correctly.
 *
 * Run: npm test
 */

const assert = require('assert');
const {
  registry, AgentConfig, DebugEngine, ChatSession,
  SystemPromptBuilder, ContextCompressor, CompressionResult,
  StreamHandler, LLMClient,
  createExpressRouter, createFastifyPlugin, createHttpHandler,
  debugTool,
} = require('../src');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed++;
    console.error(`  \u2717 ${name}`);
    console.error(`    ${e.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed++;
    console.error(`  \u2717 ${name}`);
    console.error(`    ${e.message}`);
  }
}

async function main() {
  console.log('\n  Running nodejs-debug-agent tests\n');

  // --- Module loading ---
  test('index.js exports all public APIs', () => {
    assert.ok(AgentConfig, 'AgentConfig not exported');
    assert.ok(DebugEngine, 'DebugEngine not exported');
    assert.ok(ChatSession, 'ChatSession not exported');
    assert.ok(SystemPromptBuilder, 'SystemPromptBuilder not exported');
    assert.ok(ContextCompressor, 'ContextCompressor not exported');
    assert.ok(CompressionResult, 'CompressionResult not exported');
    assert.ok(StreamHandler, 'StreamHandler not exported');
    assert.ok(LLMClient, 'LLMClient not exported');
    assert.ok(registry, 'registry not exported');
    assert.ok(createExpressRouter, 'createExpressRouter not exported');
    assert.ok(createFastifyPlugin, 'createFastifyPlugin not exported');
    assert.ok(createHttpHandler, 'createHttpHandler not exported');
    assert.ok(debugTool, 'debugTool not exported');
  });

  // --- Config ---
  test('AgentConfig has correct defaults', () => {
    const cfg = new AgentConfig();
    assert.strictEqual(cfg.enabled, true);
    assert.strictEqual(cfg.basePath, '/agent');
    assert.strictEqual(cfg.llm.model, 'gpt-4o');
    assert.strictEqual(cfg.llm.maxToolRounds, 25);
    assert.strictEqual(cfg.llm.contextWindowTokens, 100000);
    assert.strictEqual(cfg.llm.maxRetries, 3);
    assert.strictEqual(cfg.llm.retryBaseDelayMs, 1000);
    assert.strictEqual(cfg.llm.retryMaxDelayMs, 30000);
  });

  test('AgentConfig.fromEnv() creates instance', () => {
    const cfg = AgentConfig.fromEnv();
    assert.ok(cfg instanceof AgentConfig);
  });

  test('AgentConfig accepts custom options', () => {
    const cfg = new AgentConfig({
      basePath: '/debug',
      llm: { model: 'gpt-3.5-turbo', contextWindowTokens: 50000, maxRetries: 5 },
    });
    assert.strictEqual(cfg.basePath, '/debug');
    assert.strictEqual(cfg.llm.model, 'gpt-3.5-turbo');
    assert.strictEqual(cfg.llm.contextWindowTokens, 50000);
    assert.strictEqual(cfg.llm.maxRetries, 5);
  });

  // --- ChatSession ---
  test('ChatSession tracks messages and token usage', () => {
    const session = new ChatSession('test-1');
    assert.strictEqual(session.sessionId, 'test-1');
    assert.deepStrictEqual(session.messages, []);

    session.addMessage({ role: 'user', content: 'hello' });
    assert.strictEqual(session.messages.length, 1);

    session.recordTokenUsage({ prompt_tokens: 500, completion_tokens: 100 });
    assert.strictEqual(session.cumulativePromptTokens, 500);
    assert.strictEqual(session.cumulativeCompletionTokens, 100);
    assert.strictEqual(session.getCurrentContextTokens(), 500);

    session.recordTokenUsage({ prompt_tokens: 800, completion_tokens: 50 });
    assert.strictEqual(session.cumulativePromptTokens, 800);
    assert.strictEqual(session.cumulativeCompletionTokens, 150);

    session.clear();
    assert.strictEqual(session.messages.length, 0);
    assert.strictEqual(session.getCurrentContextTokens(), 0);
  });

  test('ChatSession.replaceMessages works', () => {
    const session = new ChatSession('test-2');
    session.addMessage({ role: 'user', content: 'hello' });
    session.replaceMessages([{ role: 'system', content: 'compressed' }]);
    assert.strictEqual(session.messages.length, 1);
    assert.strictEqual(session.messages[0].content, 'compressed');
  });

  // --- Tool Registry ---
  test('built-in tools are registered (19+ tools)', () => {
    const names = registry.names();
    assert.ok(names.length >= 19, `Expected >= 19 tools, got ${names.length}`);
  });

  test('expected built-in tools exist', () => {
    const names = registry.names();
    const expected = [
      'get_heap_stats', 'trigger_gc', 'get_event_loop_lag',
      'get_process_info', 'get_system_info', 'get_active_handles',
      'get_v8_flags', 'get_routes', 'get_middleware',
      'get_installed_packages', 'get_environment_variables',
      'get_recent_requests', 'get_slow_requests', 'get_error_requests',
      'get_request_stats', 'get_cpu_info', 'get_disk_usage',
      'get_uptime', 'get_module_list',
    ];
    for (const name of expected) {
      assert.ok(names.includes(name), `Missing tool: ${name}`);
    }
  });

  test('tool schemas are valid OpenAI function format', () => {
    const schemas = registry.allSchemas();
    for (const s of schemas) {
      assert.strictEqual(s.type, 'function');
      assert.ok(s.function.name, 'Tool missing name');
      assert.ok(s.function.description, 'Tool missing description');
      assert.strictEqual(s.function.parameters.type, 'object');
    }
  });

  // --- SystemPromptBuilder ---
  test('SystemPromptBuilder generates dynamic prompt with tool categories', () => {
    const builder = new SystemPromptBuilder(registry);
    const prompt = builder.build();
    assert.ok(prompt.includes('Node.js runtime debugging assistant'));
    assert.ok(prompt.includes('Your Capabilities'));
    assert.ok(prompt.includes('Workflow'));
    assert.ok(prompt.includes('get_heap_stats'));
    assert.ok(prompt.includes('get_process_info'));
  });

  // --- ContextCompressor ---
  test('ContextCompressor.needsCompression logic', () => {
    const mockClient = {};
    const comp = new ContextCompressor(mockClient, 'gpt-4o', 0.3, 100000, 3);
    assert.strictEqual(comp.needsCompression(50000), false);
    assert.strictEqual(comp.needsCompression(100001), true);
  });

  test('ContextCompressor identifies rounds correctly', () => {
    const mockClient = {};
    const comp = new ContextCompressor(mockClient, 'gpt-4o', 0.3, 100000, 3);
    const messages = [
      { role: 'user', content: 'question 1' },
      { role: 'assistant', content: 'answer 1', tool_calls: null },
    ];
    const rounds = comp._identifyRounds(messages);
    assert.strictEqual(rounds.length, 1);
  });

  test('CompressionResult stores values', () => {
    const result = new CompressionResult(10000, 5000, 3, 'test strategy');
    assert.strictEqual(result.originalTokens, 10000);
    assert.strictEqual(result.compressedTokens, 5000);
    assert.strictEqual(result.removedRounds, 3);
    assert.strictEqual(result.strategy, 'test strategy');
  });

  // --- Tool execution ---
  await asyncTest('get_process_info returns PID', async () => {
    const result = await registry.execute('get_process_info', {});
    assert.ok(result.pid);
    assert.strictEqual(result.pid, process.pid);
  });

  await asyncTest('get_system_info returns hostname', async () => {
    const result = await registry.execute('get_system_info', {});
    assert.ok(result.hostname);
  });

  await asyncTest('get_uptime returns process uptime', async () => {
    const result = await registry.execute('get_uptime', {});
    assert.ok(result.process_uptime_seconds >= 0);
  });

  await asyncTest('get_recent_requests returns array', async () => {
    const result = await registry.execute('get_recent_requests', {});
    assert.ok(Array.isArray(result.requests));
  });

  await asyncTest('get_request_stats returns stats', async () => {
    const result = await registry.execute('get_request_stats', {});
    assert.ok(result.total_requests !== undefined || result.message !== undefined);
  });

  await asyncTest('unknown tool returns error', async () => {
    const result = await registry.execute('nonexistent_tool', {});
    assert.ok(result.error);
  });

  // --- Custom tool registration ---
  await asyncTest('custom tool can be registered and executed', async () => {
    debugTool('test_custom', 'A test custom tool', {
      value: { type: 'string', description: 'Test value', required: true },
    })(async function testCustom({ value }) {
      return { echoed: value };
    });

    const result = await registry.execute('test_custom', { value: 'hello' });
    assert.strictEqual(result.echoed, 'hello');
  });

  // --- HTTP handler ---
  test('createHttpHandler returns function', () => {
    const handler = createHttpHandler();
    assert.strictEqual(typeof handler, 'function');
  });

  // --- DebugEngine ---
  test('DebugEngine initializes with all subsystems', () => {
    const cfg = new AgentConfig({ llm: { apiKey: 'test-key' } });
    const engine = new DebugEngine(cfg);
    assert.ok(engine.llm instanceof LLMClient);
    assert.ok(engine.tools);
    assert.ok(engine.sessions instanceof Map);
    assert.ok(engine.systemPrompt);
    assert.ok(engine.contextCompressor);
    assert.ok(engine.promptBuilder);
  });

  test('DebugEngine.clearSession works', () => {
    const cfg = new AgentConfig({ llm: { apiKey: 'test-key' } });
    const engine = new DebugEngine(cfg);
    engine._getOrCreateSession('test-sid').addMessage({ role: 'user', content: 'hi' });
    assert.ok(engine.sessions.has('test-sid'));
    engine.clearSession('test-sid');
    // Session still exists but is cleared
    assert.strictEqual(engine.sessions.get('test-sid').messages.length, 0);
  });

  // --- Summary ---
  await new Promise(r => setTimeout(r, 100));
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
