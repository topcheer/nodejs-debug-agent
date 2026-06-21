'use strict';

/**
 * Compresses conversation context by asking the LLM to summarize older history.
 *
 * Strategy:
 * 1. Split history into [old rounds to summarize] + [recent rounds to keep]
 * 2. Send old rounds to the LLM with a summarization prompt
 * 3. Replace old rounds with the generated summary message
 * 4. The compressed context = summary + recent rounds
 *
 * Token counts are based on actual prompt_tokens from the LLM API response.
 *
 * Equivalent to Spring's ContextCompressor.
 */

const { LLMClient } = require('./llm-client');

class ContextCompressor {
  constructor(llmClient, model, temperature, maxContextTokens, recentRoundsToKeep = 3) {
    this.llmClient = llmClient;
    this.model = model;
    this.temperature = temperature;
    this.maxContextTokens = maxContextTokens;
    this.targetTokens = Math.floor(maxContextTokens * 0.75);
    this.recentRoundsToKeep = recentRoundsToKeep;
  }

  /**
   * Check if compression is needed based on the current token count.
   */
  needsCompression(currentTokens) {
    return currentTokens > this.targetTokens;
  }

  /**
   * Compress the conversation history by summarizing older rounds via LLM.
   * @param {ChatSession} session
   * @returns {CompressionResult|null}
   */
  async compress(session) {
    const originalTokens = session.getCurrentContextTokens();
    if (!this.needsCompression(originalTokens)) {
      return null;
    }

    const allMessages = session.messages;
    const rounds = this._identifyRounds(allMessages);

    // Figure out how many recent rounds to keep
    let keepCount = Math.min(this.recentRoundsToKeep, rounds.length - 1);
    if (keepCount < 1) {
      // Can't drop rounds — try compressing tool results within rounds instead
      return await this._compressToolResults(session, originalTokens);
    }

    const summarizeCount = rounds.length - keepCount;

    // Collect messages to summarize
    let toSummarize = [];
    for (let i = 0; i < summarizeCount; i++) {
      toSummarize = toSummarize.concat(rounds[i].messages);
    }

    // Collect recent messages to keep verbatim
    let toKeep = [];
    for (let i = summarizeCount; i < rounds.length; i++) {
      toKeep = toKeep.concat(rounds[i].messages);
    }

    // Ask LLM to summarize the old rounds
    let summary;
    try {
      summary = await this._summarizeWithLlm(toSummarize);
    } catch (e) {
      summary = this._fallbackTruncate(toSummarize);
    }

    // Build compressed message list
    const compressed = [
      { role: 'system', content: `[Previous conversation summary — ${summarizeCount} rounds compressed]\n\n${summary}` },
      ...toKeep,
    ];

    const compressedTokens = this._estimateTokens(compressed);

    session.replaceMessages(compressed);

    return new CompressionResult(originalTokens, compressedTokens, summarizeCount,
      `LLM summarized ${summarizeCount} rounds`);
  }

  // ==================== Intra-Round Tool Result Compression ====================

  async _compressToolResults(session, originalTokens) {
    const messages = session.messages;

    // Identify tool-call blocks
    const blocks = [];
    let currentBlock = null;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        currentBlock = { startIndex: i, endIndex: i, messages: [msg] };
        blocks.push(currentBlock);
      } else if (msg.role === 'tool' && currentBlock) {
        currentBlock.messages.push(msg);
        currentBlock.endIndex = i;
      } else {
        currentBlock = null;
      }
    }

    if (blocks.length === 0) return null;

    // Keep the last block intact, summarize the rest
    let keepRecent = Math.min(1, blocks.length - 1);
    let summarizeCount = blocks.length - keepRecent;

    if (summarizeCount < 1) {
      const onlyBlock = blocks[0];
      if (onlyBlock.messages.length <= 3) return null;
      summarizeCount = 1;
      keepRecent = 0;
    }

    // Collect blocks to summarize
    let toSummarize = [];
    for (let i = 0; i < summarizeCount; i++) {
      toSummarize = toSummarize.concat(blocks[i].messages);
    }

    // Ask LLM for summary
    let summary;
    try {
      summary = await this._summarizeToolResultsWithLlm(toSummarize);
    } catch (e) {
      return null;
    }

    // Rebuild message list
    const skipIndices = new Set();
    for (let i = 0; i < summarizeCount; i++) {
      const b = blocks[i];
      for (let j = b.startIndex; j <= b.endIndex; j++) {
        skipIndices.add(j);
      }
    }

    const compressed = [];
    let summaryInserted = false;
    for (let i = 0; i < messages.length; i++) {
      if (skipIndices.has(i)) {
        if (!summaryInserted) {
          compressed.push({
            role: 'system',
            content: `[Previous diagnostic results summary — ${summarizeCount} tool-call round(s) compressed]\n\n${summary}`,
          });
          summaryInserted = true;
        }
        continue;
      }
      compressed.push(messages[i]);
    }

    if (!summaryInserted) {
      compressed.push({ role: 'system', content: `[Diagnostic summary]\n\n${summary}` });
    }

    const compressedTokens = this._estimateTokens(compressed);
    session.replaceMessages(compressed);

    return new CompressionResult(originalTokens, compressedTokens, 0,
      `LLM summarized ${summarizeCount} tool-call blocks`);
  }

  // ==================== LLM Summarization ====================

  async _summarizeWithLlm(oldMessages) {
    let conversationText = '';
    for (const msg of oldMessages) {
      switch (msg.role) {
        case 'user':
          conversationText += `[User] ${msg.content}\n\n`;
          break;
        case 'assistant':
          if (msg.content) {
            conversationText += `[Assistant] ${msg.content}\n\n`;
          }
          if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
              if (tc.function) {
                conversationText += `[Tool Call] ${tc.function.name}(${tc.function.arguments})\n\n`;
              }
            }
          }
          break;
        case 'tool':
          let content = msg.content || '';
          if (content.length > 2000) content = content.substring(0, 2000) + '...[truncated]';
          conversationText += `[Tool Result] ${content}\n\n`;
          break;
      }
    }

    const prompt = `You are a conversation summarizer for a Node.js debugging assistant.
Summarize the KEY diagnostic findings from the conversation below concisely.

Focus on preserving:
- Problems investigated and their root causes (if found)
- Key tool results: actual numbers, statuses, error messages, configuration values
- Recommendations or fixes already suggested
- Any unresolved issues or follow-up actions pending

Rules:
- Be concise but preserve ALL important data points (memory sizes, event loop lag, error codes, etc.)
- Use bullet points
- Do NOT include full JSON dumps — extract only the meaningful values
- Keep it under 600 words`;

    const request = {
      model: this.model,
      temperature: 0,
      maxTokens: 1024,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Conversation to summarize:\n\n${conversationText}` },
      ],
    };

    const response = await this.llmClient.chatCompletion(request);
    const summary = response.choices?.[0]?.message?.content;
    return summary || '(summary unavailable)';
  }

  async _summarizeToolResultsWithLlm(toolMessages) {
    let toolText = '';
    for (const msg of toolMessages) {
      let content = msg.content || '';
      if (content.length > 3000) content = content.substring(0, 3000) + '...[truncated]';
      toolText += `[Tool Result] ${content}\n\n---\n\n`;
    }

    const prompt = `You are summarizing diagnostic tool results from a Node.js debugging session.
Below are tool results that need to be compressed to save context space.

For each tool result, extract:
- The tool name (if identifiable from the data)
- The KEY metrics: actual numbers, statuses, error messages, configuration values
- Any anomalies or issues detected

Format as concise bullet points. Do NOT include full JSON — extract only meaningful values.
Keep it under 400 words.`;

    const request = {
      model: this.model,
      temperature: 0,
      maxTokens: 800,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Tool results to summarize:\n\n${toolText}` },
      ],
    };

    const response = await this.llmClient.chatCompletion(request);
    const summary = response.choices?.[0]?.message?.content;
    return summary || '(summary unavailable)';
  }

  // ==================== Fallback ====================

  _fallbackTruncate(messages) {
    let sb = 'Previous conversation summary (fallback — LLM summarization failed):\n\n';
    for (const msg of messages) {
      if (msg.role === 'user' && msg.content) {
        const q = msg.content.length > 100 ? msg.content.substring(0, 100) + '...' : msg.content;
        sb += `- User asked: ${q}\n`;
      }
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.function) {
            sb += `- Called tool: ${tc.function.name}\n`;
          }
        }
      }
    }
    return sb;
  }

  // ==================== Round Identification ====================

  /**
   * Group messages into compressible "rounds".
   * A round = [optional user message] + [one assistant message] + [its tool results]
   */
  _identifyRounds(messages) {
    const rounds = [];
    let current = { messages: [], hasAssistant: false };

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (current.messages.length > 0) {
          rounds.push(current);
          current = { messages: [], hasAssistant: false };
        }
        current.messages.push(msg);
      } else if (msg.role === 'assistant') {
        if (current.hasAssistant) {
          rounds.push(current);
          current = { messages: [], hasAssistant: false };
        }
        current.messages.push(msg);
        current.hasAssistant = true;
      } else {
        // tool/system messages go into the current round
        current.messages.push(msg);
      }
    }
    if (current.messages.length > 0) {
      rounds.push(current);
    }

    return rounds;
  }

  // ==================== Token Estimation ====================

  _estimateTokens(messages) {
    let chars = 0;
    for (const msg of messages) {
      if (msg.content) chars += msg.content.length;
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.function) {
            chars += (tc.function.name || '').length;
            chars += (tc.function.arguments || '').length;
          }
        }
      }
    }
    return Math.floor(chars / 4);
  }
}

class CompressionResult {
  constructor(originalTokens, compressedTokens, removedRounds, strategy) {
    this.originalTokens = originalTokens;
    this.compressedTokens = compressedTokens;
    this.removedRounds = removedRounds;
    this.strategy = strategy;
  }
}

module.exports = { ContextCompressor, CompressionResult };
