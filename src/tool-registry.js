'use strict';

/**
 * Global tool registry. Tools are registered via `debugTool()` decorator.
 */

class ToolParam {
  constructor(description, opts = {}) {
    this.description = description;
    this.required = opts.required !== false;
  }
}

class ToolDefinition {
  constructor(name, description, func, params = {}) {
    this.name = name;
    this.description = description;
    this.func = func;
    this.params = params; // { paramName: { type, description, required } }
  }

  schema() {
    const properties = {};
    const required = [];

    for (const [pname, pmeta] of Object.entries(this.params)) {
      properties[pname] = {
        type: pmeta.type || 'string',
        description: pmeta.description || '',
      };
      if (pmeta.required !== false) {
        required.push(pname);
      }
    }

    // Also check function signature for unlisted params
    const fnStr = this.func.toString();
    const match = fnStr.match(/\(([^)]*)\)/);
    if (match) {
      const fnParams = match[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const fp of fnParams) {
        const cleanName = fp.split('=')[0].trim().replace(/[{}]/g, '').trim();
        if (cleanName && !properties[cleanName] && cleanName !== 'ctx') {
          // Extract from destructuring
          if (cleanName.includes('...')) continue;
          properties[cleanName] = { type: 'string', description: '' };
          // Check if it has a default value
          if (!fp.includes('=')) {
            required.push(cleanName);
          }
        }
      }
    }

    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties,
          required,
        },
      },
    };
  }

  async execute(args = {}) {
    return await this.func(args);
  }
}

class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    this.tools.set(tool.name, tool);
  }

  get(name) {
    return this.tools.get(name);
  }

  allSchemas() {
    return Array.from(this.tools.values()).map(t => t.schema());
  }

  async execute(name, args) {
    const tool = this.tools.get(name);
    if (!tool) return { error: `Unknown tool: ${name}` };
    try {
      return await tool.execute(args);
    } catch (e) {
      return { error: e.message };
    }
  }

  names() {
    return Array.from(this.tools.keys());
  }
}

const registry = new ToolRegistry();

/**
 * Decorator to register a debug tool.
 * @param {string} name - Tool name
 * @param {string} description - Tool description
 * @param {object} params - Parameter metadata { paramName: { type, description, required } }
 */
function debugTool(name, description, params = {}) {
  return function (target, key, descriptor) {
    const func = descriptor ? descriptor.value : target;
    const tool = new ToolDefinition(name, description, func, params);
    registry.register(tool);
    return descriptor || func;
  };
}

module.exports = { ToolParam, ToolDefinition, ToolRegistry, registry, debugTool };
