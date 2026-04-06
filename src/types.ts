/**
 * Replit-Migrate Type Definitions
 */

// --- Scan Report ---

export interface ScanReport {
  project_name: string;
  project_path: string;
  scan_timestamp: number;

  stack: {
    runtime: "node" | "python" | "other";
    framework: string | null;
    frontend_framework: string | null;
    bundler: string | null;
    language: "typescript" | "javascript" | "python" | "unknown";
    styling: string[];
  };

  auth: {
    method: "replit-oidc" | "magic-link" | "session" | "jwt" | "none" | "unknown";
    files: string[];
    replit_specific: boolean;
    details: string;
  };

  database: {
    type: "postgres" | "sqlite" | "mysql" | "mongodb" | "in-memory" | "none";
    orm: string | null;
    schema_files: string[];
    connection_env_var: string | null;
    replit_hosted: boolean;
  };

  api_routes: ApiRoute[];

  env_vars: EnvVar[];

  external_services: ExternalService[];

  replit_dependencies: {
    has_replit_config: boolean;
    has_replit_nix: boolean;
    replit_env_vars: string[];
    replit_modules_used: string[];
    replit_db_used: boolean;
    replit_auth_used: boolean;
  };

  frontend: {
    entry_point: string | null;
    pages: FrontendPage[];
    routing_type: "react-router" | "wouter" | "next" | "file-based" | "none" | "unknown";
    components_count: number;
  };

  browser_apis: BrowserApi[];

  file_stats: {
    total_files: number;
    source_files: number;
    by_extension: Record<string, number>;
  };
}

export interface ApiRoute {
  method: string;
  path: string;
  file: string;
  line: number;
  auth_required: boolean;
  replit_specific_code: boolean;
}

export interface EnvVar {
  name: string;
  source: string;
  replit_specific: boolean;
  category: "auth" | "database" | "api-key" | "config" | "replit-internal";
}

export interface ExternalService {
  name: string;
  type: "ai" | "payment" | "email" | "storage" | "analytics" | "other";
  files: string[];
}

export interface FrontendPage {
  name: string;
  file: string;
  route: string;
}

export interface BrowserApi {
  api: string;
  files: string[];
  native_equivalent: string;
  native_framework: string;
  native_import: string;
  risk: "high" | "medium" | "low";
}

// --- Migration Plans ---

export interface MigrationStep {
  id: string;
  title: string;
  description: string;
  risk: "high" | "medium" | "low";
  files_affected: string[];
  depends_on: string[];
  category: "auth" | "database" | "bundling" | "api" | "env" | "deployment" | "testing" | "architecture" | "models" | "views" | "services" | "platform";
  lesson_reference?: string;
  done: boolean;
}

export interface WebMigrationPlan {
  target: "vercel" | "cloudflare" | "standalone";
  generated_at: number;

  auth_migration: {
    from: string;
    to: string;
    risk: "high" | "medium" | "low";
    steps: MigrationStep[];
    affected_files: string[];
    lesson: string;
  };

  database_migration: {
    from: string;
    to: string;
    risk: "high" | "medium" | "low";
    steps: MigrationStep[];
    connection_string_changes: Array<{ old_var: string; new_var: string }>;
  };

  bundling: {
    strategy: string;
    config_to_generate: Array<{ file: string; purpose: string }>;
    lesson: string;
  };

  env_var_mapping: Array<{
    replit_var: string;
    replacement_var: string;
    where_to_set: string;
  }>;

  api_migration: {
    route_changes: Array<{ from: string; to: string; reason: string }>;
    serverless_considerations: string[];
    lesson: string;
  };

  tasks: MigrationStep[];
  estimated_complexity: "simple" | "moderate" | "complex";
  critical_path: string[];
}

export interface NativeMigrationPlan {
  platforms: string[];
  generated_at: number;

  architecture_doc: {
    summary: string;
    layers: string[];
    data_flow: string;
    lesson: string;
  };

  data_model_translation: ModelTranslation[];

  api_to_local_mapping: Array<{
    web_route: string;
    becomes: "local" | "remote" | "removed";
    native_equivalent: string;
    reason: string;
  }>;

  browser_to_native_mapping: Array<{
    browser_api: string;
    native_framework: string;
    import_statement: string;
    notes: string;
    risk: "high" | "medium" | "low";
    lesson: string;
  }>;

  ui_screen_mapping: Array<{
    web_page: string;
    web_file: string;
    native_view: string;
    ui_notes: string[];
  }>;

  platform_constraints: PlatformConstraint[];

  auth_strategy: {
    method: "sign-in-with-apple" | "none" | "keep-api-auth";
    steps: MigrationStep[];
  };

  ibr_testing: {
    when_to_start: string;
    initial_checks: string[];
    lesson: string;
  };

  tasks: MigrationStep[];
  estimated_complexity: "simple" | "moderate" | "complex";
}

export interface ModelTranslation {
  web_model: string;
  web_orm: string;
  native_model: string;
  fields: Array<{
    web_field: string;
    web_type: string;
    swift_type: string;
    notes: string;
  }>;
  risk: "high" | "medium" | "low";
  notes: string[];
}

export interface PlatformConstraint {
  platform: string;
  constraint: string;
  category: "touch" | "permissions" | "hig" | "performance" | "privacy";
  applies_to: string[];
  lesson: string;
}

// --- Progress Tracking ---

export interface MigrationProgress {
  plan_type: "web" | "native";
  started_at: number;
  updated_at: number;
  tasks: Array<{
    id: string;
    done: boolean;
    completed_at?: number;
    notes?: string;
  }>;
}

// --- MCP Response Types ---

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface McpResponse {
  content: McpContent[];
  isError?: boolean;
}
