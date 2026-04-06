/**
 * Replit-Migrate MCP Tool Definitions and Handlers
 *
 * Exports TOOLS array (MCP tool descriptors) and handleToolCall dispatcher.
 * Improvement over NavGator pattern: projectPath resolved once at dispatch entry,
 * not duplicated inside each case. Timing wrapper logs execution time to stderr.
 */

import { scanReplitProject } from "../analyzers/replit-scanner.js";
import { mapDependencies } from "../analyzers/dependency-mapper.js";
import { mapApis } from "../analyzers/api-mapper.js";
import { generateWebPlan } from "../generators/web-migration.js";
import { generateNativePlan } from "../generators/native-migration.js";
import type {
  McpResponse,
  ScanReport,
  WebMigrationPlan,
  NativeMigrationPlan,
  MigrationProgress,
} from "../types.js";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function textResponse(text: string): McpResponse {
  return { content: [{ type: "text", text }] };
}

function errorResponse(text: string): McpResponse {
  return { content: [{ type: "text", text }], isError: true };
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function getMigrateDir(projectPath: string): string {
  const dir = path.join(projectPath, ".replit-migrate");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadScanReport(projectPath: string): ScanReport | null {
  const reportPath = path.join(
    projectPath,
    ".replit-migrate",
    "scan-report.json"
  );
  if (!fs.existsSync(reportPath)) return null;
  return JSON.parse(fs.readFileSync(reportPath, "utf-8")) as ScanReport;
}

// ---------------------------------------------------------------------------
// MCP Tool Definitions
// ---------------------------------------------------------------------------

export const TOOLS = [
  {
    name: "migrate_scan",
    description:
      "Analyze a Replit project — detect stack, auth, database, API routes, env vars, Replit-specific dependencies, browser APIs, and frontend pages. Writes full report to .replit-migrate/scan-report.json. Run this first before any migration planning.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description:
            "Path to the Replit project (default: current working directory)",
        },
        deep: {
          type: "boolean",
          description: "Include deep API route shape analysis (slower)",
        },
      },
    },
    annotations: {
      title: "Scan Replit Project",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },

  {
    name: "migrate_plan_web",
    description:
      "Generate a web migration plan from Replit to Vercel, Cloudflare, or standalone. Requires migrate_scan first. Encodes lessons from real ProductPilot migration: spike auth first, generate bundler config upfront, wire all call sites atomically.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Path to the Replit project (default: cwd)",
        },
        target: {
          type: "string",
          enum: ["vercel", "cloudflare", "standalone"],
          description: "Deployment target (default: vercel)",
        },
        auth_strategy: {
          type: "string",
          enum: ["clerk", "auth-js", "neon-auth", "none"],
          description: "Auth replacement (default: auto-detect)",
        },
      },
    },
    annotations: {
      title: "Plan Web Migration",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },

  {
    name: "migrate_plan_native",
    description:
      "Generate a native iOS/macOS migration plan. Requires migrate_scan first. Encodes lessons from FloDoro (51 builds): architecture doc before code, platform constraints before UI, native APIs before custom, IBR scanning from build 1.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Path to the Replit project (default: cwd)",
        },
        platforms: {
          type: "array",
          items: {
            type: "string",
            enum: ["ios", "macos", "watchos"],
          },
          description: "Target platforms (default: ['ios'])",
        },
        keep_api: {
          type: "boolean",
          description:
            "Keep remote API for data sync (default: false — local-first)",
        },
      },
    },
    annotations: {
      title: "Plan Native Migration",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },

  {
    name: "migrate_map_apis",
    description:
      "Deep analysis of API routes — extract parameters, response shapes, middleware, and classify for migration target. Use after migrate_scan for detailed route-level planning.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Path to the Replit project (default: cwd)",
        },
        target: {
          type: "string",
          enum: ["web", "native"],
          description: "Migration target for route classification",
        },
      },
      required: ["target"],
    },
    annotations: {
      title: "Map API Routes",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },

  {
    name: "migrate_map_models",
    description:
      "Translate data models from web ORM (Drizzle/Prisma) to target format (SwiftData, Drizzle, Prisma). Shows field-by-field type mapping with notes on relations, constraints, and defaults.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Path to the Replit project (default: cwd)",
        },
        target: {
          type: "string",
          enum: ["swiftdata", "drizzle", "prisma"],
          description: "Target model format",
        },
      },
      required: ["target"],
    },
    annotations: {
      title: "Map Data Models",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },

  {
    name: "migrate_check_progress",
    description:
      "Check migration progress — compare current filesystem state against the migration plan. Shows completed tasks, remaining work, and any new issues.",
    inputSchema: {
      type: "object",
      properties: {
        project_path: {
          type: "string",
          description: "Path to the Replit project (default: cwd)",
        },
      },
    },
    annotations: {
      title: "Check Progress",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Tool dispatcher
// ---------------------------------------------------------------------------

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<McpResponse> {
  const start = Date.now();

  try {
    // Resolve projectPath once — every handler below uses this.
    const projectPath = (args.project_path as string) || process.cwd();

    let result: McpResponse;

    switch (name) {
      case "migrate_scan":
        result = await handleMigrateScan(projectPath, args);
        break;
      case "migrate_plan_web":
        result = await handleMigratePlanWeb(projectPath, args);
        break;
      case "migrate_plan_native":
        result = await handleMigratePlanNative(projectPath, args);
        break;
      case "migrate_map_apis":
        result = await handleMigrateMapApis(projectPath, args);
        break;
      case "migrate_map_models":
        result = await handleMigrateMapModels(projectPath, args);
        break;
      case "migrate_check_progress":
        result = await handleMigrateCheckProgress(projectPath);
        break;
      default:
        result = errorResponse(`Unknown tool: ${name}`);
    }

    const elapsed = Date.now() - start;
    process.stderr.write(`[tools] ${name} completed in ${elapsed}ms\n`);
    return result;
  } catch (err) {
    const elapsed = Date.now() - start;
    const msg = err instanceof Error ? err.message : "Unknown error";
    process.stderr.write(`[tools] ${name} failed after ${elapsed}ms: ${msg}\n`);
    return errorResponse(msg);
  }
}

// ---------------------------------------------------------------------------
// migrate_scan
// ---------------------------------------------------------------------------

async function handleMigrateScan(
  projectPath: string,
  args: Record<string, unknown>
): Promise<McpResponse> {
  const deep = (args.deep as boolean) ?? false;

  const report = await scanReplitProject(projectPath, deep);

  // Persist report
  const dir = getMigrateDir(projectPath);
  fs.writeFileSync(
    path.join(dir, "scan-report.json"),
    JSON.stringify(report, null, 2)
  );

  // --- Lock-in score ---
  let lockInScore = 0;
  if (report.auth.replit_specific) lockInScore += 2;
  if (report.database.replit_hosted) lockInScore += 2;
  if (report.replit_dependencies.has_replit_config) lockInScore += 1;
  if (report.replit_dependencies.has_replit_nix) lockInScore += 1;
  // +1 per Replit env var, capped at 2
  lockInScore += Math.min(report.replit_dependencies.replit_env_vars.length, 2);
  // +1 per @replit/* package, capped at 2
  lockInScore += Math.min(report.replit_dependencies.replit_modules_used.length, 2);

  // --- Summary values ---
  const authLabel = `${report.auth.method}${report.auth.replit_specific ? " ⚠️ Replit-specific" : " (portable)"}`;
  const dbLabel = `${report.database.type} via ${report.database.orm ?? "none"}${report.database.replit_hosted ? " ⚠️ Replit-hosted" : " (portable)"}`;
  const authRequired = report.api_routes.filter((r) => r.auth_required).length;
  const replitRoutes = report.api_routes.filter(
    (r) => r.replit_specific_code
  ).length;

  const replitEnvList =
    report.replit_dependencies.replit_env_vars.length > 0
      ? report.replit_dependencies.replit_env_vars.join(", ")
      : "none";
  const replitPkgList =
    report.replit_dependencies.replit_modules_used.length > 0
      ? report.replit_dependencies.replit_modules_used.join(", ")
      : "none";

  // --- Browser API table ---
  let browserApiTable = "";
  if (report.browser_apis.length > 0) {
    const rows = report.browser_apis.map(
      (b) =>
        `| ${b.api} | ${b.native_equivalent} | ${b.risk} |`
    );
    browserApiTable =
      "| Browser API | Native Equivalent | Risk |\n" +
      "|-------------|-------------------|------|\n" +
      rows.join("\n");
  } else {
    browserApiTable = "None detected.";
  }

  const summary = `# Migration Scan: ${report.project_name}

**Stack:** ${report.stack.runtime} / ${report.stack.framework ?? "none"} / ${report.stack.frontend_framework ?? "none"} / ${report.stack.bundler ?? "none"} / ${report.stack.language}
**Auth:** ${authLabel}
**Database:** ${dbLabel}
**Routes:** ${report.api_routes.length} API routes (${authRequired} need auth, ${replitRoutes} Replit-specific)
**Env Vars:** ${report.env_vars.length} total, ${report.replit_dependencies.replit_env_vars.length} Replit-specific
**Browser APIs:** ${report.browser_apis.length} detected (need native equivalents for iOS)
**Frontend:** ${report.frontend.pages.length} pages, ${report.frontend.routing_type} routing
**Replit Lock-in:** ${lockInScore}/10

## Replit Dependencies
- .replit config: ${report.replit_dependencies.has_replit_config ? "yes" : "no"}
- replit.nix: ${report.replit_dependencies.has_replit_nix ? "yes" : "no"}
- Replit env vars: ${replitEnvList}
- @replit/* packages: ${replitPkgList}

## Browser APIs Requiring Native Translation
${browserApiTable}

Full report: .replit-migrate/scan-report.json`;

  return textResponse(summary);
}

// ---------------------------------------------------------------------------
// migrate_plan_web
// ---------------------------------------------------------------------------

async function handleMigratePlanWeb(
  projectPath: string,
  args: Record<string, unknown>
): Promise<McpResponse> {
  const scanReport = loadScanReport(projectPath);
  if (!scanReport) {
    return errorResponse(
      "No scan report found. Run migrate_scan first, then retry migrate_plan_web."
    );
  }

  const target =
    (args.target as WebMigrationPlan["target"]) ?? "vercel";
  const authStrategy =
    (args.auth_strategy as string) ?? "auto-detect";

  const plan = await generateWebPlan(scanReport, target, authStrategy);

  const dir = getMigrateDir(projectPath);
  fs.writeFileSync(path.join(dir, "web-plan.json"), JSON.stringify(plan, null, 2));

  // Build markdown plan doc
  const criticalPathList = plan.critical_path
    .map((id) => `- ${id}`)
    .join("\n");

  const taskList = plan.tasks
    .map((t) => `- [ ] [${t.id}] **${t.title}** (${t.risk} risk, ${t.category})`)
    .join("\n");

  const envMappingTable =
    plan.env_var_mapping.length > 0
      ? "| Replit Var | Replacement | Where to Set |\n" +
        "|------------|-------------|---------------|\n" +
        plan.env_var_mapping
          .map((e) => `| ${e.replit_var} | ${e.replacement_var} | ${e.where_to_set} |`)
          .join("\n")
      : "No Replit env vars to map.";

  const md = `# Web Migration Plan: ${scanReport.project_name}

**Target:** ${plan.target}
**Complexity:** ${plan.estimated_complexity}
**Generated:** ${new Date(plan.generated_at).toISOString()}

## Auth Migration
- From: ${plan.auth_migration.from}
- To: ${plan.auth_migration.to}
- Risk: ${plan.auth_migration.risk}
- Lesson: ${plan.auth_migration.lesson}

## Database Migration
- From: ${plan.database_migration.from}
- To: ${plan.database_migration.to}
- Risk: ${plan.database_migration.risk}

## Bundling
- Strategy: ${plan.bundling.strategy}
- Lesson: ${plan.bundling.lesson}

## Env Var Mapping
${envMappingTable}

## Critical Path
${criticalPathList || "None defined."}

## All Tasks
${taskList}

Full plan: .replit-migrate/web-plan.json`;

  fs.writeFileSync(path.join(dir, "WEB_MIGRATION_PLAN.md"), md);

  return textResponse(md);
}

// ---------------------------------------------------------------------------
// migrate_plan_native
// ---------------------------------------------------------------------------

async function handleMigratePlanNative(
  projectPath: string,
  args: Record<string, unknown>
): Promise<McpResponse> {
  const scanReport = loadScanReport(projectPath);
  if (!scanReport) {
    return errorResponse(
      "No scan report found. Run migrate_scan first, then retry migrate_plan_native."
    );
  }

  const platforms = (args.platforms as string[]) ?? ["ios"];
  const keepApi = (args.keep_api as boolean) ?? false;

  const plan = await generateNativePlan(scanReport, platforms, keepApi);

  const dir = getMigrateDir(projectPath);
  fs.writeFileSync(
    path.join(dir, "native-plan.json"),
    JSON.stringify(plan, null, 2)
  );

  // Build markdown plan doc
  const taskList = plan.tasks
    .map((t) => `- [ ] [${t.id}] **${t.title}** (${t.risk} risk, ${t.category})`)
    .join("\n");

  const browserMappingTable =
    plan.browser_to_native_mapping.length > 0
      ? "| Browser API | Native Framework | Risk | Lesson |\n" +
        "|-------------|-----------------|------|--------|\n" +
        plan.browser_to_native_mapping
          .map(
            (b) =>
              `| ${b.browser_api} | ${b.native_framework} | ${b.risk} | ${b.lesson} |`
          )
          .join("\n")
      : "No browser APIs requiring translation.";

  const screenMapList =
    plan.ui_screen_mapping.length > 0
      ? plan.ui_screen_mapping
          .map(
            (s) =>
              `- **${s.web_page}** (${s.web_file}) → ${s.native_view}\n` +
              s.ui_notes.map((n) => `  - ${n}`).join("\n")
          )
          .join("\n")
      : "No screen mapping defined.";

  const md = `# Native Migration Plan: ${scanReport.project_name}

**Platforms:** ${plan.platforms.join(", ")}
**Complexity:** ${plan.estimated_complexity}
**Generated:** ${new Date(plan.generated_at).toISOString()}

## Architecture
${plan.architecture_doc.summary}

**Layers:** ${plan.architecture_doc.layers.join(" → ")}
**Data Flow:** ${plan.architecture_doc.data_flow}
**Lesson:** ${plan.architecture_doc.lesson}

## Auth Strategy
**Method:** ${plan.auth_strategy.method}

## IBR Testing
- When to start: ${plan.ibr_testing.when_to_start}
- Lesson: ${plan.ibr_testing.lesson}

## Browser → Native API Mapping
${browserMappingTable}

## Screen Mapping
${screenMapList}

## All Tasks
${taskList}

Full plan: .replit-migrate/native-plan.json`;

  fs.writeFileSync(path.join(dir, "NATIVE_MIGRATION_PLAN.md"), md);

  return textResponse(md);
}

// ---------------------------------------------------------------------------
// migrate_map_apis
// ---------------------------------------------------------------------------

async function handleMigrateMapApis(
  projectPath: string,
  args: Record<string, unknown>
): Promise<McpResponse> {
  const target = (args.target as "web" | "native");

  const scanReport = loadScanReport(projectPath);
  if (!scanReport) {
    return errorResponse(
      "No scan report found. Run migrate_scan first, then retry migrate_map_apis."
    );
  }

  const mapReport = await mapApis(projectPath, scanReport.api_routes, target);

  if (mapReport.routes.length === 0) {
    return textResponse(
      "No API routes found. Ensure the project has server/routes/api source files and run migrate_scan first."
    );
  }

  // Build route table
  const tableHeader =
    target === "native"
      ? "| Method | Path | Auth | Replit | Middleware | Params | Response | Becomes | Native Equivalent |\n" +
        "|--------|------|------|--------|------------|--------|----------|---------|-------------------|\n"
      : "| Method | Path | Auth | Replit | Middleware | Path Params | Query Params | Body Fields | Response |\n" +
        "|--------|------|------|--------|------------|-------------|--------------|-------------|----------|\n";

  const tableRows = mapReport.routes.map((r) => {
    const mw = r.middleware.length > 0 ? r.middleware.join(", ") : "—";
    const pathParams =
      r.params.path_params.length > 0 ? r.params.path_params.join(", ") : "—";
    const queryParams =
      r.params.query_params.length > 0 ? r.params.query_params.join(", ") : "—";
    const bodyFields =
      r.params.body_fields.length > 0 ? r.params.body_fields.join(", ") : "—";

    if (target === "native") {
      return (
        `| ${r.method} | \`${r.path}\` | ${r.auth_required ? "yes" : "no"} | ${r.replit_specific ? "⚠️" : "no"} ` +
        `| ${mw} | ${pathParams} | ${r.response_pattern} | ${r.becomes ?? "—"} | ${r.native_equivalent ?? "—"} |`
      );
    }
    return (
      `| ${r.method} | \`${r.path}\` | ${r.auth_required ? "yes" : "no"} | ${r.replit_specific ? "⚠️" : "no"} ` +
      `| ${mw} | ${pathParams} | ${queryParams} | ${bodyFields} | ${r.response_pattern} |`
    );
  });

  const table = tableHeader + tableRows.join("\n");

  const summaryBlock = `## Summary
- Total routes: ${mapReport.summary.total}
- Auth-gated: ${mapReport.summary.auth_required}
- Replit-specific: ${mapReport.summary.replit_specific}
- By method: ${Object.entries(mapReport.summary.by_method)
    .map(([m, c]) => `${m}(${c})`)
    .join(", ")}${
    target === "native"
      ? `\n- Local-capable: ${mapReport.summary.local_capable}\n- Remote-required: ${mapReport.summary.remote_required}`
      : ""
  }`;

  return textResponse(
    `# API Route Map (target: ${target})\n\n${summaryBlock}\n\n## Routes\n${table}`
  );
}

// ---------------------------------------------------------------------------
// migrate_map_models
// ---------------------------------------------------------------------------

// Type maps for each target format
const SWIFTDATA_TYPE_MAP: Record<string, string> = {
  varchar: "String",
  text: "String",
  integer: "Int",
  int: "Int",
  bigint: "Int",
  serial: "Int",
  bigserial: "Int",
  boolean: "Bool",
  bool: "Bool",
  timestamp: "Date",
  "timestamp with time zone": "Date",
  timestamptz: "Date",
  date: "Date",
  "jsonb": "/* Codable struct — define separately */",
  json: "/* Codable struct — define separately */",
  real: "Double",
  float: "Double",
  numeric: "Decimal",
  decimal: "Decimal",
  uuid: "UUID",
};

const DRIZZLE_TYPE_MAP: Record<string, string> = {
  varchar: "varchar",
  text: "text",
  integer: "integer",
  int: "integer",
  bigint: "bigint",
  serial: "serial",
  bigserial: "bigserial",
  boolean: "boolean",
  bool: "boolean",
  timestamp: "timestamp",
  date: "date",
  jsonb: "jsonb",
  json: "json",
  real: "real",
  float: "real",
  numeric: "numeric",
  decimal: "numeric",
  uuid: "uuid",
};

const PRISMA_TYPE_MAP: Record<string, string> = {
  varchar: "String",
  text: "String",
  integer: "Int",
  int: "Int",
  bigint: "BigInt",
  serial: "Int @default(autoincrement())",
  bigserial: "BigInt @default(autoincrement())",
  boolean: "Boolean",
  bool: "Boolean",
  timestamp: "DateTime",
  date: "DateTime",
  jsonb: "Json",
  json: "Json",
  real: "Float",
  float: "Float",
  numeric: "Decimal",
  decimal: "Decimal",
  uuid: "String @default(uuid())",
};

interface ParsedField {
  name: string;
  rawType: string;
  notNull: boolean;
  isDefault: boolean;
  defaultValue: string | null;
  isForeignKey: boolean;
  referencesTable: string | null;
}

interface ParsedModel {
  name: string;
  fields: ParsedField[];
  orm: "drizzle" | "prisma" | "unknown";
}

/**
 * Parse Drizzle schema fields from a table definition block.
 * Handles: pgTable("name", { field: type().notNull().default(...) })
 */
function parseDrizzleFields(block: string): ParsedField[] {
  const fields: ParsedField[] = [];

  // Match field definitions: fieldName: type(args).modifiers
  // e.g. id: serial("id").primaryKey()
  // e.g. userId: integer("user_id").notNull().references(() => users.id)
  const fieldPattern = /(\w+)\s*:\s*(\w+)\s*\(([^)]*)\)((?:\.[^,}\n]+)*)/g;
  let m: RegExpExecArray | null;

  while ((m = fieldPattern.exec(block)) !== null) {
    const fieldName = m[1];
    const typeFunc = m[2].toLowerCase();
    const modifiers = m[4];

    const notNull = /\.notNull\(\)/.test(modifiers);
    const isDefault =
      /\.default\(/.test(modifiers) || /\.defaultNow\(\)/.test(modifiers);

    let defaultValue: string | null = null;
    const defMatch = modifiers.match(/\.default\(([^)]+)\)/);
    if (defMatch) defaultValue = defMatch[1].trim();
    if (/\.defaultNow\(\)/.test(modifiers)) defaultValue = "now()";

    const isForeignKey = /\.references\(/.test(modifiers);
    let referencesTable: string | null = null;
    if (isForeignKey) {
      const refMatch = modifiers.match(/\.references\(\s*\(\s*\)\s*=>\s*(\w+)\./);
      if (refMatch) referencesTable = refMatch[1];
    }

    // Skip primary key helpers and other non-field identifiers
    if (
      ["primaryKey", "index", "uniqueIndex", "foreignKey"].includes(fieldName)
    ) {
      continue;
    }

    fields.push({
      name: fieldName,
      rawType: typeFunc,
      notNull,
      isDefault,
      defaultValue,
      isForeignKey,
      referencesTable,
    });
  }

  return fields;
}

/**
 * Parse Prisma schema fields from a model block.
 * Handles: fieldName FieldType @modifier
 */
function parsePrismaFields(block: string): ParsedField[] {
  const fields: ParsedField[] = [];

  // Strip model header line
  const lines = block.split("\n").slice(1);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed === "}") continue;

    // fieldName Type modifiers
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;

    const fieldName = parts[0];
    const rawType = parts[1].replace("?", "").toLowerCase();
    const restLine = parts.slice(2).join(" ");
    const isOptional = parts[1].endsWith("?");

    const isForeignKey = /@relation/.test(restLine);
    let referencesTable: string | null = null;
    if (isForeignKey) {
      const refMatch = restLine.match(/references:\s*\[(\w+)\]/);
      if (refMatch) referencesTable = refMatch[1];
    }

    const isDefault = /@default/.test(restLine);
    let defaultValue: string | null = null;
    const defMatch = restLine.match(/@default\(([^)]+)\)/);
    if (defMatch) defaultValue = defMatch[1];

    fields.push({
      name: fieldName,
      rawType,
      notNull: !isOptional,
      isDefault,
      defaultValue,
      isForeignKey,
      referencesTable,
    });
  }

  return fields;
}

function detectOrm(content: string): "drizzle" | "prisma" | "unknown" {
  if (/pgTable\s*\(|mysqlTable\s*\(|sqliteTable\s*\(/.test(content))
    return "drizzle";
  if (/^model\s+\w+\s*\{/m.test(content)) return "prisma";
  return "unknown";
}

function parseModels(content: string, orm: "drizzle" | "prisma" | "unknown"): ParsedModel[] {
  const models: ParsedModel[] = [];

  if (orm === "drizzle") {
    // export const tableName = pgTable("actual_name", { ... })
    const tablePattern =
      /export\s+const\s+(\w+)\s*=\s*(?:pgTable|mysqlTable|sqliteTable)\s*\(\s*["']([^"']+)["']\s*,\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = tablePattern.exec(content)) !== null) {
      const varName = m[1];
      const block = m[3];
      models.push({
        name: varName,
        fields: parseDrizzleFields(block),
        orm: "drizzle",
      });
    }
  } else if (orm === "prisma") {
    // model ModelName { ... }
    const modelPattern = /model\s+(\w+)\s*\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = modelPattern.exec(content)) !== null) {
      const modelName = m[1];
      const block = m[0]; // full match including header
      models.push({
        name: modelName,
        fields: parsePrismaFields(block),
        orm: "prisma",
      });
    }
  }

  return models;
}

function translateFieldType(
  rawType: string,
  target: "swiftdata" | "drizzle" | "prisma"
): string {
  const normalized = rawType.toLowerCase();
  if (target === "swiftdata") return SWIFTDATA_TYPE_MAP[normalized] ?? "Any /* unknown type */";
  if (target === "drizzle") return DRIZZLE_TYPE_MAP[normalized] ?? normalized;
  if (target === "prisma") return PRISMA_TYPE_MAP[normalized] ?? "String";
  return normalized;
}

function buildFieldNote(
  field: ParsedField,
  target: "swiftdata" | "drizzle" | "prisma"
): string {
  const notes: string[] = [];

  if (field.isForeignKey && field.referencesTable) {
    if (target === "swiftdata") {
      notes.push(`@Relationship to ${field.referencesTable}`);
    } else {
      notes.push(`FK → ${field.referencesTable}`);
    }
  }

  if (field.defaultValue) {
    if (/gen_random_uuid/.test(field.defaultValue) && target === "swiftdata") {
      notes.push("UUID() default");
    } else if (field.defaultValue === "now()") {
      notes.push("default: now");
    } else {
      notes.push(`default: ${field.defaultValue}`);
    }
  }

  if (
    /jsonb|json/.test(field.rawType) &&
    target === "swiftdata"
  ) {
    notes.push("define Codable struct separately");
  }

  return notes.join("; ");
}

async function handleMigrateMapModels(
  projectPath: string,
  args: Record<string, unknown>
): Promise<McpResponse> {
  const target = args.target as "swiftdata" | "drizzle" | "prisma";

  const scanReport = loadScanReport(projectPath);
  if (!scanReport) {
    return errorResponse(
      "No scan report found. Run migrate_scan first, then retry migrate_map_models."
    );
  }

  const schemaFiles = scanReport.database.schema_files;
  if (schemaFiles.length === 0) {
    return textResponse(
      "No schema files found in the scan report. Ensure the project has a drizzle.config.ts, prisma/schema.prisma, or schema.ts, then re-run migrate_scan."
    );
  }

  const allModels: ParsedModel[] = [];
  const readErrors: string[] = [];

  for (const relFile of schemaFiles) {
    const absFile = path.isAbsolute(relFile)
      ? relFile
      : path.join(projectPath, relFile);

    let content: string;
    try {
      content = fs.readFileSync(absFile, "utf-8");
    } catch {
      readErrors.push(`Could not read ${relFile}`);
      continue;
    }

    const orm = detectOrm(content);
    const models = parseModels(content, orm);
    allModels.push(...models);
  }

  if (allModels.length === 0) {
    const errorNote =
      readErrors.length > 0 ? `\n\nRead errors:\n${readErrors.join("\n")}` : "";
    return textResponse(
      `No parseable model definitions found in schema files: ${schemaFiles.join(", ")}.${errorNote}`
    );
  }

  // Build output
  const sections: string[] = [];

  for (const model of allModels) {
    const rows = model.fields.map((f) => {
      const targetType = translateFieldType(f.rawType, target);
      const optional = !f.notNull && target === "swiftdata" ? "?" : "";
      const note = buildFieldNote(f, target);
      return `| ${f.name} | ${f.rawType} | ${targetType}${optional} | ${note || "—"} |`;
    });

    const table =
      `| Field | Source Type | ${target === "swiftdata" ? "Swift Type" : "Target Type"} | Notes |\n` +
      `|-------|-------------|----------|-------|\n` +
      rows.join("\n");

    sections.push(`### ${model.name} (${model.orm})\n\n${table}`);
  }

  const errNote =
    readErrors.length > 0
      ? `\n\n> Read errors: ${readErrors.join(", ")}`
      : "";

  return textResponse(
    `# Model Map → ${target}\n\nSource files: ${schemaFiles.join(", ")}\n\n${sections.join("\n\n")}${errNote}`
  );
}

// ---------------------------------------------------------------------------
// migrate_check_progress
// ---------------------------------------------------------------------------

interface ProgressTask {
  id: string;
  done: boolean;
  completed_at?: number;
  notes?: string;
}

interface ProgressFile {
  plan_type: "web" | "native";
  started_at: number;
  updated_at: number;
  tasks: ProgressTask[];
}

function loadPlan(
  projectPath: string
): { plan: WebMigrationPlan | NativeMigrationPlan; planType: "web" | "native" } | null {
  const migrateDir = path.join(projectPath, ".replit-migrate");

  const webPlanPath = path.join(migrateDir, "web-plan.json");
  if (fs.existsSync(webPlanPath)) {
    const plan = JSON.parse(
      fs.readFileSync(webPlanPath, "utf-8")
    ) as WebMigrationPlan;
    return { plan, planType: "web" };
  }

  const nativePlanPath = path.join(migrateDir, "native-plan.json");
  if (fs.existsSync(nativePlanPath)) {
    const plan = JSON.parse(
      fs.readFileSync(nativePlanPath, "utf-8")
    ) as NativeMigrationPlan;
    return { plan, planType: "native" };
  }

  return null;
}

/**
 * Heuristic checks for a task.
 * Returns true if evidence suggests the task is likely complete.
 */
function checkTaskHeuristics(
  task: { id: string; title: string; category: string; files_affected: string[] },
  projectPath: string,
  packageJson: Record<string, unknown> | null
): { likely_done: boolean; evidence: string } {
  const title = task.title.toLowerCase();
  const category = task.category.toLowerCase();

  // --- File existence checks ---
  if (task.files_affected.length > 0) {
    const existing = task.files_affected.filter((f) => {
      const absPath = path.isAbsolute(f) ? f : path.join(projectPath, f);
      return fs.existsSync(absPath);
    });
    if (existing.length === task.files_affected.length && task.files_affected.length > 0) {
      return {
        likely_done: true,
        evidence: `All ${existing.length} expected files exist`,
      };
    }
    if (existing.length > 0) {
      return {
        likely_done: false,
        evidence: `${existing.length}/${task.files_affected.length} files exist`,
      };
    }
  }

  // --- Package presence checks ---
  const allDeps: string[] = [];
  if (packageJson) {
    for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
      const block = packageJson[section];
      if (block && typeof block === "object") {
        allDeps.push(...Object.keys(block as Record<string, string>));
      }
    }
  }

  if (category === "auth") {
    if (/clerk/.test(title) && allDeps.includes("@clerk/nextjs")) {
      return { likely_done: true, evidence: "@clerk/nextjs found in dependencies" };
    }
    if (/auth[.-]?js|next[- ]auth/.test(title) && allDeps.some((d) => /next-auth|@auth\//.test(d))) {
      return { likely_done: true, evidence: "auth dependency found" };
    }
  }

  if (category === "database") {
    if (/drizzle/.test(title) && allDeps.includes("drizzle-orm")) {
      return { likely_done: true, evidence: "drizzle-orm found in dependencies" };
    }
    if (/prisma/.test(title) && allDeps.includes("@prisma/client")) {
      return { likely_done: true, evidence: "@prisma/client found in dependencies" };
    }
    if (/neon/.test(title) && allDeps.includes("@neondatabase/serverless")) {
      return { likely_done: true, evidence: "@neondatabase/serverless found" };
    }
  }

  if (category === "bundling") {
    const hasViteConfig =
      fs.existsSync(path.join(projectPath, "vite.config.ts")) ||
      fs.existsSync(path.join(projectPath, "vite.config.js"));
    if (/vite/.test(title) && hasViteConfig) {
      return { likely_done: true, evidence: "vite.config file exists" };
    }
    const hasVercelJson = fs.existsSync(path.join(projectPath, "vercel.json"));
    if (/vercel/.test(title) && hasVercelJson) {
      return { likely_done: true, evidence: "vercel.json exists" };
    }
  }

  if (category === "deployment") {
    const hasVercelJson = fs.existsSync(path.join(projectPath, "vercel.json"));
    const hasWranglerToml = fs.existsSync(path.join(projectPath, "wrangler.toml"));
    if (/vercel/.test(title) && hasVercelJson) {
      return { likely_done: true, evidence: "vercel.json exists" };
    }
    if (/cloudflare|wrangler/.test(title) && hasWranglerToml) {
      return { likely_done: true, evidence: "wrangler.toml exists" };
    }
  }

  return { likely_done: false, evidence: "no heuristic evidence found" };
}

/**
 * Grep for remaining REPLIT_ references across source files.
 */
function countReplitReferences(projectPath: string): number {
  let count = 0;
  const srcGlobs = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"];

  function walk(dir: string, depth: number) {
    if (depth > 10) return;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (["node_modules", ".git", "dist", "build", ".replit-migrate"].includes(entry)) continue;
      const full = path.join(dir, entry);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full, depth + 1);
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
        try {
          const content = fs.readFileSync(full, "utf-8");
          const matches = content.match(/REPLIT_|REPL_ID|REPL_SLUG|REPL_OWNER|@replit\//g);
          if (matches) count += matches.length;
        } catch {
          // skip unreadable
        }
      }
    }
  }

  walk(projectPath, 0);
  return count;
}

async function handleMigrateCheckProgress(
  projectPath: string
): Promise<McpResponse> {
  const planResult = loadPlan(projectPath);
  if (!planResult) {
    return errorResponse(
      "No migration plan found. Run migrate_plan_web or migrate_plan_native first."
    );
  }

  const { plan, planType } = planResult;
  const migrateDir = getMigrateDir(projectPath);
  const progressPath = path.join(migrateDir, "progress.json");

  // Load or initialise progress file
  let progress: ProgressFile;
  if (fs.existsSync(progressPath)) {
    progress = JSON.parse(fs.readFileSync(progressPath, "utf-8")) as ProgressFile;
  } else {
    progress = {
      plan_type: planType,
      started_at: Date.now(),
      updated_at: Date.now(),
      tasks: plan.tasks.map((t) => ({ id: t.id, done: t.done ?? false })),
    };
  }

  // Sync task list — add any new tasks from plan that don't exist in progress
  const progressIds = new Set(progress.tasks.map((t) => t.id));
  for (const planTask of plan.tasks) {
    if (!progressIds.has(planTask.id)) {
      progress.tasks.push({ id: planTask.id, done: planTask.done ?? false });
    }
  }

  // Load package.json for heuristics
  let packageJson: Record<string, unknown> | null = null;
  const pkgPath = path.join(projectPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      packageJson = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
    } catch {
      // non-critical
    }
  }

  // Build a quick lookup of plan tasks
  const planTaskMap = new Map(plan.tasks.map((t) => [t.id, t]));

  // Run heuristics and update progress
  const results: Array<{
    id: string;
    title: string;
    done: boolean;
    heuristic_done: boolean;
    evidence: string;
  }> = [];

  for (const pt of progress.tasks) {
    const planTask = planTaskMap.get(pt.id);
    if (!planTask) continue;

    const heuristic = checkTaskHeuristics(planTask, projectPath, packageJson);

    // Promote to done if heuristic passes and not already marked
    if (heuristic.likely_done && !pt.done) {
      pt.done = true;
      pt.completed_at = Date.now();
      pt.notes = `Auto-detected: ${heuristic.evidence}`;
    }

    results.push({
      id: pt.id,
      title: planTask.title,
      done: pt.done,
      heuristic_done: heuristic.likely_done,
      evidence: heuristic.evidence,
    });
  }

  // Replit reference count
  const replitRefCount = countReplitReferences(projectPath);

  progress.updated_at = Date.now();
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));

  // Build report
  const doneTasks = results.filter((r) => r.done);
  const pendingTasks = results.filter((r) => !r.done);
  const nextTask = pendingTasks[0] ?? null;

  const doneList =
    doneTasks.length > 0
      ? doneTasks.map((r) => `- [x] [${r.id}] ${r.title} _(${r.evidence})_`).join("\n")
      : "None completed yet.";

  const pendingList =
    pendingTasks.length > 0
      ? pendingTasks
          .slice(0, 10)
          .map((r) => `- [ ] [${r.id}] ${r.title}`)
          .join("\n") +
        (pendingTasks.length > 10
          ? `\n... and ${pendingTasks.length - 10} more`
          : "")
      : "All tasks complete.";

  const blockerNote =
    replitRefCount > 0
      ? `\n\n> **Blocker:** ${replitRefCount} remaining REPLIT_ / @replit/ references in source files. Search and replace before deploying.`
      : "";

  const summary =
    `# Migration Progress (${planType})\n\n` +
    `**Progress:** ${doneTasks.length}/${results.length} tasks done\n` +
    (nextTask ? `**Next task:** [${nextTask.id}] ${nextTask.title}\n` : "") +
    `**Replit references remaining:** ${replitRefCount}\n` +
    `\n## Completed\n${doneList}\n\n## Pending\n${pendingList}` +
    blockerNote;

  return textResponse(summary);
}
