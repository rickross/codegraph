/**
 * CodeGraph MCP Server
 *
 * Model Context Protocol server that exposes CodeGraph functionality
 * as tools for AI assistants like Claude.
 *
 * @module mcp
 *
 * @example
 * ```typescript
 * import { MCPServer } from 'codegraph';
 *
 * const server = new MCPServer('/path/to/project');
 * await server.start();
 * ```
 */

import CodeGraph from '../index';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { StdioTransport, JsonRpcRequest, JsonRpcNotification, ErrorCodes } from './transport';
import { tools, ToolHandler, normalizeToolName } from './tools';

/**
 * MCP Server Info
 */
const SERVER_INFO = {
  name: 'codegraph',
  version: getServerVersion(),
};

/**
 * MCP Protocol Version
 */
const PROTOCOL_VERSION = '2024-11-05';

/**
 * Build MCP server version string.
 *
 * Priority:
 * 1. CODEGRAPH_BUILD_VERSION (full override)
 * 2. package.json version + optional CODEGRAPH_VERSION_SUFFIX
 * 3. package.json version + git metadata (+g<sha>[.dirty]) when available
 */
function getServerVersion(): string {
  const buildVersion = process.env.CODEGRAPH_BUILD_VERSION?.trim();
  if (buildVersion) {
    return buildVersion;
  }

  const packagePath = path.join(__dirname, '..', '..', 'package.json');
  let baseVersion = '0.0.0';
  try {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8')) as { version?: string };
    if (packageJson.version) {
      baseVersion = packageJson.version;
    }
  } catch {
    // Fall back to default version
  }

  const suffix = process.env.CODEGRAPH_VERSION_SUFFIX?.trim();
  if (suffix) {
    const normalized = suffix.startsWith('+') || suffix.startsWith('-') ? suffix : `+${suffix}`;
    return `${baseVersion}${normalized}`;
  }

  const gitMetadata = getGitMetadata(path.dirname(packagePath));
  if (!gitMetadata) {
    return baseVersion;
  }

  return `${baseVersion}+${gitMetadata}`;
}

/**
 * Return git build metadata ("g<sha>" or "g<sha>.dirty") when running in a git checkout.
 */
function getGitMetadata(repoRoot: string): string | null {
  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    return null;
  }

  try {
    const shortSha = execSync('git rev-parse --short HEAD', {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();

    if (!shortSha) {
      return null;
    }

    const dirty = execSync('git status --porcelain', {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim().length > 0;

    return dirty ? `g${shortSha}.dirty` : `g${shortSha}`;
  } catch {
    return null;
  }
}

/**
 * MCP Server for CodeGraph
 *
 * Implements the Model Context Protocol to expose CodeGraph
 * functionality as tools that can be called by AI assistants.
 */
export class MCPServer {
  private transport: StdioTransport;
  private cg: CodeGraph | null = null;
  private toolHandler: ToolHandler | null = null;
  private projectPath: string | null;
  private initError: string | null = null;

  constructor(projectPath?: string) {
    this.projectPath = projectPath || null;
    this.transport = new StdioTransport();
  }

  /**
   * Start the MCP server
   *
   * Note: CodeGraph initialization is deferred until the initialize request
   * is received, which includes the rootUri from the client.
   */
  async start(): Promise<void> {
    // Start listening for messages immediately - don't check initialization yet
    // We'll get the project path from the initialize request's rootUri
    this.transport.start(this.handleMessage.bind(this));

    // Keep the process running
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  /**
   * Initialize CodeGraph for the project
   */
  private async initializeCodeGraph(projectPath: string): Promise<void> {
    this.projectPath = projectPath;

    if (!CodeGraph.isInitialized(projectPath)) {
      this.initError = `CodeGraph not initialized in ${projectPath}. Run init to initialize it first.`;
      return;
    }

    try {
      this.cg = await CodeGraph.open(projectPath);
      this.toolHandler = new ToolHandler(this.cg, SERVER_INFO.version);
      this.initError = null;
    } catch (err) {
      this.initError = `Failed to open CodeGraph: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.cg) {
      this.cg.close();
      this.cg = null;
    }
    this.transport.stop();
    process.exit(0);
  }

  /**
   * Handle incoming JSON-RPC messages
   */
  private async handleMessage(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    // Check if it's a request (has id) or notification (no id)
    const isRequest = 'id' in message;

    switch (message.method) {
      case 'initialize':
        if (isRequest) {
          await this.handleInitialize(message as JsonRpcRequest);
        }
        break;

      case 'initialized':
        // Notification that client has finished initialization
        // No action needed - the client is ready
        break;

      case 'tools/list':
        if (isRequest) {
          await this.handleToolsList(message as JsonRpcRequest);
        }
        break;

      case 'tools/call':
        if (isRequest) {
          await this.handleToolsCall(message as JsonRpcRequest);
        }
        break;

      case 'ping':
        if (isRequest) {
          this.transport.sendResult((message as JsonRpcRequest).id, {});
        }
        break;

      default:
        if (isRequest) {
          this.transport.sendError(
            (message as JsonRpcRequest).id,
            ErrorCodes.MethodNotFound,
            `Method not found: ${message.method}`
          );
        }
    }
  }

  /**
   * Handle initialize request
   */
  private async handleInitialize(request: JsonRpcRequest): Promise<void> {
    const params = request.params as {
      rootUri?: string;
      workspaceFolders?: Array<{ uri: string; name: string }>;
    } | undefined;

    // Extract project path from rootUri or workspaceFolders
    let projectPath = this.projectPath;

    if (params?.rootUri) {
      // Convert file:// URI to path
      projectPath = params.rootUri.replace(/^file:\/\//, '');
    } else if (params?.workspaceFolders?.[0]?.uri) {
      projectPath = params.workspaceFolders[0].uri.replace(/^file:\/\//, '');
    }

    // Fall back to current working directory if no path provided
    if (!projectPath) {
      projectPath = process.cwd();
    }

    // Initialize CodeGraph if we have a project path
    await this.initializeCodeGraph(projectPath);

    // We accept the client's protocol version but respond with our supported version
    this.transport.sendResult(request.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo: SERVER_INFO,
    });
  }

  /**
   * Handle tools/list request
   */
  private async handleToolsList(request: JsonRpcRequest): Promise<void> {
    this.transport.sendResult(request.id, {
      tools: tools,
    });
  }

  /**
   * Handle tools/call request
   */
  private async handleToolsCall(request: JsonRpcRequest): Promise<void> {
    const params = request.params as {
      name: string;
      arguments?: Record<string, unknown>;
    };

    if (!params || !params.name) {
      this.transport.sendError(
        request.id,
        ErrorCodes.InvalidParams,
        'Missing tool name'
      );
      return;
    }

    const toolName = params.name;
    const normalizedToolName = normalizeToolName(toolName);
    const toolArgs = params.arguments || {};

    // Validate tool exists (legacy codegraph_* names are normalized to canonical names)
    const tool = tools.find(t => t.name === normalizedToolName);
    if (!tool) {
      this.transport.sendError(
        request.id,
        ErrorCodes.InvalidParams,
        `Unknown tool: ${toolName}`
      );
      return;
    }

    // Handle get_project - return current project path
    if (normalizedToolName === 'get_root') {
      const result = {
        content: [{
          type: 'text' as const,
          text: this.projectPath || 'No root currently set'
        }]
      };
      this.transport.sendResult(request.id, result);
      return;
    }

    // Handle set_root specially - needs to reinitialize CodeGraph
    if (normalizedToolName === 'set_root') {
      try {
        const newPath = toolArgs.path as string;
        if (!newPath) {
          this.transport.sendError(
            request.id,
            ErrorCodes.InvalidParams,
            'Missing required parameter: path'
          );
          return;
        }

        // Close existing CodeGraph instance
        if (this.cg) {
          await this.cg.close();
          this.cg = null;
          this.toolHandler = null;
        }

        // Set the project path
        this.projectPath = newPath;

        // Try to open if already initialized
        const isInitialized = CodeGraph.isInitialized(newPath);
        if (isInitialized) {
          try {
            this.cg = await CodeGraph.open(newPath);
            this.toolHandler = new ToolHandler(this.cg, SERVER_INFO.version);
            this.initError = null;

            // Get status of the newly set root
            const status = await this.cg.getStats();
            const result = {
              content: [{
                type: 'text' as const,
                text: `Successfully switched to root: ${this.projectPath}\n\n` +
                      `**Files indexed:** ${status.fileCount}\n` +
                      `**Total nodes:** ${status.nodeCount}\n` +
                      `**Total edges:** ${status.edgeCount}\n` +
                      `**Database size:** ${(status.dbSizeBytes / 1024 / 1024).toFixed(2)} MB`
              }]
            };
            this.transport.sendResult(request.id, result);
          } catch (err) {
            this.transport.sendError(
              request.id,
              ErrorCodes.InternalError,
              `Failed to open CodeGraph: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        } else {
          // Not initialized yet - that's OK, user can call init next
          const result = {
            content: [{
              type: 'text' as const,
              text: `Root set to: ${newPath}\n\nCodeGraph not initialized yet. Run init to initialize it.`
            }]
          };
          this.transport.sendResult(request.id, result);
        }
        return;
      } catch (error) {
        this.transport.sendError(
          request.id,
          ErrorCodes.InternalError,
          `Failed to switch project: ${error}`
        );
        return;
      }
    }

    // Handle init - initialize CodeGraph in current root
    if (normalizedToolName === 'init') {
      try {
        if (!this.projectPath) {
          this.transport.sendError(
            request.id,
            ErrorCodes.InvalidParams,
            'No root currently set. Use set_root first.'
          );
          return;
        }

        // Initialize the current root (this will create .codegraph/ and schema)
        await CodeGraph.init(this.projectPath, { index: false });

        const result = {
          content: [{
            type: 'text' as const,
              text: `Successfully initialized CodeGraph in ${this.projectPath}\n\nNext step: Run index to build the index`
            }]
          };
        this.transport.sendResult(request.id, result);
        return;
      } catch (error) {
        this.transport.sendError(
          request.id,
          ErrorCodes.InternalError,
          `Failed to initialize root: ${error}`
        );
        return;
      }
    }

    // Handle index - full index of current root
    if (normalizedToolName === 'index') {
      try {
        if (!this.projectPath) {
          this.transport.sendError(
            request.id,
            ErrorCodes.InvalidParams,
            'No root currently set. Use set_root first.'
          );
          return;
        }

        // Open current root and index it
        const cg = await CodeGraph.open(this.projectPath);
        await cg.indexAll({
          useScip: toolArgs.useScip as boolean | undefined,
        });
        
        // Get final stats AFTER resolution completes
        const stats = cg.getStats();
        await cg.close();

        // Reinitialize the current instance so it's ready to use
        await this.initializeCodeGraph(this.projectPath);

        const result = {
          content: [{
            type: 'text' as const,
            text: `Successfully indexed ${this.projectPath}\n\n` +
                  `**Files indexed:** ${stats.fileCount}\n` +
                  `**Total nodes:** ${stats.nodeCount}\n` +
                  `**Total edges:** ${stats.edgeCount}\n` +
                  `**Database size:** ${(stats.dbSizeBytes / 1024 / 1024).toFixed(2)} MB`
          }]
        };
        this.transport.sendResult(request.id, result);
        return;
      } catch (error) {
        this.transport.sendError(
          request.id,
          ErrorCodes.InternalError,
          `Failed to index root: ${error}`
        );
        return;
      }
    }

    // Handle sync - incremental sync of current root
    if (normalizedToolName === 'sync') {
      try {
        if (!this.cg) {
          this.transport.sendError(
            request.id,
            ErrorCodes.InvalidParams,
            'No root currently active. Use set_root first.'
          );
          return;
        }

        // Sync the current root
        await this.cg.sync({
          useScip: toolArgs.useScip as boolean | undefined,
        });

        const result = {
          content: [{
            type: 'text' as const,
            text: `Successfully synced ${this.projectPath}\n\nIndex updated with latest changes.`
          }]
        };
        this.transport.sendResult(request.id, result);
        return;
      } catch (error) {
        this.transport.sendError(
          request.id,
          ErrorCodes.InternalError,
          `Failed to sync root: ${error}`
        );
        return;
      }
    }

    // Handle uninit - remove CodeGraph from current root
    if (normalizedToolName === 'uninit') {
      try {
        if (!this.cg) {
          this.transport.sendError(
            request.id,
            ErrorCodes.InvalidParams,
            'No root currently active. Use set_root first.'
          );
          return;
        }

        const rootPath = this.projectPath;
        
        // Uninitialize (closes DB and deletes .codegraph/)
        this.cg.uninitialize();
        this.cg = null;
        this.toolHandler = null;
        // Keep this.projectPath set so user can immediately re-init without set_root

        const result = {
          content: [{
            type: 'text' as const,
            text: `Successfully removed CodeGraph from ${rootPath}\n\nThe .codegraph/ directory has been deleted.\n\nRoot is still set to: ${rootPath}\nYou can now call init to reinitialize.`
          }]
        };
        this.transport.sendResult(request.id, result);
        return;
      } catch (error) {
        this.transport.sendError(
          request.id,
          ErrorCodes.InternalError,
          `Failed to uninitialize root: ${error}`
        );
        return;
      }
    }

    // Execute the tool
    if (!this.toolHandler) {
      const errorMsg = this.initError ||
        (this.projectPath
          ? `CodeGraph not initialized in ${this.projectPath}. Run 'codegraph init' first.`
          : 'No project path provided. Ensure Claude Code is running in a project directory.');
      this.transport.sendError(
        request.id,
        ErrorCodes.InternalError,
        errorMsg
      );
      return;
    }

    const result = await this.toolHandler.execute(normalizedToolName, toolArgs);

    this.transport.sendResult(request.id, result);
  }
}

// Export for use in CLI
export { StdioTransport } from './transport';
export { tools, ToolHandler } from './tools';
