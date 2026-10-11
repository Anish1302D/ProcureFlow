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
  'self_registration.enabled': z.boolean(),
  'roles.vice_chairman.title': z.string().trim().min(1).max(100),
  'cdc.teaching_members_limit': z.number().int().min(1).max(10),
  'cdc.non_teaching_members_limit': z.number().int().min(0).max(10),
  'budget.warn_utilization_percent': z.number().min(0).max(100),
  'institution.name': z.string().trim().min(1).max(200),
  'institution.system_name': z.string().trim().min(1).max(200),
  'institution.support_email': z.string().trim().email().max(254),
};

/**
 * Default safe institutional settings used when database records are absent.
 */
export const DEFAULT_CONFIGS = {
  'workflow.threshold.principal_max': 50000,
  'workflow.threshold.cdc_max': 500000,
  'self_registration.enabled': false,
  'roles.vice_chairman.title': 'Vice Chairman',
  'cdc.teaching_members_limit': 3,
  'cdc.non_teaching_members_limit': 1,
  'budget.warn_utilization_percent': 85,
  'institution.name': 'S.P. College',
  'institution.system_name': 'College Procurement & Approval Workflow System',
  'institution.support_email': 'support@spcollege.edu.in',
};

export const CONFIG_DESCRIPTIONS = {
  'workflow.threshold.principal_max': 'Maximum request amount decided finally by Principal (₹50,000). Requests above this escalate.',
  'workflow.threshold.cdc_max': 'Maximum request amount decided by CDC (₹5,00,000). Requests above this escalate to Chairman.',
  'self_registration.enabled': 'Whether public user self-registration is enabled. Default false.',
  'roles.vice_chairman.title': 'Institutional title for Vice Chairman role',
  'cdc.teaching_members_limit': 'Maximum number of teaching faculty members on the College Development Committee',
  'cdc.non_teaching_members_limit': 'Maximum number of non-teaching staff members on the College Development Committee',
  'budget.warn_utilization_percent': 'Budget utilization threshold percentage at which warnings are displayed',
  'institution.name': 'Official institution name',
  'institution.system_name': 'Institutional workflow system title',
  'institution.support_email': 'Institutional system support email address',
};

export const CONFIG_CATEGORIES = {
  'workflow.threshold.principal_max': 'approval_workflow',
  'workflow.threshold.cdc_max': 'approval_workflow',
  'self_registration.enabled': 'feature_flags',
  'roles.vice_chairman.title': 'institutional',
  'cdc.teaching_members_limit': 'institutional',
  'cdc.non_teaching_members_limit': 'institutional',
  'budget.warn_utilization_percent': 'budget',
  'institution.name': 'institutional',
  'institution.system_name': 'institutional',
  'institution.support_email': 'institutional',
};

class ConfigService {
  constructor() {
    this._cache = new Map();
    this._lastLoaded = 0;
    this._ttlMs = 30_000; // 30 second cache TTL with immediate invalidation on write
  }

  /**
   * Invalidate the in-memory cache so subsequent reads reload from the database.
   */
  invalidate() {
    this._cache.clear();
    this._lastLoaded = 0;
  }

  /**
   * Load all configurations from database into in-memory cache.
   */
  async loadAll(force = false) {
    const now = Date.now();
    if (!force && this._cache.size > 0 && now - this._lastLoaded < this._ttlMs) {
      return this._cache;
    }

    try {
      const { rows } = await anonQuery(
        'SELECT key, value, description, category, updated_at FROM system_configurations ORDER BY key'
      );
      this._cache.clear();
      for (const row of rows) {
        this._cache.set(row.key, row.value);
      }
      this._lastLoaded = now;
    } catch {
      // If table is not yet migrated or query fails, leave existing cache or rely on defaults
    }
    return this._cache;
  }

  /**
   * Retrieve a configuration value by key.
   */
  async get(key) {
    if (!CONFIG_SCHEMAS[key]) {
      throw new HttpError(400, `Unknown configuration key: ${key}`);
    }

    await this.loadAll();
    if (this._cache.has(key)) {
      return this._cache.get(key);
    }
    return DEFAULT_CONFIGS[key];
  }

  /**
   * Retrieve all non-secret business configurations formatted for administrative review.
   */
  async getAll() {
    await this.loadAll();
    const result = [];
    for (const key of Object.keys(CONFIG_SCHEMAS)) {
      const val = this._cache.has(key) ? this._cache.get(key) : DEFAULT_CONFIGS[key];
      result.push({
        key,
        value: val,
        description: CONFIG_DESCRIPTIONS[key] ?? '',
        category: CONFIG_CATEGORIES[key] ?? 'general',
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
      if (/(password|secret|key|token|credential)/i.test(key) && !key.startsWith('roles.') && !key.startsWith('workflow.') && !key.startsWith('self_registration.') && !key.startsWith('cdc.') && !key.startsWith('budget.') && !key.startsWith('institution.')) {
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
   * Helper: Check whether public self-registration is enabled.
   * Fails closed (returns false) if configuration cannot be retrieved or validated.
   */
  async isSelfRegistrationEnabled() {
    try {
      const val = await this.get('self_registration.enabled');
      return Boolean(val);
    } catch {
      return false; // Fail closed
    }
  }

  /**
   * Helper: Retrieve workflow thresholds.
   */
  async getThresholds() {
    const principalMax = Number(await this.get('workflow.threshold.principal_max'));
    const cdcMax = Number(await this.get('workflow.threshold.cdc_max'));
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
}

export const configService = new ConfigService();
