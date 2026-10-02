import { z } from 'zod';

/**
 * Express middleware generator to enforce Zod schema validation on req.body.
 * Returns HTTP 400 Bad Request with field-level errors when validation fails.
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fieldErrors = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join('.') || '_root';
        fieldErrors[path] = issue.message;
      }
      return res.status(400).json({
        error: "Validation failed",
        message: "Invalid or missing required request body fields",
        errors: fieldErrors,
        details: result.error.errors
      });
    }
    req.validatedBody = result.data;
    next();
  };
}

/**
 * Pagination helper to standardize limit and offset handling across list endpoints.
 * Validates limit and offset parameters and returns error details if invalid.
 */
export function parsePagination(req, defaultLimit = 50, maxLimit = 500) {
  let limit = defaultLimit;
  if (req.query && req.query.limit !== undefined) {
    const rawLimit = String(req.query.limit).trim();
    const parsed = parseInt(rawLimit, 10);
    if (isNaN(parsed) || String(parsed) !== rawLimit || parsed <= 0) {
      return {
        valid: false,
        error: "Invalid query parameter",
        message: "Query parameter 'limit' must be a positive integer greater than 0"
      };
    }
    if (parsed > maxLimit) {
      return {
        valid: false,
        error: "Limit exceeded",
        message: `Query parameter 'limit' cannot exceed maximum allowed limit of ${maxLimit}`
      };
    }
    limit = parsed;
  }

  let offset = 0;
  if (req.query && req.query.offset !== undefined) {
    const rawOffset = String(req.query.offset).trim();
    const parsed = parseInt(rawOffset, 10);
    if (isNaN(parsed) || String(parsed) !== rawOffset || parsed < 0) {
      return {
        valid: false,
        error: "Invalid query parameter",
        message: "Query parameter 'offset' must be a non-negative integer (>= 0)"
      };
    }
    offset = parsed;
  }

  return { valid: true, limit, offset };
}

/**
 * Standardized array pagination responding with both RFC/REST headers and envelope/raw payload.
 * If query parameters are invalid or exceed limits, responds with HTTP 400 Bad Request.
 */
export function sendPaginated(req, res, array, defaultLimit = 50, maxLimit = 500) {
  const result = parsePagination(req, defaultLimit, maxLimit);
  if (!result.valid) {
    return res.status(400).json({
      error: result.error,
      message: result.message
    });
  }

  const { limit, offset } = result;
  const total = Array.isArray(array) ? array.length : 0;
  const paginated = Array.isArray(array) ? array.slice(offset, offset + limit) : [];

  res.setHeader('X-Total-Count', total);
  res.setHeader('X-Limit', limit);
  res.setHeader('X-Offset', offset);
  res.setHeader('X-Has-More', String(offset + limit < total));

  if (req.query.envelope === 'true' || req.query.format === 'envelope') {
    return res.json({
      items: paginated,
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + limit < total
      }
    });
  }

  return res.json(paginated);
}

// ---------------- REQUEST BODY VALIDATION SCHEMAS ----------------

export const loginSchema = z.object({
  username: z.string().min(1, "Username or email is required").optional(),
  email: z.string().email("Invalid email format").optional(),
  password: z.string().min(1, "Password is required")
}).refine(data => data.username || data.email, {
  message: "Either username or email is required",
  path: ["username"]
});

export const agentEnrollSchema = z.object({
  device_uid: z.string().optional(),
  hostname: z.string().min(1, "hostname is required"),
  os_version: z.string().optional(),
  agent_version: z.string().optional(),
  mac_address: z.string().optional(),
  bootstrap_token: z.string().optional()
});

export const deviceRegistrationSchema = z.object({
  hostname: z.string().min(1, "hostname is required"),
  os_type: z.string().optional(),
  os_version: z.string().optional(),
  agent_version: z.string().optional(),
  device_uid: z.string().optional()
});

export const telemetryIngestSchema = z.object({
  hostname: z.string().min(1, "hostname is required"),
  metrics: z.record(z.any()).optional(),
  events: z.array(z.record(z.any())).optional(),
  processes: z.array(z.record(z.any())).optional(),
  os_version: z.string().optional(),
  agent_version: z.string().optional(),
  ip_address: z.string().optional(),
  disk_free: z.union([z.number(), z.string()]).optional(),
  memory_usage: z.union([z.number(), z.string()]).optional(),
  cpu_usage: z.union([z.number(), z.string()]).optional()
});

export const commandDispatchSchema = z.object({
  hostname: z.string().min(1).optional(),
  device_id: z.union([z.string(), z.number()]).optional(),
  agent_id: z.union([z.string(), z.number()]).optional(),
  kind: z.string().min(1).optional(),
  command_type: z.string().min(1).optional(),
  payload: z.record(z.any()).optional(),
  simulate: z.boolean().optional()
}).refine(data => data.hostname || data.device_id || data.agent_id, {
  message: "Device target (hostname, device_id, or agent_id) is required",
  path: ["hostname"]
}).refine(data => data.kind || data.command_type, {
  message: "Command kind or command_type is required",
  path: ["kind"]
});

export const commandResultSchema = z.object({
  status: z.string().optional(),
  exit_code: z.number().int().optional(),
  output: z.string().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional()
});

export const msiGenerateSchema = z.object({
  package_name: z.string().min(1, "package_name is required"),
  version: z.string().optional(),
  tenant_id: z.string().optional(),
  group_id: z.string().optional(),
  single_use: z.boolean().optional(),
  expires_in_hours: z.number().positive().optional()
});

export const createAlertRuleSchema = z.object({
  name: z.string().min(1, "Alert rule name is required"),
  metric: z.string().min(1, "Metric name is required"),
  threshold: z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/, "Threshold must be numeric")]),
  duration_mins: z.union([z.number().int().positive(), z.string()]).optional(),
  severity: z.string().optional(),
  enabled: z.boolean().optional()
});

export const updateAlertRuleSchema = z.object({
  name: z.string().optional(),
  metric: z.string().optional(),
  threshold: z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/, "Threshold must be numeric")]).optional(),
  duration_mins: z.union([z.number().int().positive(), z.string()]).optional(),
  severity: z.string().optional(),
  enabled: z.boolean().optional()
});

export const webhookConfigSchema = z.object({
  type: z.string().optional(),
  url: z.string().url("Valid webhook URL is required").optional(),
  enabled: z.boolean().optional()
});

export const createGroupSchema = z.object({
  name: z.string().min(1, "Group name is required"),
  description: z.string().optional(),
  tenant_id: z.string().optional()
});

export const updateGroupSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional()
});

export const createPolicySchema = z.object({
  name: z.string().min(1, "Policy name is required"),
  policy_type: z.string().min(1, "policy_type is required"),
  config: z.record(z.any()).optional(),
  tenant_id: z.string().optional()
});

export const updatePolicySchema = z.object({
  name: z.string().min(1).optional(),
  config: z.record(z.any()).optional()
});

export const assignPolicySchema = z.object({
  device_ids: z.array(z.union([z.string(), z.number()])).optional(),
  group_ids: z.array(z.union([z.string(), z.number()])).optional()
});

export const updateRetentionSchema = z.object({
  raw_telemetry_days: z.number().int().min(1).max(3650).optional(),
  event_log_days: z.number().int().min(1).max(3650).optional(),
  audit_log_days: z.number().int().min(1).max(3650).optional(),
  auto_purge_enabled: z.boolean().optional(),
  slack_webhook_url: z.string().url().or(z.literal("")).optional(),
  teams_webhook_url: z.string().url().or(z.literal("")).optional(),
  notification_email: z.string().email().or(z.literal("")).optional()
});

export const setupSchema = z.object({
  company_name: z.string().optional(),
  server_host: z.string().optional(),
  admin_username: z.string().min(3, "Admin username must be at least 3 characters").optional(),
  admin_password: z.string().min(8, "Admin password must be at least 8 characters").optional(),
  branding: z.record(z.any()).optional(),
  build_mode: z.string().optional(),
  github_repo: z.string().optional(),
  github_token: z.string().optional()
});

export const createUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
  role: z.string().optional(),
  email: z.string().email("Invalid email format").optional(),
  company_id: z.number().optional()
});

export const updateUserSchema = z.object({
  role: z.string().optional(),
  active: z.boolean().optional(),
  password: z.string().min(6, "Password must be at least 6 characters").optional()
});

export const createCompanySchema = z.object({
  name: z.string().min(1, "Company name is required")
});

export const defaultCompanySchema = z.object({
  name: z.string().min(1, "Company name is required")
});

export const updateFeatureSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.any()).optional()
});

export const updateTargetVersionSchema = z.object({
  target_version: z.string().min(1, "target_version is required")
});

export const buildTriggerSchema = z.object({
  repo: z.string().optional(),
  branch: z.string().optional(),
  token: z.string().optional()
});

export const updateRemediationPolicySchema = z.object({
  enabled: z.boolean()
});

export const remediationTriggerSchema = z.object({
  hostname: z.string().min(1, "hostname is required"),
  action_type: z.string().min(1, "action_type is required")
});

export const ticketConfigSchema = z.object({
  system: z.string().optional(),
  project: z.string().optional(),
  url: z.string().optional(),
  api_key: z.string().optional()
});

export const createTicketSchema = z.object({
  title: z.string().min(1, "Ticket title is required"),
  agent: z.string().optional(),
  severity: z.string().optional(),
  description: z.string().optional()
});
