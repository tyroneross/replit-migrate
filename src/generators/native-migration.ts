/**
 * Native iOS/macOS Migration Plan Generator
 *
 * Translates a ScanReport into a fully-structured NativeMigrationPlan:
 * - Field-by-field SwiftData type mappings
 * - API route → local/remote classification
 * - Browser API → native framework translation (filtered to detected APIs)
 * - HIG-aware UI screen mapping
 * - Platform constraints (iOS + macOS)
 * - FloDoro-informed task ordering (architecture doc first, IBR from build 1)
 *
 * TODO: Iteration 2 — watchOS-specific constraint handling
 * TODO: Iteration 3 — generate Xcode project scaffold from plan
 */

import type {
  ScanReport,
  NativeMigrationPlan,
  MigrationStep,
  ModelTranslation,
  PlatformConstraint,
} from "../types.js";

// ---------------------------------------------------------------------------
// Type map: SQL / ORM column type strings → Swift types
// ---------------------------------------------------------------------------

const TYPE_MAP: Record<string, { swift: string; notes: string }> = {
  varchar:   { swift: "String",  notes: "" },
  text:      { swift: "String",  notes: "" },
  integer:   { swift: "Int",     notes: "" },
  bigint:    { swift: "Int64",   notes: "Watch for overflow if values exceed Int range" },
  boolean:   { swift: "Bool",    notes: "" },
  timestamp: { swift: "Date",    notes: "" },
  date:      { swift: "Date",    notes: "Date-only — may need DateComponents for calendar operations" },
  real:      { swift: "Double",  notes: "" },
  float:     { swift: "Float",   notes: "" },
  double:    { swift: "Double",  notes: "" },
  json:      { swift: "Data",    notes: "Define a Codable struct and use @Attribute(.transformable) or store as Data" },
  jsonb:     { swift: "Data",    notes: "Define a Codable struct — JSONB → Codable is the cleanest translation" },
  uuid:      { swift: "UUID",    notes: "" },
  serial:    { swift: "Int",     notes: "SwiftData uses UUID by default — serial IDs don't map naturally" },
};

// ---------------------------------------------------------------------------
// Browser → native mapping table (full catalog)
// Only entries matching detected scan.browser_apis are emitted in the plan.
// ---------------------------------------------------------------------------

interface BrowserNativeEntry {
  browser: string;
  native: string;
  framework: string;
  import: string;
  risk: "high" | "medium" | "low";
  lesson: string;
}

const BROWSER_NATIVE_MAP: BrowserNativeEntry[] = [
  {
    browser: "SpeechRecognition",
    native: "SFSpeechRecognizer",
    framework: "Speech",
    import: "import Speech",
    risk: "high",
    lesson:
      "Spike this FIRST. Speech Recognition is the highest-risk API translation. Test on a real device — simulator has limited speech support.",
  },
  {
    browser: "SpeechSynthesis",
    native: "AVSpeechSynthesizer",
    framework: "AVFoundation",
    import: "import AVFoundation",
    risk: "low",
    lesson: "Direct 1:1 mapping. Straightforward.",
  },
  {
    browser: "navigator.geolocation",
    native: "CLLocationManager",
    framework: "CoreLocation",
    import: "import CoreLocation",
    risk: "medium",
    lesson: "Requires Info.plist usage description. Request permission before use.",
  },
  {
    browser: "navigator.mediaDevices",
    native: "AVCaptureSession",
    framework: "AVFoundation",
    import: "import AVFoundation",
    risk: "medium",
    lesson: "Camera/mic require Info.plist descriptions. Test permission denial paths.",
  },
  {
    browser: "localStorage",
    native: "UserDefaults or SwiftData",
    framework: "Foundation",
    import: "import Foundation",
    risk: "low",
    lesson: "UserDefaults for settings, SwiftData for structured data.",
  },
  {
    browser: "WebSocket",
    native: "URLSessionWebSocketTask",
    framework: "Foundation",
    import: "import Foundation",
    risk: "low",
    lesson: "Native WebSocket API is clean. Use async/await.",
  },
  {
    browser: "Notification",
    native: "UNUserNotificationCenter",
    framework: "UserNotifications",
    import: "import UserNotifications",
    risk: "medium",
    lesson: "Requires permission request. Add pre-permission screen per Apple HIG.",
  },
  {
    browser: "fetch",
    native: "URLSession",
    framework: "Foundation",
    import: "import Foundation",
    risk: "low",
    lesson: "Use async/await with URLSession. Add Codable for JSON parsing.",
  },
  {
    browser: "canvas",
    native: "Canvas or Core Graphics",
    framework: "SwiftUI",
    import: "import SwiftUI",
    risk: "medium",
    lesson: "SwiftUI Canvas for simple drawing. Core Graphics for complex rendering.",
  },
  {
    browser: "clipboard",
    native: "UIPasteboard",
    framework: "UIKit",
    import: "import UIKit",
    risk: "low",
    lesson: "Direct mapping.",
  },
];

// ---------------------------------------------------------------------------
// Platform constraints catalog
// ---------------------------------------------------------------------------

const IOS_CONSTRAINTS: PlatformConstraint[] = [
  {
    platform: "ios",
    constraint: "Minimum touch target 44x44pt",
    category: "touch",
    applies_to: ["all interactive elements"],
    lesson:
      "FloDoro's IBR scan caught undersized targets at build 36 that existed since build 1. Scan from build 1.",
  },
  {
    platform: "ios",
    constraint: "NSMicrophoneUsageDescription required for microphone",
    category: "permissions",
    applies_to: ["speech recognition", "audio recording"],
    lesson: "iOS will crash without Info.plist usage descriptions. Add before first use.",
  },
  {
    platform: "ios",
    constraint: "NSSpeechRecognitionUsageDescription required",
    category: "permissions",
    applies_to: ["speech recognition"],
    lesson: "Separate permission from microphone. Both required for Speech framework.",
  },
  {
    platform: "ios",
    constraint: "Support Dynamic Type for accessibility",
    category: "hig",
    applies_to: ["all text"],
    lesson: "Use .font(.body) etc., not hardcoded sizes.",
  },
  {
    platform: "ios",
    constraint: "Dark mode support required",
    category: "hig",
    applies_to: ["all views"],
    lesson: "Use semantic colors (Color.primary, .secondary) not hardcoded colors.",
  },
  {
    platform: "ios",
    constraint: "Privacy manifest required for App Store",
    category: "privacy",
    applies_to: ["app submission"],
    lesson: "Required since iOS 17. Declare all API usage reasons.",
  },
  {
    platform: "ios",
    constraint: "4.5:1 contrast ratio for text",
    category: "hig",
    applies_to: ["all text on backgrounds"],
    lesson: "IBR catches contrast issues automatically. Run scans.",
  },
];

const MACOS_CONSTRAINTS: PlatformConstraint[] = [
  {
    platform: "macos",
    constraint: "Support keyboard navigation",
    category: "hig",
    applies_to: ["all interactive elements"],
    lesson: "macOS users expect Tab/Enter/Escape to work.",
  },
  {
    platform: "macos",
    constraint: "Support window resizing",
    category: "hig",
    applies_to: ["all views"],
    lesson: "Use adaptive layouts, not fixed sizes.",
  },
  {
    platform: "macos",
    constraint: "Menu bar integration expected",
    category: "hig",
    applies_to: ["app lifecycle"],
    lesson: "macOS apps should have menu items for key actions.",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capitalize and suffix "View". "user-list" → "UserListView". */
function toSwiftViewName(pageName: string): string {
  const cleaned = pageName
    .replace(/[-_/]/g, " ")
    .trim()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return cleaned.endsWith("View") ? cleaned : `${cleaned}View`;
}

/** Derive HIG layout notes from page name and route. */
function higNotesForPage(name: string, route: string): string[] {
  const token = `${name} ${route}`.toLowerCase();
  const notes: string[] = [];

  if (/list|feed|index|search/.test(token))
    notes.push("Use SwiftUI List with NavigationStack");
  if (/form|create|edit|new|update/.test(token))
    notes.push("Use Form with Section grouping");
  if (/setting|preference|config/.test(token))
    notes.push("Use Form with toggles and pickers");
  if (/dashboard|home|overview|main/.test(token))
    notes.push("Use ScrollView with cards");
  if (/auth|login|signin|sign-in|signup|sign-up|register/.test(token))
    notes.push("Use Sign in with Apple button or custom form");
  if (/detail|view|show|profile/.test(token))
    notes.push("Use ScrollView, present via NavigationLink");

  if (notes.length === 0)
    notes.push("Use NavigationStack with appropriate layout");

  return notes;
}

/** Strip length qualifiers and aliases from a SQL type string. */
function normalizeColumnType(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower.startsWith("character varying") || lower.startsWith("varchar"))
    return "varchar";
  if (lower.startsWith("timestamp")) return "timestamp";
  return lower.replace(/\s*\(.*\)/, "").trim();
}

/** Look up a SQL/ORM type in TYPE_MAP with fallback. */
function mapType(rawType: string): { swift: string; notes: string } {
  const key = normalizeColumnType(rawType);
  return (
    TYPE_MAP[key] ?? {
      swift: "String",
      notes: `Unknown type '${rawType}' — defaulted to String. Verify.`,
    }
  );
}

function isAuthRoute(path: string): boolean {
  return /\/(login|logout|signup|register|auth|session|token|oauth)/i.test(path);
}

function isFileRoute(path: string): boolean {
  return /upload|download|file|attachment|media|image|video|audio/i.test(path);
}

function isExternalApiRoute(routePath: string, scan: ScanReport): boolean {
  const keywords = scan.external_services.map((s) => s.name.toLowerCase());
  const lp = routePath.toLowerCase();
  return keywords.some((kw) => lp.includes(kw));
}

// ---------------------------------------------------------------------------
// Architecture doc
// ---------------------------------------------------------------------------

function buildArchitectureDoc(
  scan: ScanReport,
  keepApi: boolean
): NativeMigrationPlan["architecture_doc"] {
  const layers: string[] = ["SwiftUI Views", "ViewModels", "SwiftData Models", "Services"];
  if (keepApi) layers.push("Networking (keep_api)");

  const data_flow = keepApi
    ? "Views observe ViewModels → ViewModels call Services → Services hit remote API via URLSession → responses decoded into SwiftData models or in-memory structs."
    : "Views observe ViewModels via @Query and @Bindable → ViewModels mutate @Model objects → SwiftData persists locally → external calls (AI, payments) via URLSession Services only.";

  return {
    summary:
      `Layered SwiftUI architecture for ${scan.project_name}. ` +
      (keepApi
        ? "API-backed: existing server is the source of truth; SwiftData used for local caching only."
        : "Local-first: SwiftData is the source of truth. Server calls limited to external services (AI, payment, etc.)."),
    layers,
    data_flow,
    lesson:
      "Architecture doc before code — FloDoro's APPLE_ECOSYSTEM_PLAN.md was the highest-ROI artifact across 51 builds.",
  };
}

// ---------------------------------------------------------------------------
// Data model translation (best-effort from schema_files list in scan)
//
// TAG:INFERRED — the scanner provides file paths but not parsed column ASTs.
// Each translation entry captures identity fields and directs the developer
// to review the source schema file for full column mapping.
// Full column parsing would require AST access (future iteration).
// ---------------------------------------------------------------------------

function buildModelTranslations(scan: ScanReport): ModelTranslation[] {
  const translations: ModelTranslation[] = [];
  const orm = scan.database.orm ?? "unknown";

  for (const schemaFile of scan.database.schema_files) {
    const baseName = schemaFile
      .split("/")
      .pop()!
      .replace(/\.(ts|js|py|prisma)$/, "");
    const modelName = baseName.charAt(0).toUpperCase() + baseName.slice(1);

    const idMapping = mapType("serial");
    const tsMapping = mapType("timestamp");

    translations.push({
      web_model: modelName,
      web_orm: orm,
      native_model: modelName,
      fields: [
        {
          web_field: "id",
          web_type: "serial / uuid",
          swift_type: "UUID",
          notes:
            "SwiftData uses UUID as default identity. Add @Attribute(.unique) if keeping serial — but prefer UUID.",
        },
        {
          web_field: "created_at",
          web_type: "timestamp",
          swift_type: tsMapping.swift,
          notes: tsMapping.notes,
        },
        {
          web_field: "updated_at",
          web_type: "timestamp",
          swift_type: tsMapping.swift,
          notes: tsMapping.notes,
        },
        {
          web_field: "(remaining columns)",
          web_type: "(see schema file)",
          swift_type: "(map using TYPE_MAP)",
          notes:
            `Review ${schemaFile} and map each column. ` +
            "notNull() → non-optional type. Nullable → optional (?). " +
            ".default(...) → Swift default value. " +
            ".references(...) → @Relationship with deleteRule. " +
            ".unique() → @Attribute(.unique).",
        },
      ],
      risk: scan.database.replit_hosted ? "high" : "medium",
      notes: [
        `Source: ${schemaFile}`,
        "Add @Model macro to the class declaration.",
        "Use @Attribute(.unique) for primary and unique constraints.",
        "Use @Relationship(deleteRule: .cascade) for foreign keys pointing to owned data.",
        "JSON/JSONB columns → define a Codable struct, store as Data with @Attribute(.transformable).",
        scan.database.replit_hosted
          ? "Replit-hosted DB: export data before migration and verify row counts after import."
          : "",
      ].filter(Boolean),
    });
  }

  if (translations.length === 0 && scan.database.type !== "none") {
    translations.push({
      web_model: "UnknownModel",
      web_orm: orm,
      native_model: "UnknownModel",
      fields: [
        {
          web_field: "(schema not detected)",
          web_type: "(unknown)",
          swift_type: "(unknown)",
          notes:
            "No schema files were detected. Locate your ORM schema and map fields manually using the type table.",
        },
      ],
      risk: "high",
      notes: [
        "Schema files not found in scan. Re-run scanner with --include-schema or point it at your models directory.",
      ],
    });
  }

  return translations;
}

// ---------------------------------------------------------------------------
// API → local / remote / removed mapping
// ---------------------------------------------------------------------------

function buildApiMapping(
  scan: ScanReport,
  keepApi: boolean
): NativeMigrationPlan["api_to_local_mapping"] {
  return scan.api_routes.map((route) => {
    const method = route.method.toUpperCase();

    if (isAuthRoute(route.path)) {
      return {
        web_route: `${method} ${route.path}`,
        becomes: "removed" as const,
        native_equivalent: keepApi
          ? "Remove auth route — use keep-api-auth token exchange via URLSession"
          : "Sign in with Apple or local session",
        reason: "Auth routes are replaced by native auth in all modes.",
      };
    }

    if (keepApi) {
      return {
        web_route: `${method} ${route.path}`,
        becomes: "remote" as const,
        native_equivalent: `URLSession call to ${route.path}`,
        reason: "keepApi=true — all non-auth routes remain remote.",
      };
    }

    if (isFileRoute(route.path)) {
      return {
        web_route: `${method} ${route.path}`,
        becomes: "remote" as const,
        native_equivalent: "URLSession multipart upload or file download",
        reason: "File operations require a remote endpoint.",
      };
    }

    if (isExternalApiRoute(route.path, scan)) {
      return {
        web_route: `${method} ${route.path}`,
        becomes: "remote" as const,
        native_equivalent: "URLSession call to external service",
        reason: "Route proxies an external API (AI, payment, etc.) — must stay remote.",
      };
    }

    switch (method) {
      case "GET":
        return {
          web_route: `${method} ${route.path}`,
          becomes: "local" as const,
          native_equivalent: "SwiftData @Query — fetch from local store",
          reason: "GET routes fetching user data map directly to @Query.",
        };
      case "POST":
        return {
          web_route: `${method} ${route.path}`,
          becomes: "local" as const,
          native_equivalent: "modelContext.insert(_:)",
          reason: "POST routes creating records map to SwiftData insert.",
        };
      case "PUT":
      case "PATCH":
        return {
          web_route: `${method} ${route.path}`,
          becomes: "local" as const,
          native_equivalent: "Modify @Model properties — SwiftData auto-saves on context save",
          reason: "Update routes map to direct property mutation on @Model objects.",
        };
      case "DELETE":
        return {
          web_route: `${method} ${route.path}`,
          becomes: "local" as const,
          native_equivalent: "modelContext.delete(_:)",
          reason: "DELETE routes map to SwiftData delete.",
        };
      default:
        return {
          web_route: `${method} ${route.path}`,
          becomes: "remote" as const,
          native_equivalent: "URLSession call",
          reason: "Non-standard method — kept as remote call.",
        };
    }
  });
}

// ---------------------------------------------------------------------------
// Browser → native mapping (filtered to detected APIs only)
// ---------------------------------------------------------------------------

function buildBrowserNativeMapping(
  scan: ScanReport
): NativeMigrationPlan["browser_to_native_mapping"] {
  const detectedApis = new Set(scan.browser_apis.map((b) => b.api));

  return BROWSER_NATIVE_MAP.filter((entry) => detectedApis.has(entry.browser)).map(
    (entry) => ({
      browser_api: entry.browser,
      native_framework: entry.framework,
      import_statement: entry.import,
      notes: entry.native,
      risk: entry.risk,
      lesson: entry.lesson,
    })
  );
}

// ---------------------------------------------------------------------------
// UI screen mapping
// ---------------------------------------------------------------------------

function buildUiScreenMapping(
  scan: ScanReport
): NativeMigrationPlan["ui_screen_mapping"] {
  return scan.frontend.pages.map((page) => ({
    web_page: page.name,
    web_file: page.file,
    native_view: toSwiftViewName(page.name),
    ui_notes: higNotesForPage(page.name, page.route),
  }));
}

// ---------------------------------------------------------------------------
// Platform constraints (filtered to selected platforms)
// ---------------------------------------------------------------------------

function buildPlatformConstraints(platforms: string[]): PlatformConstraint[] {
  const out: PlatformConstraint[] = [];
  if (platforms.includes("ios")) out.push(...IOS_CONSTRAINTS);
  if (platforms.includes("macos")) out.push(...MACOS_CONSTRAINTS);
  return out;
}

// ---------------------------------------------------------------------------
// Auth strategy
// ---------------------------------------------------------------------------

function buildAuthStrategy(
  scan: ScanReport,
  keepApi: boolean
): NativeMigrationPlan["auth_strategy"] {
  if (keepApi) {
    return {
      method: "keep-api-auth",
      steps: [
        {
          id: "native-auth-1",
          title: "Retain server-side auth; store tokens in Keychain",
          description:
            "Keep existing server authentication. Exchange credentials via URLSession. Store session tokens in Keychain (Security framework) — never UserDefaults.",
          risk: "medium",
          files_affected: [],
          depends_on: [],
          category: "auth",
          lesson_reference:
            "Keychain is the iOS equivalent of httpOnly cookies. Never store tokens in UserDefaults.",
          done: false,
        },
      ],
    };
  }

  if (scan.auth.method !== "none") {
    return {
      method: "sign-in-with-apple",
      steps: [
        {
          id: "native-auth-1",
          title: "Replace web auth with Sign in with Apple",
          description:
            "Remove server auth routes. Implement ASAuthorizationAppleIDProvider. Store user identifier in Keychain.",
          risk: "medium",
          files_affected: scan.auth.files,
          depends_on: [],
          category: "auth",
          lesson_reference:
            "Sign in with Apple is lowest-friction native auth. Required on App Store if any third-party auth is offered.",
          done: false,
        },
        {
          id: "native-auth-2",
          title: "Add Keychain wrapper for credential storage",
          description:
            "Store Apple user identifier and session tokens in Keychain using Security framework. Never UserDefaults for credentials.",
          risk: "low",
          files_affected: [],
          depends_on: ["native-auth-1"],
          category: "auth",
          lesson_reference:
            "Keychain survives app reinstalls on the same device. UserDefaults does not encrypt.",
          done: false,
        },
      ],
    };
  }

  return { method: "none", steps: [] };
}

// ---------------------------------------------------------------------------
// IBR testing plan
// ---------------------------------------------------------------------------

function buildIbrTesting(): NativeMigrationPlan["ibr_testing"] {
  return {
    when_to_start: "Build 1 — do not wait until the app is 'ready'",
    initial_checks: [
      "Touch targets ≥ 44pt on all interactive elements",
      "VoiceOver labels on all controls",
      "Dynamic Type scaling on all text",
      "Dark mode contrast ratios ≥ 4.5:1",
      "Keyboard navigation on macOS (if applicable)",
    ],
    lesson:
      "FloDoro waited until build 36 to run IBR scanning. Issues found had existed since build 1. Every build saved by scanning early = one less iteration.",
  };
}

// ---------------------------------------------------------------------------
// Complexity estimate
// ---------------------------------------------------------------------------

function estimateComplexity(scan: ScanReport): "simple" | "moderate" | "complex" {
  const pageCount = scan.frontend.pages.length;
  const hasBrowserApis = scan.browser_apis.length > 0;
  const hasAuth = scan.auth.method !== "none";
  const modelCount = scan.database.schema_files.length;

  if (pageCount > 8 && hasBrowserApis && hasAuth && modelCount > 4) return "complex";
  if (pageCount >= 4 || hasBrowserApis || hasAuth) return "moderate";
  return "simple";
}

// ---------------------------------------------------------------------------
// Task generation (FloDoro-informed order)
// ---------------------------------------------------------------------------

function buildTasks(
  scan: ScanReport,
  platforms: string[],
  keepApi: boolean,
  browserMappings: NativeMigrationPlan["browser_to_native_mapping"]
): MigrationStep[] {
  const tasks: MigrationStep[] = [];

  // 1. Architecture doc — must precede ALL code
  tasks.push({
    id: "native-architecture-1",
    title: "Write architecture doc (APPLE_ECOSYSTEM_PLAN.md)",
    description:
      "Document layer structure, data flow, screen inventory, and API decisions. Review before any Swift is written.",
    risk: "low",
    files_affected: ["APPLE_ECOSYSTEM_PLAN.md"],
    depends_on: [],
    category: "architecture",
    lesson_reference:
      "FloDoro's APPLE_ECOSYSTEM_PLAN.md was the highest-ROI artifact across 51 builds. Architecture doc before code.",
    done: false,
  });

  // 2. Xcode project setup
  tasks.push({
    id: "native-architecture-2",
    title: `Create Xcode project targeting ${platforms.join(" + ")}`,
    description:
      "Create a new Xcode project with SwiftData enabled. Configure Info.plist with required usage descriptions. " +
      "Add entitlements for Sign in with Apple if needed. Set deployment target before writing any UI.",
    risk: "low",
    files_affected: [`${scan.project_name}.xcodeproj`],
    depends_on: ["native-architecture-1"],
    category: "architecture",
    lesson_reference:
      "XcodeGen regenerates Info.plist — ALL properties (orientations, permissions, usage descriptions) must go in project.yml, not Info.plist directly. Manual plist edits will be silently dropped on next xcodegen generate.",
    done: false,
  });

  // 3. SwiftData models
  if (scan.database.schema_files.length > 0 || scan.database.type !== "none") {
    tasks.push({
      id: "native-models-1",
      title: "Translate data models to SwiftData @Model classes",
      description:
        `Translate ${scan.database.schema_files.length} schema file(s) to SwiftData @Model classes. ` +
        "Map column types using the type table in the plan. Add @Attribute(.unique), @Relationship, and optionality.",
      risk: scan.database.replit_hosted ? "high" : "medium",
      files_affected: scan.database.schema_files,
      depends_on: ["native-architecture-2"],
      category: "models",
      lesson_reference:
        "Data model correctness gates everything. A wrong model found at build 30 requires migrating persisted stores.",
      done: false,
    });
  }

  // 4. Spike highest-risk browser API (if any detected)
  const highRiskApis = browserMappings.filter((b) => b.risk === "high");
  if (highRiskApis.length > 0) {
    const topRisk = highRiskApis[0];
    tasks.push({
      id: "native-services-1",
      title: `Spike: ${topRisk.browser_api} → ${topRisk.notes} (highest-risk API)`,
      description:
        `Prove out ${topRisk.browser_api} translation on a real device before building any UI that depends on it. ` +
        topRisk.lesson,
      risk: "high",
      files_affected: [],
      depends_on: ["native-architecture-2"],
      category: "services",
      lesson_reference: topRisk.lesson,
      done: false,
    });
  }

  // 5. Navigation shell
  const screenNames = scan.frontend.pages
    .map((p) => toSwiftViewName(p.name))
    .join(", ");

  tasks.push({
    id: "native-views-1",
    title: "Build navigation shell (NavigationStack + tab bar stubs)",
    description:
      `Create NavigationStack and tab bar. Stub all ${scan.frontend.pages.length} screen(s): ` +
      `${screenNames || "(see UI mapping)"}. Each stub must render at minimum a Text with its screen name.`,
    risk: "low",
    files_affected: [],
    depends_on: ["native-architecture-2"],
    category: "views",
    lesson_reference:
      "Stub all screens before building any. Dead ends in the nav graph are easiest to catch when all stubs exist.",
    done: false,
  });

  // 6. Core screen with real SwiftData
  const modelsDep = scan.database.schema_files.length > 0 ? ["native-models-1"] : [];
  tasks.push({
    id: "native-views-2",
    title: "Build core feature screen with real SwiftData",
    description:
      "Implement the primary feature screen with real @Query and modelContext operations. No mock data.",
    risk: "medium",
    files_affected: [],
    depends_on: [...modelsDep, "native-views-1"],
    category: "views",
    lesson_reference: "Real data exposes model design issues. Mock data delays them.",
    done: false,
  });

  // 7. Remaining screens
  const remainingCount = Math.max(0, scan.frontend.pages.length - 1);
  if (remainingCount > 0) {
    tasks.push({
      id: "native-views-3",
      title: `Build remaining ${remainingCount} screen(s)`,
      description:
        "Implement all remaining screens with their layouts, data bindings, and navigation. Follow HIG notes from the screen mapping table.",
      risk: "medium",
      files_affected: [],
      depends_on: ["native-views-2"],
      category: "views",
      lesson_reference:
        "Complete the UI before adding polish — partially built screens cause false positives in IBR scans.",
      done: false,
    });
  }

  // 8. Services layer
  const servicesDeps = ["native-views-1", ...(highRiskApis.length > 0 ? ["native-services-1"] : [])];
  const allApiNames = browserMappings.map((b) => b.browser_api).join(", ");

  tasks.push({
    id: "native-services-2",
    title: "Implement services layer (URLSession + native API integrations)",
    description:
      (keepApi
        ? "Implement URLSession service wrappers for all remote API calls. Use async/await. Add Codable response models. "
        : "Implement URLSession for external services only (AI, payments, etc.). ") +
      (allApiNames ? `Integrate native APIs: ${allApiNames}.` : ""),
    risk: "medium",
    files_affected: [],
    depends_on: servicesDeps,
    category: "services",
    lesson_reference:
      "Wrap all URLSession calls in a typed service — never call URLSession directly from a View.",
    done: false,
  });

  // 9. Platform polish
  tasks.push({
    id: "native-platform-1",
    title: "Platform polish (haptics, notifications, app lifecycle)",
    description:
      "Add haptic feedback (UIImpactFeedbackGenerator on iOS), local notifications (UNUserNotificationCenter), " +
      "handle app lifecycle (scenePhase), background fetch if needed. " +
      (platforms.includes("macos") ? "Add menu bar commands (Commands protocol) for macOS. " : "") +
      "Implement proper state restoration.",
    risk: "low",
    files_affected: [],
    depends_on: ["native-services-2"],
    category: "platform",
    lesson_reference: "Polish is a multiplier, not a foundation. Add after core flows work.",
    done: false,
  });

  // 10. IBR scan + fix
  tasks.push({
    id: "native-testing-1",
    title: "IBR scan + fix (accessibility and UI audit)",
    description:
      "Run a comprehensive IBR scan: touch targets, VoiceOver labels, Dynamic Type, contrast ratios" +
      (platforms.includes("macos") ? ", keyboard navigation" : "") +
      ". Fix all issues. This should have started at Build 1 — run now if not already.",
    risk: "medium",
    files_affected: [],
    depends_on: ["native-platform-1"],
    category: "testing",
    lesson_reference:
      "MANDATORY: Run IBR native scan before every TestFlight upload. SpeakSavvy Build 1 shipped without a scan despite this being encoded as lesson #5. The hooks now enforce this — do not override.",
    done: false,
  });

  // 11. TestFlight
  tasks.push({
    id: "native-deployment-1",
    title: "Archive and upload to TestFlight",
    description:
      "Configure signing (automatic or manual). Archive in Xcode. Upload to App Store Connect. Distribute to internal testers.",
    risk: "medium",
    files_affected: [],
    depends_on: ["native-testing-1"],
    category: "deployment",
    lesson_reference:
      "Create app record in App Store Connect BEFORE archiving. altool and the ASC API (without Admin key) cannot create apps. Budget for this manual browser step. Also verify UISupportedInterfaceOrientations is in project.yml — TestFlight rejects builds without it.",
    done: false,
  });

  return tasks;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function generateNativePlan(
  scan: ScanReport,
  platforms: string[] = ["ios"],
  keepApi: boolean = false
): NativeMigrationPlan {
  const normalizedPlatforms = platforms.map((p) => p.toLowerCase());

  console.log(
    `[native-migration] Generating plan for ${scan.project_name} → ${normalizedPlatforms.join(", ")} ` +
      `(keepApi=${keepApi})`
  );

  const architecture_doc = buildArchitectureDoc(scan, keepApi);
  const data_model_translation = buildModelTranslations(scan);
  const api_to_local_mapping = buildApiMapping(scan, keepApi);
  const browser_to_native_mapping = buildBrowserNativeMapping(scan);
  const ui_screen_mapping = buildUiScreenMapping(scan);
  const platform_constraints = buildPlatformConstraints(normalizedPlatforms);
  const auth_strategy = buildAuthStrategy(scan, keepApi);
  const ibr_testing = buildIbrTesting();
  const tasks = buildTasks(scan, normalizedPlatforms, keepApi, browser_to_native_mapping);
  const estimated_complexity = estimateComplexity(scan);

  console.log(
    `[native-migration] Plan complete: ${tasks.length} task(s), ` +
      `${data_model_translation.length} model(s), ` +
      `${browser_to_native_mapping.length} browser API mapping(s), ` +
      `complexity=${estimated_complexity}`
  );

  return {
    platforms: normalizedPlatforms,
    generated_at: Date.now(),
    architecture_doc,
    data_model_translation,
    api_to_local_mapping,
    browser_to_native_mapping,
    ui_screen_mapping,
    platform_constraints,
    auth_strategy,
    ibr_testing,
    tasks,
    estimated_complexity,
  };
}

// ---------------------------------------------------------------------------
// Markdown formatter
// ---------------------------------------------------------------------------

export function formatNativePlanMarkdown(
  plan: NativeMigrationPlan,
  scan: ScanReport
): string {
  const date = new Date(plan.generated_at).toISOString().split("T")[0];
  const platformLabel = plan.platforms.map((p) => p.toUpperCase()).join(" + ");
  const strategyLabel = plan.api_to_local_mapping.some(
    (r) => r.becomes === "remote" && r.reason.includes("keepApi")
  )
    ? "API-backed"
    : "local-first";

  const lines: string[] = [];

  // --- Header ---
  lines.push(`# Native Migration Plan: ${scan.project_name} → ${platformLabel}`);
  lines.push("");
  lines.push(`Generated: ${date}`);
  lines.push(`Estimated Complexity: ${plan.estimated_complexity}`);
  lines.push(`Strategy: ${strategyLabel}`);
  lines.push("");

  // --- Lessons Applied ---
  lines.push("## Lessons Applied");
  lines.push("");

  const allLessons = [
    plan.architecture_doc.lesson,
    plan.ibr_testing.lesson,
    ...plan.browser_to_native_mapping
      .filter((b) => b.risk === "high")
      .map((b) => b.lesson),
    ...plan.tasks
      .filter((t) => t.lesson_reference)
      .map((t) => t.lesson_reference!)
      .slice(0, 5),
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  allLessons.forEach((lesson, idx) => {
    lines.push(`${idx + 1}. ${lesson}`);
  });
  lines.push("");

  // --- Architecture ---
  lines.push("## Architecture");
  lines.push("");
  lines.push(plan.architecture_doc.summary);
  lines.push(`Layers: ${plan.architecture_doc.layers.join(" → ")}`);
  lines.push(`Data Flow: ${plan.architecture_doc.data_flow}`);
  lines.push("");

  // --- Data Model Translation ---
  lines.push("## Data Model Translation");
  lines.push("");

  if (plan.data_model_translation.length === 0) {
    lines.push("_No database models detected in scan._");
  } else {
    for (const model of plan.data_model_translation) {
      lines.push(`### ${model.native_model} (Web: ${model.web_orm} → Native: SwiftData)`);
      lines.push("");
      lines.push("| Web Field | Web Type | Swift Type | Notes |");
      lines.push("|-----------|---------|------------|-------|");
      for (const field of model.fields) {
        const notes = field.notes.replace(/\|/g, "\\|");
        lines.push(`| ${field.web_field} | ${field.web_type} | ${field.swift_type} | ${notes} |`);
      }
      if (model.notes.length > 0) {
        lines.push("");
        lines.push("**Notes:**");
        for (const note of model.notes) {
          lines.push(`- ${note}`);
        }
      }
      lines.push("");
    }
  }

  // --- API Route Mapping ---
  lines.push("## API Route Mapping");
  lines.push("");

  if (plan.api_to_local_mapping.length === 0) {
    lines.push("_No API routes detected in scan._");
  } else {
    lines.push("| Route | Becomes | Native Equivalent |");
    lines.push("|-------|---------|-------------------|");
    for (const entry of plan.api_to_local_mapping) {
      const becomes =
        entry.becomes === "local"
          ? "local (SwiftData)"
          : entry.becomes === "removed"
          ? "removed"
          : "remote (URLSession)";
      const native = entry.native_equivalent.replace(/\|/g, "\\|");
      lines.push(`| ${entry.web_route} | ${becomes} | ${native} |`);
    }
  }
  lines.push("");

  // --- Browser → Native ---
  lines.push("## Browser → Native API Translation");
  lines.push("");

  if (plan.browser_to_native_mapping.length === 0) {
    lines.push("_No browser APIs detected in scan._");
  } else {
    lines.push("| Browser API | Native Framework | Risk | Notes |");
    lines.push("|------------|-----------------|------|-------|");
    for (const entry of plan.browser_to_native_mapping) {
      const risk =
        entry.risk === "high" ? "**HIGH**" : entry.risk === "medium" ? "medium" : "low";
      lines.push(
        `| ${entry.browser_api} | ${entry.native_framework} | ${risk} | ${entry.notes} |`
      );
    }
    lines.push("");

    const spikeTarget = plan.browser_to_native_mapping.find((b) => b.risk === "high");
    if (spikeTarget) {
      lines.push(
        `> **Spike Required:** ${spikeTarget.browser_api} — test on real device before building UI around it. ${spikeTarget.lesson}`
      );
    }
  }
  lines.push("");

  // --- UI Screen Mapping ---
  lines.push("## UI Screen Mapping");
  lines.push("");

  if (plan.ui_screen_mapping.length === 0) {
    lines.push("_No frontend pages detected in scan._");
  } else {
    lines.push("| Web Page | SwiftUI View | Notes |");
    lines.push("|----------|-------------|-------|");
    for (const entry of plan.ui_screen_mapping) {
      const notes = entry.ui_notes.join("; ").replace(/\|/g, "\\|");
      lines.push(`| ${entry.web_page} | ${entry.native_view} | ${notes} |`);
    }
  }
  lines.push("");

  // --- Platform Constraints ---
  for (const platform of plan.platforms) {
    const constraints = plan.platform_constraints.filter((c) => c.platform === platform);
    if (constraints.length === 0) continue;

    lines.push(`## Platform Constraints (${platform.toUpperCase()})`);
    lines.push("");
    lines.push("| Constraint | Category | Applies To | Lesson |");
    lines.push("|------------|----------|------------|--------|");
    for (const c of constraints) {
      const appliesto = c.applies_to.join(", ").replace(/\|/g, "\\|");
      const lesson = c.lesson.replace(/\|/g, "\\|");
      lines.push(`| ${c.constraint} | ${c.category} | ${appliesto} | ${lesson} |`);
    }
    lines.push("");
  }

  // --- IBR Testing Plan ---
  lines.push("## IBR Testing Plan");
  lines.push("");
  lines.push(`Start: ${plan.ibr_testing.when_to_start}`);
  lines.push("");
  lines.push("Initial checks:");
  for (const check of plan.ibr_testing.initial_checks) {
    lines.push(`- ${check}`);
  }
  lines.push("");
  lines.push(`> ${plan.ibr_testing.lesson}`);
  lines.push("");

  // --- Full Task List ---
  lines.push("## Full Task List");
  lines.push("");

  const riskBadge = (r: "high" | "medium" | "low"): string =>
    r === "high" ? "[HIGH RISK]" : r === "medium" ? "[medium]" : "[low]";

  plan.tasks.forEach((task, i) => {
    lines.push(`### ${i + 1}. ${task.title} ${riskBadge(task.risk)}`);
    lines.push(`**ID:** \`${task.id}\`  **Category:** ${task.category}`);
    lines.push("");
    lines.push(task.description);
    if (task.depends_on.length > 0) {
      lines.push(`**Depends on:** ${task.depends_on.join(", ")}`);
    }
    if (task.lesson_reference) {
      lines.push(`**Lesson:** ${task.lesson_reference}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}
