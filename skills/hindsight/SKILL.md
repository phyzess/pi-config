---
name: hindsight
description: Agent-curated project memory — retain and recall key insights across sessions. Load at session start and after resolving non-trivial issues.
---

# Hindsight — Agent-Curated Project Memory

Persistent, agent-curated memory for this project. Unlike passive search (context-mode FTS5), Hindsight is **active curation**: the agent decides what is worth remembering and writes it down. Next session, it loads automatically.

## Memory Store

Memory is stored per-project at `<project_root>/.pi/hindsight.jsonl`. One JSON object per line:
```json
{"timestamp": "2026-07-15T10:00:00Z", "context": "refactoring auth module", "insight": "JWT validation happens in middleware/auth.ts:42, secret comes from env.JWT_SECRET", "tags": ["auth", "jwt", "middleware"], "file_paths": ["src/middleware/auth.ts", ".env.example"]}
```

## When to RETAIN (write a memory)

Write a memory entry whenever you discover something that:
1. **Took non-trivial effort** to figure out (hidden dependency, undocumented convention, tricky call chain)
2. **Would save a future agent significant time** (key architecture decisions, non-obvious file relationships)
3. **Is a project-specific convention** (naming patterns, error handling style, test patterns)
4. **Resolved a confusing issue** (root cause of a bug, why a previous fix worked)

Do NOT retain obvious things (file paths, library names) or things easily discovered via codegraph/grep.

### How to write
```bash
echo '{"timestamp":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","context":"<brief context>","insight":"<the insight>","tags":["<tag1>","<tag2>"],"file_paths":["<path1>"]}' >> .pi/hindsight.jsonl
```

## When to RECALL (load memories)

On every session start, load the last 20 entries:
```bash
tail -20 .pi/hindsight.jsonl 2>/dev/null
```

When solving a task in a specific area, search relevant memories:
```bash
grep -i '<keyword>' .pi/hindsight.jsonl | tail -10
```

## When to REFLECT (synthesize)

After completing a significant piece of work, take 30 seconds to reflect:
1. What did you learn that wasn't obvious?
2. What would have made this task faster if you knew it upfront?
3. Retain the top 1-2 insights.

## Integration with context-mode

Hindsight entries complement context-mode's auto-captured events. Context-mode captures errors, decisions, and plans automatically; Hindsight captures strategic insights that require judgment. Both are searchable.
