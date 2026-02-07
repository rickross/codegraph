# An AI Guide to Using CodeGraph

> **For AI Assistants:** This guide helps you leverage CodeGraph effectively to understand and navigate codebases faster than traditional file-by-file exploration.

## 🎯 Core Philosophy

**CodeGraph is a semantic index, not just a file tree.** It understands:
- What functions/classes exist and where they are
- What calls what (call graph)
- What imports what (dependency graph)
- What extends/implements what (inheritance)

**Think of it like having X-ray vision into code structure.**

---

## 🚀 Quick Start Workflow

### 1. **Set Your Project Root**
```
codegraph_set_root("/path/to/project")
```
This switches CodeGraph to work with a specific project.

### 2. **Check Status**
```
codegraph_status()
```
See if the project is indexed. Look for:
- Number of files/nodes/edges
- Whether index is up to date

### 3. **Search for Entry Points**
```
codegraph_search("main")
codegraph_search("server")
codegraph_search("handler")
```
Find where the action starts.

### 4. **Explore from There**
Once you find a key function:
```
codegraph_node("functionName", includeCode=true)  // Get details + source
codegraph_callers("functionName")                  // What calls this?
codegraph_callees("functionName")                  // What does this call?
```

---

## 🎓 The Five Essential Patterns

### Pattern 1: **"Where does X happen?"**
**Goal:** Find where authentication/logging/processing happens

**Approach:**
```
1. codegraph_search("authenticate")
2. Look at results, pick most relevant
3. codegraph_node("authenticate", includeCode=true)
4. codegraph_callers("authenticate") → see where it's used
```

**Why this works:** CodeGraph's FTS5 search finds symbols by name, then the graph shows you connections.

---

### Pattern 2: **"What does this function affect?"**
**Goal:** Understand impact of changing a function

**Approach:**
```
1. codegraph_impact("functionName", depth=2)
```

**What you get:**
- Direct callers (depth 1)
- Indirect callers (depth 2)
- Everything that could break if you change this

**Pro tip:** Start with depth=2. Go deeper only if needed (gets noisy).

---

### Pattern 3: **"How do I implement X?"**
**Goal:** Gather context for building a new feature

**Approach:**
```
1. codegraph_context("implement user authentication", maxNodes=20)
```

**What you get:**
- Relevant entry points
- Related symbols
- Code snippets

**Then refine:**
```
2. codegraph_search("User")
3. codegraph_node("User", includeCode=true)
4. codegraph_callees("User") → see what User interacts with
```

**Why two steps?** `context` gives you the overview, then use `search`/`node`/`callers`/`callees` for precision.

---

### Pattern 4: **"What's the call chain from A to B?"**
**Goal:** Trace how data flows through the system

**Approach:**
```
1. codegraph_node("entryFunction", includeCode=true)
2. codegraph_callees("entryFunction")
   → Note: calls processData
3. codegraph_node("processData", includeCode=true)
4. codegraph_callees("processData")
   → Note: calls validateInput, saveToDb
5. Continue following the chain
```

**Pro tip:** Draw a mental (or actual) diagram as you go. CodeGraph gives you the graph, you interpret the flow.

---

### Pattern 5: **"What are the main modules?"**
**Goal:** Understand high-level architecture

**Approach:**
```
1. codegraph_search("index")  // Find index.ts, index.js files (often entry points)
2. codegraph_search("router")  // Find routing logic
3. codegraph_search("controller")  // Find business logic
4. For each main file:
   codegraph_node("MainClass", includeCode=false)  // Just metadata
   codegraph_callees("MainClass")  // See dependencies
```

**Why this works:** Entry points and routers define the module structure. Following their callees shows you the layers.

---

## 🎯 Tool Reference Card

| Tool | Use When | Returns |
|------|----------|---------|
| `codegraph_search` | Find symbols by name | List of matches |
| `codegraph_node` | Get details about a specific symbol | Code + metadata |
| `codegraph_callers` | "What calls this?" | Functions that depend on this |
| `codegraph_callees` | "What does this call?" | Functions this depends on |
| `codegraph_impact` | "What breaks if I change this?" | Ripple effect (transitive callers) |
| `codegraph_context` | "Give me relevant code for task X" | Entry points + related code |
| `codegraph_status` | "Is this project indexed?" | Stats about the index |

---

## ⚡ Performance Tips

### CodeGraph is FAST (7 seconds to index 882 files!)
- **Don't hesitate to use it.** It's not expensive.
- **Search first, read later.** Don't grep through files manually.
- **Use `includeCode=false` for broad exploration.** Only request code when you need it.

### When to Use Each Tool

**🔍 Discovery Phase (exploring unfamiliar code):**
```
1. codegraph_search → find candidates
2. codegraph_node (includeCode=false) → scan options quickly
3. codegraph_callers/callees → understand relationships
4. codegraph_node (includeCode=true) → read the winners
```

**🎯 Implementation Phase (building something):**
```
1. codegraph_context → get relevant context in one shot
2. codegraph_node (includeCode=true) → deep dive on key symbols
3. codegraph_impact → check what you might break
```

**🐛 Debugging Phase (fixing a bug):**
```
1. codegraph_search → find the function with the bug
2. codegraph_callers → see how it's being called (wrong inputs?)
3. codegraph_callees → see what it calls (where does it fail?)
4. codegraph_impact → understand blast radius of a fix
```

---

## 🚫 Common Mistakes

### ❌ Mistake 1: Using `context` without a clear task
```
codegraph_context("learn about the project")  // Too vague!
```
**Better:**
```
codegraph_context("implement OAuth authentication flow")  // Specific!
```

### ❌ Mistake 2: Reading files before searching
```
1. Read src/index.ts
2. Read src/auth.ts
3. Read src/database.ts
```
**Better:**
```
1. codegraph_search("authenticate")
2. codegraph_node("authenticate", includeCode=true)  // Directly to the right code!
```

### ❌ Mistake 3: Not using callers/callees
```
codegraph_node("processPayment", includeCode=true)
// Now what? How is this used?
```
**Better:**
```
codegraph_node("processPayment", includeCode=true)
codegraph_callers("processPayment")  // Ah! Called from checkout.ts and api.ts
```

### ❌ Mistake 4: Using impact with depth > 3
```
codegraph_impact("logMessage", depth=5)  // Returns 500 results, total noise
```
**Better:**
```
codegraph_impact("logMessage", depth=2)  // Manageable set of affected code
```

---

## 🎓 Advanced Patterns

### Finding Framework Entry Points (Express, React, Next.js, etc.)

**Express/Node:**
```
codegraph_search("app.listen")  // Server start
codegraph_search("app.use")     // Middleware
codegraph_search("app.get")     // Routes
```

**React:**
```
codegraph_search("ReactDOM.render")  // App entry
codegraph_search("App")              // Main component
codegraph_search("useState")         // Stateful components
```

**Next.js:**
```
codegraph_search("getServerSideProps")  // SSR pages
codegraph_search("getStaticProps")      // SSG pages
codegraph_search("API")                 // API routes
```

### Finding Test Coverage
```
codegraph_search("test")
codegraph_search("describe")
codegraph_search("it")
```
Then use `callers` to see what's tested!

### Finding Security-Sensitive Code
```
codegraph_search("password")
codegraph_search("token")
codegraph_search("auth")
codegraph_search("decrypt")
```

---

## 💡 Pro Tips from Expert AI Users

### 1. **Chain searches to narrow down**
```
codegraph_search("user")       // 50 results, too many
codegraph_search("createUser") // 5 results, perfect!
```

### 2. **Use node + callers to understand APIs**
```
codegraph_node("apiHandler", includeCode=true)  // See what it does
codegraph_callers("apiHandler")                 // See how it's called (routes!)
```

### 3. **Impact analysis before refactoring**
```
codegraph_impact("oldFunction", depth=2)
// If > 20 callers → careful!
// If < 5 callers → safe to refactor
```

### 4. **Context + search combo for new features**
```
codegraph_context("implement rate limiting")     // Get overview
codegraph_search("middleware")                   // Find where to plug it in
codegraph_node("authMiddleware", includeCode=true)  // See similar pattern
```

### 5. **Use status to know if you need to sync**
```
codegraph_status()
// If you changed files recently, run:
codegraph_sync()
```

---

## 🎬 Real Example: "Add Logging to All API Endpoints"

**Without CodeGraph:**
1. Find all API files manually (grep? tree?)
2. Read each file
3. Find the handler functions
4. Add logging to each
5. Miss 3 files because they were named differently

**With CodeGraph:**
```
1. codegraph_search("handler")
   → Found: authHandler, userHandler, paymentHandler, webhookHandler

2. For each handler:
   codegraph_node("authHandler", includeCode=true)
   → See the signature, understand the pattern

3. codegraph_callees("authHandler")
   → See what it already does (maybe it already logs?)

4. Add logging to each, confident you found them all
```

**Time saved:** 80% (and you didn't miss anything!)

---

## 🤝 Working with Other Agents

If another AI agent (like Telos, Kai, or Starshine) is using CodeGraph:
- **Ask them to show their workflow** - different agents have different styles
- **Share discoveries** - "I found X using codegraph_search"
- **Divide and conquer** - one agent explores, another implements

---

## 📚 When to Use CodeGraph vs. Other Tools

| Task | Use CodeGraph? | Alternative |
|------|----------------|-------------|
| Find where a function is defined | ✅ `codegraph_search` | grep/ripgrep |
| See what calls a function | ✅ `codegraph_callers` | Manual search |
| Understand function logic | ✅ `codegraph_node` + Read | Read tool directly |
| See file contents | ❌ Use Read tool | Read tool |
| Find files by path pattern | ❌ Use Glob tool | Glob tool |
| Search file contents | ❌ Use Grep tool | Grep tool |
| Understand relationships | ✅ CodeGraph is best | No good alternative |

**Rule of thumb:** 
- **Structure/relationships?** → CodeGraph
- **Content/text?** → Read/Grep/Glob

---

## 🎯 Success Metrics

**You're using CodeGraph well if:**
- ✅ You find the right code in < 3 tool calls
- ✅ You understand call relationships without reading every file
- ✅ You can explain "X calls Y which calls Z" confidently
- ✅ You discover edge cases by following the graph

**You're not using it well if:**
- ❌ You're still reading files sequentially to find things
- ❌ You're using grep when search would be faster
- ❌ You're guessing at relationships instead of checking callers/callees
- ❌ You're asking the user "where is X?" when CodeGraph could tell you

---

## 🚀 Next Level: Understanding the Index

CodeGraph indexes:
- **Nodes:** Functions, classes, methods, variables, types
- **Edges:** Calls, imports, extends, implements, references

**This means:**
- If it's declared in code, CodeGraph knows about it
- If it's a relationship, CodeGraph tracked it
- Built-ins (like `map`, `parseInt`) are NOT indexed (they're external)

**Unresolved references** = things that couldn't be traced:
- External libraries (node_modules)
- Built-in functions
- Dynamic calls (eval, computed properties)

**This is normal and expected!**

---

## 🎓 Graduation Test

**You've mastered CodeGraph when you can:**

1. Find all functions that call `processPayment` (< 30 seconds)
2. Explain the call chain from `main()` to `saveToDatabase()` (< 2 minutes)
3. Gather context for "add rate limiting" without reading files manually (< 1 minute)
4. Identify which functions would break if you change `validateUser()` (< 1 minute)

**If you can do all four, you're a CodeGraph expert!** 🎯

---

## 🙏 Credits

CodeGraph was optimized from 2m 31s → 7s through collaborative debugging by Rick and Telos, with major contributions to the hybrid InMemory+FTS5 approach that achieves 100% accuracy at 21.7x speed.

**Now go forth and navigate code like a boss!** 🚀

---

## 📖 Appendix: Quick Command Reference

```bash
# Project management
codegraph_set_root("/path/to/project")
codegraph_status()
codegraph_sync()

# Discovery
codegraph_search("symbolName")
codegraph_node("symbolName", includeCode=true)

# Relationships
codegraph_callers("symbolName")
codegraph_callees("symbolName")
codegraph_impact("symbolName", depth=2)

# Context building
codegraph_context("task description", maxNodes=20)
```

**That's it! Now you're ready to use CodeGraph like a pro.** 🎯
