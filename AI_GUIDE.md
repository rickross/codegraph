# AI Guide: Using CodeGraph Effectively

> This guide is for AI assistants and human operators who want fast, high-quality code understanding with CodeGraph MCP tools.
> Canonical MCP tool names are short (`search`, `context`, `node`, etc.); legacy `codegraph_*` aliases still work.

## Purpose

CodeGraph is best when you use it as a **semantic graph interface** for code structure and relationships, not as a plain text search replacement.

It helps you answer:
- Where is behavior implemented?
- What calls this symbol?
- What does this symbol call?
- What is the impact radius of changing this?
- What is the shortest path from user input to effect?

## Core Principles

1. Start graph-first, not file-first.
2. Scope queries early (path/language/kind) to reduce noise.
3. Disambiguate symbols explicitly (`kind`, `pathHint`) when names collide.
4. Retrieve code only when needed (`includeCode=true` late, not early).
5. Prefer iterative narrowing over broad exploratory dumps.

## Operating Modes

CodeGraph now works best with two explicit approaches:

### Discovery mode (gain a foothold)
- Use broad intent queries first.
- Allow file nodes and mixed kinds.
- Do not over-constrain too early.

```text
search(query="architecture overview entry points", limit=15)
context(task="Give me a high-level module map and likely entry points", maxNodes=30, includeCode=false)
```

### Focused tracing mode (answer a specific question)
- Constrain by `kind`, `pathHint`, and optionally `language`.
- Prefer `includeFiles=false`.
- Use callers/callees/impact to produce evidence-backed flow.

```text
search(query="submitPrompt", kind="method", pathHint="sdk/js/src/v2/gen", limit=10)
context(task="Trace TUI submit to server processing", kind="function", pathHint="packages/opencode/src", includeFiles=false, includeCode=false)
```

If unsure, start in discovery mode for 1-2 calls, then switch to focused tracing.

## Quick Start (MCP, Focused Trace)

### 1) Set project root

```text
set_root(path="/absolute/path/to/project")
```

### 2) Verify index health

```text
status()
```

If indexing is stale:
- Run `codegraph sync` for incremental updates
- Run `codegraph index` for full rebuild

### 3) Begin with scoped discovery

```text
search(query="session", kind="function", language="typescript", pathHint="cli/cmd/tui", includeFiles=false, limit=10)
```

### 4) Resolve symbol and trace relationships

```text
node(symbol="Session", kind="function", pathHint="cli/cmd/tui", includeCode=false)
callers(symbol="Session", kind="function", pathHint="cli/cmd/tui", limit=20)
callees(symbol="Session", kind="function", pathHint="cli/cmd/tui", limit=20)
```

### 5) Build focused task context

```text
context(
  task="Trace TUI input to server handling and streaming updates",
  maxNodes=30,
  kind="function",
  language="typescript",
  pathHint="packages/opencode/src",
  includeFiles=false,
  includeCode=false
)
```

## Tool Reference

| Tool | Best use | Key params | Notes |
|---|---|---|---|
| `search` | Candidate discovery | `query`, `kind`, `language`, `pathHint`, `includeFiles`, `limit` | Fastest first pass |
| `node` | Symbol details | `symbol`, `kind`, `pathHint`, `includeCode` | Use `includeCode=true` only for finalists |
| `callers` | Upstream impact/use sites | `symbol`, `kind`, `pathHint`, `limit` | Great for entrypoints and usage |
| `callees` | Downstream flow | `symbol`, `kind`, `pathHint`, `limit` | Great for data/control flow tracing |
| `impact` | Change blast radius | `symbol`, `kind`, `pathHint`, `depth` | Start with `depth=2` |
| `context` | Task-level grounding | `task`, `maxNodes`, `kind`, `language`, `pathHint`, `includeFiles`, `includeCode` | Use scoped context to avoid noise |
| `status` | Index sanity check | none | Always check before deep analysis |

## Disambiguation-First Workflow

If a symbol name is common (`Session`, `start`, `loop`, `run`), assume ambiguity.

### Bad

```text
node(symbol="Session", includeCode=true)
```

### Good

```text
node(symbol="Session", kind="function", pathHint="cli/cmd/tui", includeCode=false)
```

### Escalation ladder

1. Add `kind`.
2. Add `pathHint`.
3. Add `language` at search stage.
4. Increase `limit` and inspect candidates.

## Scoped Retrieval Patterns

### Pattern A: Architecture mapping

```text
context(
  task="Map request path from route handlers to persistence",
  maxNodes=35,
  kind="function",
  language="typescript",
  pathHint="src/server",
  includeFiles=false,
  includeCode=false
)
```

Then refine with targeted node/callers/callees lookups.

### Pattern B: Debugging a behavior

```text
search(query="validateToken", kind="function", language="typescript", pathHint="src/auth", limit=10)
callers(symbol="validateToken", kind="function", pathHint="src/auth", limit=20)
callees(symbol="validateToken", kind="function", pathHint="src/auth", limit=20)
impact(symbol="validateToken", kind="function", pathHint="src/auth", depth=2)
```

### Pattern C: Finding file-level anchors

```text
search(query="session.ts", includeFiles=true, pathHint="cli/cmd/tui", limit=10)
```

Use file nodes when path/file intent is explicit.

## MCP-Only Investigation Protocol

Use this when you want strict graph-only investigation (no shell fallback).

1. `set_root(...)`
2. `status()`
3. `context(...)` with `kind/language/pathHint/includeFiles=false`
4. `search(...)` for missing anchors
5. `node(...)` with `includeCode=false`
6. `callers(...)` and `callees(...)`
7. Re-run `node(..., includeCode=true)` on final symbols only
8. Produce final flow with exact symbol + file evidence

## Example: TUI ↔ Server Session Trace

Goal: understand how user input in TUI becomes server execution and streams back.

```text
set_root(path="/Volumes/Terra/Users/rick/Projects/openfork-1.0")
status()

context(
  task="Trace TUI input -> SDK call -> server route -> prompt loop -> streaming updates back to TUI",
  maxNodes=30,
  kind="function",
  language="typescript",
  pathHint="packages/opencode/src",
  includeFiles=false,
  includeCode=false
)

search(query="Session", kind="function", language="tsx", pathHint="cli/cmd/tui", limit=10)
node(symbol="Session", kind="function", pathHint="cli/cmd/tui", includeCode=true)

search(query="prompt", kind="function", language="typescript", pathHint="server/routes", limit=10)
search(query="start", kind="function", language="typescript", pathHint="session/prompt", limit=10)
```

Deliverable format:
- Step-by-step flow (6-10 steps)
- For each step: symbol, file path, role in flow
- Explicit unresolved ambiguities

## Troubleshooting

### Symptom: unrelated results (e.g., SDK/Rust noise)

Actions:
1. Add `pathHint` to target the subsystem.
2. Add `language` filter.
3. Add `kind` filter (`function`, `method`, etc.).
4. Set `includeFiles=false` unless file intent is explicit.
5. Reduce context scope (`maxNodes`) and iterate.

### Symptom: wrong symbol chosen

Actions:
1. Re-run with `kind` + `pathHint`.
2. Use `search` first and inspect top candidates.
3. Use `node(..., includeCode=false)` before full code extraction.

### Symptom: context feels too broad

Actions:
1. Rewrite task with specific subsystem nouns.
2. Add `pathHint` and `language`.
3. Limit to function/method kinds first.
4. Increase precision before increasing breadth.

### Symptom: stale or missing results

Actions:
1. `status()`
2. `codegraph sync`
3. Full `codegraph index` if needed

## Common Mistakes

### Mistake 1: Vague context prompt

Bad:

```text
context(task="learn this project")
```

Better:

```text
context(
  task="Trace OAuth login callback handling and token persistence",
  kind="function",
  language="typescript",
  pathHint="src/auth",
  includeFiles=false,
  includeCode=false
)
```

### Mistake 2: Reading code too early

Bad:

```text
node(symbol="handler", includeCode=true)
```

Better:

```text
search(query="handler", kind="function", pathHint="server/routes", limit=10)
node(symbol="authHandler", kind="function", pathHint="server/routes", includeCode=false)
```

### Mistake 3: Ignoring callers/callees

Reading one symbol rarely explains behavior. Always place it in a graph neighborhood.

### Mistake 4: Overusing deep impact traversals

`depth > 3` often becomes noisy. Start at `depth=2`.

## When to Use CodeGraph vs Other Tools

Use CodeGraph first for:
- Symbol discovery and disambiguation
- Relationship tracing (callers/callees/impact)
- Task context assembly
- Scoped subsystem exploration

Use direct file/content tools when:
- You need exact literal text/strings not represented as symbols
- You need non-code files not indexed into the graph
- You need bulk text operations unrelated to symbol structure

## Quality Checklist for Agents

Before finalizing analysis, verify:
- Root is set to the intended project
- Index is current enough for the task
- Ambiguous symbols were disambiguated with `kind/pathHint`
- Claims are backed by symbol+file evidence
- `includeCode=true` was used only where needed

## Recommended Prompt to Give Another Agent

```text
Use ONLY CodeGraph MCP tools for this investigation (no shell/grep/glob/read fallback).

Project: /absolute/path/to/project
Task: <specific task>

Rules:
- Set root and verify status first.
- Prefer scoped queries (kind, language, pathHint, includeFiles=false).
- If symbol is ambiguous, retry with kind + pathHint.
- Use includeCode=true only on final symbols.

Deliverable:
- 6-10 step flow with exact symbols
- For each step: file path + role
- Explicit unknowns/ambiguities
```

## Performance Guidance

CodeGraph is generally fast for iterative exploration, but speed depends on project size, language mix, and machine resources.

Practical guidance:
- Keep queries specific.
- Avoid broad context calls without filters.
- Use `search -> node(no code) -> callers/callees -> node(with code)` as default loop.

## Appendix: Compact Command Reference

```text
# Project and index
set_root(path="/path/to/project")
status()
# If stale: sync() / index()

# Search and details
search(query="symbol", kind="function", language="typescript", pathHint="src/auth", includeFiles=false, limit=10)
node(symbol="symbol", kind="function", pathHint="src/auth", includeCode=false)

# Graph relationships
callers(symbol="symbol", kind="function", pathHint="src/auth", limit=20)
callees(symbol="symbol", kind="function", pathHint="src/auth", limit=20)
impact(symbol="symbol", kind="function", pathHint="src/auth", depth=2)

# Task context
context(task="specific engineering task", maxNodes=30, kind="function", language="typescript", pathHint="src/auth", includeFiles=false, includeCode=false)
```

This workflow consistently improves precision for both AI and human consumers.
