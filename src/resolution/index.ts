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
export class ReferenceResolver {
  private projectRoot: string;
  private queries: QueryBuilder;
  private context: ResolutionContext;
  private frameworks: FrameworkResolver[] = [];
  private nodeCache: Map<string, Node[]> = new Map();
  private fileCache: Map<string, string | null> = new Map();
  private nameCache: Map<string, Node[]> = new Map();
  private qualifiedNameCache: Map<string, Node[]> = new Map();

  constructor(projectRoot: string, queries: QueryBuilder) {
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
    const t1 = Date.now();
    this.nameCache.clear();
    this.qualifiedNameCache.clear();
    
    const allNodes = this.queries.getAllNodes();
    const t2 = Date.now();
    // console.log(`[DEBUG] getAllNodes: ${t2 - t1}ms (${allNodes.length} nodes)`);
    
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

    const t1 = Date.now();
    // console.log(`[DEBUG] Starting parallel resolution with ${numWorkers} workers...`);

    // Split refs into chunks
    const chunkSize = Math.ceil(unresolvedRefs.length / numWorkers);
    const chunks: UnresolvedReference[][] = [];
    for (let i = 0; i < unresolvedRefs.length; i += chunkSize) {
      chunks.push(unresolvedRefs.slice(i, i + chunkSize));
    }

    // console.log(`[DEBUG] Split ${unresolvedRefs.length} refs into ${chunks.length} chunks of ~${chunkSize} refs each`);

    // Spawn workers
    const workerPath = path.join(__dirname, 'worker.js');
    const dbPath = path.join(this.projectRoot, '.codegraph', 'codegraph.db');
    
    const workers = chunks.map((chunk, idx) => {
      return new Promise<ResolutionResult>((resolve, reject) => {
        const worker = new Worker(workerPath, {
          workerData: {
            projectRoot: this.projectRoot,
            dbPath,
            refs: chunk,
          },
        });

        worker.on('message', (result: ResolutionResult) => {
          console.log(`[DEBUG] Worker ${idx} completed: ${result.stats.resolved} resolved, ${result.stats.unresolved} unresolved`);
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
    const t2 = Date.now();
    // console.log(`[DEBUG] All workers completed in ${t2 - t1}ms`);

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

    // console.log(`[DEBUG] Merged results: ${merged.stats.resolved} resolved, ${merged.stats.unresolved} unresolved`);
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
    const t4 = Date.now();
    const refs: UnresolvedRef[] = unresolvedRefs.map((ref) => ({
      fromNodeId: ref.fromNodeId,
      referenceName: ref.referenceName,
      referenceKind: ref.referenceKind,
      line: ref.line,
      column: ref.column,
      filePath: ref.filePath,
      language: ref.language,
    }));
    const t5 = Date.now();
    // console.log(`[DEBUG] Convert refs format: ${t5 - t4}ms (${refs.length} refs)`);

    const total = refs.length;
    let current = 0;

    // console.log(`[DEBUG] Starting resolution loop for ${total} refs...`);
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
        slowRefs.push({name: ref.referenceName, time: resolveTime});
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
    const loopTotal = loopEnd - loopStart;
    // console.log(`[DEBUG] Resolution loop completed: ${loopTotal}ms`);
    // console.log(`[DEBUG]   - Time in resolveOne: ${totalResolveOneTime}ms (${(totalResolveOneTime/loopTotal*100).toFixed(1)}%)`);
    // console.log(`[DEBUG]   - Overhead: ${loopTotal - totalResolveOneTime}ms`);
    // console.log(`[DEBUG]   - Slow refs (>10ms): ${slowRefs.length}`);
    if (slowRefs.length > 0) {
      slowRefs.sort((a, b) => b.time - a.time);
      console.log(`[DEBUG]   - Top 10 slowest:`);
      for (let i = 0; i < Math.min(10, slowRefs.length); i++) {
        const slow = slowRefs[i];
        if (slow) {
          console.log(`[DEBUG]       ${slow.name}: ${slow.time}ms`);
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
    const t1 = Date.now();
    const result = await this.resolveAllParallel(unresolvedRefs, numWorkers, onProgress);
    const t2 = Date.now();
    // console.log(`[DEBUG] resolveAll total: ${t2 - t1}ms`);

    // Create edges from resolved references
    const edges = this.createEdges(result.resolved);
    const t3 = Date.now();
    // console.log(`[DEBUG] createEdges: ${t3 - t2}ms (${edges.length} edges)`);

    // Delete old resolved edges before inserting new ones
    // (prevents duplicates when re-indexing)
    const sourceIds = new Set(edges.map(e => e.source));
    // console.log(`[DEBUG] About to delete edges from ${sourceIds.size} sources...`);
    try {
      for (const sourceId of sourceIds) {
        this.queries.deleteEdgesBySource(sourceId);
      }
    } catch (error) {
      console.error(`[DEBUG] Error deleting edges:`, error);
      throw error;
    }
    const t4 = Date.now();
    // console.log(`[DEBUG] deleteEdgesBySource: ${t4 - t3}ms (${sourceIds.size} sources)`);

    // Insert new edges into database
    if (edges.length > 0) {
      this.queries.insertEdges(edges);
    }
    const t5 = Date.now();
    // console.log(`[DEBUG] insertEdges: ${t5 - t4}ms`);

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
