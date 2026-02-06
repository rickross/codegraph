/**
 * Worker thread for parallel reference resolution
 */

import { parentPort, workerData } from 'worker_threads';
import { ReferenceResolver } from './index';
import { QueryBuilder } from '../db/queries';
import Database from 'better-sqlite3';
import type { UnresolvedReference } from '../types';

interface WorkerData {
  projectRoot: string;
  dbPath: string;
  refs: UnresolvedReference[];
}

if (!parentPort) {
  throw new Error('This file must be run as a worker thread');
}

const { projectRoot, dbPath, refs } = workerData as WorkerData;

// Open read-only DB connection for this worker
const db = new Database(dbPath, { readonly: true });
const queries = new QueryBuilder(db);

// Create resolver instance
const resolver = new ReferenceResolver(projectRoot, queries);
resolver.initialize();

// Resolve the chunk of refs
const result = resolver.resolveAll(refs);

// Send results back to main thread
parentPort.postMessage(result);

// Cleanup
db.close();
