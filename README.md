# replit-migrate

Claude Code plugin that migrates Replit apps to web (Vercel/Cloudflare/standalone) or native iOS/macOS apps. Generates risk-ordered migration plans with lessons encoded from real migrations.

## Install

```bash
npm install -g @tyroneross/replit-migrate
```

Or install as a Claude Code plugin:
```bash
claude plugin add @tyroneross/replit-migrate
```

## Usage

### As Claude Code Plugin

```
# Scan a Replit project
/replit-migrate:scan

# Generate a web migration plan
/replit-migrate:migrate web

# Generate a native iOS migration plan  
/replit-migrate:migrate native
```

### As CLI

```bash
# Scan
replit-migrate scan ./my-replit-app

# Plan web migration
replit-migrate plan web ./my-replit-app --deploy vercel

# Plan native migration
replit-migrate plan native ./my-replit-app --platform ios

# Check progress
replit-migrate progress ./my-replit-app
```

## What It Detects

- **Stack**: Runtime, framework, frontend, bundler, ORM, styling
- **Auth**: Replit OIDC, magic link, JWT, session — flags Replit-specific auth
- **Database**: Postgres, SQLite, MongoDB — flags Replit-hosted DBs
- **API Routes**: Method, path, auth requirements, Replit-specific code
- **Environment Variables**: Categorized, with Replit-specific flags
- **Browser APIs**: SpeechRecognition, geolocation, etc. — mapped to native equivalents
- **Replit Dependencies**: .replit, replit.nix, @replit/* packages, REPLIT_* env vars

## Encoded Lessons

Plans are shaped by real migration experience:

| Lesson | Source | Effect |
|--------|--------|--------|
| Spike auth first | ProductPilot (6+ fix commits) | Auth tasks ordered first in web plans |
| Bundler config upfront | ProductPilot (4+ fix commits) | Config generation before feature code |
| Architecture doc first | FloDoro (51 builds) | Native plans start with architecture doc |
| Platform constraints before UI | FloDoro watchOS redesign | Constraint checklist before any views |
| IBR from build 1 | FloDoro (caught issues at build 36) | Testing included from first task |

## License

MIT
