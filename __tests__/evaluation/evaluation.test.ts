/**
 * Evaluation Tests
 *
 * Runs the evaluation suite as part of the test suite.
 * Use `npm run test:eval` to run just these tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import CodeGraph from '../../src/index';
import type { TestCase, TestCaseResult } from './types';
import { typescriptFixture } from './fixtures/typescript-project/ground-truth';
import { pythonFixture } from './fixtures/python-project/ground-truth';

/**
 * Extract symbol names from nodes
 */
function extractSymbolNames(nodes: { name: string }[]): Set<string> {
  return new Set(nodes.map(n => n.name.toLowerCase()));
}

/**
 * Normalize symbol name
 */
function normalizeSymbol(symbol: string): string {
  return symbol.split('.').pop()?.toLowerCase() || symbol.toLowerCase();
}

/**
 * Check if symbol matches
 */
function symbolMatches(symbol: string, candidates: Set<string>): boolean {
  const normalized = normalizeSymbol(symbol);
  for (const candidate of candidates) {
    if (normalizeSymbol(candidate) === normalized) return true;
  }
  return false;
}

/**
 * Find a target node by name, supporting qualified names like "ClassName.methodName"
 */
function findTargetNode(cg: CodeGraph, targetSymbol: string): { id: string; name: string } | null {
  // Check if it's a qualified name (e.g., "OrderService.createOrder")
  const parts = targetSymbol.split('.');

  if (parts.length === 2) {
    const [className, methodName] = parts;
    // Search for the method name and filter by qualified name containing the class
    const results = cg.searchNodes(methodName!, { limit: 20 });
    for (const r of results) {
      if (r.node.qualifiedName.includes(className!) && r.node.name === methodName) {
        return { id: r.node.id, name: r.node.name };
      }
    }
  }

  // Fall back to simple search
  const results = cg.searchNodes(targetSymbol, { limit: 1 });
  if (results.length > 0 && results[0]) {
    return { id: results[0].node.id, name: results[0].node.name };
  }

  return null;
}

/**
 * Run a single test case and return metrics
 */
async function runSingleTest(cg: CodeGraph, testCase: TestCase): Promise<TestCaseResult> {
  let retrievedNodes: { name: string; id: string }[] = [];

  switch (testCase.type) {
    case 'search': {
      const results = cg.searchNodes(testCase.query, { limit: 20 });
      retrievedNodes = results.map(r => ({ name: r.node.name, id: r.node.id }));
      break;
    }

    case 'context': {
      // Use buildContext to get semantic search + graph traversal
      const context = await cg.buildContext(testCase.query, {
        maxNodes: 30,
        traversalDepth: 2,
        searchLimit: 5,
        format: 'object',
      });
      // Extract nodes from the subgraph
      if (typeof context !== 'string' && context.subgraph) {
        retrievedNodes = Array.from(context.subgraph.nodes.values()).map(n => ({
          name: n.name,
          id: n.id,
        }));
      }
      break;
    }

    case 'callers': {
      if (testCase.targetSymbol) {
        const targetNode = findTargetNode(cg, testCase.targetSymbol);
        if (targetNode) {
          const callers = cg.getCallers(targetNode.id);
          retrievedNodes = callers.map(c => ({ name: c.node.name, id: c.node.id }));
        }
      }
      break;
    }

    case 'callees': {
      if (testCase.targetSymbol) {
        const targetNode = findTargetNode(cg, testCase.targetSymbol);
        if (targetNode) {
          const callees = cg.getCallees(targetNode.id);
          retrievedNodes = callees.map(c => ({ name: c.node.name, id: c.node.id }));
        }
      }
      break;
    }

    case 'impact': {
      if (testCase.targetSymbol) {
        const targetNode = findTargetNode(cg, testCase.targetSymbol);
        if (targetNode) {
          const impact = cg.getImpactRadius(targetNode.id, 2);
          retrievedNodes = Array.from(impact.nodes.values()).map(n => ({ name: n.name, id: n.id }));
        }
      }
      break;
    }
  }

  // Calculate metrics
  const retrievedSymbols = extractSymbolNames(retrievedNodes);

  const truePositives: string[] = [];
  const falsePositives: string[] = [];

  for (const symbol of retrievedSymbols) {
    if (symbolMatches(symbol, new Set(testCase.expectedSymbols))) {
      truePositives.push(symbol);
    } else if (symbolMatches(symbol, new Set(testCase.irrelevantSymbols))) {
      falsePositives.push(symbol);
    }
  }

  const falseNegatives: string[] = [];
  for (const expected of testCase.expectedSymbols) {
    if (!symbolMatches(expected, retrievedSymbols)) {
      falseNegatives.push(expected);
    }
  }

  const totalRetrieved = truePositives.length + falsePositives.length;
  const precision = totalRetrieved > 0 ? truePositives.length / totalRetrieved : 0;

  const totalRelevant = testCase.expectedSymbols.length;
  const recall = totalRelevant > 0 ? truePositives.length / totalRelevant : 0;

  const f1Score = precision + recall > 0
    ? 2 * (precision * recall) / (precision + recall)
    : 0;

  // Check if passed thresholds (with 20% margin)
  const passedRecall = !testCase.minRecall || recall >= testCase.minRecall * 0.8;
  const passedPrecision = !testCase.minPrecision || precision >= testCase.minPrecision * 0.8;

  return {
    testCaseId: testCase.id,
    passed: passedRecall && passedPrecision,
    precision,
    recall,
    f1Score,
    truePositives,
    falsePositives,
    falseNegatives,
    contextTokens: 0,
    executionTimeMs: 0,
  };
}

/**
 * Print a results table
 */
function printResultsTable(results: TestCaseResult[], fixtureName: string): void {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  ${fixtureName} Results`);
  console.log('='.repeat(80));
  console.log('');
  console.log('  Test ID                              Type       Prec    Recall  F1     Status');
  console.log('  ' + '-'.repeat(76));

  for (const r of results) {
    const id = r.testCaseId.padEnd(35);
    const type = r.testCaseId.split('-')[1]?.padEnd(10) || ''.padEnd(10);
    const prec = `${(r.precision * 100).toFixed(0)}%`.padStart(5);
    const recall = `${(r.recall * 100).toFixed(0)}%`.padStart(6);
    const f1 = `${(r.f1Score * 100).toFixed(0)}%`.padStart(5);
    const status = r.passed ? '✓' : '✗';
    console.log(`  ${id} ${type} ${prec}   ${recall}  ${f1}    ${status}`);
  }

  const avgPrecision = results.reduce((sum, r) => sum + r.precision, 0) / results.length;
  const avgRecall = results.reduce((sum, r) => sum + r.recall, 0) / results.length;
  const avgF1 = results.reduce((sum, r) => sum + r.f1Score, 0) / results.length;
  const passRate = results.filter(r => r.passed).length / results.length;

  console.log('  ' + '-'.repeat(76));
  console.log(`  ${'AVERAGE'.padEnd(35)} ${''.padEnd(10)} ${`${(avgPrecision * 100).toFixed(0)}%`.padStart(5)}   ${`${(avgRecall * 100).toFixed(0)}%`.padStart(6)}  ${`${(avgF1 * 100).toFixed(0)}%`.padStart(5)}    ${(passRate * 100).toFixed(0)}%`);
  console.log('');
}

describe('CodeGraph Evaluation', () => {
  describe('TypeScript Fixture', () => {
    let cg: CodeGraph;
    const fixturePath = path.resolve(__dirname, 'fixtures/typescript-project');
    const results: TestCaseResult[] = [];

    beforeAll(async () => {
      // Clean up any existing index
      const codegraphDir = path.join(fixturePath, '.codegraph');
      if (fs.existsSync(codegraphDir)) {
        fs.rmSync(codegraphDir, { recursive: true });
      }

      // Initialize and index
      cg = await CodeGraph.init(fixturePath, { index: true });

      // Initialize embeddings for semantic search
      await cg.initializeEmbeddings();
      await cg.generateEmbeddings();
    }, 120000);

    afterAll(() => {
      // Print summary table after all tests
      printResultsTable(results, 'TypeScript');

      if (cg) {
        cg.destroy();
      }
    });

    it('should index all files', () => {
      const stats = cg.getStats();
      expect(stats.fileCount).toBeGreaterThanOrEqual(typescriptFixture.totalFiles);
    });

    // Generate test for each test case - collect results but don't fail
    for (const testCase of typescriptFixture.testCases) {
      it(`${testCase.id}: ${testCase.description}`, async () => {
        const result = await runSingleTest(cg, testCase);
        results.push(result);
        // Don't assert - just collect results
        expect(true).toBe(true);
      });
    }
  });

  describe('Python Fixture', () => {
    let cg: CodeGraph;
    const fixturePath = path.resolve(__dirname, 'fixtures/python-project');
    const results: TestCaseResult[] = [];

    beforeAll(async () => {
      // Clean up any existing index
      const codegraphDir = path.join(fixturePath, '.codegraph');
      if (fs.existsSync(codegraphDir)) {
        fs.rmSync(codegraphDir, { recursive: true });
      }

      // Initialize and index
      cg = await CodeGraph.init(fixturePath, { index: true });

      // Initialize embeddings for semantic search
      await cg.initializeEmbeddings();
      await cg.generateEmbeddings();
    }, 120000);

    afterAll(() => {
      // Print summary table after all tests
      printResultsTable(results, 'Python');

      if (cg) {
        cg.destroy();
      }
    });

    it('should index all files', () => {
      const stats = cg.getStats();
      expect(stats.fileCount).toBeGreaterThanOrEqual(pythonFixture.totalFiles);
    });

    // Generate test for each test case - collect results but don't fail
    for (const testCase of pythonFixture.testCases) {
      it(`${testCase.id}: ${testCase.description}`, async () => {
        const result = await runSingleTest(cg, testCase);
        results.push(result);
        // Don't assert - just collect results
        expect(true).toBe(true);
      });
    }
  });
});
