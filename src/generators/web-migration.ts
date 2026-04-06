/**
 * Web Migration Plan Generator
 *
 * Generates a structured WebMigrationPlan from a ScanReport.
 * Lessons encoded here are derived from real ProductPilot migration failures.
 */

import type { ScanReport, WebMigrationPlan, MigrationStep } from "../types.js";

// ---------------------------------------------------------------------------
// Hardcoded lessons — do not water these down
// ---------------------------------------------------------------------------

const LESSONS = {
  AUTH_SPIKE:
    "Spike auth first. Map ALL differences between old and new auth before writing any code. ProductPilot burned 6+ fix commits by coding before understanding Replit OIDC → Neon Auth differences.",
  BUNDLER_UPFRONT:
    "Generate bundler config as the first code change, not an afterthought. ProductPilot burned 4+ fix commits on esbuild trial-and-error.",
  ATOMIC_WIRING:
    "Wire ALL auth/session call sites atomically in one pass. Do not incrementally replace bearer tokens. ProductPilot's partial Bearer token wiring is still uncommitted.",
  ENV_MAPPING:
    "Map ALL environment variables before deploying. Missing env vars cause silent failures in production.",
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type Target = "vercel" | "cloudflare" | "standalone";
type Risk = "high" | "medium" | "low";

function resolveTarget(raw: string | undefined): Target {
  if (!raw) return "standalone";
  const t = raw.toLowerCase();
  if (t === "vercel") return "vercel";
  if (t === "cloudflare") return "cloudflare";
  return "standalone";
}

function resolveAuthStrategy(target: Target, override?: string): string {
  if (override) return override;
  switch (target) {
    case "vercel":
      return "clerk";
    case "cloudflare":
      return "auth-js";
    default:
      return "auth-js";
  }
}

function makeStep(
  id: string,
  title: string,
  description: string,
  risk: Risk,
  category: MigrationStep["category"],
  filesAffected: string[],
  dependsOn: string[],
  lessonRef?: string
): MigrationStep {
  return {
    id,
    title,
    description,
    risk,
    files_affected: filesAffected,
    depends_on: dependsOn,
    category,
    lesson_reference: lessonRef,
    done: false,
  };
}

// ---------------------------------------------------------------------------
// Auth migration
// ---------------------------------------------------------------------------

function buildAuthMigration(
  scan: ScanReport,
  target: Target,
  authStrategy: string
): WebMigrationPlan["auth_migration"] {
  const { method, files, replit_specific } = scan.auth;

  let risk: Risk;
  let steps: MigrationStep[];

  switch (method) {
    case "replit-oidc": {
      risk = "high";
      steps = [
        makeStep(
          "web-auth-1",
          "Spike: read new auth docs fully",
          `Read the complete documentation for ${authStrategy} before writing any code. Map every difference between Replit OIDC and ${authStrategy}: session shape, token claims, callback URLs, middleware API, and protected route pattern.`,
          "high",
          "auth",
          [],
          [],
          LESSONS.AUTH_SPIKE
        ),
        makeStep(
          "web-auth-2",
          `Install ${authStrategy} package`,
          `Install and configure the ${authStrategy} package. Set up required environment variables (client ID, secret, callback URL).`,
          "high",
          "auth",
          [],
          ["web-auth-1"],
          LESSONS.AUTH_SPIKE
        ),
        makeStep(
          "web-auth-3",
          "Create auth middleware",
          `Implement auth middleware using ${authStrategy}. Define session shape, protected route handler, and public route bypass logic. Do not wire call sites yet.`,
          "high",
          "auth",
          [],
          ["web-auth-2"],
          LESSONS.ATOMIC_WIRING
        ),
        makeStep(
          "web-auth-4",
          "Locate ALL files that check auth",
          `Audit every file that reads session, checks authentication, or uses identity tokens. Files already identified by scanner: ${files.length > 0 ? files.join(", ") : "none detected — manual search required"}. Add any missed files to this list before proceeding.`,
          "high",
          "auth",
          files,
          ["web-auth-3"],
          LESSONS.ATOMIC_WIRING
        ),
        makeStep(
          "web-auth-5",
          "Replace ALL auth checks atomically",
          `Replace every auth check in every identified file in a single pass. Do not leave any file partially migrated. Replace session reads, identity checks, and bearer token wiring all at once.`,
          "high",
          "auth",
          files,
          ["web-auth-4"],
          LESSONS.ATOMIC_WIRING
        ),
        makeStep(
          "web-auth-6",
          "Test login flow end-to-end",
          "Verify: login → redirect → session present → protected route accessible → logout → session cleared. Test both success path and failure path (invalid token, expired session).",
          "high",
          "auth",
          [],
          ["web-auth-5"]
        ),
      ];
      break;
    }

    case "magic-link": {
      risk = "medium";
      steps = [
        makeStep(
          "web-auth-1",
          "Choose email provider",
          "Select an email provider for magic link delivery. Resend is recommended (simple API, good deliverability). Configure SMTP or API key.",
          "medium",
          "auth",
          [],
          []
        ),
        makeStep(
          "web-auth-2",
          "Replace magic link generation",
          "Implement magic link token generation and email dispatch using the chosen provider. Ensure tokens are time-limited and single-use.",
          "medium",
          "auth",
          files,
          ["web-auth-1"]
        ),
        makeStep(
          "web-auth-3",
          "Update token verification",
          "Replace Replit-specific token verification with provider-agnostic logic. Update callback route to consume and validate tokens.",
          "medium",
          "auth",
          files,
          ["web-auth-2"]
        ),
      ];
      break;
    }

    case "session": {
      risk = replit_specific ? "medium" : "low";
      steps = [
        makeStep(
          "web-auth-1",
          "Verify session store works outside Replit",
          "Confirm the session store (e.g., connect-pg-simple, redis) does not rely on Replit-specific infrastructure. If using in-memory store, replace with a persistent store.",
          risk,
          "auth",
          files,
          []
        ),
        makeStep(
          "web-auth-2",
          "Update cookie config for new domain",
          "Update cookie domain, SameSite, and Secure flags for the new deployment target. Replit's proxy may have set specific cookie requirements that differ from production.",
          risk,
          "auth",
          files,
          ["web-auth-1"]
        ),
      ];
      break;
    }

    case "jwt":
    case "none":
    default: {
      risk = "low";
      steps = [
        makeStep(
          "web-auth-1",
          "Verify auth is not Replit-dependent",
          "Confirm JWT signing keys and auth config do not reference Replit environment variables. Update any Replit-specific env var references.",
          "low",
          "auth",
          files,
          []
        ),
      ];
      break;
    }
  }

  return {
    from: method,
    to: authStrategy,
    risk,
    steps,
    affected_files: files,
    lesson: LESSONS.AUTH_SPIKE,
  };
}

// ---------------------------------------------------------------------------
// Database migration
// ---------------------------------------------------------------------------

function resolveDatabaseTarget(
  scan: ScanReport,
  target: Target
): { to: string; risk: Risk } {
  if (!scan.database.replit_hosted) {
    return { to: scan.database.type, risk: "low" };
  }
  switch (target) {
    case "vercel":
      return { to: "neon-serverless", risk: "medium" };
    case "cloudflare":
      return { to: "d1-or-turso", risk: "medium" };
    default:
      return { to: "postgres-direct", risk: "medium" };
  }
}

function buildDatabaseMigration(
  scan: ScanReport,
  target: Target
): WebMigrationPlan["database_migration"] {
  const { to, risk } = resolveDatabaseTarget(scan, target);
  const fromLabel = scan.database.replit_hosted
    ? `replit-hosted-${scan.database.type}`
    : scan.database.type;

  const connectionChanges: Array<{ old_var: string; new_var: string }> = [];
  if (scan.database.connection_env_var) {
    connectionChanges.push({
      old_var: scan.database.connection_env_var,
      new_var: "DATABASE_URL",
    });
  }

  const steps: MigrationStep[] = [
    makeStep(
      "web-db-1",
      `Set up ${to} database`,
      `Provision a new ${to} database instance. Obtain connection string and store as DATABASE_URL.`,
      risk,
      "database",
      [],
      []
    ),
    makeStep(
      "web-db-2",
      "Update connection config",
      `Update database connection config to use DATABASE_URL. Remove any Replit-specific connection logic. ${scan.database.orm ? `ORM in use: ${scan.database.orm} — update dialect/adapter if required.` : "No ORM detected — update raw connection string."}`,
      risk,
      "database",
      scan.database.schema_files,
      ["web-db-1"]
    ),
    makeStep(
      "web-db-3",
      "Run migrations",
      `Run schema migrations against the new database. Schema files: ${scan.database.schema_files.length > 0 ? scan.database.schema_files.join(", ") : "none detected — manual schema review required"}.`,
      risk,
      "database",
      scan.database.schema_files,
      ["web-db-2"]
    ),
    makeStep(
      "web-db-4",
      "Verify data access",
      "Run application queries against the new database. Verify reads, writes, and any ORM-generated queries return expected shapes.",
      risk,
      "database",
      [],
      ["web-db-3"]
    ),
  ];

  return {
    from: fromLabel,
    to,
    risk,
    steps,
    connection_string_changes: connectionChanges,
  };
}

// ---------------------------------------------------------------------------
// Bundling
// ---------------------------------------------------------------------------

function buildBundling(
  scan: ScanReport,
  target: Target
): WebMigrationPlan["bundling"] {
  switch (target) {
    case "vercel": {
      const configs = [
        {
          file: "vercel.json",
          purpose:
            "Vercel deployment config: routes, function regions, build output directory",
        },
        {
          file: "esbuild.config.js",
          purpose:
            "Bundle API functions for Vercel serverless: entry points, external packages, target node version",
        },
      ];
      if (scan.stack.framework) {
        configs.push({
          file: `${scan.stack.framework}.config.js`,
          purpose: `Framework-specific build config for ${scan.stack.framework}`,
        });
      }
      return {
        strategy: "vercel-serverless",
        config_to_generate: configs,
        lesson: LESSONS.BUNDLER_UPFRONT,
      };
    }

    case "cloudflare": {
      return {
        strategy: "cloudflare-workers",
        config_to_generate: [
          {
            file: "wrangler.toml",
            purpose:
              "Cloudflare Workers config: account ID, routes, KV namespaces, D1 bindings",
          },
          {
            file: "esbuild.config.js",
            purpose:
              "Bundle for Cloudflare Workers edge runtime: target esnext, no Node built-ins",
          },
        ],
        lesson: LESSONS.BUNDLER_UPFRONT,
      };
    }

    default: {
      return {
        strategy: "standalone-node",
        config_to_generate: [
          {
            file: "build.sh",
            purpose:
              "Build script that compiles TypeScript and runs without Replit toolchain",
          },
          {
            file: "Dockerfile",
            purpose: "Container definition for portable standalone deployment",
          },
        ],
        lesson: LESSONS.BUNDLER_UPFRONT,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Env var mapping
// ---------------------------------------------------------------------------

const REPLIT_ENV_REPLACEMENTS: Record<
  string,
  { replacement: string; action: "replace" | "remove" }
> = {
  REPLIT_DB_URL: { replacement: "DATABASE_URL", action: "replace" },
  REPLIT_IDENTITY_KEY: { replacement: "", action: "remove" },
  REPL_ID: { replacement: "", action: "remove" },
  REPL_SLUG: { replacement: "", action: "remove" },
  REPL_OWNER: { replacement: "", action: "remove" },
};

function buildEnvVarMapping(
  scan: ScanReport,
  target: Target
): WebMigrationPlan["env_var_mapping"] {
  const whereToSet =
    target === "vercel"
      ? "Vercel dashboard → Settings → Environment Variables"
      : target === "cloudflare"
        ? "wrangler.toml [vars] or Cloudflare dashboard → Workers → Settings → Variables"
        : ".env file (never commit) + hosting platform env config";

  const mapping: WebMigrationPlan["env_var_mapping"] = [];

  for (const envVar of scan.env_vars) {
    if (!envVar.replit_specific) continue;

    const known = REPLIT_ENV_REPLACEMENTS[envVar.name];
    if (known) {
      if (known.action === "remove") {
        mapping.push({
          replit_var: envVar.name,
          replacement_var: "— remove —",
          where_to_set: "Delete from codebase. Replaced by new auth/platform.",
        });
      } else {
        mapping.push({
          replit_var: envVar.name,
          replacement_var: known.replacement,
          where_to_set: whereToSet,
        });
      }
    } else {
      // Unknown Replit-specific var — flag for manual review
      const genericName = envVar.name
        .replace(/^REPLIT?_/, "")
        .replace(/^REPL_/, "");
      mapping.push({
        replit_var: envVar.name,
        replacement_var: genericName || envVar.name,
        where_to_set: `${whereToSet} (review required — auto-mapped name may not be correct)`,
      });
    }
  }

  // Also pick up replit_env_vars from replit_dependencies that may not be in env_vars
  for (const varName of scan.replit_dependencies.replit_env_vars) {
    const alreadyMapped = mapping.some((m) => m.replit_var === varName);
    if (alreadyMapped) continue;

    const known = REPLIT_ENV_REPLACEMENTS[varName];
    if (known && known.action === "remove") {
      mapping.push({
        replit_var: varName,
        replacement_var: "— remove —",
        where_to_set: "Delete from codebase.",
      });
    } else if (known) {
      mapping.push({
        replit_var: varName,
        replacement_var: known.replacement,
        where_to_set: whereToSet,
      });
    }
  }

  return mapping;
}

// ---------------------------------------------------------------------------
// API migration
// ---------------------------------------------------------------------------

function buildApiMigration(
  scan: ScanReport,
  target: Target
): WebMigrationPlan["api_migration"] {
  const isServerless = target === "vercel" || target === "cloudflare";
  const considerations: string[] = [];
  const routeChanges: Array<{ from: string; to: string; reason: string }> = [];

  if (isServerless) {
    // Detect long-running routes (heuristic: no direct scan data, flag all routes with auth as candidates)
    const wsRoutes = scan.api_routes.filter(
      (r) =>
        r.path.includes("/ws") ||
        r.path.includes("/socket") ||
        r.path.includes("/stream") ||
        r.path.includes("/sse") ||
        r.path.includes("/events")
    );

    for (const route of wsRoutes) {
      routeChanges.push({
        from: route.path,
        to: `${route.path} (needs redesign)`,
        reason:
          "WebSocket or SSE endpoints do not work in serverless functions. Migrate to polling, or use Pusher/Ably/Cloudflare Durable Objects.",
      });
      considerations.push(
        `Route ${route.method} ${route.path} — WebSocket/SSE detected. Serverless cannot hold open connections.`
      );
    }

    const uploadRoutes = scan.api_routes.filter(
      (r) =>
        r.path.includes("/upload") ||
        r.path.includes("/file") ||
        r.path.includes("/import")
    );

    for (const route of uploadRoutes) {
      considerations.push(
        `Route ${route.method} ${route.path} — file upload detected. Serverless functions have payload size limits (~4.5MB on Vercel). Large uploads should go directly to S3/R2 via presigned URLs.`
      );
    }

    if (scan.api_routes.length > 20) {
      considerations.push(
        `${scan.api_routes.length} API routes detected. Each becomes a separate serverless function on ${target}. Review cold-start impact on user-facing latency.`
      );
    }

    if (target === "cloudflare") {
      considerations.push(
        "Cloudflare Workers run on V8 isolates, not Node.js. Node built-ins (fs, path, crypto) are not available. Use Web APIs equivalents or wrangler compatibility flags."
      );
    }
  }

  return {
    route_changes: routeChanges,
    serverless_considerations: considerations,
    lesson:
      isServerless && routeChanges.length > 0
        ? "Serverless targets cannot sustain long-lived connections. WebSocket/SSE routes must be redesigned before deployment."
        : "API routes are compatible with the target. Verify timeout limits match longest-running operations.",
  };
}

// ---------------------------------------------------------------------------
// Complexity estimate
// ---------------------------------------------------------------------------

function estimateComplexity(scan: ScanReport): "simple" | "moderate" | "complex" {
  const replitDepCount = [
    scan.replit_dependencies.has_replit_config,
    scan.replit_dependencies.has_replit_nix,
    scan.replit_dependencies.replit_db_used,
    scan.replit_dependencies.replit_auth_used,
    scan.replit_dependencies.replit_modules_used.length > 0,
  ].filter(Boolean).length;

  const authNeedsMigration =
    scan.auth.method === "replit-oidc" || scan.auth.method === "magic-link";
  const dbNeedsMigration = scan.database.replit_hosted;
  const routeCount = scan.api_routes.length;

  if (authNeedsMigration && dbNeedsMigration && routeCount > 20) {
    return "complex";
  }

  if (
    authNeedsMigration ||
    routeCount > 10 ||
    dbNeedsMigration
  ) {
    return "moderate";
  }

  if (replitDepCount <= 3 && routeCount <= 10) {
    return "simple";
  }

  return "moderate";
}

// ---------------------------------------------------------------------------
// Task ordering — critical path
// ---------------------------------------------------------------------------

function buildOrderedTaskList(
  authMigration: WebMigrationPlan["auth_migration"],
  bundling: WebMigrationPlan["bundling"],
  dbMigration: WebMigrationPlan["database_migration"],
  envMapping: WebMigrationPlan["env_var_mapping"],
  apiMigration: WebMigrationPlan["api_migration"],
  target: Target
): MigrationStep[] {
  const tasks: MigrationStep[] = [];

  // 1. Auth (highest risk, must go first)
  tasks.push(...authMigration.steps);

  // 2. Bundler config (must be done before any code changes compile)
  const lastAuthId =
    authMigration.steps.length > 0
      ? authMigration.steps[authMigration.steps.length - 1].id
      : undefined;

  tasks.push(
    makeStep(
      "web-bundling-1",
      `Generate ${target} bundler config`,
      `Create: ${bundling.config_to_generate.map((c) => c.file).join(", ")}. Verify build succeeds before touching database or env vars.`,
      "medium",
      "bundling",
      bundling.config_to_generate.map((c) => c.file),
      lastAuthId ? [lastAuthId] : [],
      LESSONS.BUNDLER_UPFRONT
    )
  );

  // 3. Database migration
  const dbStepsWithDep = dbMigration.steps.map((s, i) => {
    if (i === 0) {
      return { ...s, depends_on: ["web-bundling-1", ...s.depends_on] };
    }
    return s;
  });
  tasks.push(...dbStepsWithDep);

  // 4. Env var replacement
  const lastDbId =
    dbStepsWithDep.length > 0
      ? dbStepsWithDep[dbStepsWithDep.length - 1].id
      : "web-bundling-1";

  tasks.push(
    makeStep(
      "web-env-1",
      "Replace all Replit env vars",
      `Map and replace ${envMapping.length} Replit-specific environment variable(s). Remove internal Replit vars. Set replacements in target platform. Verify no references remain in code.`,
      "low",
      "env",
      [],
      [lastDbId],
      LESSONS.ENV_MAPPING
    )
  );

  // 5. API route adjustments (only if there are changes)
  if (apiMigration.route_changes.length > 0) {
    tasks.push(
      makeStep(
        "web-api-1",
        "Redesign incompatible API routes",
        `${apiMigration.route_changes.length} route(s) need redesign for serverless target: ${apiMigration.route_changes.map((r) => r.from).join(", ")}. See serverless_considerations for details.`,
        "medium",
        "api",
        [],
        ["web-env-1"]
      )
    );
  }

  // 6. Deploy config
  const priorStep =
    apiMigration.route_changes.length > 0 ? "web-api-1" : "web-env-1";

  tasks.push(
    makeStep(
      "web-deploy-1",
      "Configure deployment",
      `Set up deployment pipeline for ${target}. Add required secrets to platform. Verify build command and output directory.`,
      "low",
      "deployment",
      [],
      [priorStep]
    )
  );

  // 7. End-to-end testing
  tasks.push(
    makeStep(
      "web-testing-1",
      "End-to-end verification",
      "Test full user journey: auth, data access, key API routes. Verify no Replit environment assumptions remain. Check error handling on missing env vars.",
      "low",
      "testing",
      [],
      ["web-deploy-1"]
    )
  );

  return tasks;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function generateWebPlan(
  scan: ScanReport,
  targetRaw?: string,
  authStrategyOverride?: string
): WebMigrationPlan {
  const target = resolveTarget(targetRaw);
  const authStrategy = resolveAuthStrategy(target, authStrategyOverride);

  const authMigration = buildAuthMigration(scan, target, authStrategy);
  const dbMigration = buildDatabaseMigration(scan, target);
  const bundling = buildBundling(scan, target);
  const envMapping = buildEnvVarMapping(scan, target);
  const apiMigration = buildApiMigration(scan, target);
  const complexity = estimateComplexity(scan);

  const tasks = buildOrderedTaskList(
    authMigration,
    bundling,
    dbMigration,
    envMapping,
    apiMigration,
    target
  );

  const criticalPath = tasks
    .filter((t) => t.risk === "high" || t.category === "auth")
    .map((t) => t.id);

  return {
    target,
    generated_at: Date.now(),
    auth_migration: authMigration,
    database_migration: dbMigration,
    bundling,
    env_var_mapping: envMapping,
    api_migration: apiMigration,
    tasks,
    estimated_complexity: complexity,
    critical_path: criticalPath,
  };
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function riskBadge(risk: Risk): string {
  switch (risk) {
    case "high":
      return "[HIGH RISK]";
    case "medium":
      return "[MEDIUM RISK]";
    case "low":
      return "[LOW RISK]";
  }
}

function taskLine(task: MigrationStep, index: number): string {
  const dep =
    task.depends_on.length > 0
      ? `  _(depends on: ${task.depends_on.join(", ")})_`
      : "";
  const lesson = task.lesson_reference
    ? `\n  > Lesson: ${task.lesson_reference}`
    : "";
  const files =
    task.files_affected.length > 0
      ? `\n  Files: ${task.files_affected.join(", ")}`
      : "";
  return `${index + 1}. **[${task.id}]** ${riskBadge(task.risk)} ${task.title}\n   ${task.description}${dep}${files}${lesson}`;
}

export function formatWebPlanMarkdown(
  plan: WebMigrationPlan,
  scan: ScanReport
): string {
  const date = new Date(plan.generated_at).toISOString().split("T")[0];
  const lines: string[] = [];

  // Header
  lines.push(
    `# Web Migration Plan: ${scan.project_name} → ${plan.target}`,
    "",
    `Generated: ${date}`,
    `Estimated Complexity: **${plan.estimated_complexity.toUpperCase()}**`,
    ""
  );

  // Lessons applied
  lines.push("## Lessons Applied", "");
  const lessonsApplied = new Set<string>();
  for (const task of plan.tasks) {
    if (task.lesson_reference) lessonsApplied.add(task.lesson_reference);
  }
  if (plan.auth_migration.lesson) lessonsApplied.add(plan.auth_migration.lesson);
  if (plan.bundling.lesson) lessonsApplied.add(plan.bundling.lesson);
  if (lessonsApplied.size === 0) {
    lines.push("_No high-risk patterns detected. Standard migration applies._");
  } else {
    for (const lesson of lessonsApplied) {
      lines.push(`- ${lesson}`);
    }
  }
  lines.push("");

  // Auth migration
  lines.push(
    `## Auth Migration ${riskBadge(plan.auth_migration.risk)}`,
    "",
    `From: \`${plan.auth_migration.from}\` → To: \`${plan.auth_migration.to}\``,
    ""
  );
  if (plan.auth_migration.affected_files.length > 0) {
    lines.push(
      `Affected files: ${plan.auth_migration.affected_files.join(", ")}`,
      ""
    );
  }
  lines.push(
    `> **Lesson:** ${plan.auth_migration.lesson}`,
    "",
    "### Auth Tasks",
    ""
  );
  plan.auth_migration.steps.forEach((step, i) => {
    lines.push(taskLine(step, i), "");
  });

  // Database migration
  lines.push(
    `## Database Migration ${riskBadge(plan.database_migration.risk)}`,
    "",
    `From: \`${plan.database_migration.from}\` → To: \`${plan.database_migration.to}\``,
    ""
  );
  if (plan.database_migration.connection_string_changes.length > 0) {
    lines.push("Connection string changes:");
    for (const c of plan.database_migration.connection_string_changes) {
      lines.push(`- \`${c.old_var}\` → \`${c.new_var}\``);
    }
    lines.push("");
  }
  lines.push("### Database Tasks", "");
  plan.database_migration.steps.forEach((step, i) => {
    lines.push(taskLine(step, i), "");
  });

  // Bundling
  lines.push(
    "## Bundling Strategy",
    "",
    `Strategy: **${plan.bundling.strategy}**`,
    "",
    `> **Lesson:** ${plan.bundling.lesson}`,
    "",
    "### Config Files to Generate",
    ""
  );
  for (const cfg of plan.bundling.config_to_generate) {
    lines.push(`- \`${cfg.file}\` — ${cfg.purpose}`);
  }
  lines.push("");

  // Env vars
  lines.push(
    "## Environment Variables",
    ""
  );
  if (plan.env_var_mapping.length === 0) {
    lines.push("_No Replit-specific environment variables detected._", "");
  } else {
    lines.push(
      `> **Lesson:** ${LESSONS.ENV_MAPPING}`,
      "",
      "| Current | Replacement | Set In |",
      "|---------|------------|--------|"
    );
    for (const m of plan.env_var_mapping) {
      lines.push(`| \`${m.replit_var}\` | \`${m.replacement_var}\` | ${m.where_to_set} |`);
    }
    lines.push("");
  }

  // API route changes
  lines.push("## API Route Changes", "");
  if (plan.api_migration.route_changes.length > 0) {
    lines.push("### Incompatible Routes", "");
    for (const r of plan.api_migration.route_changes) {
      lines.push(`- **${r.from}** → ${r.to}`);
      lines.push(`  Reason: ${r.reason}`, "");
    }
  }
  if (plan.api_migration.serverless_considerations.length > 0) {
    lines.push("### Serverless Considerations", "");
    for (const c of plan.api_migration.serverless_considerations) {
      lines.push(`- ${c}`);
    }
    lines.push("");
  }
  if (
    plan.api_migration.route_changes.length === 0 &&
    plan.api_migration.serverless_considerations.length === 0
  ) {
    lines.push("_No API route changes required._", "");
  }
  lines.push(`> ${plan.api_migration.lesson}`, "");

  // Full task list
  lines.push(
    "## Full Task List (ordered by risk)",
    "",
    `Critical path: ${plan.critical_path.length > 0 ? plan.critical_path.join(" → ") : "_none identified_"}`,
    ""
  );
  plan.tasks.forEach((task, i) => {
    lines.push(taskLine(task, i), "");
  });

  return lines.join("\n");
}
