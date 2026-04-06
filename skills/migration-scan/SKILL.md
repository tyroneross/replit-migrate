---
name: migration-scan
description: >-
  This skill should be used when the user asks to "scan this Replit app",
  "analyze for migration", "what needs to change to move off Replit",
  "what's Replit-specific in this project", "migration readiness",
  "can I deploy this elsewhere", "check Replit dependencies",
  or when a .replit file is detected in the project directory.
version: 0.1.0
user-invocable: true
argument-hint: <project-path>
---

# Migration Scan

Analyze a Replit project to produce a migration readiness report — stack, auth,
database, API routes, environment variables, browser APIs, and Replit-specific
dependencies.

## When to Activate

- User asks about migrating from Replit
- User asks what framework/stack a project uses
- User asks about Replit-specific dependencies
- `.replit` or `replit.nix` file detected in project
- User mentions "move off Replit", "deploy elsewhere", "self-host"

## Workflow

1. Run the `migrate_scan` MCP tool on the project directory
2. Present the migration readiness brief:
   - **Stack**: Runtime, framework, frontend, ORM, bundler
   - **Replit Lock-in Score**: 0-10 (higher = more Replit-specific)
   - **Auth**: Method detected, is it Replit-specific?
   - **Database**: Type, ORM, is it Replit-hosted?
   - **Browser APIs**: Any that need native equivalents for iOS?
   - **Routes**: Total, auth-required, Replit-specific
3. Ask user what they want to migrate to (web or native) unless already stated

## Decision Tree

| User Intent | Tool | Follow-up |
|-------------|------|-----------|
| "What does this app use?" | `migrate_scan` | Show stack summary |
| "Can I move this off Replit?" | `migrate_scan` | Show Replit dependencies + lock-in score |
| "What needs to change?" | `migrate_scan` then `migrate_map_apis` | Show Replit-specific code |
| "How hard is the migration?" | `migrate_scan` | Show complexity estimate + risk areas |

## Output Interpretation

**Lock-in Score:**
- 0-2: Easy migration — minimal Replit dependencies
- 3-5: Moderate — auth or database tied to Replit
- 6-8: Significant — multiple Replit services in use
- 9-10: Deep coupling — extensive Replit platform usage

Full report saved to `.replit-migrate/scan-report.json`.
