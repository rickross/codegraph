/**
 * In-memory query builder for worker threads
 * Provides same interface as QueryBuilder but works with pre-loaded nodes
 */

import type { Node, NodeKind, Edge } from '../types';

export class InMemoryQueryBuilder {
  private nodes: Node[];
  private nodeById: Map<string, Node>;
  private nodesByName: Map<string, Node[]>;
  private nodesByQualifiedName: Map<string, Node[]>;
  private nodesByFile: Map<string, Node[]>;
  private nodesByKind: Map<NodeKind, Node[]>;

  constructor(nodes: Node[]) {
    this.nodes = nodes;
    this.nodeById = new Map();
    this.nodesByName = new Map();
    this.nodesByQualifiedName = new Map();
    this.nodesByFile = new Map();
    this.nodesByKind = new Map();

    // Build indexes
    for (const node of nodes) {
      this.nodeById.set(node.id, node);

      if (node.name) {
        if (!this.nodesByName.has(node.name)) {
          this.nodesByName.set(node.name, []);
        }
        this.nodesByName.get(node.name)!.push(node);
      }

      if (node.qualifiedName) {
        if (!this.nodesByQualifiedName.has(node.qualifiedName)) {
          this.nodesByQualifiedName.set(node.qualifiedName, []);
        }
        this.nodesByQualifiedName.get(node.qualifiedName)!.push(node);
      }

      if (!this.nodesByFile.has(node.filePath)) {
        this.nodesByFile.set(node.filePath, []);
      }
      this.nodesByFile.get(node.filePath)!.push(node);

      if (!this.nodesByKind.has(node.kind)) {
        this.nodesByKind.set(node.kind, []);
      }
      this.nodesByKind.get(node.kind)!.push(node);
    }
  }

  // Required methods for ReferenceResolver

  getNodeById(id: string): Node | undefined {
    return this.nodeById.get(id);
  }

  getNodesByName(name: string): Node[] {
    return this.nodesByName.get(name) || [];
  }

  getNodesByQualifiedName(qualifiedName: string): Node[] {
    return this.nodesByQualifiedName.get(qualifiedName) || [];
  }

  getNodesByFile(filePath: string): Node[] {
    return this.nodesByFile.get(filePath) || [];
  }

  getNodesByKind(kind: NodeKind): Node[] {
    return this.nodesByKind.get(kind) || [];
  }

  getAllNodes(): Node[] {
    return this.nodes;
  }

  searchNodes(query: string, options?: { limit?: number }): Array<{ node: Node; score: number }> {
    const limit = options?.limit || 100;
    const lowerQuery = query.toLowerCase();
    const results: Array<{ node: Node; score: number }> = [];

    // Mimic FTS5 behavior: prefix matching, case-insensitive, scored by match quality
    for (const node of this.nodes) {
      let score = 0;
      const lowerName = node.name?.toLowerCase();
      const lowerQualified = node.qualifiedName?.toLowerCase();

      // Exact match (highest score)
      if (lowerName === lowerQuery) {
        score = 10;
      } else if (lowerQualified === lowerQuery) {
        score = 9;
      }
      // Prefix match (high score)
      else if (lowerName?.startsWith(lowerQuery)) {
        score = 8;
      } else if (lowerQualified?.endsWith('.' + lowerQuery)) {
        score = 7;
      }
      // Contains match (medium score)
      else if (lowerName?.includes(lowerQuery)) {
        score = 5;
      } else if (lowerQualified?.includes(lowerQuery)) {
        score = 4;
      }
      // Partial word match (lower score)
      else if (lowerName?.split(/[._-]/).some(part => part.startsWith(lowerQuery))) {
        score = 3;
      } else if (lowerQualified?.split(/[._-]/).some(part => part.includes(lowerQuery))) {
        score = 2;
      }

      if (score > 0) {
        results.push({ node, score });
      }
    }

    // Sort by score descending, then take limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  getAllFiles(): Array<{ path: string }> {
    const uniquePaths = new Set(this.nodes.map(n => n.filePath));
    return Array.from(uniquePaths).map(path => ({ path }));
  }

  // These methods shouldn't be called in workers (no DB writes)
  insertNode(): void {
    throw new Error('Cannot insert node in worker thread');
  }

  insertEdge(): void {
    throw new Error('Cannot insert edge in worker thread');
  }

  insertEdges(_edges: Edge[]): void {
    throw new Error('Cannot insert edges in worker thread');
  }

  deleteEdgesBySource(): void {
    throw new Error('Cannot delete edges in worker thread');
  }
}
