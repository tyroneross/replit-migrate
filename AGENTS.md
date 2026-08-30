# AGENTS.md — replit-migrate

Universal AI agent guidance for Claude Code, Codex, Cursor, Copilot, and any other AI coding agent working in this repository.

---

## What This Project Is

`@tyroneross/replit-migrate` analyzes Replit projects and generates risk-ordered migration plans for web (Vercel / Cloudflare / standalone) or native (iOS / macOS) targets. Plans encode lessons from real migrations — auth-first ordering, bundler config upfront, architecture doc before code — so agents and developers skip the iterations those projects burned.

- **npm package:** `@tyroneross/replit-migrate` (v0.1.1)
- **License:** Apache-2.0
- **Runtime:** Node.js, TypeScript (ES2022, NodeNext)

---

## Capabilities (MCP Tools)

The migration capability is delivered entirely through MCP tools registered in `.mcp.json` (`dist/mcp/server.js`). All six tools are host-neutral — callable from Codex, Claude Code, or any MCP-capable host.

| Tool | Purpose | When to call |
|------|---------|-------------|
| `migrate_scan` | Analyze project: stack, auth, DB, API routes, env vars, browser APIs, Replit-specific deps. Writes `.replit-migrate/scan-report.json`. | **Always first** — required before planning |
| `migrate_map_apis` | Deep per-route analysis: parameters, response shapes, middleware, Replit classification | After scan, when detailed route mapping is needed |
| `migrate_map_models` | Translate data models (Drizzle / Prisma → SwiftData, Drizzle, or Prisma) with field-level type notes | After scan, when previewing model translation |
| `migrate_plan_web` | Generate risk-ordered web migration plan (Vercel / Cloudflare / standalone). Requires scan first. | After scan, when target is web |
| `migrate_plan_native` | Generate native iOS / macOS migration plan with architecture doc. Requires scan first. | After scan, when target is iOS / macOS |
| `migrate_check_progress` | Compare filesystem state against active plan; auto-promotes heuristically-detected completed tasks | During migration execution to track status |

All tools accept `project_path` (defaults to cwd). Plans are persisted under `.replit-migrate/` as both JSON and readable Markdown.

---

## Workflow

Call in this order:

1. **`migrate_scan`** — produces lock-in score (0–10), stack summary, and risk areas. Required before any other tool.
2. **`migrate_map_apis`** and/or **`migrate_map_models`** *(optional)* — use when deeper route or model detail is needed before planning.
3. **`migrate_plan_web`** or **`migrate_plan_native`** — generates the full task list, ordered by risk (auth and architecture first).
4. **`migrate_check_progress`** — call repeatedly during execution to track completion and surface remaining Replit references.

---

## Agent / Skills

**`migration-analyst` agent** (`agents/migration-analyst.md`) — exhaustive 5-phase investigation: project census, Replit dependency audit, auth deep dive, data flow mapping, readiness report. Use when the standard scan output isn't thorough enough or hidden dependencies are suspected. Read-only; analysis only.

**Skills (3):**

| Skill | Trigger |
|-------|---------|
| `migration-scan` | "scan this Replit app", "analyze for migration", `.replit` file present |
| `migrate-web` | "migrate to web", "deploy to Vercel", "move off Replit" |
| `migrate-ios` | "migrate to iOS", "native app", "build for iPhone" |

Skills provide workflow guidance and decision trees; the underlying work is done by calling the MCP tools above. All 3 are `user-invocable: false` — Claude auto-loads them from their trigger description; the user reaches them through `/replit-migrate`, not a direct skill call.
