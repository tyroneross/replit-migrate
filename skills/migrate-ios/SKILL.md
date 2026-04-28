---
name: migrate-ios
description: Use when the user asks to "make this an iOS app", "convert to native", "port to Swift", "SwiftUI version", or migrate a Replit app to native iOS/macOS.
version: 0.2.0
user-invocable: true
argument-hint: <project-path>
---

# iOS Migration

Generate and execute a migration plan from a Replit web app to a native
iOS app using SwiftUI and SwiftData. Encodes lessons from FloDoro
(51 TestFlight builds) and the SpeakSavvy migration (Build 1 shipped
in a single session).

## Encoded Lessons

These lessons are hardcoded into the plan generator and were validated
during the SpeakSavvy migration:

1. **Architecture doc before code** — FloDoro's APPLE_ECOSYSTEM_PLAN.md was
   the highest-ROI artifact. The plan generates an architecture doc as the
   FIRST deliverable, before any Swift code.
2. **Platform constraints before UI** — FloDoro's watchOS redesign (builds
   27-35) was a full restart because constraints weren't researched first.
   The plan includes a constraint checklist before any view code.
3. **Native APIs before custom** — FloDoro replaced a custom BottomSheetModifier
   and Timer implementation with native SwiftUI APIs. The plan flags browser
   APIs that have native equivalents and says "use native."
4. **Spike the scariest API first** — SpeakSavvy's SpeechRecognition was
   flagged HIGH risk. Spike on a real device before building UI around it.
5. **IBR scanning from build 1** — FloDoro waited until build 36. SpeakSavvy
   shipped Build 1 without an IBR scan — don't repeat this. Enforce scanning.
6. **iOS only first** — Don't add watchOS/macOS until iOS is solid.
7. **XcodeGen plist gotcha** — Info.plist properties (orientations, permissions)
   MUST go in project.yml, not Info.plist directly. XcodeGen regenerates the
   plist and drops manual edits.
8. **App Store Connect app record first** — Create the app in ASC before
   archiving. The API key needs Admin role for CREATE; altool can't create
   apps. Budget for this manual step.
9. **Schema files ≠ config files** — The scanner should find the actual schema
   definition files (shared/schema.ts), not just ORM config (drizzle.config.ts).
   Always verify model translation against the real schema.

## Workflow

1. Check if scan exists. If not, run `migrate_scan` first.
2. Run `migrate_plan_native` with target `ios`.
3. Present the architecture doc FIRST — do not start coding until reviewed.
4. Execute in order: models → spike risky API → navigation → screens → services.
5. Run IBR native scanning after each screen (DO NOT SKIP — lesson from SpeakSavvy).
6. Before TestFlight: verify Info.plist has orientations, create app in ASC.

## Strategy: Local-First (Default)

| Approach | When to Use | Trade-offs |
|----------|------------|------------|
| **Local-first** (default) | App works standalone, data stays on device | No server, no hosting, works offline. User provides own API key for LLM |
| **API-backed** | Need cross-device sync or server-side processing | More moving parts = more iterations |

Default is local-first (SwiftData) — lowest iteration path. ProductPilot's
server infrastructure burned the most commits.

## TestFlight Checklist (from SpeakSavvy Build 1)

Before `xcodebuild archive`:
- [ ] UISupportedInterfaceOrientations in **project.yml** (not Info.plist)
- [ ] NSMicrophoneUsageDescription (if using mic)
- [ ] NSSpeechRecognitionUsageDescription (if using speech)
- [ ] App icon in Assets.xcassets (1024x1024 single icon for iOS 17+)
- [ ] ExportOptions.plist with team ID and `app-store-connect` method
- [ ] App record exists in App Store Connect

After archive + export:
- [ ] `xcrun altool --upload-app` with API key

## Decision Tree

| User Intent | Tools | Notes |
|-------------|-------|-------|
| "Make this an iOS app" | scan → `migrate_plan_native`(ios) | Default local-first |
| "What would the data models look like?" | `migrate_map_models`(swiftdata) | Preview translation |
| "Keep the server" | `migrate_plan_native`(ios, keep_api=true) | API-backed plan |
| "Check progress" | `migrate_check_progress` | Filesystem heuristics |

Plan saved to `.replit-migrate/NATIVE_MIGRATION_PLAN.md`.
