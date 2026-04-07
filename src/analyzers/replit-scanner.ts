/**
 * Replit Project Scanner
 *
 * Analyzes a Replit project directory and produces a ScanReport.
 * Self-contained — does not import from other analyzer files.
 */

import fs from "fs";
import path from "path";
import { glob } from "glob";
import type {
  ScanReport,
  ApiRoute,
  EnvVar,
  ExternalService,
  FrontendPage,
  BrowserApi,
} from "../types.js";

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function grepFiles(
  pattern: RegExp,
  files: string[]
): Promise<Array<{ file: string; line: number; match: string }>> {
  const results: Array<{ file: string; line: number; match: string }> = [];
  for (const file of files) {
    const content = await readFileIfExists(file);
    if (!content) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(pattern);
      if (m) {
        results.push({ file, line: i + 1, match: m[0] });
      }
    }
  }
  return results;
}

async function parsePackageJson(
  projectPath: string
): Promise<Record<string, unknown> | null> {
  const raw = await readFileIfExists(path.join(projectPath, "package.json"));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Collect all dep names from package.json (dependencies + devDependencies + peerDependencies). */
function allDeps(pkg: Record<string, unknown>): string[] {
  const sections = ["dependencies", "devDependencies", "peerDependencies"];
  const names: string[] = [];
  for (const section of sections) {
    const block = pkg[section];
    if (block && typeof block === "object") {
      names.push(...Object.keys(block as Record<string, unknown>));
    }
  }
  return names;
}

function hasDep(deps: string[], name: string): boolean {
  return deps.some((d) => d === name || d.startsWith(`${name}/`));
}

/** Resolve absolute paths for source files, returning paths relative to projectPath. */
function toRelative(absolutePaths: string[], projectPath: string): string[] {
  return absolutePaths.map((p) => path.relative(projectPath, p));
}

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

export async function scanReplitProject(
  projectPath: string,
  deep: boolean
): Promise<ScanReport> {
  process.stderr.write(`[replit-scanner] Scanning: ${projectPath}\n`);

  const abs = (rel: string) => path.join(projectPath, rel);

  // ---------------------------------------------------------------------------
  // 1. Replit detection
  // ---------------------------------------------------------------------------

  const hasReplitConfig = !!(await readFileIfExists(abs(".replit")));
  const hasReplitNix = !!(await readFileIfExists(abs("replit.nix")));
  const hasReplitMd = !!(await readFileIfExists(abs("replit.md")));

  process.stderr.write(`[replit-scanner] Replit files detected. Scanning stack...\n`);

  // ---------------------------------------------------------------------------
  // 2. Stack detection
  // ---------------------------------------------------------------------------

  const pkg = await parsePackageJson(projectPath);
  const deps = pkg ? allDeps(pkg) : [];

  const hasRequirements = !!(await readFileIfExists(abs("requirements.txt")));
  const hasPyproject = !!(await readFileIfExists(abs("pyproject.toml")));

  const runtime: ScanReport["stack"]["runtime"] = pkg
    ? "node"
    : hasRequirements || hasPyproject
    ? "python"
    : "other";

  // Framework (server)
  let framework: string | null = null;
  for (const fw of ["express", "fastify", "hono", "koa"]) {
    if (hasDep(deps, fw)) {
      framework = fw;
      break;
    }
  }

  // Frontend framework
  let frontend_framework: string | null = null;
  for (const fw of ["react", "vue", "svelte", "angular"]) {
    if (hasDep(deps, fw)) {
      frontend_framework = fw;
      break;
    }
  }

  // Bundler — check deps first, then config files
  let bundler: string | null = null;
  const bundlerCandidates: Array<[string, string]> = [
    ["vite", "vite.config"],
    ["webpack", "webpack.config"],
    ["esbuild", "esbuild"],
    ["parcel", "parcel"],
  ];
  for (const [name] of bundlerCandidates) {
    if (hasDep(deps, name)) {
      bundler = name;
      break;
    }
  }
  if (!bundler) {
    const configFiles = await glob("*.config.{js,ts,mjs,cjs}", {
      cwd: projectPath,
    });
    for (const [name, prefix] of bundlerCandidates) {
      if (configFiles.some((f) => f.startsWith(prefix))) {
        bundler = name;
        break;
      }
    }
  }

  // Language
  const hasTsConfig = !!(await readFileIfExists(abs("tsconfig.json")));
  const language: ScanReport["stack"]["language"] =
    runtime === "python"
      ? "python"
      : hasTsConfig
      ? "typescript"
      : pkg
      ? "javascript"
      : "unknown";

  // ORM — check config files, not just deps
  let orm: string | null = null;
  const hasDrizzleConfig = !!(await readFileIfExists(abs("drizzle.config.ts"))) ||
    !!(await readFileIfExists(abs("drizzle.config.js")));
  const hasPrismaSchema = !!(await readFileIfExists(abs("prisma/schema.prisma")));
  if (hasDrizzleConfig || hasDep(deps, "drizzle-orm")) {
    orm = "drizzle";
  } else if (hasPrismaSchema || hasDep(deps, "@prisma/client")) {
    orm = "prisma";
  } else {
    // Mongoose: check for mongoose.connect in source files
    const srcFiles = await glob("**/*.{ts,tsx,js,jsx}", {
      cwd: projectPath,
      ignore: ["node_modules/**", "dist/**", "build/**", ".git/**"],
    });
    const mongooseHits = await grepFiles(
      /mongoose\.connect/,
      srcFiles.map((f) => abs(f))
    );
    if (mongooseHits.length > 0 || hasDep(deps, "mongoose")) {
      orm = "mongoose";
    }
  }

  // Styling
  const styling: string[] = [];
  const hasTailwind =
    !!(await readFileIfExists(abs("tailwind.config.ts"))) ||
    !!(await readFileIfExists(abs("tailwind.config.js"))) ||
    !!(await readFileIfExists(abs("tailwind.config.cjs")));
  if (hasTailwind || hasDep(deps, "tailwindcss")) styling.push("tailwind");

  const hasShadcn = !!(await readFileIfExists(abs("components.json")));
  if (hasShadcn) styling.push("shadcn");

  const cssModuleFiles = await glob("**/*.module.css", {
    cwd: projectPath,
    ignore: ["node_modules/**", "dist/**", "build/**"],
  });
  if (cssModuleFiles.length > 0) styling.push("css-modules");

  // ---------------------------------------------------------------------------
  // 3. Auth detection
  // ---------------------------------------------------------------------------

  process.stderr.write(`[replit-scanner] Detecting auth...\n`);

  const allSrcFiles = await glob("**/*.{ts,tsx,js,jsx,py}", {
    cwd: projectPath,
    ignore: ["node_modules/**", "dist/**", "build/**", ".git/**"],
  });
  const allSrcAbsolute = allSrcFiles.map((f) => abs(f));

  // Auth pattern definitions with category
  const authPatterns: Array<{ pattern: RegExp; method: ScanReport["auth"]["method"]; label: string }> = [
    { pattern: /REPLIT_IDENTITY|replit_auth|@replit\/identity|REPL_OWNER/, method: "replit-oidc", label: "replit-oidc" },
    { pattern: /magic\.?[Ll]ink|magicLink|magic_link/, method: "magic-link", label: "magic-link" },
    { pattern: /jsonwebtoken|jose|jwt\.verify|jwt\.sign/, method: "jwt", label: "jwt" },
    { pattern: /express-session|req\.session/, method: "session", label: "session" },
    { pattern: /passport/, method: "session", label: "passport" },
  ];

  const authFileSet = new Set<string>();
  let replitSpecificAuth = false;
  const authDetails: string[] = [];

  // Weight hits by file location — route-level auth > UI auth > ambient references > build tooling
  const methodScores = new Map<ScanReport["auth"]["method"], number>();

  for (const { pattern, method, label } of authPatterns) {
    const hits = await grepFiles(pattern, allSrcAbsolute);
    if (hits.length > 0) {
      let weightedScore = 0;
      for (const h of hits) {
        const rel = path.relative(projectPath, h.file);
        authFileSet.add(rel);

        // Weight by file location
        if (/\.(config|build)\.|script\/|replit\./.test(rel)) {
          // Build tooling / config — don't count for method detection
          weightedScore += 0;
        } else if (/server\/(routes|auth)|api\//.test(rel)) {
          weightedScore += 3; // Route-level auth
        } else if (/pages\/auth|lib\/auth|hooks\/.*auth/i.test(rel)) {
          weightedScore += 2; // Auth UI
        } else {
          weightedScore += 1; // Ambient reference
        }
      }

      methodScores.set(method, (methodScores.get(method) ?? 0) + weightedScore);

      if (method === "replit-oidc") {
        replitSpecificAuth = true;
      }
      authDetails.push(`${label} pattern found in ${hits.length} location(s), weight ${weightedScore}`);
    }
  }

  // Pick method with highest weighted score
  let detectedAuthMethod: ScanReport["auth"]["method"] = "none";
  let maxScore = 0;
  for (const [method, score] of methodScores) {
    if (score > maxScore) {
      maxScore = score;
      detectedAuthMethod = method;
    }
  }

  if (detectedAuthMethod === "none" && authFileSet.size > 0) {
    detectedAuthMethod = "unknown";
  }

  // ---------------------------------------------------------------------------
  // 4. Database detection
  // ---------------------------------------------------------------------------

  process.stderr.write(`[replit-scanner] Detecting database...\n`);

  let dbType: ScanReport["database"]["type"] = "none";
  const dbDepMap: Array<[string, ScanReport["database"]["type"]]> = [
    ["pg", "postgres"],
    ["@neondatabase/serverless", "postgres"],
    ["postgres", "postgres"],
    ["mysql2", "mysql"],
    ["better-sqlite3", "sqlite"],
    ["mongoose", "mongodb"],
    ["mongodb", "mongodb"],
  ];
  for (const [dep, type] of dbDepMap) {
    if (hasDep(deps, dep)) {
      dbType = type;
      break;
    }
  }

  let schemaFiles: string[] = [];
  if (hasDrizzleConfig) schemaFiles.push("drizzle.config.ts");
  if (hasPrismaSchema) schemaFiles.push("prisma/schema.prisma");

  if (deep) {
    const drizzleSchemas = await glob("**/schema.ts", {
      cwd: projectPath,
      ignore: ["node_modules/**", "dist/**", "build/**"],
    });
    schemaFiles.push(...drizzleSchemas);
  }

  // After detecting ORM type, find actual schema files (not just config)
  if (orm === "drizzle") {
    const schemaGlobs = await glob(
      "{shared/schema,src/schema,server/schema,db/schema,src/db/schema,lib/schema}.{ts,js}",
      { cwd: projectPath }
    );
    if (schemaGlobs.length > 0) {
      schemaFiles.push(...schemaGlobs);
    }
    // Deduplicate
    schemaFiles = [...new Set(schemaFiles)];
  }

  // Prisma: schema.prisma already captured above; also check non-standard locations
  if (orm === "prisma") {
    const prismaSchemas = await glob("**/schema.prisma", {
      cwd: projectPath,
      ignore: ["node_modules/**"],
    });
    schemaFiles.push(...prismaSchemas);
    schemaFiles = [...new Set(schemaFiles)];
  }

  // Mongoose: find model definition files
  if (orm === "mongoose") {
    const mongooseModels = await glob(
      "{models,server/models,src/models}/*.{ts,js}",
      { cwd: projectPath }
    );
    schemaFiles.push(...mongooseModels);
    schemaFiles = [...new Set(schemaFiles)];
  }

  // Check for DATABASE_URL in env files pointing to Replit
  const envFiles = [".env", ".env.local", ".env.example", ".env.production"];
  let connectionEnvVar: string | null = null;
  let replitHosted = false;

  for (const envFile of envFiles) {
    const content = await readFileIfExists(abs(envFile));
    if (!content) continue;
    for (const line of content.split("\n")) {
      const match = line.match(/^(DATABASE_URL|DB_URL)\s*=\s*(.+)$/);
      if (match) {
        connectionEnvVar = match[1];
        if (/replit\.dev|replit\.com/.test(match[2])) {
          replitHosted = true;
        }
      }
    }
  }

  // Also grep source files for REPLIT_DB_URL
  const replitDbHits = await grepFiles(/REPLIT_DB_URL/, allSrcAbsolute);
  const replitDbUsed = replitDbHits.length > 0;
  if (replitDbUsed) {
    replitHosted = true;
    if (!connectionEnvVar) connectionEnvVar = "REPLIT_DB_URL";
    if (dbType === "none") dbType = "in-memory"; // Replit DB is key-value, closest mapping
  }

  // ---------------------------------------------------------------------------
  // 5. API route detection
  // ---------------------------------------------------------------------------

  process.stderr.write(`[replit-scanner] Detecting API routes...\n`);

  const routeGlobs = [
    "server/**/*.{ts,js}",
    "routes/**/*.{ts,js}",
    "api/**/*.{ts,js}",
    "src/server/**/*.{ts,js}",
  ];

  const routeFileSet = new Set<string>();
  for (const pattern of routeGlobs) {
    const found = await glob(pattern, {
      cwd: projectPath,
      ignore: ["node_modules/**", "dist/**", "build/**"],
    });
    for (const f of found) routeFileSet.add(f);
  }

  const routePattern =
    /(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*["'`](\/[^"'`]*)/gi;

  const apiRoutes: ApiRoute[] = [];

  for (const relFile of routeFileSet) {
    const content = await readFileIfExists(abs(relFile));
    if (!content) continue;
    const lines = content.split("\n");

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      let m: RegExpExecArray | null;
      const localPattern =
        /(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*["'`](\/[^"'`]*)/gi;
      while ((m = localPattern.exec(line)) !== null) {
        const method = m[1].toUpperCase();
        const routePath = m[2];

        // Lookahead: scan next ~30 lines for handler body hints
        const handlerLines = lines
          .slice(lineIdx, lineIdx + 30)
          .join("\n");

        const authRequired =
          /req\.user|requireAuth|isAuthenticated/.test(handlerLines);
        const replitSpecificCode = /REPLIT_/.test(handlerLines);

        apiRoutes.push({
          method,
          path: routePath,
          file: relFile,
          line: lineIdx + 1,
          auth_required: authRequired,
          replit_specific_code: replitSpecificCode,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Environment variable detection
  // ---------------------------------------------------------------------------

  process.stderr.write(`[replit-scanner] Detecting environment variables...\n`);

  const envVarMap = new Map<string, EnvVar>();

  const addEnvVar = (name: string, source: string) => {
    if (envVarMap.has(name)) return;

    const replitSpecific =
      name.startsWith("REPLIT_") ||
      name.startsWith("REPL_") ||
      ["REPLIT_DB_URL", "REPL_ID", "REPL_SLUG", "REPL_OWNER", "REPLIT_IDENTITY_KEY"].includes(
        name
      );

    let category: EnvVar["category"] = "config";
    if (replitSpecific) {
      category = "replit-internal";
    } else if (
      /SESSION_SECRET|JWT_SECRET|AUTH_/.test(name)
    ) {
      category = "auth";
    } else if (/DATABASE_URL|^DB_/.test(name)) {
      category = "database";
    } else if (/_API_KEY$|_SECRET$/.test(name)) {
      category = "api-key";
    }

    envVarMap.set(name, { name, source, replit_specific: replitSpecific, category });
  };

  // Parse .env files
  for (const envFile of envFiles) {
    const content = await readFileIfExists(abs(envFile));
    if (!content) continue;
    for (const line of content.split("\n")) {
      const m = line.match(/^([A-Z][A-Z0-9_]*)\s*=/);
      if (m) addEnvVar(m[1], envFile);
    }
  }

  // Grep source files for process.env references
  const processEnvPattern = /process\.env\.([A-Z][A-Z0-9_]*)/g;
  for (const relFile of allSrcFiles) {
    const content = await readFileIfExists(abs(relFile));
    if (!content) continue;
    let m: RegExpExecArray | null;
    while ((m = processEnvPattern.exec(content)) !== null) {
      addEnvVar(m[1], relFile);
    }
    // Reset lastIndex for global regex
    processEnvPattern.lastIndex = 0;
  }

  // ---------------------------------------------------------------------------
  // 7. External service detection
  // ---------------------------------------------------------------------------

  process.stderr.write(`[replit-scanner] Detecting external services...\n`);

  const servicePatterns: Array<[string, ExternalService["type"], RegExp]> = [
    ["openai", "ai", /openai/],
    ["anthropic", "ai", /@anthropic-ai\/sdk/],
    ["groq", "ai", /groq-sdk/],
    ["google-ai", "ai", /@google\/generative-ai/],
    ["stripe", "payment", /stripe/],
    ["nodemailer", "email", /nodemailer/],
    ["sendgrid", "email", /@sendgrid/],
    ["resend", "email", /resend/],
    ["aws-s3", "storage", /@aws-sdk\/client-s3/],
    ["supabase", "storage", /@supabase\/supabase-js/],
    ["firebase", "storage", /firebase/],
    ["segment", "analytics", /@segment/],
    ["mixpanel", "analytics", /mixpanel/],
    ["posthog", "analytics", /posthog/],
  ];

  const externalServices: ExternalService[] = [];

  for (const [name, type, pattern] of servicePatterns) {
    const hits = await grepFiles(pattern, allSrcAbsolute);
    if (hits.length > 0) {
      const files = [...new Set(hits.map((h) => path.relative(projectPath, h.file)))];
      externalServices.push({ name, type, files });
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Frontend page detection
  // ---------------------------------------------------------------------------

  process.stderr.write(`[replit-scanner] Detecting frontend pages...\n`);

  const pageGlobs = [
    "client/src/pages/*.{tsx,jsx,ts,js}",
    "pages/*.{tsx,jsx,ts,js}",
    "app/**/page.{tsx,jsx,ts,js}",
    "src/pages/*.{tsx,jsx,ts,js}",
    "src/routes/*.{tsx,jsx,ts,js}",
  ];

  const pageFiles: FrontendPage[] = [];
  for (const pattern of pageGlobs) {
    const found = await glob(pattern, {
      cwd: projectPath,
      ignore: ["node_modules/**", "dist/**", "build/**"],
    });
    for (const f of found) {
      const basename = path.basename(f, path.extname(f));
      const name =
        basename.charAt(0).toUpperCase() + basename.slice(1).replace(/[_-](\w)/g, (_, c) => c.toUpperCase());
      // Derive route: strip leading directory segments to just the filename slug
      const routeBase = basename === "index" ? "/" : `/${basename.toLowerCase()}`;
      pageFiles.push({ name, file: f, route: routeBase });
    }
  }

  // Routing type detection
  let routingType: ScanReport["frontend"]["routing_type"] = "none";
  const hasNextPages =
    !!(await readFileIfExists(abs("pages"))) ||
    !!(await readFileIfExists(abs("app")));
  // More reliable: check deps
  if (hasDep(deps, "next")) {
    routingType = "next";
  } else if (hasDep(deps, "wouter")) {
    routingType = "wouter";
  } else if (hasDep(deps, "react-router-dom") || hasDep(deps, "react-router")) {
    routingType = "react-router";
  } else if (pageFiles.length > 0) {
    routingType = "file-based";
  } else if (deps.length > 0) {
    routingType = "unknown";
  }

  // Frontend entry point
  const entryPointCandidates = [
    "client/src/main.tsx",
    "client/src/main.ts",
    "client/src/index.tsx",
    "client/src/index.ts",
    "src/main.tsx",
    "src/main.ts",
    "src/index.tsx",
    "src/index.ts",
    "index.tsx",
    "index.ts",
  ];
  let frontendEntry: string | null = null;
  for (const candidate of entryPointCandidates) {
    if (await readFileIfExists(abs(candidate))) {
      frontendEntry = candidate;
      break;
    }
  }

  // Count components
  const componentFiles = await glob("**/*.{tsx,jsx}", {
    cwd: projectPath,
    ignore: ["node_modules/**", "dist/**", "build/**", "**/*.test.*", "**/*.spec.*"],
  });

  // ---------------------------------------------------------------------------
  // 9. Browser API detection
  // ---------------------------------------------------------------------------

  process.stderr.write(`[replit-scanner] Detecting browser API usage...\n`);

  type BrowserApiDef = {
    api: string;
    pattern: RegExp;
    native_equivalent: string;
    native_framework: string;
    native_import: string;
    risk: BrowserApi["risk"];
  };

  const browserApiDefs: BrowserApiDef[] = [
    {
      api: "SpeechRecognition",
      pattern: /SpeechRecognition|webkitSpeechRecognition/,
      native_equivalent: "SFSpeechRecognizer",
      native_framework: "Speech",
      native_import: "import Speech",
      risk: "high",
    },
    {
      api: "speechSynthesis",
      pattern: /speechSynthesis|SpeechSynthesisUtterance/,
      native_equivalent: "AVSpeechSynthesizer",
      native_framework: "AVFoundation",
      native_import: "import AVFoundation",
      risk: "low",
    },
    {
      api: "navigator.geolocation",
      pattern: /navigator\.geolocation/,
      native_equivalent: "CLLocationManager",
      native_framework: "CoreLocation",
      native_import: "import CoreLocation",
      risk: "medium",
    },
    {
      api: "navigator.mediaDevices",
      pattern: /navigator\.mediaDevices|getUserMedia/,
      native_equivalent: "AVCaptureSession",
      native_framework: "AVFoundation",
      native_import: "import AVFoundation",
      risk: "medium",
    },
    {
      api: "localStorage",
      pattern: /localStorage|sessionStorage/,
      native_equivalent: "UserDefaults / SwiftData",
      native_framework: "SwiftUI",
      native_import: "import SwiftUI",
      risk: "low",
    },
    {
      api: "WebSocket",
      pattern: /new WebSocket\s*\(/,
      native_equivalent: "URLSessionWebSocketTask",
      native_framework: "Foundation",
      native_import: "import Foundation",
      risk: "low",
    },
    {
      api: "Notification (web push)",
      pattern: /new Notification\s*\(|Notification\.requestPermission/,
      native_equivalent: "UNUserNotificationCenter",
      native_framework: "UserNotifications",
      native_import: "import UserNotifications",
      risk: "medium",
    },
    {
      api: "navigator.clipboard",
      pattern: /navigator\.clipboard/,
      native_equivalent: "UIPasteboard",
      native_framework: "UIKit",
      native_import: "import UIKit",
      risk: "low",
    },
    {
      api: "canvas",
      pattern: /canvas|getContext\s*\(\s*["']2d["']\s*\)/,
      native_equivalent: "Core Graphics / SwiftUI Canvas",
      native_framework: "SwiftUI",
      native_import: "import SwiftUI",
      risk: "medium",
    },
    {
      api: "IntersectionObserver",
      pattern: /IntersectionObserver/,
      native_equivalent: "ScrollView onAppear",
      native_framework: "SwiftUI",
      native_import: "import SwiftUI",
      risk: "low",
    },
  ];

  const browserApis: BrowserApi[] = [];

  for (const def of browserApiDefs) {
    const hits = await grepFiles(def.pattern, allSrcAbsolute);
    if (hits.length > 0) {
      const files = [...new Set(hits.map((h) => path.relative(projectPath, h.file)))];
      browserApis.push({
        api: def.api,
        files,
        native_equivalent: def.native_equivalent,
        native_framework: def.native_framework,
        native_import: def.native_import,
        risk: def.risk,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 10. File stats
  // ---------------------------------------------------------------------------

  process.stderr.write(`[replit-scanner] Counting files...\n`);

  const allFiles = await glob("**/*", {
    cwd: projectPath,
    ignore: ["node_modules/**", ".git/**", "dist/**", "build/**"],
    nodir: true,
  });

  const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".swift"]);
  let sourceCount = 0;
  const byExtension: Record<string, number> = {};

  for (const f of allFiles) {
    const ext = path.extname(f);
    if (!ext) continue;
    byExtension[ext] = (byExtension[ext] ?? 0) + 1;
    if (sourceExtensions.has(ext)) sourceCount++;
  }

  // ---------------------------------------------------------------------------
  // Replit-specific dependency summary
  // ---------------------------------------------------------------------------

  const replitModulesUsed = deps.filter((d) => d.startsWith("@replit/"));

  const replitEnvVarNames = [...envVarMap.values()]
    .filter((v) => v.replit_specific)
    .map((v) => v.name);

  // ---------------------------------------------------------------------------
  // Assemble report
  // ---------------------------------------------------------------------------

  const projectName = path.basename(projectPath);

  process.stderr.write(`[replit-scanner] Scan complete.\n`);

  return {
    project_name: projectName,
    project_path: projectPath,
    scan_timestamp: Date.now(),

    stack: {
      runtime,
      framework,
      frontend_framework,
      bundler,
      language,
      styling,
    },

    auth: {
      method: detectedAuthMethod,
      files: [...authFileSet],
      replit_specific: replitSpecificAuth,
      details: authDetails.join("; ") || "no auth detected",
    },

    database: {
      type: dbType,
      orm,
      schema_files: schemaFiles,
      connection_env_var: connectionEnvVar,
      replit_hosted: replitHosted,
    },

    api_routes: apiRoutes,

    env_vars: [...envVarMap.values()],

    external_services: externalServices,

    replit_dependencies: {
      has_replit_config: hasReplitConfig,
      has_replit_nix: hasReplitNix,
      replit_env_vars: replitEnvVarNames,
      replit_modules_used: replitModulesUsed,
      replit_db_used: replitDbUsed,
      replit_auth_used: replitSpecificAuth,
    },

    frontend: {
      entry_point: frontendEntry,
      pages: pageFiles,
      routing_type: routingType,
      components_count: componentFiles.length,
    },

    browser_apis: browserApis,

    file_stats: {
      total_files: allFiles.length,
      source_files: sourceCount,
      by_extension: byExtension,
    },
  };
}
