'use strict';

/**
 * A lightweight OpenAI-compatible chat client with built-in retry and real streaming.
 *
 * Works with any endpoint that implements the /v1/chat/completions API:
 *   - OpenAI (api.openai.com)
 *   - Ollama (localhost:11434)
 *   - vLLM, LM Studio, Together AI, DeepSeek, Moonshot, ZhipuAI, etc.
 *
 * Uses Node.js built-in http/https — zero external dependencies.
 *
 * Equivalent to Spring's OpenAiClient.
 */

const https = require('https');
const http = require('http');

// Reusable agents with keepAlive for connection reuse (avoids TCP handshake per request)
const _httpAgent = new http.Agent({ keepAlive: true, maxSockets: 4 });
const _httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 4 });
const { URL } = require('url');

/**
 * Callback for streaming responses — matches Spring's StreamHandler.
 */
class StreamHandler {
  /** @param {string} content */
  onContent(content) {}
  /** @param {Array} toolCalls @param {string} finishReason @param {object|null} usage */
  onComplete(toolCalls, finishReason, usage) {}
  /** @param {Error} error */
  onError(error) {}
}

class LLMClient {
  constructor(config) {
    this.cfg = config; // { baseUrl, apiKey, model, temperature, maxTokens, timeoutSeconds, maxRetries, ... }
  }

  // ==================== Non-Streaming ====================

  /**
   * Non-streaming chat completion with automatic retry.
   * Used by ContextCompressor for summarization calls.
   */
  async chatCompletion(request) {
    const body = {
      model: request.model || this.cfg.model,
      messages: request.messages,
      temperature: request.temperature ?? 0,
      max_tokens: request.maxTokens || 1024,
      stream: false,
    };
    if (request.tools && request.tools.length > 0) body.tools = request.tools;

    return this._postWithRetry('/chat/completions', body);
  }

  // ==================== Streaming (primary) ====================

  /**
   * Primary streaming method used by the agent engine.
   * Parses SSE stream for correct tool-call index handling.
   * Retries on 429/5xx/network errors before streaming starts.
   *
   * @param {object} request - Chat request config
   * @param {StreamHandler} handler - Callback interface
   */
  async chatCompletionStreamRaw(request, handler) {
    const body = {
      model: request.model || this.cfg.model,
      messages: request.messages,
      temperature: request.temperature ?? this.cfg.temperature,
      max_tokens: request.maxTokens || this.cfg.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (request.toolChoice) body.tool_choice = request.toolChoice;
    if (request.tools && request.tools.length > 0) body.tools = request.tools;
    if (request.tools && request.tools.length === 0) body.tools = [];

    const maxRetries = this.cfg.maxRetries ?? 3;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this._streamRequest('/chat/completions', body, handler);
        return; // Success
      } catch (e) {
        lastError = e;

        // Check if retriable
        if (e._retriable && attempt < maxRetries) {
          const delay = this._calculateDelay(e._statusCode || 0, e._retryAfter, attempt);
          await this._sleep(delay);
          continue;
        }

        // Not retriable or exhausted retries
        handler.onError(e);
        return;
      }
    }

    handler.onError(new Error(`Exhausted retries after ${maxRetries} attempts: ${lastError?.message}`));
  }

  // ==================== Stream Processing ====================

  _streamRequest(path, requestBody, handler) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.cfg.baseUrl + path);
      const transport = url.protocol === 'https:' ? https : http;
      const agent = url.protocol === 'https:' ? _httpsAgent : _httpAgent;
      const data = JSON.stringify(requestBody);

      const req = transport.request(url, {
        method: 'POST',
        agent,
        headers: {
          'Authorization': `Bearer ${this.cfg.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: this.cfg.timeoutSeconds * 1000,
      }, (res) => {
        const code = res.statusCode;

        // Handle retriable errors
        if (code >= 400) {
          let errorBody = '';
          res.on('data', c => errorBody += c);
          res.on('end', () => {
            const error = new Error(`LLM API error ${code}: ${errorBody}`);
            error._statusCode = code;
            error._retriable = this._isRetriable(code);
            const retryAfter = res.headers['retry-after'];
            if (retryAfter) error._retryAfter = retryAfter;
            reject(error);
          });
          return;
        }

        // Process SSE stream
        let buffer = '';
        const toolCallMap = new Map(); // index → { id, function: { name, arguments } }
        let finishReason = null;
        let usage = null;

        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop(); // Keep incomplete line

          for (const line of lines) {
            const trimmed = line.replace(/\r$/, '');
            if (trimmed === '' || !trimmed.startsWith('data:')) continue;

            const dataStr = trimmed.substring(5).trim();
            if (dataStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(dataStr);
              const choice = parsed.choices?.[0];
              if (!choice) {
                // Check for usage in final chunk
                if (parsed.usage && parsed.usage.prompt_tokens) {
                  usage = parsed.usage;
                }
                continue;
              }

              const delta = choice.delta || {};

              // Content → forward immediately
              if (delta.content !== undefined && delta.content !== '') {
                handler.onContent(delta.content);
              }

              // Tool calls with proper index
              if (Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!toolCallMap.has(idx)) {
                    toolCallMap.set(idx, { id: '', type: 'function', function: { name: '', arguments: '' } });
                  }
                  const existing = toolCallMap.get(idx);

                  if (tc.id) existing.id = tc.id;
                  if (tc.type) existing.type = tc.type;
                  if (tc.function) {
                    if (tc.function.name) existing.function.name += tc.function.name;
                    if (tc.function.arguments !== undefined) existing.function.arguments += tc.function.arguments;
                  }
                }
              }

              if (choice.finish_reason) {
                finishReason = choice.finish_reason;
              }
            } catch (e) {
              // Skip malformed chunks
            }
          }
        });

        res.on('end', () => {
          // Process remaining buffer
          if (buffer.trim().startsWith('data:')) {
            const dataStr = buffer.trim().substring(5).trim();
            if (dataStr !== '[DONE]') {
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.usage && parsed.usage.prompt_tokens) {
                  usage = parsed.usage;
                }
                const choice = parsed.choices?.[0];
                if (choice?.finish_reason) finishReason = choice.finish_reason;
              } catch (e) {}
            }
          }

          // Clean up tool calls
          const toolCalls = Array.from(toolCallMap.values())
            .filter(tc => tc.function.name);

          handler.onComplete(toolCalls, finishReason, usage);
          resolve();
        });

        res.on('error', (e) => {
          reject(e);
        });
      });

      req.on('error', (e) => {
        e._retriable = true; // Network errors are retriable
        reject(e);
      });

      req.on('timeout', () => {
        req.destroy();
        const error = new Error('LLM request timed out');
        error._retriable = true;
        reject(error);
      });

      req.write(data);
      req.end();
    });
  }

  // ==================== Non-streaming POST with retry ====================

  async _postWithRetry(path, body) {
    const maxRetries = this.cfg.maxRetries ?? 3;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._post(path, body);
      } catch (e) {
        lastError = e;
        if (e._retriable && attempt < maxRetries) {
          const delay = this._calculateDelay(e._statusCode || 0, e._retryAfter, attempt);
          await this._sleep(delay);
          continue;
        }
        throw e;
      }
    }
    throw lastError;
  }

  _post(path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.cfg.baseUrl + path);
      const transport = url.protocol === 'https:' ? https : http;
      const agent = url.protocol === 'https:' ? _httpsAgent : _httpAgent;
      const data = JSON.stringify(body);

      const req = transport.request(url, {
        method: 'POST',
        agent,
        headers: {
          'Authorization': `Bearer ${this.cfg.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: this.cfg.timeoutSeconds * 1000,
      }, (res) => {
        const code = res.statusCode;
        let chunks = '';
        res.on('data', c => chunks += c);
        res.on('end', () => {
          if (code >= 400) {
            const error = new Error(`LLM API error ${code}: ${chunks}`);
            error._statusCode = code;
            error._retriable = this._isRetriable(code);
            const retryAfter = res.headers['retry-after'];
            if (retryAfter) error._retryAfter = retryAfter;
            reject(error);
            return;
          }
          try {
            resolve(JSON.parse(chunks));
          } catch (e) {
            reject(new Error(`Failed to parse response: ${chunks.slice(0, 200)}`));
          }
        });
      });

      req.on('error', (e) => {
        e._retriable = true;
        reject(e);
      });

      req.on('timeout', () => {
        req.destroy();
        const error = new Error('LLM request timed out');
        error._retriable = true;
        reject(error);
      });

      req.write(data);
      req.end();
    });
  }

  // ==================== Retry Helpers ====================

  _isRetriable(statusCode) {
    return statusCode === 429 || statusCode === 500 || statusCode === 502 ||
           statusCode === 503 || statusCode === 504;
  }

  _calculateDelay(statusCode, retryAfter, attempt) {
    // Respect Retry-After header
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return Math.min(seconds * 1000, this.cfg.retryMaxDelayMs || 30000);
      }
    }

    // Exponential backoff: base * 2^attempt + jitter
    const base = (this.cfg.retryBaseDelayMs || 1000) * (1 << attempt);
    const jitter = Math.floor(Math.random() * (base / 2 + 1));
    return Math.min(base + jitter, this.cfg.retryMaxDelayMs || 30000);
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { LLMClient, StreamHandler };
