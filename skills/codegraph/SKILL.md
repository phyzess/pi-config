---
name: codegraph
description: Use CodeGraph as the primary tool for code structure, call graphs, and impact analysis. Load whenever you need to explore, trace, or understand code.
---

# codegraph

Leverage CodeGraph — a code intelligence and knowledge graph engine — as the primary tool for understanding code structure, call graphs, and impact analysis.

## When to Use This Skill

**Use codegraph FIRST (before grep/rg/find/read) whenever you need to:**

- Find which functions/methods call a specific symbol (callers)
- Find what functions/methods a symbol calls (callees)
- Understand the impact of changing a function/class (impact analysis)
- Discover which test files are affected by changed source files
- Explore a code area with symbols, source, and call paths in one shot
- Look up a symbol's source code with its caller/callee trail
- Search for symbols across the entire codebase
- Navigate unfamiliar code — codegraph gives structural answers that grep cannot

## When NOT to Use

- Reading a known file path (use `read`)
- File system operations (use `bash`, `ls`, `find`)
- Editing or writing files (use `edit`, `write`)
- Running build/test commands (use `bash`)

## Available Tools

### Primary (direct tools)
- `codegraph_explore` — Explore an area: relevant symbols' source + call paths in one shot. Best for "how does X work?"
- `codegraph_node` — One symbol's source + caller/callee trail, or read a file with line numbers + dependents

### Secondary (via mcp proxy)
- `codegraph_query` — Search for symbols by name
- `codegraph_callers` — List all callers of a symbol
- `codegraph_callees` — List all callees of a symbol
- `codegraph_impact` — Analyze what code is affected by changing a symbol
- `codegraph_affected` — Find test files affected by changed source files

## Workflow Pattern

1. **Exploring unknown code:** use `codegraph_explore` with a natural-language query describing what you're looking for
2. **Tracing call chains:** use `codegraph_node` on a symbol to see callers and callees
3. **Before refactoring:** use `codegraph_impact` to understand blast radius
4. **After making changes:** use `codegraph_affected` to find relevant tests
5. **Finding implementations:** use `codegraph_query` to locate symbols by name

## Anti-patterns
- Do NOT grep for function names to find callers — use codegraph_callers
- Do NOT manually trace imports to understand dependencies — use codegraph_node
- Do NOT guess which tests to run after changes — use codegraph_affected
