'use strict';

class AgentConfig {
  constructor(opts = {}) {
    this.enabled = opts.enabled !== false;
    this.basePath = opts.basePath || '/agent';

    const llm = opts.llm || {};
    this.llm = {
      baseUrl: llm.baseUrl || process.env.LLM_BASE_URL || 'https://open.bigmodel.cn/api/coding/paas/v4',
      apiKey: llm.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
      model: llm.model || process.env.LLM_MODEL || 'glm-5.2',
      temperature: llm.temperature ?? 0.3,
      maxTokens: llm.maxTokens || 4096,
      maxToolRounds: llm.maxToolRounds || 25,
      timeoutSeconds: llm.timeoutSeconds || 120,
      maxRetries: llm.maxRetries ?? 3,
      retryBaseDelayMs: llm.retryBaseDelayMs || 1000,
      retryMaxDelayMs: llm.retryMaxDelayMs || 30000,
      contextWindowTokens: llm.contextWindowTokens || 100000,
    };
  }

  static fromEnv() {
    return new AgentConfig();
  }
}

module.exports = { AgentConfig };
