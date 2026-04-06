#!/usr/bin/env node
/**
 * Replit-Migrate CLI
 *
 * Command-line interface for migration analysis and planning.
 * Mirrors MCP tool functionality for direct terminal use.
 */

import { Command } from "commander";
import { scanReplitProject } from "../analyzers/replit-scanner.js";
import { mapDependencies } from "../analyzers/dependency-mapper.js";
import { mapApis } from "../analyzers/api-mapper.js";
import { generateWebPlan, formatWebPlanMarkdown } from "../generators/web-migration.js";
import { generateNativePlan, formatNativePlanMarkdown } from "../generators/native-migration.js";
import * as fs from "fs";
import * as path from "path";

const program = new Command();

program
  .name("replit-migrate")
  .description("Migrate Replit apps to web (Vercel) or native (iOS/macOS)")
  .version("0.1.0");

function getMigrateDir(projectPath: string): string {
  const dir = path.join(projectPath, ".replit-migrate");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// --- scan ---

program
  .command("scan")
  .description("Analyze a Replit project for migration readiness")
  .argument("[path]", "Project path", process.cwd())
  .option("--deep", "Include deep API route analysis")
  .option("--json", "Output raw JSON")
  .action(async (projectPath: string, opts: { deep?: boolean; json?: boolean }) => {
    const resolved = path.resolve(projectPath);
    console.error(`Scanning ${resolved}...`);

    const report = await scanReplitProject(resolved, opts.deep ?? false);
    const migrateDir = getMigrateDir(resolved);
    fs.writeFileSync(path.join(migrateDir, "scan-report.json"), JSON.stringify(report, null, 2));

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const replitCount = report.replit_dependencies.replit_env_vars.length;
      const replitPkgs = report.replit_dependencies.replit_modules_used.length;
      let lockIn = 0;
      if (report.replit_dependencies.replit_auth_used) lockIn += 2;
      if (report.replit_dependencies.replit_db_used) lockIn += 2;
      if (report.replit_dependencies.has_replit_config) lockIn += 1;
      if (report.replit_dependencies.has_replit_nix) lockIn += 1;
      lockIn += Math.min(replitCount, 2);
      lockIn += Math.min(replitPkgs, 2);

      console.log(`\n# Migration Scan: ${report.project_name}\n`);
      console.log(`Stack: ${report.stack.runtime} / ${report.stack.framework ?? "none"} / ${report.stack.frontend_framework ?? "none"} / ${report.stack.language}`);
      console.log(`Auth: ${report.auth.method}${report.auth.replit_specific ? " (⚠️ Replit-specific)" : ""}`);
      console.log(`Database: ${report.database.type} via ${report.database.orm ?? "none"}${report.database.replit_hosted ? " (⚠️ Replit-hosted)" : ""}`);
      console.log(`Routes: ${report.api_routes.length} total`);
      console.log(`Browser APIs: ${report.browser_apis.length} detected`);
      console.log(`Lock-in Score: ${lockIn}/10\n`);
      console.log(`Report saved to .replit-migrate/scan-report.json`);
    }
  });

// --- plan ---

program
  .command("plan")
  .description("Generate a migration plan")
  .argument("<target>", "web or native")
  .argument("[path]", "Project path", process.cwd())
  .option("--platform <platforms...>", "Target platforms for native (ios, macos, watchos)")
  .option("--deploy <target>", "Deploy target for web (vercel, cloudflare, standalone)")
  .option("--keep-api", "Keep remote API for native migration")
  .action(async (target: string, projectPath: string, opts: { platform?: string[]; deploy?: string; keepApi?: boolean }) => {
    const resolved = path.resolve(projectPath);
    const reportPath = path.join(resolved, ".replit-migrate", "scan-report.json");

    if (!fs.existsSync(reportPath)) {
      console.error("No scan report found. Run `replit-migrate scan` first.");
      process.exit(1);
    }

    const scan = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    const migrateDir = getMigrateDir(resolved);

    if (target === "web") {
      const plan = generateWebPlan(scan, opts.deploy, undefined);
      fs.writeFileSync(path.join(migrateDir, "web-plan.json"), JSON.stringify(plan, null, 2));
      const md = formatWebPlanMarkdown(plan, scan);
      fs.writeFileSync(path.join(migrateDir, "WEB_MIGRATION_PLAN.md"), md);
      console.log(md);
    } else if (target === "native") {
      const plan = generateNativePlan(scan, opts.platform, opts.keepApi);
      fs.writeFileSync(path.join(migrateDir, "native-plan.json"), JSON.stringify(plan, null, 2));
      const md = formatNativePlanMarkdown(plan, scan);
      fs.writeFileSync(path.join(migrateDir, "NATIVE_MIGRATION_PLAN.md"), md);
      console.log(md);
    } else {
      console.error(`Unknown target: ${target}. Use "web" or "native".`);
      process.exit(1);
    }
  });

// --- progress ---

program
  .command("progress")
  .description("Check migration progress")
  .argument("[path]", "Project path", process.cwd())
  .action(async (projectPath: string) => {
    const resolved = path.resolve(projectPath);
    const progressPath = path.join(resolved, ".replit-migrate", "progress.json");

    if (!fs.existsSync(progressPath)) {
      console.log("No migration in progress. Run `replit-migrate plan` first.");
      return;
    }

    const progress = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
    const done = progress.tasks.filter((t: { done: boolean }) => t.done).length;
    const total = progress.tasks.length;
    console.log(`\nMigration Progress: ${done}/${total} tasks complete`);
    console.log(`Type: ${progress.plan_type}`);
    console.log(`Started: ${new Date(progress.started_at).toLocaleDateString()}`);

    const next = progress.tasks.find((t: { done: boolean }) => !t.done);
    if (next) {
      console.log(`\nNext task: ${next.id}`);
    } else {
      console.log(`\n✅ All tasks complete!`);
    }
  });

program.parse();
