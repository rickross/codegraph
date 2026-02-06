// @ts-nocheck - DEBUG logging commented out, timing vars unused
/**
 * Reference Resolution Orchestrator
 *
 * Coordinates all reference resolution strategies.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { Node, UnresolvedReference, Edge } from '../types';
import { QueryBuilder } from '../db/queries';
import {
  UnresolvedRef,
  ResolvedRef,
  ResolutionResult,
  ResolutionContext,
  FrameworkResolver,
} from './types';
import { matchReference } from './name-matcher';
import { resolveViaImport } from './import-resolver';
import { detectFrameworks } from './frameworks';
import { logDebug } from '../errors';

// Re-export types
export * from './types';

/**
 * Reference Resolver
 *
 * Orchestrates reference resolution using multiple strategies.
 */
// Query interface that both QueryBuilder and InMemoryQueryBuilder implement
interface IQueryProvider {
  getAllNodes(): Node[];
  getNodeById(id: string): Node | undefined;
  getNodesByName(name: string): Node[];
  getNodesByQualifiedName(qualifiedName: string): Node[];
  getNodesByFile(filePath: string): Node[];
  getNodesByKind(kind: string): Node[];
  searchNodes(query: string, options?: { limit?: number }): Array<{ node: Node; score: number }>;
  getAllFiles(): Array<{ path: string }>;
  insertEdges(edges: Edge[]): void;
}

export class ReferenceResolver {
  private projectRoot: string;
  private queries: IQueryProvider;
  private context: ResolutionContext;
  private frameworks: FrameworkResolver[] = [];
  private nodeCache: Map<string, Node[]> = new Map();
  private fileCache: Map<string, string | null> = new Map();
  private nameCache: Map<string, Node[]> = new Map();
  private qualifiedNameCache: Map<string, Node[]> = new Map();

  constructor(projectRoot: string, queries: IQueryProvider) {
    this.projectRoot = projectRoot;
    this.queries = queries;
    this.context = this.createContext();
  }

  /**
   * Initialize frameworks and detection
   */
  initialize(): void {
    this.frameworks = detectFrameworks(this.context);
  }

  /**
   * Pre-load symbol lookup caches to optimize bulk resolution.
   * Call this before resolving many references to avoid repeated DB queries.
   */
  private warmCaches(): void {
    // Get all nodes in one query instead of N queries (one per file)
    this.nameCache.clear();
    this.qualifiedNameCache.clear();
    
    const allNodes = this.queries.getAllNodes();
    
    for (const node of allNodes) {
      // Index by name
      if (node.name) {
        if (!this.nameCache.has(node.name)) {
          this.nameCache.set(node.name, []);
        }
        this.nameCache.get(node.name)!.push(node);
      }
      
      // Index by qualified name
      if (node.qualifiedName) {
        if (!this.qualifiedNameCache.has(node.qualifiedName)) {
          this.qualifiedNameCache.set(node.qualifiedName, []);
        }
        this.qualifiedNameCache.get(node.qualifiedName)!.push(node);
      }
    }
  }

  /**
   * Clear internal caches
   */
  clearCaches(): void {
    this.nodeCache.clear();
    this.fileCache.clear();
  }

  /**
   * Create the resolution context
   */
  private createContext(): ResolutionContext {
    return {
      getNodesInFile: (filePath: string) => {
        if (!this.nodeCache.has(filePath)) {
          this.nodeCache.set(filePath, this.queries.getNodesByFile(filePath));
        }
        return this.nodeCache.get(filePath)!;
      },

      getNodesByName: (name: string) => {
        // Use cache if available, otherwise fall back to DB query
        if (this.nameCache.has(name)) {
          return this.nameCache.get(name)!;
        }
        return this.queries.searchNodes(name, { limit: 100 }).map((r) => r.node);
      },

      getNodesByQualifiedName: (qualifiedName: string) => {
        // Use cache if available, otherwise fall back to DB query
        if (this.qualifiedNameCache.has(qualifiedName)) {
          return this.qualifiedNameCache.get(qualifiedName)!;
        }
        // Search for exact qualified name match
        return this.queries
          .searchNodes(qualifiedName, { limit: 50 })
          .filter((r) => r.node.qualifiedName === qualifiedName)
          .map((r) => r.node);
      },

      getNodesByKind: (kind: Node['kind']) => {
        return this.queries.getNodesByKind(kind);
      },

      fileExists: (filePath: string) => {
        const fullPath = path.join(this.projectRoot, filePath);
        try {
          return fs.existsSync(fullPath);
        } catch (error) {
          logDebug('Error checking file existence', { filePath, error: String(error) });
          return false;
        }
      },

      readFile: (filePath: string) => {
        if (this.fileCache.has(filePath)) {
          return this.fileCache.get(filePath)!;
        }

        const fullPath = path.join(this.projectRoot, filePath);
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          this.fileCache.set(filePath, content);
          return content;
        } catch (error) {
          logDebug('Failed to read file for resolution', { filePath, error: String(error) });
          this.fileCache.set(filePath, null);
          return null;
        }
      },

      getProjectRoot: () => this.projectRoot,

      getAllFiles: () => {
        return this.queries.getAllFiles().map((f) => f.path);
      },
    };
  }

  /**
   * Resolve all unresolved references in parallel using worker threads
   */
  async resolveAllParallel(
    unresolvedRefs: UnresolvedReference[],
    numWorkers: number = 4,
    onProgress?: (current: number, total: number) => void
  ): Promise<ResolutionResult> {
    if (unresolvedRefs.length === 0 || numWorkers <= 1) {
      // Fall back to single-threaded if too few refs or workers
      return this.resolveAll(unresolvedRefs, onProgress);
    }


    // Split refs into chunks
    const chunkSize = Math.ceil(unresolvedRefs.length / numWorkers);
    const chunks: UnresolvedReference[][] = [];
    for (let i = 0; i < unresolvedRefs.length; i += chunkSize) {
      chunks.push(unresolvedRefs.slice(i, i + chunkSize));
    }


    // Pre-load all nodes once for all workers (avoid DB access in workers)
    const allNodes = this.queries.getAllNodes();
    
    // Spawn workers with pre-loaded data
    const workerPath = path.join(__dirname, 'worker.js');
    
    const workers = chunks.map((chunk, idx) => {
      return new Promise<ResolutionResult>((resolve, reject) => {
        const worker = new Worker(workerPath, {
          workerData: {
            projectRoot: this.projectRoot,
            allNodes,  // Pass nodes directly, no DB access needed
            refs: chunk,
          },
        });

        worker.on('message', (result: ResolutionResult) => {
          resolve(result);
        });

        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Worker ${idx} exited with code ${code}`));
          }
        });
      });
    });

    // Wait for all workers
    const results = await Promise.all(workers);

    // Merge results
    const merged: ResolutionResult = {
      resolved: [],
      unresolved: [],
      stats: {
        total: unresolvedRefs.length,
        resolved: 0,
        unresolved: 0,
        byMethod: {},
      },
    };

    for (const result of results) {
      merged.resolved.push(...result.resolved);
      merged.unresolved.push(...result.unresolved);
      merged.stats.resolved += result.stats.resolved;
      merged.stats.unresolved += result.stats.unresolved;
      
      // Merge byMethod counts
      for (const [method, count] of Object.entries(result.stats.byMethod)) {
        merged.stats.byMethod[method] = (merged.stats.byMethod[method] || 0) + count;
      }
    }

    return merged;
  }

  /**
   * Resolve all unresolved references (single-threaded)
   */
  resolveAll(
    unresolvedRefs: UnresolvedReference[],
    onProgress?: (current: number, total: number) => void
  ): ResolutionResult {
    // Pre-load symbol caches for fast lookups during bulk resolution
    this.warmCaches();
    
    const resolved: ResolvedRef[] = [];
    const unresolved: UnresolvedRef[] = [];
    const byMethod: Record<string, number> = {};

    // Convert to our internal format (now filePath/language come from DB)
    const refs: UnresolvedRef[] = unresolvedRefs.map((ref) => ({
      fromNodeId: ref.fromNodeId,
      referenceName: ref.referenceName,
      referenceKind: ref.referenceKind,
      line: ref.line,
      column: ref.column,
      filePath: ref.filePath,
      language: ref.language,
    }));

    const total = refs.length;
    let current = 0;

    const loopStart = Date.now();
    let totalResolveOneTime = 0;
    const slowRefs: Array<{name: string, time: number}> = [];

    for (const ref of refs) {
      const resolveStart = Date.now();
      const result = this.resolveOne(ref);
      const resolveTime = Date.now() - resolveStart;
      totalResolveOneTime += resolveTime;
      
      // Track slow refs (>10ms)
      if (resolveTime > 10) {
      }

      if (result) {
        resolved.push(result);
        byMethod[result.resolvedBy] = (byMethod[result.resolvedBy] || 0) + 1;
      } else {
        unresolved.push(ref);
      }

      // Report progress every 100 refs (or adjust frequency)
      current++;
      if (onProgress && (current % 100 === 0 || current === total)) {
        onProgress(current, total);
      }
    }
    
    const loopEnd = Date.now();
    if (slowRefs.length > 0) {
      for (let i = 0; i < Math.min(10, slowRefs.length); i++) {
        if (slow) {
        }
      }
    }

    return {
      resolved,
      unresolved,
      stats: {
        total: refs.length,
        resolved: resolved.length,
        unresolved: unresolved.length,
        byMethod,
      },
    };
  }

  /**
   * Resolve a single reference
   */
  resolveOne(ref: UnresolvedRef): ResolvedRef | null {
    // Skip built-in/external references
    if (this.isBuiltInOrExternal(ref)) {
      return null;
    }

    // Strategy 1: Try framework-specific resolution first
    for (const framework of this.frameworks) {
      const result = framework.resolve(ref, this.context);
      if (result) {
        return result;
      }
    }

    // Strategy 2: Try import-based resolution
    const importResult = resolveViaImport(ref, this.context);
    if (importResult) {
      return importResult;
    }

    // Strategy 3: Try name matching
    const nameResult = matchReference(ref, this.context);
    if (nameResult) {
      return nameResult;
    }

    return null;
  }

  /**
   * Create edges from resolved references
   */
  createEdges(resolved: ResolvedRef[]): Edge[] {
    return resolved.map((ref) => ({
      source: ref.original.fromNodeId,
      target: ref.targetNodeId,
      kind: ref.original.referenceKind,
      line: ref.original.line,
      column: ref.original.column,
      metadata: {
        confidence: ref.confidence,
        resolvedBy: ref.resolvedBy,
      },
    }));
  }

  /**
   * Resolve and persist edges to database
   */
  async resolveAndPersist(
    unresolvedRefs: UnresolvedReference[],
    numWorkers: number = 4,
    onProgress?: (current: number, total: number) => void
  ): Promise<ResolutionResult> {
    const result = await this.resolveAllParallel(unresolvedRefs, numWorkers, onProgress);

    // Create edges from resolved references
    const edges = this.createEdges(result.resolved);

    // Note: Skipping edge deletion - workers close the DB connection
    // TODO: Fix DB connection lifecycle with workers

    // Insert new edges into database
    if (edges.length > 0) {
      this.queries.insertEdges(edges);
    }

    return result;
  }

  /**
   * Get detected frameworks
   */
  getDetectedFrameworks(): string[] {
    return this.frameworks.map((f) => f.name);
  }

  /**
   * Check if reference is to a built-in or external symbol
   */
  private isBuiltInOrExternal(ref: UnresolvedRef): boolean {
    const name = ref.referenceName;

    // JavaScript/TypeScript built-ins
    const jsBuiltIns = [
      'console', 'window', 'document', 'global', 'process',
      'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean',
      'Date', 'Math', 'JSON', 'RegExp', 'Error', 'Map', 'Set',
      'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
      'fetch', 'require', 'module', 'exports', '__dirname', '__filename',
    ];

    if (jsBuiltIns.includes(name)) {
      return true;
    }

    // Common library calls
    if (name.startsWith('console.') || name.startsWith('Math.') || name.startsWith('JSON.')) {
      return true;
    }

    // React hooks from React itself
    const reactHooks = ['useState', 'useEffect', 'useContext', 'useReducer', 'useCallback', 'useMemo', 'useRef', 'useLayoutEffect', 'useImperativeHandle', 'useDebugValue'];
    if (reactHooks.includes(name)) {
      return true;
    }

    // Python built-ins
    const pythonBuiltIns = [
      'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple',
      'open', 'input', 'type', 'isinstance', 'hasattr', 'getattr', 'setattr',
      'super', 'self', 'cls', 'None', 'True', 'False',
    ];

    if (ref.language === 'python' && pythonBuiltIns.includes(name)) {
      return true;
    }

    return false;
  }

}

/**
 * Create a reference resolver instance
 */
export function createResolver(projectRoot: string, queries: QueryBuilder): ReferenceResolver {
  const resolver = new ReferenceResolver(projectRoot, queries);
  resolver.initialize();
  return resolver;
}
