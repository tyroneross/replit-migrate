---
name: migrate-web
description: >-
  This skill should be used when the user asks to "migrate to web app",
  "deploy to Vercel", "move to Cloudflare", "convert from Replit to web",
  "get off Replit", "deploy as standalone", "make this a real web app",
  "self-host this app", or "deploy to production".
version: 0.1.0
user-invocable: true
argument-hint: <target>
---

# Web Migration

Generate and execute a migration plan from Replit to Vercel, Cloudflare, or
standalone deployment. Encodes lessons from real ProductPilot migration
(30+ commits, auth burned 6+ fix commits).

## Encoded Lessons

These lessons are hardcoded into the plan generator — they shape task ordering
and risk ratings automatically:

1. **Spike auth first** — Auth replacement burned the most iterations in
   ProductPilot. The plan requires a spike step before any auth code changes.
2. **Generate bundler config upfront** — Bundling for serverless was 4+ fix
   commits of trial-and-error. Config is generated as the first code change.
3. **Wire ALL call sites atomically** — Partial token wiring creates bugs.
   Auth tasks require changing every call site in one pass.

## Workflow

1. Check if scan exists (`.replit-migrate/scan-report.json`). If not, run
   `migrate_scan` first.
2. Run `migrate_plan_web` with the user's preferred target.
3. Present the plan as a risk-ordered checklist.
4. Begin executing tasks in order, starting with auth (highest risk).
5. After each major section, run `migrate_check_progress` to track status.

## Decision Tree

| User Intent | Tools | Notes |
|-------------|-------|-------|
| "Deploy to Vercel" | scan → `migrate_plan_web`(vercel) | Generates vercel.json |
| "Deploy to Cloudflare" | scan → `migrate_plan_web`(cloudflare) | Generates wrangler.toml |
| "Standalone server" | scan → `migrate_plan_web`(standalone) | No serverless constraints |
| "What's my progress?" | `migrate_check_progress` | Shows done/remaining/blockers |

## Targets

| Target | Auth Default | DB Default | Bundling |
|--------|-------------|-----------|----------|
| Vercel | Clerk | Neon serverless | esbuild + vercel.json |
| Cloudflare | Auth.js | D1/Turso | wrangler.toml |
| Standalone | Auth.js | Direct Postgres | Docker/build script |

Plan saved to `.replit-migrate/WEB_MIGRATION_PLAN.md`.
