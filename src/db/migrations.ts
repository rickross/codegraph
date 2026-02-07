/**
 * Database Migrations
 *
 * Schema versioning and migration support.
 */

import Database from 'better-sqlite3';

/**
 * Current schema version
 */
export const CURRENT_SCHEMA_VERSION = 2;

/**
 * Migration definition
 */
interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

/**
 * All migrations in order
 *
 * Note: Version 1 is the initial schema, handled by schema.sql
 * Future migrations go here.
 */
const migrations: Migration[] = [
  {
    version: 2,
    description: 'Add project metadata table for index provenance',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_project_metadata_updated_at ON project_metadata(updated_at);
      `);

      // Best-effort backfill for existing indexes.
      // We cannot infer historical version, so mark as unknown when files exist.
      const hasFiles = (
        db.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number }
      ).count > 0;
      if (hasFiles) {
        const now = Date.now();
        const minIndexedAt = (
          db.prepare('SELECT MIN(indexed_at) as value FROM files').get() as { value: number | null }
        ).value;
        if (minIndexedAt !== null) {
          db.prepare(`
            INSERT OR IGNORE INTO project_metadata (key, value, updated_at)
            VALUES ('first_indexed_at', ?, ?)
          `).run(String(minIndexedAt), now);
        }
        db.prepare(`
          INSERT OR IGNORE INTO project_metadata (key, value, updated_at)
          VALUES ('first_indexed_by_version', 'unknown', ?)
        `).run(now);
      }
    },
  },
];

/**
 * Get the current schema version from the database
 */
export function getCurrentVersion(db: Database.Database): number {
  try {
    const row = db
      .prepare('SELECT MAX(version) as version FROM schema_versions')
      .get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  } catch {
    // Table doesn't exist yet
    return 0;
  }
}

/**
 * Record a migration as applied
 */
function recordMigration(db: Database.Database, version: number, description: string): void {
  db.prepare(
    'INSERT INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)'
  ).run(version, Date.now(), description);
}

/**
 * Run all pending migrations
 */
export function runMigrations(db: Database.Database, fromVersion: number): void {
  const pending = migrations.filter((m) => m.version > fromVersion);

  if (pending.length === 0) {
    return;
  }

  // Sort by version
  pending.sort((a, b) => a.version - b.version);

  // Run each migration in a transaction
  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      recordMigration(db, migration.version, migration.description);
    })();
  }
}

/**
 * Check if the database needs migration
 */
export function needsMigration(db: Database.Database): boolean {
  const current = getCurrentVersion(db);
  return current < CURRENT_SCHEMA_VERSION;
}

/**
 * Get list of pending migrations
 */
export function getPendingMigrations(db: Database.Database): Migration[] {
  const current = getCurrentVersion(db);
  return migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);
}

/**
 * Get migration history from database
 */
export function getMigrationHistory(
  db: Database.Database
): Array<{ version: number; appliedAt: number; description: string | null }> {
  const rows = db
    .prepare('SELECT version, applied_at, description FROM schema_versions ORDER BY version')
    .all() as Array<{ version: number; applied_at: number; description: string | null }>;

  return rows.map((row) => ({
    version: row.version,
    appliedAt: row.applied_at,
    description: row.description,
  }));
}
