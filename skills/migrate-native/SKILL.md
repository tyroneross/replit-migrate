---
name: migrate-native
description: >-
  This skill should be used when the user asks to "make this an iOS app",
  "convert to native", "port to Swift", "build a macOS version",
  "make this a native app", "SwiftUI version", "convert web app to mobile",
  "build an iPhone app from this", or "native iOS version".
version: 0.1.0
user-invocable: true
argument-hint: <platforms>
---

# Native Migration

Generate and execute a migration plan from a Replit web app to a native
iOS/macOS app using SwiftUI and SwiftData. Encodes lessons from FloDoro
(51 TestFlight builds, watchOS redesign was a full restart).

## Encoded Lessons

These lessons are hardcoded into the plan generator:

1. **Architecture doc before code** — FloDoro's APPLE_ECOSYSTEM_PLAN.md was
   the highest-ROI artifact. The plan generates an architecture doc as the
   FIRST deliverable, before any Swift code.
2. **Platform constraints before UI** — FloDoro's watchOS redesign (builds
   27-35) was a full restart because constraints weren't researched first.
   The plan includes a constraint checklist before any view code.
3. **Native APIs before custom** — FloDoro replaced a custom BottomSheetModifier
   and Timer implementation with native SwiftUI APIs. The plan flags browser
   APIs that have native equivalents and says "use native."
4. **Spike the scariest API first** — If the app uses SpeechRecognition or
   other high-risk browser APIs, the plan requires spiking them on a real
   device before building any UI around them.
5. **IBR scanning from build 1** — FloDoro waited until build 36. Every scan
   saved = one fewer iteration.
6. **iOS only first** — Don't add watchOS/macOS until iOS is solid. FloDoro's
   watchOS redesign proves multiplatform before core is stable = wasted builds.

## Workflow

1. Check if scan exists. If not, run `migrate_scan` first.
2. Run `migrate_plan_native` with target platforms.
3. Present the architecture doc FIRST — do not start coding until reviewed.
4. Execute in order: models → spike risky API → navigation → screens → services.
5. Run IBR native scanning after each screen.

## Strategy: Local-First vs API-Backed

| Approach | When to Use | Trade-offs |
|----------|------------|------------|
| **Local-first** (default) | App works standalone, data stays on device | No server, no hosting, works offline. Need API key for LLM calls |
| **API-backed** | Need cross-device sync or server-side processing | More moving parts, need to deploy + maintain server |

Default is local-first (SwiftData) — lowest iteration path based on
ProductPilot's lesson that server infrastructure burns the most commits.

## Decision Tree

| User Intent | Tools | Notes |
|-------------|-------|-------|
| "Make this an iOS app" | scan → `migrate_plan_native`(ios) | iOS-only plan |
| "iOS and macOS" | scan → `migrate_plan_native`(ios, macos) | Multiplatform |
| "What would the data models look like?" | `migrate_map_models`(swiftdata) | Preview translation |
| "Keep the server" | `migrate_plan_native`(ios, keep_api=true) | API-backed |

Plan saved to `.replit-migrate/NATIVE_MIGRATION_PLAN.md`.
