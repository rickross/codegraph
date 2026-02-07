import Database from 'better-sqlite3';

const oldDb = new Database('/Volumes/Terra/Users/rick/Projects/langchain-ai/langgraph/.codegraph-orig/codegraph.db', { readonly: true });
const newDb = new Database('/Volumes/Terra/Users/rick/Projects/langchain-ai/langgraph/.codegraph/codegraph.db', { readonly: true });

// Get edges from old DB
const oldEdges = oldDb.prepare('SELECT from_node_id, to_node_id, kind FROM edges').all();
const oldSet = new Set(oldEdges.map((e: any) => `${e.from_node_id}:${e.to_node_id}:${e.kind}`));

// Get edges from new DB
const newEdges = newDb.prepare('SELECT from_node_id, to_node_id, kind FROM edges').all();
const newSet = new Set(newEdges.map((e: any) => `${e.from_node_id}:${e.to_node_id}:${e.kind}`));

console.log(`Old edges: ${oldSet.size}`);
console.log(`New edges: ${newSet.size}`);

// Find differences
const onlyInOld: string[] = [];
const onlyInNew: string[] = [];

for (const edge of oldSet) {
  if (!newSet.has(edge)) onlyInOld.push(edge);
}

for (const edge of newSet) {
  if (!oldSet.has(edge)) onlyInNew.push(edge);
}

console.log(`\nOnly in old: ${onlyInOld.length}`);
console.log(`Only in new: ${onlyInNew.length}`);

// Sample 10 from each
console.log(`\n=== Sample edges only in OLD (first 10) ===`);
for (let i = 0; i < Math.min(10, onlyInOld.length); i++) {
  const [fromId, toId, kind] = onlyInOld[i].split(':');
  const fromNode = oldDb.prepare('SELECT name, qualified_name FROM nodes WHERE id = ?').get(fromId) as any;
  const toNode = oldDb.prepare('SELECT name, qualified_name FROM nodes WHERE id = ?').get(toId) as any;
  console.log(`${i+1}. ${fromNode?.qualified_name || fromNode?.name} --${kind}--> ${toNode?.qualified_name || toNode?.name}`);
}

console.log(`\n=== Sample edges only in NEW (first 10) ===`);
for (let i = 0; i < Math.min(10, onlyInNew.length); i++) {
  const [fromId, toId, kind] = onlyInNew[i].split(':');
  const fromNode = newDb.prepare('SELECT name, qualified_name FROM nodes WHERE id = ?').get(fromId) as any;
  const toNode = newDb.prepare('SELECT name, qualified_name FROM nodes WHERE id = ?').get(toId) as any;
  console.log(`${i+1}. ${fromNode?.qualified_name || fromNode?.name} --${kind}--> ${toNode?.qualified_name || toNode?.name}`);
}

oldDb.close();
newDb.close();
