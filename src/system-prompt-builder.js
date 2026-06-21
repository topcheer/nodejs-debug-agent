'use strict';

/**
 * Builds the system prompt dynamically from registered tools.
 *
 * Instead of hardcoding tool descriptions, this reads all registered tools
 * from the ToolRegistry and groups them by category for the LLM —
 * exactly matching the Spring agent's SystemPromptBuilder.
 */

const CATEGORY_MAP = {
  // Runtime / V8
  heap:           'Memory & GC',
  gc:             'Memory & GC',
  trigger:        'Memory & GC',
  v8:             'V8 Engine',
  // Process & Handles
  process:        'Process Info',
  active:         'Active Handles',
  event:          'Event Loop',
  resource:       'Process Info',
  // System
  system:         'System Info',
  cpu:            'System Info',
  disk:           'System Info',
  uptime:         'System Info',
  // Modules
  module:         'Module Info',
  loaded:         'Module Info',
  // Framework
  routes:         'Framework',
  middleware:     'Framework',
  installed:      'Dependencies',
  environment:    'Environment & Config',
  // HTTP
  recent:         'HTTP Requests',
  slow:           'HTTP Requests',
  error:          'HTTP Requests',
  request:        'HTTP Requests',
  // Database
  db:             'Database',
};

class SystemPromptBuilder {
  constructor(toolRegistry) {
    this.registry = toolRegistry;
  }

  build() {
    const categories = this._categorizeTools();

    let sb = '';
    sb += 'You are an expert Node.js runtime debugging assistant.\n';
    sb += 'You are running INSIDE the developer\'s Node.js application and have direct access\n';
    sb += 'to its runtime state through diagnostic tools.\n\n';
    sb += '## Your Capabilities\n';
    sb += 'You can call tools to inspect the live application. Here are ALL available tools,\n';
    sb += 'grouped by category:\n\n';

    for (const [category, tools] of Object.entries(categories)) {
      sb += `**${category}**\n`;
      for (const tool of tools) {
        sb += `- \`${tool.name}\`: ${this._truncate(tool.description)}\n`;
      }
      sb += '\n';
    }

    sb += '## Workflow\n';
    sb += '1. Understand the developer\'s problem description\n';
    sb += '2. Proactively call the most relevant tools to gather diagnostic data — DO NOT just ask questions\n';
    sb += '3. Analyze the collected data to identify root causes\n';
    sb += '4. Provide clear, actionable solutions with data evidence\n\n';
    sb += '## Guidelines\n';
    sb += '- Be proactive: gather data with tools before answering\n';
    sb += '- Always present data in a readable format (tables, bullet points)\n';
    sb += '- Respond in the same language the developer uses (Chinese/English/etc.)\n';
    sb += '- When you find a problem, explain the root cause and give concrete fix suggestions\n';
    sb += '- You can call multiple tools in parallel if they are independent\n';

    return sb;
  }

  _categorizeTools() {
    const categories = {};
    const schemas = this.registry.allSchemas();

    for (const schema of schemas) {
      const name = schema.function.name;
      const desc = schema.function.description;
      const category = this._extractCategory(name);

      if (!categories[category]) categories[category] = [];
      categories[category].push({ name, description: desc });
    }

    return categories;
  }

  _extractCategory(toolName) {
    const match = toolName.match(/^([a-z]+)_/);
    if (match) {
      const prefix = match[1];
      return CATEGORY_MAP[prefix] || 'Other Tools';
    }
    return 'Other Tools';
  }

  _truncate(desc) {
    if (!desc) return '';
    const period = desc.indexOf('.');
    if (period > 0 && period < 150) {
      return desc.substring(0, period + 1);
    }
    return desc.length > 120 ? desc.substring(0, 117) + '...' : desc;
  }
}

module.exports = { SystemPromptBuilder };
