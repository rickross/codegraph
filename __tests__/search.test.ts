/**
 * Search quality and ranking behavior tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import CodeGraph from '../src/index';

describe('Search Quality', () => {
  let testDir: string;
  let cg: CodeGraph;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-search-test-'));
    const srcDir = path.join(testDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, 'config.ts'),
      `
export function configLoader() {
  return true;
}

export function configureApp() {
  return configLoader();
}
`
    );

    fs.writeFileSync(
      path.join(srcDir, 'project.ts'),
      `
export function projectManager() {
  return 'ok';
}
`
    );

    fs.mkdirSync(path.join(srcDir, 'tui'), { recursive: true });
    fs.mkdirSync(path.join(srcDir, 'server'), { recursive: true });
    fs.mkdirSync(path.join(srcDir, 'sdk'), { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, 'tui', 'session.ts'),
      `
export function handleTuiSessionInput() {
  return 'input';
}
`
    );

    fs.writeFileSync(
      path.join(srcDir, 'server', 'session.ts'),
      `
export function streamServerSessionResponse() {
  return 'stream';
}
`
    );

    fs.writeFileSync(
      path.join(srcDir, 'sdk', 'client.ts'),
      `
export function createSdkClient() {
  return 'sdk';
}
`
    );

    cg = CodeGraph.initSync(testDir, {
      config: {
        include: ['src/**/*.ts'],
        exclude: [],
      },
    });

    await cg.indexAll();
    await cg.resolveReferences();
  });

  afterEach(() => {
    if (cg) {
      cg.destroy();
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('excludes file nodes by default for symbol queries', () => {
    const results = cg.searchNodes('config', { limit: 20 });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.node.kind === 'file')).toBe(false);
    expect(results[0]?.node.kind).not.toBe('file');
  });

  it('includes file nodes when includeFiles is true', () => {
    const results = cg.searchNodes('config', { limit: 20, includeFiles: true });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.node.kind === 'file')).toBe(true);
    expect(results[0]?.node.kind).toBe('function');
  });

  it('auto-includes files for file-intent queries', () => {
    const results = cg.searchNodes('config.ts', { limit: 10 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.node.kind).toBe('file');
    expect(results[0]?.node.name).toBe('config.ts');
  });

  it('respects includeFiles=false even for file-intent queries', () => {
    const results = cg.searchNodes('config.ts', { limit: 10, includeFiles: false });

    expect(results.some((r) => r.node.kind === 'file')).toBe(false);
  });

  it('prioritizes relevant terms for natural-language task queries', () => {
    const query = 'understand how the tui and server interact during sessions';
    const results = cg.searchNodes(query, { limit: 5, includeFiles: true });

    expect(results.length).toBeGreaterThan(0);
    const topPath = results[0]?.node.filePath ?? '';
    expect(topPath.includes('src/tui/') || topPath.includes('src/server/')).toBe(true);
  });

  it('supports includePatterns path filtering', () => {
    const results = cg.searchNodes('session', {
      limit: 10,
      includeFiles: true,
      includePatterns: ['*src/tui/*'],
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.node.filePath.includes('src/tui/'))).toBe(true);
  });

  it('supports excludePatterns path filtering', () => {
    const results = cg.searchNodes('session', {
      limit: 10,
      includeFiles: true,
      excludePatterns: ['*src/sdk/*'],
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.node.filePath.includes('src/sdk/'))).toBe(false);
  });
});
