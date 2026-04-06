import * as fs from "fs";
import * as path from "path";
import type { ApiRoute } from "../types.js";

export interface ApiDetail {
  method: string;
  path: string;
  file: string;
  line: number;
  params: {
    path_params: string[];
    query_params: string[];
    body_fields: string[];
  };
  response_pattern: string;
  auth_required: boolean;
  replit_specific: boolean;
  middleware: string[];
  // For native target:
  native_equivalent?: string;
  becomes?: "local" | "remote" | "removed";
}

export interface ApiMapReport {
  routes: ApiDetail[];
  summary: {
    total: number;
    auth_required: number;
    replit_specific: number;
    by_method: Record<string, number>;
    local_capable: number;
    remote_required: number;
  };
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

function extractPathParams(routePath: string): string[] {
  const matches = routePath.match(/:(\w+)/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1));
}

function extractQueryParams(body: string): string[] {
  const params = new Set<string>();

  // req.query.foo
  const dotRefs = body.matchAll(/req\.query\.(\w+)/g);
  for (const m of dotRefs) params.add(m[1]);

  // req.query['foo'] or req.query["foo"]
  const bracketRefs = body.matchAll(/req\.query\[['"](\w+)['"]\]/g);
  for (const m of bracketRefs) params.add(m[1]);

  return Array.from(params);
}

function extractBodyFields(body: string): string[] {
  const fields = new Set<string>();

  // req.body.foo
  const dotRefs = body.matchAll(/req\.body\.(\w+)/g);
  for (const m of dotRefs) fields.add(m[1]);

  // req.body['foo']
  const bracketRefs = body.matchAll(/req\.body\[['"](\w+)['"]\]/g);
  for (const m of bracketRefs) fields.add(m[1]);

  // const { a, b } = req.body  (single line destructure)
  const destructRefs = body.matchAll(/const\s*\{([^}]+)\}\s*=\s*req\.body/g);
  for (const m of destructRefs) {
    const parts = m[1].split(",").map((s) => s.trim().replace(/:\s*\w+/, "").trim());
    for (const p of parts) {
      if (p && /^\w+$/.test(p)) fields.add(p);
    }
  }

  return Array.from(fields);
}

function detectResponsePattern(body: string): string {
  if (/res\.json\s*\(/.test(body)) return "json";
  if (/res\.redirect\s*\(/.test(body)) return "redirect";
  if (/res\.write\s*\(|pipe\s*\(|stream/i.test(body)) return "stream";
  if (/res\.send\s*\(|res\.render\s*\(/.test(body)) return "html";
  return "unknown";
}

function isReplitSpecific(body: string): boolean {
  return (
    /@replit\//.test(body) ||
    /REPL_ID|REPLIT_DB_URL|X-Replit-User/.test(body)
  );
}

// ---------------------------------------------------------------------------
// Handler body extraction via brace counting
// ---------------------------------------------------------------------------

function extractHandlerBody(lines: string[], startLine: number): string {
  // startLine is 1-based (from ApiRoute.line).
  // Walk forward from that line to find the opening brace of the handler,
  // then count braces until balanced.
  const idx = startLine - 1; // convert to 0-based
  let braceDepth = 0;
  let started = false;
  const bodyLines: string[] = [];

  for (let i = idx; i < lines.length; i++) {
    const line = lines[i];

    for (const ch of line) {
      if (ch === "{") {
        braceDepth++;
        started = true;
      } else if (ch === "}") {
        braceDepth--;
      }
    }

    bodyLines.push(line);

    if (started && braceDepth === 0) break;

    // Safety: don't read more than 300 lines for a single handler
    if (bodyLines.length > 300) break;
  }

  return bodyLines.join("\n");
}

// ---------------------------------------------------------------------------
// Middleware extraction
// ---------------------------------------------------------------------------

function extractMiddleware(routeLine: string): string[] {
  // Match: app.get("/path", mw1, mw2, handler) or router.post(...)
  // The last argument is the handler; everything in between are middleware.
  const argsMatch = routeLine.match(/\.\w+\s*\([^,]+,(.+)\)/);
  if (!argsMatch) return [];

  const argsPart = argsMatch[1];
  // Split by comma at top level (ignore commas inside parens/brackets)
  const args: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of argsPart) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());

  // Last arg is the handler; everything else that looks like a bare identifier is middleware
  const middlewareCandidates = args.slice(0, -1);
  return middlewareCandidates
    .map((a) => a.trim())
    .filter((a) => /^\w+$/.test(a));
}

// ---------------------------------------------------------------------------
// Native target classification
// ---------------------------------------------------------------------------

function classifyForNative(
  detail: Omit<ApiDetail, "native_equivalent" | "becomes">
): { native_equivalent: string; becomes: "local" | "remote" | "removed" } {
  const method = detail.method.toUpperCase();
  const isAuthRoute =
    /\/(login|logout|signup|register|auth|session|token|oauth)/i.test(detail.path);
  const hasFileOp =
    /upload|download|file|attachment|media|image|video|audio/i.test(detail.path);
  const isExternalProxy = false; // determined by body scan below (handled by caller)

  if (isAuthRoute) {
    return {
      native_equivalent: "Remove auth route — use Sign in with Apple or local session",
      becomes: "removed",
    };
  }

  if (hasFileOp) {
    return {
      native_equivalent: "URLSession multipart upload or file download",
      becomes: "remote",
    };
  }

  if (["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    // Simple CRUD on user-owned resource → SwiftData
    return {
      native_equivalent: "SwiftData query",
      becomes: "local",
    };
  }

  return {
    native_equivalent: "URLSession call",
    becomes: "remote",
  };
}

function refineNativeClassification(
  detail: Omit<ApiDetail, "native_equivalent" | "becomes">,
  handlerBody: string
): { native_equivalent: string; becomes: "local" | "remote" | "removed" } {
  const hasExternalFetch = /\bfetch\s*\(|axios\.|got\s*\(|request\s*\(/.test(handlerBody);
  const hasComplexAggregation = /aggregate|GROUP BY|HAVING|window\s*\(/i.test(handlerBody);

  if (hasExternalFetch) {
    return {
      native_equivalent: "URLSession call to external service",
      becomes: "remote",
    };
  }

  if (hasComplexAggregation) {
    return {
      native_equivalent: "Remote aggregation endpoint",
      becomes: "remote",
    };
  }

  return classifyForNative(detail);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function mapApis(
  projectPath: string,
  routes: ApiRoute[],
  target: "web" | "native"
): Promise<ApiMapReport> {
  const detailedRoutes: ApiDetail[] = [];

  for (const route of routes) {
    const filePath = path.isAbsolute(route.file)
      ? route.file
      : path.join(projectPath, route.file);

    let lines: string[] = [];
    let routeLine = "";
    let handlerBody = "";

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      lines = content.split("\n");
      routeLine = lines[route.line - 1] ?? "";
      handlerBody = extractHandlerBody(lines, route.line);
    } catch (err) {
      console.log(`[api-mapper] Could not read file ${filePath}: ${String(err)}`);
    }

    const pathParams = extractPathParams(route.path);
    const queryParams = extractQueryParams(handlerBody);
    const bodyFields = extractBodyFields(handlerBody);
    const responsePattern = detectResponsePattern(handlerBody);
    const replitSpecific = route.replit_specific_code || isReplitSpecific(handlerBody);
    const middleware = extractMiddleware(routeLine);

    const base: Omit<ApiDetail, "native_equivalent" | "becomes"> = {
      method: route.method,
      path: route.path,
      file: route.file,
      line: route.line,
      params: {
        path_params: pathParams,
        query_params: queryParams,
        body_fields: bodyFields,
      },
      response_pattern: responsePattern,
      auth_required: route.auth_required,
      replit_specific: replitSpecific,
      middleware,
    };

    let detail: ApiDetail;

    if (target === "native") {
      const classification = refineNativeClassification(base, handlerBody);
      detail = { ...base, ...classification };
    } else {
      detail = { ...base };
    }

    detailedRoutes.push(detail);
  }

  const by_method: Record<string, number> = {};
  for (const r of detailedRoutes) {
    const m = r.method.toUpperCase();
    by_method[m] = (by_method[m] ?? 0) + 1;
  }

  const local_capable = detailedRoutes.filter((r) => r.becomes === "local").length;
  const remote_required = detailedRoutes.filter((r) => r.becomes === "remote").length;

  const summary = {
    total: detailedRoutes.length,
    auth_required: detailedRoutes.filter((r) => r.auth_required).length,
    replit_specific: detailedRoutes.filter((r) => r.replit_specific).length,
    by_method,
    local_capable,
    remote_required,
  };

  console.log(
    `[api-mapper] Mapped ${summary.total} routes: ` +
      `${summary.auth_required} auth-gated, ` +
      `${summary.replit_specific} Replit-specific` +
      (target === "native"
        ? `, ${local_capable} local-capable, ${remote_required} remote-required`
        : "")
  );

  return { routes: detailedRoutes, summary };
}
