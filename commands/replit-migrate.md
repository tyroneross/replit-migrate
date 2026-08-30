---
name: replit-migrate
description: Main replit-migrate entry. Dispatches to the matching action based on your request, or lists options if unclear.
argument-hint: "[what you want to do]"
---

# /replit-migrate — Router

Route this request to the appropriate action based on the user's intent, then perform it
directly. This is the plugin's only command — there are no separate subcommands to dispatch
to; call the underlying `replit-migrate` MCP tools and skills yourself using the guidance below.

**Raw user input**: $ARGUMENTS

## Routing logic

1. If `$ARGUMENTS` is empty or only whitespace: list the available actions below and ask the user what they want to do.
2. Otherwise: match the user's natural-language request against the action intents below and perform the matching action.
3. If the request clearly matches one of the `migrate-ios`, `migrate-web`, or `migration-scan` skills' trigger guidance (listed in your available skills), load that skill and follow it instead of the summarized steps below.
4. If nothing fits, say so and list the actions. Do NOT guess.

## Available actions

- **scan** — Analyze this project for Replit migration readiness. Run the `migrate_scan` MCP tool on the current directory (or the given project path). Then present the migration readiness summary, highlight Replit-specific dependencies, show the lock-in score, and ask: "Would you like to migrate to **web** (Vercel/Cloudflare/standalone) or **native** (iOS/macOS)?"
- **migrate** — Generate and begin executing a migration plan.
  1. If no scan exists (`.replit-migrate/scan-report.json`), run `migrate_scan` first.
  2. Based on the target: if it contains "web", "vercel", "cloudflare", or "standalone", run `migrate_plan_web` (the `migrate-web` skill); if it contains "native", "ios", "macos", or "swift", run `migrate_plan_native` (the `migrate-ios` skill); if no target was specified, ask the user.
  3. Present the plan and begin execution — **web**: execute tasks in risk order (auth first); **native**: present the architecture doc first, then execute models -> spike -> screens.
  4. Track progress with `migrate_check_progress` after each major section.

For bugs or feedback about the plugin itself, use `/replit-migrate:feedback`.

## Examples

- User types `/replit-migrate` alone → list actions, ask for direction
- User types `/replit-migrate <free-form request>` → match intent, perform the matching action
- User asks for something outside these actions → say so, list the actions, do not guess

## Rules

- Prefer the most specific action match. If two could fit, ask which.
- Never invent an action or MCP tool that isn't listed above.
- If the user is describing a workflow that spans multiple actions (e.g. scan then migrate), outline the sequence and ask whether to proceed.
