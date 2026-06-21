'use strict';

/**
 * The core agent reasoning engine.
 *
 * Implements the tool-calling loop:
 * 1. Send user message + tools to LLM
 * 2. If LLM returns tool calls → execute them → feed results back → repeat
 * 3. If LLM returns content → stream to caller → done
 *
 * Features:
 * - Dynamic system prompt generated from registered tools
 * - Real token usage tracking from LLM API responses
 * - Automatic context compression when token count exceeds threshold
 *
 * All responses are streamed via callback for real-time UX.
 *
 * Equivalent to Spring's DebugAgentEngine.
 */

const { LLMClient, StreamHandler } = require('./llm-client');
const { registry } = require('./tool-registry');
const { ChatSession } = require('./chat-session');
const { SystemPromptBuilder } = require('./system-prompt-builder');
const { ContextCompressor } = require('./context-compressor');

class DebugEngine {
  constructor(config) {
    this.config = config;
    this.llm = new LLMClient(config.llm);
    this.tools = registry;
    this.sessions = new Map();

    /** Builds system prompt dynamically from registered tools. */
    this.promptBuilder = new SystemPromptBuilder(registry);
    this.systemPrompt = this.promptBuilder.build();

    /** Compresses context when token count exceeds the limit. */
    this.contextCompressor = new ContextCompressor(
      this.llm,
      config.llm.model,
      config.llm.temperature,
      config.llm.contextWindowTokens,
      3
    );
  }

  /**
   * Process a user message with streaming output via callbacks.
   *
   * @param {string} userMessage
   * @param {string} sessionId
   * @param {object} callback - { onContent, onToolStart, onToolResult, onComplete, onError, onContextCompressed }
   */
  async chat(userMessage, sessionId, callback) {
    try {
      const session = this._getOrCreateSession(sessionId);
      session.addMessage({ role: 'user', content: userMessage });

      await this._runToolLoop(session, callback);
    } catch (e) {
      callback.onError('Internal error: ' + e.message);
    }
  }

  /**
   * Clear a session's conversation history.
   */
  clearSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.clear();
    }
  }

  _getOrCreateSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new ChatSession(sessionId));
    }
    return this.sessions.get(sessionId);
  }

  // ==================== Core Tool-Calling Loop ====================

  async _runToolLoop(session, callback) {
    const maxRounds = this.config.llm.maxToolRounds;
    const llmConfig = this.config.llm;

    for (let round = 0; round < maxRounds; round++) {
      // ── Check if context compression is needed ──
      if (round > 0 && this.contextCompressor.needsCompression(session.getCurrentContextTokens())) {
        const result = await this.contextCompressor.compress(session);
        if (result) {
          callback.onContent('\n\n> [Context auto-compressed: ' +
            result.originalTokens + ' → ~' + result.compressedTokens + ' tokens' +
            ' (' + result.strategy + ')]\n\n');
          callback.onContextCompressed(
            result.originalTokens, result.compressedTokens, result.removedRounds);
        }
      }

      // ── Build the request ──
      const request = {
        model: llmConfig.model,
        temperature: llmConfig.temperature,
        maxTokens: llmConfig.maxTokens,
        toolChoice: 'auto',
        messages: [
          { role: 'system', content: this.systemPrompt },
          ...session.messages,
        ],
        tools: this.tools.allSchemas(),
      };

      // ── Stream the response ──
      let contentBuilder = '';
      let toolCallHolder = [];
      let hadError = false;
      let usageHolder = null;

      await new Promise((resolve) => {
        const handler = new StreamHandler();
        handler.onContent = (content) => {
          contentBuilder += content;
          callback.onContent(content);
        };
        handler.onComplete = (toolCalls, finishReason, usage) => {
          toolCallHolder = toolCalls;
          usageHolder = usage;
          resolve();
        };
        handler.onError = (error) => {
          hadError = true;
          callback.onError('LLM API error: ' + error.message);
          resolve();
        };

        this.llm.chatCompletionStreamRaw(request, handler);
      });

      if (hadError) return;

      // ── Record token usage ──
      if (usageHolder) {
        session.recordTokenUsage(usageHolder);
      }

      const toolCalls = toolCallHolder;

      if (!toolCalls || toolCalls.length === 0) {
        // No tool calls → final answer is done (content was already streamed)
        session.addMessage({ role: 'assistant', content: contentBuilder, tool_calls: null });
        callback.onComplete();
        return;
      }

      // LLM wants to call tools → add the assistant message with tool calls
      session.addMessage({ role: 'assistant', content: contentBuilder, tool_calls: toolCalls });

      // If LLM returned empty content with tool calls, prompt it to summarize after tools
      if (!contentBuilder.trim() && round > 0) {
        session.addMessage({
          role: 'system',
          content: 'After reviewing the tool results above, provide a concise analysis of what you found.',
        });
      }

      // Execute each tool call
      for (const tc of toolCalls) {
        const toolName = tc.function.name;
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}

        callback.onToolStart(toolName, tc.function.arguments);

        try {
          const result = await this.tools.execute(toolName, args);
          const resultStr = JSON.stringify(result);
          callback.onToolResult(toolName, resultStr);

          // Add tool result to conversation
          session.addMessage({
            role: 'tool',
            tool_call_id: tc.id,
            content: resultStr.slice(0, 12000),
          });
        } catch (e) {
          const errorResult = JSON.stringify({ error: e.message });
          callback.onToolResult(toolName, errorResult);
          session.addMessage({
            role: 'tool',
            tool_call_id: tc.id,
            content: errorResult,
          });
        }
      }

      // Loop continues → LLM will analyze tool results in the next round
    }

    // ── Reached max rounds — force a final summary ──
    const finalRequest = {
      model: llmConfig.model,
      temperature: llmConfig.temperature,
      maxTokens: llmConfig.maxTokens,
      toolChoice: 'none',
      messages: [
        { role: 'system', content: this.systemPrompt },
        ...session.messages,
        {
          role: 'system',
          content: 'You have reached the maximum number of tool-calling rounds. ' +
            'Based on all the diagnostic data you have gathered so far, ' +
            'provide a comprehensive analysis and actionable recommendations NOW. ' +
            'Do not attempt to call more tools.',
        },
      ],
      tools: [],
    };

    await new Promise((resolve) => {
      const handler = new StreamHandler();
      handler.onContent = (content) => {
        callback.onContent(content);
      };
      handler.onComplete = (toolCalls, finishReason, usage) => {
        if (usage) session.recordTokenUsage(usage);
        callback.onComplete();
        resolve();
      };
      handler.onError = (error) => {
        callback.onContent('\n\n*I\'ve gathered diagnostic data from multiple tools ' +
          'but reached the analysis limit. Please ask a more specific question ' +
          'about a particular component for deeper analysis.*');
        callback.onComplete();
        resolve();
      };

      this.llm.chatCompletionStreamRaw(finalRequest, handler);
    });
  }
}

module.exports = { DebugEngine };
