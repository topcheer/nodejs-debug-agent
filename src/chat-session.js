'use strict';

/**
 * Manages conversation sessions in memory.
 * Tracks cumulative token usage for context compression decisions.
 *
 * Equivalent to Spring's ChatSession.
 */

class ChatSession {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.createdAt = Date.now();
    this.messages = [];
    this.lastActiveAt = this.createdAt;

    /** Token usage from the most recent LLM API response. */
    this.lastTokenUsage = null;

    /** Cumulative prompt tokens across all rounds (represents current context window). */
    this.cumulativePromptTokens = 0;

    /** Total completion tokens across all rounds. */
    this.cumulativeCompletionTokens = 0;
  }

  addMessage(message) {
    this.messages.push(message);
    this.lastActiveAt = Date.now();
  }

  /**
   * Replace the entire message list (used by context compression).
   */
  replaceMessages(newMessages) {
    this.messages = newMessages;
    this.lastActiveAt = Date.now();
  }

  /**
   * Record token usage from an LLM API response.
   * prompt_tokens represents the current context window size.
   */
  recordTokenUsage(usage) {
    if (!usage) return;
    this.lastTokenUsage = usage;
    this.cumulativePromptTokens = usage.prompt_tokens || 0;
    this.cumulativeCompletionTokens += usage.completion_tokens || 0;
  }

  getCurrentContextTokens() {
    return this.cumulativePromptTokens;
  }

  clear() {
    this.messages = [];
    this.lastTokenUsage = null;
    this.cumulativePromptTokens = 0;
    this.cumulativeCompletionTokens = 0;
    this.lastActiveAt = Date.now();
  }
}

module.exports = { ChatSession };
