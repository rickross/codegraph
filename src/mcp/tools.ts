/**
 * MCP Tool Definitions
 *
 * Defines the tools exposed by the CodeGraph MCP server.
 */

import CodeGraph from '../index';
import type { Node, SearchResult, Subgraph, TaskContext, NodeKind } from '../types';

/**
 * MCP Tool definition
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, PropertySchema>;
    required?: string[];
  };
}

interface PropertySchema {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

const TOOL_NAME_ALIASES: Record<string, string> = {
  codegraph_search: 'search',
  codegraph_context: 'context',
  codegraph_callers: 'callers',
  codegraph_callees: 'callees',
  codegraph_impact: 'impact',
  codegraph_node: 'node',
  codegraph_status: 'status',
  codegraph_get_root: 'get_root',
  codegraph_set_root: 'set_root',
  codegraph_init: 'init',
  codegraph_index: 'index',
  codegraph_sync: 'sync',
  codegraph_uninit: 'uninit',
};

export function normalizeToolName(toolName: string): string {
  return TOOL_NAME_ALIASES[toolName] ?? toolName;
}

/**
 * All CodeGraph MCP tools
 *
 * Designed for minimal context usage - use context as the primary tool,
 * and only use other tools for targeted follow-up queries.
 */
export const tools: ToolDefinition[] = [
  {
    name: 'search',
    description: 'Quick symbol search by name. Returns locations only (no code). Use context instead for comprehensive task context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Symbol name or partial name (e.g., "auth", "signIn", "UserService")',
        },
        kind: {
          type: 'string',
          description: 'Filter by node kind',
          enum: ['function', 'method', 'class', 'interface', 'type', 'variable', 'route', 'component'],
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 10)',
          default: 10,
        },
        language: {
          type: 'string',
          description: 'Filter by language (typescript, tsx, python, rust, etc.)',
        },
        pathHint: {
          type: 'string',
          description: 'Optional file path substring filter (e.g. "cli/cmd/tui")',
        },
        includeFiles: {
          type: 'boolean',
          description: 'Include file nodes in results (default: false)',
          default: false,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'context',
    description: 'PRIMARY TOOL: Build comprehensive context for a task. Returns entry points, related symbols, and key code - often enough to understand the codebase without additional tool calls. NOTE: This provides CODE context, not product requirements. For new features, still clarify UX/behavior questions with the user before implementing.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Description of the task, bug, or feature to build context for',
        },
        maxNodes: {
          type: 'number',
          description: 'Maximum symbols to include (default: 20)',
          default: 20,
        },
        kind: {
          type: 'string',
          description: 'Optional node kind filter for entry-point retrieval',
          enum: ['function', 'method', 'class', 'interface', 'type', 'variable', 'route', 'component'],
        },
        language: {
          type: 'string',
          description: 'Optional language filter for entry-point retrieval',
        },
        pathHint: {
          type: 'string',
          description: 'Optional file path substring filter for entry-point retrieval',
        },
        includeFiles: {
          type: 'boolean',
          description: 'Include file nodes as entry points',
          default: false,
        },
        includeCode: {
          type: 'boolean',
          description: 'Include code snippets for key symbols (default: true)',
          default: true,
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'callers',
    description: 'Find all functions/methods that call a specific symbol. Useful for understanding usage patterns and impact of changes.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Name of the function, method, or class to find callers for',
        },
        kind: {
          type: 'string',
          description: 'Optional kind to disambiguate symbol lookup',
          enum: ['function', 'method', 'class', 'interface', 'type', 'variable', 'route', 'component'],
        },
        pathHint: {
          type: 'string',
          description: 'Optional file path substring to disambiguate (e.g. "cli/cmd/tui")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of callers to return (default: 20)',
          default: 20,
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'callees',
    description: 'Find all functions/methods that a specific symbol calls. Useful for understanding dependencies and code flow.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Name of the function, method, or class to find callees for',
        },
        kind: {
          type: 'string',
          description: 'Optional kind to disambiguate symbol lookup',
          enum: ['function', 'method', 'class', 'interface', 'type', 'variable', 'route', 'component'],
        },
        pathHint: {
          type: 'string',
          description: 'Optional file path substring to disambiguate (e.g. "cli/cmd/tui")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of callees to return (default: 20)',
          default: 20,
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'impact',
    description: 'Analyze the impact radius of changing a symbol. Shows what code could be affected by modifications.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Name of the symbol to analyze impact for',
        },
        kind: {
          type: 'string',
          description: 'Optional kind to disambiguate symbol lookup',
          enum: ['function', 'method', 'class', 'interface', 'type', 'variable', 'route', 'component'],
        },
        pathHint: {
          type: 'string',
          description: 'Optional file path substring to disambiguate (e.g. "cli/cmd/tui")',
        },
        depth: {
          type: 'number',
          description: 'How many levels of dependencies to traverse (default: 2)',
          default: 2,
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'node',
    description: 'Get detailed information about a specific code symbol. Use includeCode=true only when you need the full source code - otherwise just get location and signature to minimize context usage.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Name of the symbol to get details for',
        },
        kind: {
          type: 'string',
          description: 'Optional kind to disambiguate symbol lookup',
          enum: ['function', 'method', 'class', 'interface', 'type', 'variable', 'route', 'component'],
        },
        pathHint: {
          type: 'string',
          description: 'Optional file path substring to disambiguate (e.g. "cli/cmd/tui")',
        },
        includeCode: {
          type: 'boolean',
          description: 'Include full source code (default: false to minimize context)',
          default: false,
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'status',
    description: 'Get the status of the CodeGraph index, including statistics about indexed files, nodes, and edges.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_root',
    description: 'Get the currently active root path.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_root',
    description: 'Switch to a different root. The root must already have CodeGraph initialized.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the root directory',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'init',
    description: 'Initialize CodeGraph in the current root. Creates .codegraph/ directory and database schema.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'index',
    description: 'Perform a full index of all files in the current root. The root must be initialized first.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'sync',
    description: 'Incrementally sync the current root index (only processes changed files since last index/sync). Much faster than full index.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'uninit',
    description: 'Remove CodeGraph from the current root. WARNING: Permanently deletes all CodeGraph data (.codegraph/ directory).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Tool handler that executes tools against a CodeGraph instance
 */
export class ToolHandler {
  constructor(private cg: CodeGraph) {}

  /**
   * Execute a tool by name
   */
  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const normalizedToolName = normalizeToolName(toolName);
      switch (normalizedToolName) {
        case 'search':
          return await this.handleSearch(args);
        case 'context':
          return await this.handleContext(args);
        case 'callers':
          return await this.handleCallers(args);
        case 'callees':
          return await this.handleCallees(args);
        case 'impact':
          return await this.handleImpact(args);
        case 'node':
          return await this.handleNode(args);
        case 'status':
          return await this.handleStatus();
        default:
          return this.errorResult(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.errorResult(`Tool execution failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handle codegraph_search
   */
  private async handleSearch(args: Record<string, unknown>): Promise<ToolResult> {
    const query = args.query as string;
    const inputKind = args.kind as string | undefined;
    const inputLanguage = args.language as string | undefined;
    const pathHint = (args.pathHint as string | undefined)?.trim();
    const limit = (args.limit as number) || 10;
    const inputIncludeFiles = args.includeFiles as boolean | undefined;
    const isBroadQuery = this.isBroadSearchQuery(query);
    const exploratorySearch = this.isExploratorySearchIntent(query);
    const focusedSearch = isBroadQuery && !exploratorySearch;
    const kind = inputKind ?? (focusedSearch ? 'function' : undefined);
    const language = inputLanguage;
    const includeFiles = inputIncludeFiles ?? (focusedSearch ? false : (isBroadQuery ? true : undefined));
    const autoNarrowNotes: string[] = [];

    let results = this.cg.searchNodes(query, {
      limit,
      kinds: kind ? [kind as NodeKind] : undefined,
      languages: language ? [language as Node['language']] : undefined,
      includePatterns: pathHint ? [`*${pathHint}*`] : undefined,
      includeFiles,
    });

    // Auto-narrow broad/ambiguous searches when pathHint wasn't provided.
    if (!pathHint && !exploratorySearch && results.length > 1) {
      const inferredPathHint = this.inferPathHintFromSearchResults(query, results);
      if (inferredPathHint) {
        const narrowed = this.cg.searchNodes(query, {
          limit,
          kinds: kind ? [kind as NodeKind] : undefined,
          languages: language ? [language as Node['language']] : undefined,
          includePatterns: [`*${inferredPathHint}*`],
          includeFiles,
        });

        if (this.shouldUseNarrowedSearchResults(query, results, narrowed)) {
          results = narrowed;
          autoNarrowNotes.push(`pathHint=${inferredPathHint}`);
        }
      }
    }

    if (results.length === 0) {
      return this.textResult(
        this.formatSearchNoResults(query, {
          kind,
          pathHint,
          intent: exploratorySearch ? 'discovery' : 'focused',
        })
      );
    }

    const formatted = this.formatSearchResults(results);
    const prefixLines: string[] = [];
    if (autoNarrowNotes.length > 0) {
      prefixLines.push(`ℹ Auto-narrowed search: ${autoNarrowNotes.join(', ')}`);
    }
    const prefix = prefixLines.length > 0 ? `${prefixLines.join('\n')}\n\n` : '';
    return this.textResult(prefix + formatted);
  }

  /**
   * Handle codegraph_context
   */
  private async handleContext(args: Record<string, unknown>): Promise<ToolResult> {
    const task = args.task as string;
    const maxNodes = (args.maxNodes as number) || 20;
    const inputKind = args.kind as string | undefined;
    const inputLanguage = args.language as Node['language'] | undefined;
    const inputPathHint = (args.pathHint as string | undefined)?.trim();
    const inputIncludeFiles = args.includeFiles as boolean | undefined;
    const includeCode = args.includeCode !== false;
    const exploratoryTask = this.isExploratoryTaskIntent(task);

    // Autopilot defaults:
    // - focused tasks: narrow aggressively
    // - discovery tasks: keep breadth for foothold building
    const kind = inputKind ?? (exploratoryTask ? undefined : 'function');
    const language = inputLanguage ?? (exploratoryTask ? undefined : this.inferPrimaryLanguage());
    const includeFiles = inputIncludeFiles ?? (exploratoryTask ? true : false);
    const pathHint = inputPathHint ?? (exploratoryTask ? undefined : this.inferPathHintFromTask(task, kind, language));

    const autoScopeNotes: string[] = [];
    if (!inputPathHint && pathHint) autoScopeNotes.push(`pathHint=${pathHint}`);

    const context = await this.cg.buildContext(task, {
      maxNodes,
      nodeKinds: kind ? [kind as NodeKind] : undefined,
      language,
      pathHint,
      includeFiles,
      includeCode,
      format: 'markdown',
    });

    // Detect if this looks like a feature request (vs bug fix or exploration)
    const isFeatureQuery = this.looksLikeFeatureRequest(task);
    const reminder = isFeatureQuery
      ? '\n\n⚠️ **Ask user:** UX preferences, edge cases, acceptance criteria'
      : '';
    const scopePrefix = autoScopeNotes.length > 0
      ? `ℹ Auto-scope applied: ${autoScopeNotes.join(', ')}\n\n`
      : '';

    // buildContext returns string when format is 'markdown'
    if (typeof context === 'string') {
      return this.textResult(scopePrefix + context + reminder);
    }

    // If it returns TaskContext, format it
    return this.textResult(scopePrefix + this.formatTaskContext(context) + reminder);
  }

  /**
   * Heuristic to detect if a query looks like a feature request
   */
  private looksLikeFeatureRequest(task: string): boolean {
    const featureKeywords = [
      'add', 'create', 'implement', 'build', 'enable', 'allow',
      'new feature', 'support for', 'ability to', 'want to',
      'should be able', 'need to add', 'swap', 'edit', 'modify'
    ];
    const bugKeywords = [
      'fix', 'bug', 'error', 'broken', 'crash', 'issue', 'problem',
      'not working', 'fails', 'undefined', 'null'
    ];
    const explorationKeywords = [
      'how does', 'where is', 'what is', 'find', 'show me',
      'explain', 'understand', 'explore'
    ];

    const lowerTask = task.toLowerCase();

    // If it's clearly a bug or exploration, not a feature
    if (bugKeywords.some(k => lowerTask.includes(k))) return false;
    if (explorationKeywords.some(k => lowerTask.includes(k))) return false;

    // If it matches feature keywords, it's likely a feature request
    return featureKeywords.some(k => lowerTask.includes(k));
  }

  private isExploratoryTaskIntent(task: string): boolean {
    const lower = task.toLowerCase();
    const exploratoryKeywords = [
      'overview',
      'architecture',
      'high level',
      'high-level',
      'foothold',
      'where to start',
      'main modules',
      'entry points',
      'explore',
      'map the codebase',
      'understand project',
      'understand codebase',
      'survey',
    ];
    return exploratoryKeywords.some((keyword) => lower.includes(keyword));
  }

  private isExploratorySearchIntent(query: string): boolean {
    const lower = query.toLowerCase();
    const focusedVerbPatterns = [
      'trace ', 'debug', 'fix ', 'implement', 'refactor', 'call chain',
      'impact', 'break', 'failing', 'where does', 'how does'
    ];
    if (focusedVerbPatterns.some((pattern) => lower.includes(pattern))) {
      return false;
    }

    const exploratoryKeywords = [
      'overview',
      'architecture',
      'entry point',
      'entry points',
      'module',
      'modules',
      'where to start',
      'foothold',
      'explore',
      'survey',
      'map',
    ];
    if (exploratoryKeywords.some((keyword) => lower.includes(keyword))) {
      return true;
    }

    // Noun-like broad phrases are often discovery-oriented (e.g. "tui session", "auth flow").
    const terms = this.extractQueryTerms(query);
    if (terms.length >= 2) {
      return true;
    }

    return false;
  }

  private formatSearchNoResults(
    query: string,
    options: {
      kind?: string;
      pathHint?: string;
      intent: 'discovery' | 'focused';
    }
  ): string {
    const escaped = query.replace(/"/g, '\\"');
    const lines = [
      `No results found for "${query}"`,
      '',
      'Suggested retries:',
    ];

    if (options.pathHint) {
      lines.push(`- search(query="${escaped}", kind="${options.kind ?? 'function'}", limit=20)`);
      lines.push(`- search(query="${escaped}", pathHint="${options.pathHint}", includeFiles=true, limit=20)`);
    } else {
      lines.push(`- search(query="${escaped}", kind="${options.kind ?? 'function'}", limit=20)`);
      lines.push(`- search(query="${escaped}", includeFiles=true, limit=20)`);
      lines.push(`- context(task="Find where ${query} is implemented", maxNodes=20, includeCode=false)`);
    }

    if (options.intent === 'focused') {
      lines.push(`- search(query="${escaped}", kind="${options.kind ?? 'method'}", pathHint="server/routes", limit=20)`);
    } else {
      lines.push(`- search(query="${escaped}", limit=25)`);
    }

    return lines.join('\n');
  }

  /**
   * Handle codegraph_callers
   */
  private async handleCallers(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = args.symbol as string;
    const kind = args.kind as string | undefined;
    const pathHint = args.pathHint as string | undefined;
    const limit = (args.limit as number) || 20;

    const resolved = this.resolveSymbolNode(symbol, kind, pathHint);
    if (!resolved.node) {
      return this.textResult(resolved.message ?? `Symbol "${symbol}" not found in the codebase`);
    }

    const node = resolved.node;
    const callers = this.cg.getCallers(node.id);

    if (callers.length === 0) {
      return this.textResult(this.formatNoCallersFound(symbol, kind, pathHint));
    }

    // Extract just the nodes from the { node, edge } tuples
    const callerNodes = callers.slice(0, limit).map(c => c.node);
    const formatted = this.formatNodeList(callerNodes, `Callers of ${symbol}`);
    return this.textResult(formatted);
  }

  /**
   * Handle codegraph_callees
   */
  private async handleCallees(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = args.symbol as string;
    const kind = args.kind as string | undefined;
    const pathHint = args.pathHint as string | undefined;
    const limit = (args.limit as number) || 20;

    const resolved = this.resolveSymbolNode(symbol, kind, pathHint);
    if (!resolved.node) {
      return this.textResult(resolved.message ?? `Symbol "${symbol}" not found in the codebase`);
    }

    const node = resolved.node;
    const callees = this.cg.getCallees(node.id);

    if (callees.length === 0) {
      return this.textResult(this.formatNoCalleesFound(symbol, kind, pathHint));
    }

    // Extract just the nodes from the { node, edge } tuples
    const calleeNodes = callees.slice(0, limit).map(c => c.node);
    const formatted = this.formatNodeList(calleeNodes, `Callees of ${symbol}`);
    return this.textResult(formatted);
  }

  /**
   * Handle codegraph_impact
   */
  private async handleImpact(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = args.symbol as string;
    const kind = args.kind as string | undefined;
    const pathHint = args.pathHint as string | undefined;
    const depth = (args.depth as number) || 2;

    const resolved = this.resolveSymbolNode(symbol, kind, pathHint);
    if (!resolved.node) {
      return this.textResult(resolved.message ?? `Symbol "${symbol}" not found in the codebase`);
    }

    const node = resolved.node;
    const impact = this.cg.getImpactRadius(node.id, depth);

    const formatted = this.formatImpact(symbol, impact);
    return this.textResult(formatted);
  }

  /**
   * Handle codegraph_node
   */
  private async handleNode(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = args.symbol as string;
    const kind = args.kind as string | undefined;
    const pathHint = args.pathHint as string | undefined;
    // Default to false to minimize context usage
    const includeCode = args.includeCode === true;

    const resolved = this.resolveSymbolNode(symbol, kind, pathHint);
    if (!resolved.node) {
      return this.textResult(resolved.message ?? `Symbol "${symbol}" not found in the codebase`);
    }

    const node = resolved.node;
    let code: string | null = null;

    if (includeCode) {
      code = await this.cg.getCode(node.id);
    }

    const formatted = this.formatNodeDetails(node, code);
    return this.textResult(formatted);
  }

  private resolveSymbolNode(
    symbol: string,
    kind?: string,
    pathHint?: string
  ): { node?: Node; message?: string } {
    const results = this.cg.searchNodes(symbol, {
      limit: 25,
      kinds: kind ? [kind as NodeKind] : undefined,
    });

    const hint = pathHint?.trim().toLowerCase();
    const filtered = hint
      ? results.filter((r) => r.node.filePath.toLowerCase().includes(hint))
      : results;

    if (filtered.length === 0) {
      if (hint) {
        return { message: this.formatSymbolNotFound(symbol, kind, pathHint) };
      }
      return { message: this.formatSymbolNotFound(symbol, kind) };
    }

    const normalizedSymbol = symbol.trim().toLowerCase();
    const exactMatches = filtered.filter((r) => r.node.name.toLowerCase() === normalizedSymbol);
    if (exactMatches.length === 1) {
      return { node: exactMatches[0]!.node };
    }

    if (exactMatches.length > 1) {
      if (!kind && !hint) {
        const inferredPathHint = this.inferPathHintFromSearchResults(symbol, exactMatches);
        if (inferredPathHint) {
          const narrowed = this.cg.searchNodes(symbol, {
            limit: 25,
            kinds: kind ? [kind as NodeKind] : undefined,
            includePatterns: [`*${inferredPathHint}*`],
          });
          const narrowedExact = narrowed.filter(
            (r) => r.node.name.toLowerCase() === normalizedSymbol
          );
          if (narrowedExact.length === 1) {
            return { node: narrowedExact[0]!.node };
          }
        }
      }

      const sortedExact = [...exactMatches].sort((a, b) => b.score - a.score);
      const top = sortedExact[0]!;
      const second = sortedExact[1];
      // Autopick only when confidence is very high and user did not provide disambiguation hints.
      if (!kind && !hint && second && top.score - second.score >= 0.3) {
        return { node: top.node };
      }
      return { message: this.formatAmbiguousSymbol(symbol, sortedExact) };
    }

    if (filtered.length === 1) {
      return { node: filtered[0]!.node };
    }

    const top = filtered[0]!;
    const second = filtered[1];
    if (!second || top.score - second.score >= 0.2) {
      return { node: top.node };
    }

    return { message: this.formatAmbiguousSymbol(symbol, filtered) };
  }

  private formatSymbolNotFound(symbol: string, kind?: string, pathHint?: string): string {
    const lines = [
      pathHint
        ? `Symbol "${symbol}" not found with path hint "${pathHint}".`
        : `Symbol "${symbol}" not found in the codebase.`,
      '',
      'Suggested retries:',
    ];

    const escaped = symbol.replace(/"/g, '\\"');
    if (pathHint) {
      lines.push(`- search(query="${escaped}", kind="${kind ?? 'function'}", limit=15)`);
      lines.push(`- search(query="${escaped}", pathHint="${pathHint}", includeFiles=true, limit=20)`);
      lines.push(`- search(query="${escaped}", kind="${kind ?? 'method'}", limit=15)`);
    } else {
      lines.push(`- search(query="${escaped}", kind="${kind ?? 'function'}", limit=15)`);
      lines.push(`- search(query="${escaped}", includeFiles=true, limit=20)`);
      lines.push(`- context(task="Find where ${symbol} is implemented", maxNodes=20, includeCode=false)`);
    }

    return lines.join('\n');
  }

  private formatNoCallersFound(symbol: string, kind?: string, pathHint?: string): string {
    const escaped = symbol.replace(/"/g, '\\"');
    const lines = [
      `No callers found for "${symbol}"`,
      '',
      'Suggested retries:',
      `- node(symbol="${escaped}", kind="${kind ?? 'function'}"${pathHint ? `, pathHint="${pathHint}"` : ''}, includeCode=true)`,
      `- search(query="${escaped}", kind="${kind ?? 'function'}"${pathHint ? `, pathHint="${pathHint}"` : ''}, limit=20)`,
      `- impact(symbol="${escaped}"${kind ? `, kind="${kind}"` : ''}${pathHint ? `, pathHint="${pathHint}"` : ''}, depth=2)`,
    ];

    return lines.join('\n');
  }

  private formatNoCalleesFound(symbol: string, kind?: string, pathHint?: string): string {
    const escaped = symbol.replace(/"/g, '\\"');
    const lines = [
      `No callees found for "${symbol}"`,
      '',
      'Suggested retries:',
      `- node(symbol="${escaped}", kind="${kind ?? 'function'}"${pathHint ? `, pathHint="${pathHint}"` : ''}, includeCode=true)`,
      `- search(query="${escaped}", kind="${kind ?? 'function'}"${pathHint ? `, pathHint="${pathHint}"` : ''}, limit=20)`,
      `- impact(symbol="${escaped}"${kind ? `, kind="${kind}"` : ''}${pathHint ? `, pathHint="${pathHint}"` : ''}, depth=2)`,
    ];

    return lines.join('\n');
  }

  private formatAmbiguousSymbol(symbol: string, matches: SearchResult[]): string {
    const lines = [
      `Ambiguous symbol "${symbol}" (${matches.length} matches).`,
      'Provide `kind` and/or `pathHint` to disambiguate. Top matches:',
      '',
    ];

    for (const match of matches.slice(0, 8)) {
      const node = match.node;
      const location = node.startLine ? `:${node.startLine}` : '';
      lines.push(`- ${node.name} (${node.kind}) - ${node.filePath}${location}`);
    }

    lines.push('', 'Suggested retries:');
    for (const match of matches.slice(0, 3)) {
      const node = match.node;
      const suggestedPathHint = this.suggestPathHint(node.filePath);
      lines.push(
        `- node(symbol="${symbol}", kind="${node.kind}", pathHint="${suggestedPathHint}", includeCode=false)`
      );
    }

    return lines.join('\n');
  }

  private inferPrimaryLanguage(): Node['language'] | undefined {
    const stats = this.cg.getStats();
    let best: Node['language'] | undefined;
    let bestCount = 0;

    for (const [language, count] of Object.entries(stats.filesByLanguage)) {
      const numericCount = Number(count);
      if (numericCount > bestCount) {
        best = language as Node['language'];
        bestCount = numericCount;
      }
    }

    return bestCount > 0 ? best : undefined;
  }

  private inferPathHintFromTask(
    task: string,
    kind?: string,
    language?: Node['language']
  ): string | undefined {
    const results = this.cg.searchNodes(task, {
      limit: 40,
      kinds: kind ? [kind as NodeKind] : undefined,
      languages: language ? [language] : undefined,
      includeFiles: true,
    });

    if (results.length < 2) {
      return undefined;
    }

    const terms = this.extractQueryTerms(task);
    const scoreBySubpath = new Map<string, number>();
    const countBySubpath = new Map<string, number>();

    for (const result of results.slice(0, 25)) {
      const directories = result.node.filePath
        .toLowerCase()
        .split('/')
        .filter(Boolean)
        .slice(0, -1);

      for (let len = 2; len <= 4; len++) {
        for (let i = 0; i <= directories.length - len; i++) {
          const subpath = directories.slice(i, i + len).join('/');
          let score =
            result.score *
            this.pathQualityMultiplier(result.node.filePath) *
            this.pathQualityMultiplier(subpath) *
            (1 + (len - 2) * 0.25);
          if (terms.some((term) => subpath.includes(term))) {
            score *= 1.35;
          }

          scoreBySubpath.set(subpath, (scoreBySubpath.get(subpath) ?? 0) + score);
          countBySubpath.set(subpath, (countBySubpath.get(subpath) ?? 0) + 1);
        }
      }
    }

    const ranked = Array.from(scoreBySubpath.entries())
      .filter(([subpath]) => (countBySubpath.get(subpath) ?? 0) >= 2)
      .sort((a, b) => b[1] - a[1]);

    let bestPath = ranked[0]?.[0];
    const bestScore = ranked[0]?.[1] ?? 0;
    if (bestPath && this.isDisfavoredPath(bestPath) && !this.hasInfraIntent(terms)) {
      const fallback = ranked.find(([subpath, score]) => {
        if (this.isDisfavoredPath(subpath)) return false;
        return score >= bestScore * 0.65;
      });
      if (fallback) {
        bestPath = fallback[0];
      }
    }

    return bestPath;
  }

  private inferPathHintFromSearchResults(query: string, results: SearchResult[]): string | undefined {
    if (results.length < 2) return undefined;

    const normalizedQuery = query.trim().toLowerCase();
    const exactMatches = results.filter((r) => r.node.name.toLowerCase() === normalizedQuery);
    const candidates = exactMatches.length >= 2 ? exactMatches : results.slice(0, 12);
    if (candidates.length < 2) return undefined;

    const terms = this.extractQueryTerms(query);
    const scoreByPath = new Map<string, number>();
    const countByPath = new Map<string, number>();

    for (const result of candidates) {
      const node = result.node;
      const hint = this.suggestPathHint(node.filePath);
      let score = result.score * this.pathQualityMultiplier(node.filePath);
      if (exactMatches.includes(result)) score *= 1.25;
      if (terms.some((term) => hint.includes(term))) score *= 1.2;

      scoreByPath.set(hint, (scoreByPath.get(hint) ?? 0) + score);
      countByPath.set(hint, (countByPath.get(hint) ?? 0) + 1);
    }

    const ranked = Array.from(scoreByPath.entries()).sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    const second = ranked[1];
    if (!top) return undefined;

    const topCount = countByPath.get(top[0]) ?? 0;
    if (topCount < 1) return undefined;
    if (second && top[1] < second[1] * 1.2) return undefined;

    if (this.isDisfavoredPath(top[0]) && !this.hasInfraIntent(terms)) {
      const fallback = ranked.find(([hint, score]) => {
        if (this.isDisfavoredPath(hint)) return false;
        return score >= top[1] * 0.7;
      });
      if (fallback) return fallback[0];
    }

    return top[0];
  }

  private shouldUseNarrowedSearchResults(
    query: string,
    original: SearchResult[],
    narrowed: SearchResult[]
  ): boolean {
    if (narrowed.length === 0) return false;

    const normalizedQuery = query.trim().toLowerCase();
    const originalExact = original.filter((r) => r.node.name.toLowerCase() === normalizedQuery).length;
    const narrowedExact = narrowed.filter((r) => r.node.name.toLowerCase() === normalizedQuery).length;

    if (originalExact > 1 && narrowedExact === 1) {
      return true;
    }

    const originalTop = original[0];
    const narrowedTop = narrowed[0];
    if (!originalTop || !narrowedTop) return false;

    const originalQuality = this.pathQualityMultiplier(originalTop.node.filePath);
    const narrowedQuality = this.pathQualityMultiplier(narrowedTop.node.filePath);

    if (narrowedQuality > originalQuality + 0.2 && narrowedTop.score >= originalTop.score * 0.75) {
      return true;
    }

    return false;
  }

  private extractQueryTerms(query: string): string[] {
    const stopWords = new Set([
      'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'does', 'find', 'for',
      'from', 'how', 'in', 'is', 'it', 'of', 'on', 'or', 'show', 'the', 'to',
      'trace', 'understand', 'what', 'where', 'with',
    ]);

    const cleaned = query
      .toLowerCase()
      .replace(/[^a-z0-9_/-]+/g, ' ')
      .trim();

    if (!cleaned) return [];

    return Array.from(
      new Set(
        cleaned
          .split(/\s+/)
          .map((part) => part.replace(/^[-_/]+|[-_/]+$/g, ''))
          .filter((part) => part.length >= 3)
          .filter((part) => !stopWords.has(part))
      )
    );
  }

  private isBroadSearchQuery(query: string): boolean {
    const trimmed = query.trim();
    if (!trimmed || this.isFileIntentQuery(trimmed)) {
      return false;
    }

    const terms = this.extractQueryTerms(trimmed);
    return terms.length >= 2 || /\s/.test(trimmed);
  }

  private isFileIntentQuery(query: string): boolean {
    const trimmed = query.trim();
    if (!trimmed) return false;
    return /[\\/]/.test(trimmed) || /\.[a-z0-9]{1,8}$/i.test(trimmed);
  }

  private pathQualityMultiplier(pathValue: string): number {
    const value = pathValue.toLowerCase();
    let multiplier = 1.0;

    if (this.isDisfavoredPath(value)) {
      multiplier *= 0.5;
    }
    if (/(^|\/)sdk(\/|$)/.test(value)) {
      multiplier *= 0.7;
    }
    if (/(^|\/)src(\/|$)/.test(value)) {
      multiplier *= 1.12;
    }
    if (/(^|\/)(app|server|routes|cli|core|session)(\/|$)/.test(value)) {
      multiplier *= 1.1;
    }
    if (/(^|\/)(__tests__|test|tests)(\/|$)/.test(value)) {
      multiplier *= 0.85;
    }

    return Math.max(0.2, Math.min(1.5, multiplier));
  }

  private isDisfavoredPath(pathValue: string): boolean {
    const value = pathValue.toLowerCase();
    return (
      /(^|\/)(gen|generated|dist|build|coverage|vendor|node_modules)(\/|$)/.test(value) ||
      value.includes('.gen.')
    );
  }

  private hasInfraIntent(terms: string[]): boolean {
    const infraTerms = new Set(['sdk', 'generated', 'gen', 'vendor', 'dist', 'build', 'node_modules']);
    return terms.some((term) => infraTerms.has(term));
  }

  private suggestPathHint(filePath: string): string {
    const segments = filePath.split('/').filter(Boolean);
    if (segments.length <= 2) return filePath;

    const srcIndex = segments.findIndex((seg) => seg === 'src');
    if (srcIndex >= 0 && srcIndex < segments.length - 2) {
      return segments.slice(srcIndex + 1, Math.min(srcIndex + 5, segments.length - 1)).join('/');
    }

    return segments.slice(Math.max(0, segments.length - 4), segments.length - 1).join('/');
  }

  /**
   * Handle codegraph_status
   */
  private async handleStatus(): Promise<ToolResult> {
    const stats = this.cg.getStats();

    const lines: string[] = [
      '## CodeGraph Status',
      '',
      `**Files indexed:** ${stats.fileCount}`,
      `**Total nodes:** ${stats.nodeCount}`,
      `**Total edges:** ${stats.edgeCount}`,
      `**Database size:** ${(stats.dbSizeBytes / 1024 / 1024).toFixed(2)} MB`,
      '',
      '### Nodes by Kind:',
    ];

    for (const [kind, count] of Object.entries(stats.nodesByKind)) {
      if ((count as number) > 0) {
        lines.push(`- ${kind}: ${count}`);
      }
    }

    lines.push('', '### Languages:');
    for (const [lang, count] of Object.entries(stats.filesByLanguage)) {
      if ((count as number) > 0) {
        lines.push(`- ${lang}: ${count}`);
      }
    }

    return this.textResult(lines.join('\n'));
  }

  // =========================================================================
  // Formatting helpers (compact by default to reduce context usage)
  // =========================================================================

  private formatSearchResults(results: SearchResult[]): string {
    const lines: string[] = [`## Search Results (${results.length} found)`, ''];

    for (const result of results) {
      const { node } = result;
      const location = node.startLine ? `:${node.startLine}` : '';
      // Compact format: one line per result with key info
      lines.push(`### ${node.name} (${node.kind})`);
      lines.push(`${node.filePath}${location}`);
      if (node.signature) lines.push(`\`${node.signature}\``);
      lines.push('');
    }

    return lines.join('\n');
  }

  private formatNodeList(nodes: Node[], title: string): string {
    const lines: string[] = [`## ${title} (${nodes.length} found)`, ''];

    for (const node of nodes) {
      const location = node.startLine ? `:${node.startLine}` : '';
      // Compact: just name, kind, location
      lines.push(`- ${node.name} (${node.kind}) - ${node.filePath}${location}`);
    }

    return lines.join('\n');
  }

  private formatImpact(symbol: string, impact: Subgraph): string {
    const nodeCount = impact.nodes.size;

    // Compact format: just list affected symbols grouped by file
    const lines: string[] = [
      `## Impact: "${symbol}" affects ${nodeCount} symbols`,
      '',
    ];

    // Group by file
    const byFile = new Map<string, Node[]>();
    for (const node of impact.nodes.values()) {
      const existing = byFile.get(node.filePath) || [];
      existing.push(node);
      byFile.set(node.filePath, existing);
    }

    for (const [file, nodes] of byFile) {
      lines.push(`**${file}:**`);
      // Compact: inline list
      const nodeList = nodes.map(n => `${n.name}:${n.startLine}`).join(', ');
      lines.push(nodeList);
      lines.push('');
    }

    return lines.join('\n');
  }

  private formatNodeDetails(node: Node, code: string | null): string {
    const location = node.startLine ? `:${node.startLine}` : '';
    const lines: string[] = [
      `## ${node.name} (${node.kind})`,
      '',
      `**Location:** ${node.filePath}${location}`,
    ];

    if (node.signature) {
      lines.push(`**Signature:** \`${node.signature}\``);
    }

    // Only include docstring if it's short and useful
    if (node.docstring && node.docstring.length < 200) {
      lines.push('', node.docstring);
    }

    if (code) {
      lines.push('', '```' + node.language, code, '```');
    }

    return lines.join('\n');
  }

  private formatTaskContext(context: TaskContext): string {
    return context.summary || 'No context found';
  }

  private textResult(text: string): ToolResult {
    return {
      content: [{ type: 'text', text }],
    };
  }

  private errorResult(message: string): ToolResult {
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
}
