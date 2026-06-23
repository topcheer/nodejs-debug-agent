// Type definitions for @debug-agent/node

// ==================== Config ====================

export interface LLMConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxToolRounds?: number;
  timeoutSeconds?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  contextWindowTokens?: number;
}

export interface AgentConfigOptions {
  enabled?: boolean;
  basePath?: string;
  llm?: Partial<LLMConfig>;
}

export class AgentConfig {
  enabled: boolean;
  basePath: string;
  llm: LLMConfig;
  constructor(opts?: AgentConfigOptions);
  static fromEnv(): AgentConfig;
}

// ==================== Tool Registry ====================

export interface ToolParamMeta {
  type?: string;
  description?: string;
  required?: boolean;
}

export class ToolParam {
  constructor(description: string, opts?: { required?: boolean });
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

export interface ToolResult {
  [key: string]: unknown;
}

export class ToolRegistry {
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  allSchemas(): ToolSchema[];
  execute(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  names(): string[];
}

export class ToolDefinition {
  name: string;
  description: string;
  params: Record<string, ToolParamMeta>;
  schema(): ToolSchema;
  execute(args?: Record<string, unknown>): Promise<ToolResult>;
}

export const registry: ToolRegistry;

export function debugTool(
  name: string,
  description: string,
  params?: Record<string, ToolParamMeta>
): (target: any, key?: string, descriptor?: PropertyDescriptor) => any;

// ==================== LLM Client ====================

export class StreamHandler {
  onContent(content: string): void;
  onComplete(toolCalls: any[], finishReason: string | null, usage: any | null): void;
  onError(error: Error): void;
}

export class LLMClient {
  constructor(config: LLMConfig);
  chatCompletion(request: {
    model?: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
    tools?: any[];
  }): Promise<any>;
  chatCompletionStreamRaw(request: {
    model?: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
    tools?: any[];
    toolChoice?: string;
  }, handler: StreamHandler): Promise<void>;
}

// ==================== Chat Session ====================

export class ChatSession {
  sessionId: string;
  messages: Array<Record<string, any>>;
  lastTokenUsage: any | null;
  cumulativePromptTokens: number;
  cumulativeCompletionTokens: number;
  constructor(sessionId: string);
  addMessage(message: Record<string, any>): void;
  replaceMessages(newMessages: Array<Record<string, any>>): void;
  recordTokenUsage(usage: any): void;
  getCurrentContextTokens(): number;
  clear(): void;
}

// ==================== System Prompt Builder ====================

export class SystemPromptBuilder {
  constructor(toolRegistry: ToolRegistry);
  build(): string;
}

// ==================== Context Compressor ====================

export class CompressionResult {
  originalTokens: number;
  compressedTokens: number;
  removedRounds: number;
  strategy: string;
}

export class ContextCompressor {
  constructor(
    llmClient: LLMClient,
    model: string,
    temperature: number,
    maxContextTokens: number,
    recentRoundsToKeep?: number
  );
  needsCompression(currentTokens: number): boolean;
  compress(session: ChatSession): Promise<CompressionResult | null>;
}

// ==================== Debug Engine ====================

export interface ChatCallback {
  onContent(chunk: string): void;
  onToolStart(toolName: string, args: string): void;
  onToolResult(toolName: string, result: string): void;
  onComplete(): void;
  onError(message: string): void;
  onContextCompressed?(originalTokens: number, compressedTokens: number, removedRounds: number): void;
}

export class DebugEngine {
  constructor(config: AgentConfig);
  chat(userMessage: string, sessionId: string, callback: ChatCallback): Promise<void>;
  clearSession(sessionId: string): void;
}

// ==================== Framework Integration ====================

export function createExpressRouter(config?: AgentConfigOptions): any;
export function createFastifyPlugin(config?: AgentConfigOptions): any;
export function createHttpHandler(config?: AgentConfigOptions): (req: any, res: any) => Promise<boolean>;
export function createKoaMiddleware(config?: AgentConfigOptions): any;
export function getEngine(config?: AgentConfigOptions): DebugEngine;

// ==================== Inspector Registration APIs ====================

// Error Tracking
export function captureError(error: Error | string, context?: { path?: string; method?: string }): void;

// Config
export function registerConfig(name: string, config: Record<string, any>): void;
export function setConfigSources(sources: Record<string, { source: string; value: any }>): void;

// Feature Flags
export function registerFeatureFlag(name: string, flag: { enabled: boolean; variant?: string; reason?: string }): void;

// Database
export function registerDatabase(name: string, db: any): void;

// Cache
export function registerCache(name: string, cache: any): void;

// Redis
export function registerRedisClient(name: string, client: any): void;

// WebSocket
export function registerWSServer(name: string, wss: any): void;
export function registerIO(name: string, io: any): void;

// Pool
export function registerPool(name: string, pool: any): void;

// Migrations
export function registerMigrationProvider(name: string, provider: { current: string | number; pending: string[]; history: Array<{ version: string; applied_at: string }> }): void;

// Locks
export function registerLock(name: string, lock: any): void;

// Endpoint Testing
export function getBaseUrl(): string;
export function setBaseUrl(url: string): void;
