---
name: migrate
description: Generate and begin executing a migration plan
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

Generate a migration plan for this Replit project.

{{#if ARGUMENTS}}
Target: {{ARGUMENTS}}
{{/if}}

## Steps

1. If no scan exists (`.replit-migrate/scan-report.json`), run `migrate_scan` first
2. Based on target:
   - If target contains "web", "vercel", "cloudflare", or "standalone": run `migrate_plan_web`
   - If target contains "native", "ios", "macos", or "swift": run `migrate_plan_native`
   - If no target specified: ask the user
3. Present the plan and begin execution:
   - **Web**: Execute tasks in risk order (auth first)
   - **Native**: Present architecture doc first, then execute models → spike → screens
4. Track progress with `migrate_check_progress` after each major section
