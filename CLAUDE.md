# Replit-Migrate — Migration Context for Claude

## What This Plugin Does

Analyzes Replit projects and generates migration plans for web (Vercel/Cloudflare/standalone) or native (iOS/macOS) targets. Encodes lessons from real migrations to reduce iterations.

## Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `migrate_scan` | Analyze project: stack, auth, DB, routes, env vars, browser APIs | First — before any planning |
| `migrate_plan_web` | Generate web migration plan with risk-ordered tasks | After scan, when target is web |
| `migrate_plan_native` | Generate native migration plan with architecture doc | After scan, when target is iOS/macOS |
| `migrate_map_apis` | Deep API route analysis with parameter/response shapes | When detailed route mapping needed |
| `migrate_map_models` | Translate data models (Drizzle/Prisma → SwiftData) | When previewing model translation |
| `migrate_check_progress` | Compare filesystem state against plan | During migration execution |

## Slash Commands

| Command | Purpose |
|---------|---------|
| `/replit-migrate:scan` | Scan project for migration readiness |
| `/replit-migrate:migrate <target>` | Generate and execute migration plan |

## Encoded Lessons

These are baked into the generators — they shape task ordering automatically:

### From ProductPilot (Replit → Vercel, 30+ commits)
- **Auth burns the most iterations.** Spike it first. Map ALL differences before coding.
- **Bundler config upfront.** Don't trial-and-error — generate the config as the first code change.
- **Wire ALL call sites atomically.** Partial auth/token wiring = bugs.

### From FloDoro (51 TestFlight builds)
- **Architecture doc before code.** Highest-ROI artifact across all projects.
- **Platform constraints before UI.** Research touch targets, permissions, HIG before designing screens.
- **Native APIs before custom.** Use SFSpeechRecognizer, not a custom wrapper. Use .sheet(), not BottomSheetModifier.
- **IBR scanning from build 1.** Don't wait until build 36.
- **iOS only first.** Don't multiplatform until the core is stable.

## Storage

```
.replit-migrate/
├── scan-report.json          ← Project analysis
├── web-plan.json             ← Web migration plan (JSON)
├── WEB_MIGRATION_PLAN.md     ← Web migration plan (readable)
├── native-plan.json          ← Native migration plan (JSON)
├── NATIVE_MIGRATION_PLAN.md  ← Native migration plan (readable)
└── progress.json             ← Task completion tracking
```

## Migration Workflow

1. **Scan** → Understand the project
2. **Plan** → Generate risk-ordered task list
3. **Execute** → Follow the plan, auth/architecture first
4. **Check** → Track progress, verify completion
