/**
 * Worker thread for parallel reference resolution (no DB access)
 */

import { parentPort, workerData } from 'worker_threads';
import type { UnresolvedReference, Node } from '../types';
import { InMemoryQueryBuilder } from './in-memory-query-builder';
import { ReferenceResolver } from './index';

interface WorkerData {
  projectRoot: string;
  allNodes: Node[];
  refs: UnresolvedReference[];
}

if (!parentPort) {
  throw new Error('This file must be run as a worker thread');
}

const { projectRoot, allNodes, refs } = workerData as WorkerData;

// Create in-memory query builder from pre-loaded nodes
const queries = new InMemoryQueryBuilder(allNodes);

// Create resolver instance
const resolver = new ReferenceResolver(projectRoot, queries);
resolver.initialize();

// Resolve the chunk of refs
const result = resolver.resolveAll(refs);

// Send results back to main thread
parentPort.postMessage(result);
