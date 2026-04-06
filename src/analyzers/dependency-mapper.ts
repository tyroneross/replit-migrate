import * as fs from "fs";
import * as path from "path";
import type { ApiRoute } from "../types.js";

export interface DependencyReport {
  total: number;
  replit_specific: Array<{ name: string; version: string; replacement: string }>;
  auth_related: Array<{ name: string; version: string }>;
  database_related: Array<{ name: string; version: string }>;
  ui_related: Array<{ name: string; version: string }>;
  build_related: Array<{ name: string; version: string }>;
  ai_related: Array<{ name: string; version: string }>;
}

const KNOWN_REPLIT_PACKAGES: Record<string, string> = {
  "@replit/database": "Use SwiftData (native) or Neon/Supabase (web)",
  "@replit/object-storage": "Use S3/R2/Supabase Storage",
  "@replit/ai": "Use @anthropic-ai/sdk or openai directly",
  "@replit/identity": "Use Clerk, Auth.js, or Sign in with Apple",
  "@replit/extensions": "Remove — Replit-only feature",
};

const AUTH_PATTERNS = [
  /^passport/,
  /^express-session$/,
  /^jsonwebtoken$/,
  /^jose$/,
  /^@clerk\//,
  /^@auth\//,
  /^better-auth$/,
  /^lucia$/,
];

const DATABASE_PATTERNS = [
  /^pg$/,
  /^mysql2$/,
  /^better-sqlite3$/,
  /^mongoose$/,
  /^drizzle-orm$/,
  /^@prisma\/client$/,
  /^@neondatabase\//,
  /^@supabase\//,
];

const UI_PATTERNS = [
  /^react$/,
  /^react-dom$/,
  /^vue$/,
  /^svelte$/,
  /^@radix-ui\//,
  /^framer-motion$/,
  /^tailwindcss$/,
];

const BUILD_PATTERNS = [
  /^vite$/,
  /^esbuild$/,
  /^webpack$/,
  /^typescript$/,
  /^postcss$/,
  /^autoprefixer$/,
];

const AI_PATTERNS = [
  /^openai$/,
  /^@anthropic-ai\/sdk$/,
  /^groq-sdk$/,
  /^@google\/generative-ai$/,
  /^langchain$/,
  /^@langchain\//,
];

function matchesAny(name: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(name));
}

function getReplitReplacement(name: string): string | null {
  if (KNOWN_REPLIT_PACKAGES[name]) {
    return KNOWN_REPLIT_PACKAGES[name];
  }
  if (name.startsWith("@replit/")) {
    return "Remove — Replit-only package";
  }
  return null;
}

export async function mapDependencies(projectPath: string): Promise<DependencyReport> {
  const pkgPath = path.join(projectPath, "package.json");

  let pkgJson: Record<string, unknown>;

  try {
    const raw = fs.readFileSync(pkgPath, "utf-8");
    pkgJson = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.log(`[dependency-mapper] Could not read package.json at ${pkgPath}: ${String(err)}`);
    return {
      total: 0,
      replit_specific: [],
      auth_related: [],
      database_related: [],
      ui_related: [],
      build_related: [],
      ai_related: [],
    };
  }

  const deps = (pkgJson.dependencies ?? {}) as Record<string, string>;
  const devDeps = (pkgJson.devDependencies ?? {}) as Record<string, string>;
  const all = { ...deps, ...devDeps };

  const report: DependencyReport = {
    total: Object.keys(all).length,
    replit_specific: [],
    auth_related: [],
    database_related: [],
    ui_related: [],
    build_related: [],
    ai_related: [],
  };

  for (const [name, version] of Object.entries(all)) {
    const replitReplacement = getReplitReplacement(name);
    if (replitReplacement !== null) {
      report.replit_specific.push({ name, version, replacement: replitReplacement });
      continue;
    }

    if (matchesAny(name, AUTH_PATTERNS)) {
      report.auth_related.push({ name, version });
      continue;
    }

    if (matchesAny(name, DATABASE_PATTERNS)) {
      report.database_related.push({ name, version });
      continue;
    }

    if (matchesAny(name, UI_PATTERNS)) {
      report.ui_related.push({ name, version });
      continue;
    }

    if (matchesAny(name, BUILD_PATTERNS)) {
      report.build_related.push({ name, version });
      continue;
    }

    if (matchesAny(name, AI_PATTERNS)) {
      report.ai_related.push({ name, version });
      continue;
    }
  }

  console.log(
    `[dependency-mapper] Scanned ${report.total} packages: ` +
      `${report.replit_specific.length} Replit-specific, ` +
      `${report.auth_related.length} auth, ` +
      `${report.database_related.length} database, ` +
      `${report.ui_related.length} UI, ` +
      `${report.build_related.length} build, ` +
      `${report.ai_related.length} AI`
  );

  return report;
}
