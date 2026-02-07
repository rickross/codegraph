import { CodeGraph } from './src/index';

async function checkSearch() {
  // Open old DB
  const oldCG = await CodeGraph.open('/Volumes/Terra/Users/rick/Projects/langchain-ai/langgraph', {
    dbPath: '/Volumes/Terra/Users/rick/Projects/langchain-ai/langgraph/.codegraph-orig/codegraph.db'
  });
  
  // Open new DB  
  const newCG = await CodeGraph.open('/Volumes/Terra/Users/rick/Projects/langchain-ai/langgraph');
  
  // Search for "get" method
  const oldResults = (oldCG as any).queries.searchNodes('get', { limit: 20 });
  const newResults = (newCG as any).queries.searchNodes('get', { limit: 20 });
  
  console.log('OLD search for "get":');
  oldResults.slice(0, 5).forEach((r: any, i: number) => {
    console.log(`  ${i+1}. ${r.node.qualifiedName || r.node.name} (score: ${r.score.toFixed(2)})`);
  });
  
  console.log('\nNEW search for "get":');
  newResults.slice(0, 5).forEach((r: any, i: number) => {
    console.log(`  ${i+1}. ${r.node.qualifiedName || r.node.name} (score: ${r.score.toFixed(2)})`);
  });
  
  oldCG.close();
  newCG.close();
}

checkSearch().catch(console.error);
