import { z } from 'zod';
import { anonQuery } from './db.js';
import { HttpError } from './errors.js';

/**
 * Authoritative schemas for known configuration keys.
 * Unknown keys and malformed values are strictly rejected.
 */
export const CONFIG_SCHEMAS = {
  'workflow.threshold.principal_max': z.number().positive().max(10_000_000),
  'workflow.threshold.cdc_max': z.number().positive().max(100_000_000),
  'workflow.stage.entry': z.string().trim().min(1).max(50),
  'workflow.stage.principal': z.string().trim().min(1).max(50),
  'workflow.stage.intermediate': z.string().trim().min(1).max(50),
  'workflow.stage.final_authority': z.string().trim().min(1).max(50),
  'workflow.authority.final_role': z.string().trim().min(1).max(50),
  'roles.vice_chairman.title': z.string().trim().min(1).max(100),
  'cdc.teaching_members_limit': z.number().int().min(1).max(10),
  'cdc.non_teaching_members_limit': z.number().int().min(0).max(10),
  'budget.warn_utilization_percent': z.number().min(0).max(100),
  'institution.name': z.string().trim().min(1).max(200),
  'institution.system_name': z.string().trim().min(1).max(200),
  // Empty means "not set": emails then simply omit the support line.
  'institution.support_email': z.union([z.literal(''), z.string().trim().email().max(254)]),
  // Account security policy (non-secret; secrets stay in the environment).
  'auth.password_min_length': z.number().int().min(10).max(64),
  'auth.invite_ttl_hours': z.number().int().min(1).max(720),
  'auth.reset_ttl_minutes': z.number().int().min(10).max(1440),
  'auth.reset_requests_per_hour': z.number().int().min(1).max(20),
  'auth.lockout_threshold': z.number().int().min(3).max(20),
  'auth.lockout_minutes': z.number().int().min(5).max(1440),
  // Roles that must use 2-step verification. ADMIN is always among them.
  'auth.mfa_required_roles': z.array(z.string().trim().min(1).max(50)).max(20)
    .refine((roles) => roles.includes('ADMIN'), 'ADMIN must always require 2-step verification'),
  // Empty list = every email domain may be invited.
  'auth.allowed_email_domains': z.array(
    z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Must be a domain such as example.edu'),
  ).max(50),
};

/**
 * Default safe institutional settings used when database records are absent.
 */
export const DEFAULT_CONFIGS = {
  'workflow.threshold.principal_max': 50000,
  'workflow.threshold.cdc_max': 500000,
  'workflow.stage.entry': 'PURCHASE_COMMITTEE',
  'workflow.stage.principal': 'PRINCIPAL',
  'workflow.stage.intermediate': 'CDC',
  'workflow.stage.final_authority': 'FINAL_AUTHORITY',
  'workflow.authority.final_role': 'CHAIRMAN',
  'roles.vice_chairman.title': 'Vice Chairman',
  'cdc.teaching_members_limit': 3,
  'cdc.non_teaching_members_limit': 1,
  'budget.warn_utilization_percent': 85,
  'institution.name': 'S.P. College',
  'institution.system_name': 'College Procurement & Approval Workflow System',
  'institution.support_email': '',
  // People who are not comfortable with technology get a week to accept.
  'auth.password_min_length': 12,
  'auth.invite_ttl_hours': 168,
  'auth.reset_ttl_minutes': 60,
  'auth.reset_requests_per_hour': 3,
  'auth.lockout_threshold': 5,
  'auth.lockout_minutes': 15,
  'auth.mfa_required_roles': ['ADMIN'],
  'auth.allowed_email_domains': [],
};

export const CONFIG_DESCRIPTIONS = {
  'workflow.threshold.principal_max': 'Maximum request amount decided finally by Principal (₹50,000). Requests above this escalate.',
  'workflow.threshold.cdc_max': 'Maximum request amount decided by CDC (₹5,00,000). Requests above this escalate to Chairman.',
  'workflow.stage.entry': 'Stage code where new requests enter for initial verification',
  'workflow.stage.principal': 'Stage code for the Principal approval gate',
  'workflow.stage.intermediate': 'Stage code for College Development Committee intermediate authority',
  'workflow.stage.final_authority': 'Stage code for the final governing authority',
  'workflow.authority.final_role': 'Role code authorized for final sanction',
  'roles.vice_chairman.title': 'Institutional title for Vice Chairman role',
  'cdc.teaching_members_limit': 'Maximum number of teaching faculty members on the College Development Committee',
  'cdc.non_teaching_members_limit': 'Maximum number of non-teaching staff members on the College Development Committee',
  'budget.warn_utilization_percent': 'Budget utilization threshold percentage at which warnings are displayed',
  'institution.name': 'Official institution name',
  'institution.system_name': 'Institutional workflow system title',
  'institution.support_email': 'Institutional system support email address (leave empty to omit it from emails)',
  'auth.password_min_length': 'Minimum password length for every account',
  'auth.invite_ttl_hours': 'Hours an invitation link stays valid',
  'auth.reset_ttl_minutes': 'Minutes a password reset link stays valid',
  'auth.reset_requests_per_hour': 'Most reset emails one account can receive in an hour',
  'auth.lockout_threshold': 'Failed sign-ins before an account is temporarily locked',
  'auth.lockout_minutes': 'Minutes an account stays locked after too many failed sign-ins',
  'auth.mfa_required_roles': 'Roles that must use 2-step verification (ADMIN always does)',
  'auth.allowed_email_domains': 'Email domains that may be invited; empty allows every domain',
};

export const CONFIG_CATEGORIES = {
  'workflow.threshold.principal_max': 'approval_workflow',
  'workflow.threshold.cdc_max': 'approval_workflow',
  'workflow.stage.entry': 'approval_workflow',
  'workflow.stage.principal': 'approval_workflow',
  'workflow.stage.intermediate': 'approval_workflow',
  'workflow.stage.final_authority': 'approval_workflow',
  'workflow.authority.final_role': 'approval_workflow',
  'roles.vice_chairman.title': 'institutional',
  'cdc.teaching_members_limit': 'institutional',
  'cdc.non_teaching_members_limit': 'institutional',
  'budget.warn_utilization_percent': 'budget',
  'institution.name': 'institutional',
  'institution.system_name': 'institutional',
  'institution.support_email': 'institutional',
  'auth.password_min_length': 'security',
  'auth.invite_ttl_hours': 'security',
  'auth.reset_ttl_minutes': 'security',
  'auth.reset_requests_per_hour': 'security',
  'auth.lockout_threshold': 'security',
  'auth.lockout_minutes': 'security',
  'auth.mfa_required_roles': 'security',
  'auth.allowed_email_domains': 'security',
};

/**
 * Critical workflow & authorization keys: MUST fail closed when database configuration
 * cannot be verified. Silent fallbacks are strictly prohibited.
 */
export const CRITICAL_CONFIG_KEYS = new Set([
  'workflow.threshold.principal_max',
  'workflow.threshold.cdc_max',
  'workflow.stage.entry',
  'workflow.stage.principal',
  'workflow.stage.intermediate',
  'workflow.stage.final_authority',
  'workflow.authority.final_role',
]);

/**
 * Safe, non-sensitive keys permitted to use safe institutional default fallbacks
 * if missing from the database.
 */
export const SAFE_FALLBACK_KEYS = new Set([
  'institution.name',
  'institution.system_name',
  'institution.support_email',
  'roles.vice_chairman.title',
  'budget.warn_utilization_percent',
  'cdc.teaching_members_limit',
  'cdc.non_teaching_members_limit',
  'auth.password_min_length',
  'auth.invite_ttl_hours',
  'auth.reset_ttl_minutes',
  'auth.reset_requests_per_hour',
  'auth.lockout_threshold',
  'auth.lockout_minutes',
  'auth.allowed_email_domains',
  'auth.mfa_required_roles',
]);

// Policy keys whose names happen to contain a word the secrets guard looks
// for ("password"), but which hold no secret. Listed one by one on purpose:
// a prefix would let something like auth.jwt_secret slip past the guard.
const NON_SECRET_POLICY_KEYS = new Set(['auth.password_min_length']);

class ConfigService {
  constructor() {
    this._cache = new Map();
    this._invalidKeys = new Map();
    this._dbError = null;
    this._lastLoaded = 0;
    this._ttlMs = 30_000; // 30 second cache TTL with immediate invalidation on write
    this._testOverrides = null;
  }

  /**
   * Invalidate the in-memory cache so subsequent reads reload from the database.
   */
  invalidate() {
    this._cache.clear();
    this._invalidKeys.clear();
    this._dbError = null;
    this._lastLoaded = 0;
  }

  /**
   * Set a temporary test override (for isolated unit tests only).
   */
  setTestOverride(key, val) {
    if (!this._testOverrides) this._testOverrides = new Map();
    this._testOverrides.set(key, val);
  }

  /**
   * Clear test overrides.
   */
  clearTestOverrides() {
    if (this._testOverrides) this._testOverrides.clear();
  }

  /**
   * Load all configurations from database into in-memory cache.
   */
  async loadAll(force = false) {
    const now = Date.now();
    if (!force && (this._cache.size > 0 || this._dbError) && now - this._lastLoaded < this._ttlMs) {
      return this._cache;
    }

    try {
      const { rows } = await anonQuery(
        'SELECT key, value, description, category, updated_at FROM system_configurations ORDER BY key'
      );
      this._cache.clear();
      this._invalidKeys.clear();
      this._dbError = null;
      for (const row of rows) {
        if (CONFIG_SCHEMAS[row.key]) {
          const parsed = CONFIG_SCHEMAS[row.key].safeParse(row.value);
          if (parsed.success) {
            this._cache.set(row.key, parsed.data);
          } else {
            this._invalidKeys.set(row.key, parsed.error);
          }
        }
      }
    } catch (err) {
      this._dbError = err;
    } finally {
      this._lastLoaded = now;
    }
    return this._cache;
  }

  /**
   * Retrieve a configuration value by key. Fails closed for critical workflow keys.
   */
  async get(key) {
    if (!CONFIG_SCHEMAS[key]) {
      throw new HttpError(400, `Unknown configuration key: ${key}`);
    }

    if (this._testOverrides && this._testOverrides.has(key)) {
      return this._testOverrides.get(key);
    }

    await this.loadAll();

    // 1. If database query failed
    if (this._dbError) {
      if (CRITICAL_CONFIG_KEYS.has(key)) {
        throw new HttpError(
          500,
          `Critical workflow configuration "${key}" cannot be trusted: database error (${this._dbError.message})`
        );
      }
      if (SAFE_FALLBACK_KEYS.has(key) && DEFAULT_CONFIGS[key] !== undefined) {
        return DEFAULT_CONFIGS[key];
      }
      throw new HttpError(
        500,
        `Configuration "${key}" is unavailable due to database error (${this._dbError.message})`
      );
    }

    // 2. If row exists in database but has an invalid/corrupt value
    if (this._invalidKeys.has(key)) {
      throw new HttpError(
        500,
        `Configuration "${key}" in database has an invalid value and cannot be trusted: ${this._invalidKeys.get(key).message}`
      );
    }

    // 3. Successfully loaded and validated from database
    if (this._cache.has(key)) {
      return this._cache.get(key);
    }

    // 4. Missing from database
    if (CRITICAL_CONFIG_KEYS.has(key)) {
      throw new HttpError(
        500,
        `Critical workflow configuration "${key}" is missing from database; institutional approval policy cannot be verified`
      );
    }

    // Safe fallback keys permitted only for explicitly approved non-sensitive settings
    if (SAFE_FALLBACK_KEYS.has(key) && DEFAULT_CONFIGS[key] !== undefined) {
      return DEFAULT_CONFIGS[key];
    }

    throw new HttpError(500, `Configuration "${key}" is missing from database`);
  }

  /**
   * Retrieve all non-secret business configurations formatted for administrative review.
   */
  async getAll() {
    await this.loadAll();
    const result = [];
    for (const key of Object.keys(CONFIG_SCHEMAS)) {
      let val;
      if (this._cache.has(key)) {
        val = this._cache.get(key);
      } else if (SAFE_FALLBACK_KEYS.has(key)) {
        val = DEFAULT_CONFIGS[key];
      } else {
        val = null;
      }
      result.push({
        key,
        value: val,
        description: CONFIG_DESCRIPTIONS[key] ?? '',
        category: CONFIG_CATEGORIES[key] ?? 'general',
        isCritical: CRITICAL_CONFIG_KEYS.has(key),
      });
    }
    return result;
  }

  /**
   * Validate a proposed key/value pair without writing.
   */
  validate(key, rawValue) {
    const schema = CONFIG_SCHEMAS[key];
    if (!schema) {
      throw new HttpError(422, `Unknown configuration key: '${key}'`);
    }
    const parsed = schema.safeParse(rawValue);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => i.message).join('; ');
      throw new HttpError(422, `Invalid value for configuration key '${key}': ${message}`);
    }
    return parsed.data;
  }

  /**
   * Update one or more non-secret business settings in a single transaction with audit logging.
   */
  async updateMultiple(updates, actorUserId = null, dbClient = null) {
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      throw new HttpError(400, 'Configuration updates must be an object of key-value pairs');
    }

    const validatedUpdates = {};
    for (const [key, rawValue] of Object.entries(updates)) {
      // Reject any secret or credentials
      if (/(password|secret|key|token|credential)/i.test(key) && !key.startsWith('roles.') && !key.startsWith('workflow.') && !key.startsWith('cdc.') && !key.startsWith('budget.') && !key.startsWith('institution.') && !NON_SECRET_POLICY_KEYS.has(key)) {
        throw new HttpError(400, 'Secret configuration cannot be stored in database configuration');
      }
      validatedUpdates[key] = this.validate(key, rawValue);
    }

    // Cross-key validation: Principal threshold cannot exceed CDC threshold
    const currentPrincipal = validatedUpdates['workflow.threshold.principal_max'] ?? await this.get('workflow.threshold.principal_max');
    const currentCdc = validatedUpdates['workflow.threshold.cdc_max'] ?? await this.get('workflow.threshold.cdc_max');
    if (currentPrincipal >= currentCdc) {
      throw new HttpError(422, `Principal threshold (₹${currentPrincipal}) must be strictly less than CDC threshold (₹${currentCdc})`);
    }

    const runWithClient = async (db) => {
      // 1. Fetch existing values for audit log
      const keys = Object.keys(validatedUpdates);
      const { rows: existingRows } = await db.query(
        'SELECT key, value FROM system_configurations WHERE key = ANY($1::text[])',
        [keys]
      );
      const beforeMap = Object.fromEntries(existingRows.map((r) => [r.key, r.value]));

      // 2. Upsert each configuration key
      for (const [key, val] of Object.entries(validatedUpdates)) {
        const desc = CONFIG_DESCRIPTIONS[key] ?? '';
        const cat = CONFIG_CATEGORIES[key] ?? 'general';
        await db.query(
          `INSERT INTO system_configurations (key, value, description, category, is_secret, updated_at, updated_by)
           VALUES ($1, $2::jsonb, $3, $4, FALSE, NOW(), $5)
           ON CONFLICT (key) DO UPDATE SET
             value = EXCLUDED.value,
             description = EXCLUDED.description,
             category = EXCLUDED.category,
             updated_at = NOW(),
             updated_by = EXCLUDED.updated_by`,
          [key, JSON.stringify(val), desc, cat, actorUserId]
        );
      }

      // 3. Record audit log
      await db.query(
        `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, before_json, after_json)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
        [
          'system_configuration',
          keys.join(','),
          actorUserId,
          'UPDATE',
          JSON.stringify(beforeMap),
          JSON.stringify(validatedUpdates),
        ]
      );
    };

    if (dbClient) {
      await runWithClient(dbClient);
    } else {
      const { withUser } = await import('./db.js');
      await withUser(actorUserId, runWithClient);
    }

    this.invalidate();
    return validatedUpdates;
  }

  /**
   * Update a single configuration key.
   */
  async update(key, value, actorUserId = null) {
    return this.updateMultiple({ [key]: value }, actorUserId);
  }

  /**
   * Helper: Retrieve workflow thresholds.
   * Fails closed with 500 if thresholds are missing, invalid, or violate invariants.
   */
  async getThresholds() {
    const principalMax = Number(await this.get('workflow.threshold.principal_max'));
    const cdcMax = Number(await this.get('workflow.threshold.cdc_max'));
    if (!Number.isFinite(principalMax) || !Number.isFinite(cdcMax) || principalMax <= 0 || cdcMax <= 0 || principalMax >= cdcMax) {
      throw new HttpError(500, 'Workflow thresholds in database violate institutional policy invariants');
    }
    return { principalMax, cdcMax };
  }

  /**
   * Helper: Retrieve CDC member capacity limits.
   */
  async getCdcLimits() {
    const teachingLimit = Number(await this.get('cdc.teaching_members_limit'));
    const nonTeachingLimit = Number(await this.get('cdc.non_teaching_members_limit'));
    return { teachingLimit, nonTeachingLimit };
  }

  /**
   * Helper: Retrieve workflow routing stages and final authority role.
   */
  async getRoutingStages() {
    const entryStage = await this.get('workflow.stage.entry');
    const principalStage = await this.get('workflow.stage.principal');
    const intermediateStage = await this.get('workflow.stage.intermediate');
    const finalAuthorityStage = await this.get('workflow.stage.final_authority');
    const finalAuthorityRole = await this.get('workflow.authority.final_role');
    return {
      entryStage: String(entryStage),
      principalStage: String(principalStage),
      intermediateStage: String(intermediateStage),
      finalAuthorityStage: String(finalAuthorityStage),
      finalAuthorityRole: String(finalAuthorityRole),
    };
  }
}

export const configService = new ConfigService();
