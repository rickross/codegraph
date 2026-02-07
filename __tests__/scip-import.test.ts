import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeGraph } from '../src';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-scip-test-'));
}

function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('SCIP import', () => {
  it('imports semantic reference edges and records provenance', async () => {
    const tempDir = createTempDir();
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    const source = [
      'export function target() {',
      '  return 1;',
      '}',
      '',
      'export function caller() {',
      '  return target();',
      '}',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(srcDir, 'example.ts'), source, 'utf-8');

    const scipPayload = {
      documents: [
        {
          relative_path: 'src/example.ts',
          occurrences: [
            {
              symbol: 'scip-typescript npm test 0.0.0 src/example.ts/target().',
              range: [0, 16, 22],
              symbol_roles: 1,
            },
            {
              symbol: 'scip-typescript npm test 0.0.0 src/example.ts/caller().',
              range: [4, 16, 22],
              symbol_roles: 1,
            },
            {
              symbol: 'scip-typescript npm test 0.0.0 src/example.ts/target().',
              range: [5, 9, 15],
              symbol_roles: 0,
            },
          ],
        },
      ],
    };
    fs.writeFileSync(path.join(tempDir, 'index.scip.json'), JSON.stringify(scipPayload), 'utf-8');

    const cg = await CodeGraph.init(tempDir);
    await cg.indexAll();
    const result = await cg.importScip('index.scip.json');

    expect(result.documentsParsed).toBe(1);
    expect(result.importedEdges).toBeGreaterThan(0);

    const callerNode = cg.searchNodes('caller', { kinds: ['function'], limit: 1 })[0]?.node;
    const targetNode = cg.searchNodes('target', { kinds: ['function'], limit: 1 })[0]?.node;
    expect(callerNode).toBeDefined();
    expect(targetNode).toBeDefined();

    const scipEdges = cg
      .getOutgoingEdges(callerNode!.id)
      .filter((edge) => edge.kind === 'references' && edge.metadata?.source === 'scip');
    expect(scipEdges.some((edge) => edge.target === targetNode!.id)).toBe(true);

    const stats = cg.getStats();
    expect(stats.scipProvenance?.lastImportedPath).toContain('index.scip.json');
    expect(stats.scipProvenance?.lastImportedEdges).toBe(result.importedEdges);

    cg.destroy();
    cleanupTempDir(tempDir);
  });
});

