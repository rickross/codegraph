import * as fs from 'fs';
import { execSync } from 'child_process';

/**
 * Build a CodeGraph version string with support for:
 * 1) CODEGRAPH_BUILD_VERSION (full override)
 * 2) base + CODEGRAPH_VERSION_SUFFIX
 * 3) base + git metadata
 */
export function buildVersion(baseVersion: string, repoRoot: string): string {
  const buildVersionOverride = process.env.CODEGRAPH_BUILD_VERSION?.trim();
  if (buildVersionOverride) {
    return buildVersionOverride;
  }

  const suffix = process.env.CODEGRAPH_VERSION_SUFFIX?.trim();
  if (suffix) {
    const normalized = suffix.startsWith('+') || suffix.startsWith('-')
      ? suffix
      : `+${suffix}`;
    return `${baseVersion}${normalized}`;
  }

  const gitMetadata = getGitMetadata(repoRoot);
  if (!gitMetadata) {
    return baseVersion;
  }

  return `${baseVersion}+${gitMetadata}`;
}

/**
 * Return git build metadata ("g<sha>" or "g<sha>.dirty.<utc timestamp>")
 * when running in a git checkout.
 */
function getGitMetadata(repoRoot: string): string | null {
  if (!fs.existsSync(`${repoRoot}/.git`)) {
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

    if (!dirty) {
      return `g${shortSha}`;
    }

    const dirtyTimestamp = new Date()
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z')
      .replace(/[-:]/g, '');
    return `g${shortSha}.dirty.${dirtyTimestamp}`;
  } catch {
    return null;
  }
}
