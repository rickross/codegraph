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

    for (const node of this.nodes) {
      let score = 0;
      if (node.name?.toLowerCase().includes(lowerQuery)) {
        score = 1;
      }
      if (node.qualifiedName?.toLowerCase().includes(lowerQuery)) {
        score = Math.max(score, 0.8);
      }
      if (score > 0) {
        results.push({ node, score });
      }
      if (results.length >= limit) break;
    }

    return results;
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
