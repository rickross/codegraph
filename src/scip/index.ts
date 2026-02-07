/**
 * SCIP JSON Import
 *
 * Adds high-confidence semantic reference edges from SCIP occurrence data.
 * This is additive and does not replace tree-sitter extraction.
 */

import * as fs from 'fs';
import * as path from 'path';
import { QueryBuilder } from '../db/queries';
import type { Edge, Node, ScipImportResult } from '../types';

const SCIP_SYMBOL_ROLE_DEFINITION = 1;
const SCIP_SYMBOL_ROLE_IMPORT = 2;

interface ScipOccurrence {
  symbol: string;
  range: number[];
  symbol_roles?: number;
}

interface ScipDocument {
  relative_path?: string;
  relativePath?: string;
  occurrences?: ScipOccurrence[];
}

interface ScipIndexPayload {
  documents?: ScipDocument[];
}

interface ScipRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeScipRange(range: number[]): ScipRange | null {
  if (range.length === 3) {
    const [startLine, startColumn, endColumn] = range;
    if (
      typeof startLine !== 'number' ||
      typeof startColumn !== 'number' ||
      typeof endColumn !== 'number'
    ) {
      return null;
    }
    return {
      startLine,
      startColumn,
      endLine: startLine,
      endColumn,
    };
  }

  if (range.length === 4) {
    const [startLine, startColumn, endLine, endColumn] = range;
    if (
      typeof startLine !== 'number' ||
      typeof startColumn !== 'number' ||
      typeof endLine !== 'number' ||
      typeof endColumn !== 'number'
    ) {
      return null;
    }
    return {
      startLine,
      startColumn,
      endLine,
      endColumn,
    };
  }

  return null;
}

function isDefinitionOccurrence(occurrence: ScipOccurrence): boolean {
  const roles = occurrence.symbol_roles ?? 0;
  return (roles & SCIP_SYMBOL_ROLE_DEFINITION) !== 0;
}

function isImportOccurrence(occurrence: ScipOccurrence): boolean {
  const roles = occurrence.symbol_roles ?? 0;
  return (roles & SCIP_SYMBOL_ROLE_IMPORT) !== 0;
}

function normalizeDocumentPath(projectRoot: string, rawPath: string): string {
  const withPosixSeparators = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path.isAbsolute(withPosixSeparators)) {
    return withPosixSeparators;
  }

  const relative = path.relative(projectRoot, withPosixSeparators).replace(/\\/g, '/');
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
  }
  return withPosixSeparators;
}

function nodeContains(node: Node, range: ScipRange): boolean {
  const startLine = range.startLine + 1; // SCIP is 0-based line numbers
  const endLine = range.endLine + 1;

  if (startLine < node.startLine || endLine > node.endLine) return false;

  if (startLine === node.startLine && range.startColumn < node.startColumn) {
    return false;
  }
  if (endLine === node.endLine && range.endColumn > node.endColumn) {
    return false;
  }

  return true;
}

function pickBestContainingNode(nodes: Node[], range: ScipRange): Node | undefined {
  const candidates = nodes.filter((node) => nodeContains(node, range));
  if (candidates.length === 0) return undefined;

  candidates.sort((a, b) => {
    const aSpan = (a.endLine - a.startLine) * 10000 + (a.endColumn - a.startColumn);
    const bSpan = (b.endLine - b.startLine) * 10000 + (b.endColumn - b.startColumn);
    if (aSpan !== bSpan) return aSpan - bSpan;

    if (a.kind === 'file' && b.kind !== 'file') return 1;
    if (b.kind === 'file' && a.kind !== 'file') return -1;
    return 0;
  });

  return candidates[0];
}

function parseDocuments(input: unknown): ScipDocument[] {
  if (!isRecord(input)) return [];

  const direct = input.documents;
  if (Array.isArray(direct)) {
    return direct.filter((d): d is ScipDocument => isRecord(d));
  }

  if (Array.isArray(input)) {
    return input.filter((d): d is ScipDocument => isRecord(d));
  }

  return [];
}

export class ScipImporter {
  private projectRoot: string;
  private queries: QueryBuilder;
  private nodesByFile = new Map<string, Node[]>();

  constructor(projectRoot: string, queries: QueryBuilder) {
    this.projectRoot = projectRoot;
    this.queries = queries;
  }

  importFromFile(indexPath: string): ScipImportResult {
    const resolvedPath = path.isAbsolute(indexPath)
      ? indexPath
      : path.resolve(this.projectRoot, indexPath);
    const raw = fs.readFileSync(resolvedPath, 'utf-8');
    const payload = JSON.parse(raw) as ScipIndexPayload | unknown;
    const documents = parseDocuments(payload);

    const symbolDefinitions = new Map<string, Set<string>>();
    let occurrencesScanned = 0;
    let definitionsMapped = 0;
    let referencesMapped = 0;

    // Pass 1: map definitions to concrete graph node IDs.
    for (const document of documents) {
      const rawPath = document.relative_path ?? document.relativePath;
      if (!rawPath || !Array.isArray(document.occurrences)) continue;
      const filePath = normalizeDocumentPath(this.projectRoot, rawPath);
      const nodes = this.getNodesForFile(filePath);

      for (const occurrence of document.occurrences) {
        occurrencesScanned++;
        if (!occurrence.symbol || !Array.isArray(occurrence.range)) continue;
        if (!isDefinitionOccurrence(occurrence)) continue;

        const range = normalizeScipRange(occurrence.range);
        if (!range) continue;

        const definitionNode = pickBestContainingNode(nodes, range);
        if (!definitionNode) continue;

        const existing = symbolDefinitions.get(occurrence.symbol) ?? new Set<string>();
        const before = existing.size;
        existing.add(definitionNode.id);
        symbolDefinitions.set(occurrence.symbol, existing);
        if (existing.size > before) {
          definitionsMapped++;
        }
      }
    }

    // Pass 2: create semantic edges from references to mapped definitions.
    const dedupe = new Set<string>();
    const importedEdges: Edge[] = [];

    for (const document of documents) {
      const rawPath = document.relative_path ?? document.relativePath;
      if (!rawPath || !Array.isArray(document.occurrences)) continue;
      const filePath = normalizeDocumentPath(this.projectRoot, rawPath);
      const nodes = this.getNodesForFile(filePath);

      for (const occurrence of document.occurrences) {
        if (!occurrence.symbol || !Array.isArray(occurrence.range)) continue;
        if (isDefinitionOccurrence(occurrence)) continue;

        const targets = symbolDefinitions.get(occurrence.symbol);
        if (!targets || targets.size === 0) continue;

        const range = normalizeScipRange(occurrence.range);
        if (!range) continue;

        const sourceNode = pickBestContainingNode(nodes, range);
        if (!sourceNode) continue;
        referencesMapped++;

        const edgeKind: Edge['kind'] = isImportOccurrence(occurrence) ? 'imports' : 'references';
        const line = range.startLine + 1;
        const column = range.startColumn;

        for (const targetNodeId of targets) {
          if (targetNodeId === sourceNode.id) continue;
          const key = `${sourceNode.id}|${targetNodeId}|${edgeKind}|${line}|${column}`;
          if (dedupe.has(key)) continue;
          dedupe.add(key);
          importedEdges.push({
            source: sourceNode.id,
            target: targetNodeId,
            kind: edgeKind,
            line,
            column,
            metadata: {
              source: 'scip',
              resolvedBy: 'scip',
              confidence: 0.98,
              scipSymbol: occurrence.symbol,
            },
          });
        }
      }
    }

    if (importedEdges.length > 0) {
      this.queries.insertEdges(importedEdges);
    }

    return {
      indexPath: resolvedPath,
      documentsParsed: documents.length,
      occurrencesScanned,
      definitionsMapped,
      referencesMapped,
      importedEdges: importedEdges.length,
    };
  }

  private getNodesForFile(filePath: string): Node[] {
    if (!this.nodesByFile.has(filePath)) {
      this.nodesByFile.set(filePath, this.queries.getNodesByFile(filePath));
    }
    return this.nodesByFile.get(filePath) ?? [];
  }
}

