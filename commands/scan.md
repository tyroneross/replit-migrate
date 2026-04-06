---
name: scan
description: Scan a Replit project for migration readiness
allowed-tools: Bash, Read, Glob, Grep
---

Analyze this project for Replit migration readiness.

Run the `migrate_scan` MCP tool on the current directory{{#if ARGUMENTS}} with project path: {{ARGUMENTS}}{{/if}}.

After the scan completes:
1. Present the migration readiness summary
2. Highlight any Replit-specific dependencies
3. Show the lock-in score
4. Ask: "Would you like to migrate to **web** (Vercel/Cloudflare/standalone) or **native** (iOS/macOS)?"
