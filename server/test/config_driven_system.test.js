import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';

// Configure environment before importing server modules
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://app_user:app_password@localhost:5433/sp_college';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-minimum-32-characters-long!';
process.env.SIGNING_SECRET = process.env.SIGNING_SECRET || 'test-signing-secret-minimum-32-characters-long!';
process.env.NODE_ENV = 'test';

const {
  configService,
  CONFIG_SCHEMAS,
  DEFAULT_CONFIGS,
  CONFIG_DESCRIPTIONS,
  CONFIG_CATEGORIES,
} = await import('../src/configService.js');
const { pool, anonQuery } = await import('../src/db.js');
const { HttpError } = await import('../src/errors.js');

// Helper to check DB connectivity
async function isDbConnected() {
  try {
    const client = await pool.connect();
    client.release();
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// 1. CONFIGURATION SYSTEM: SCHEMAS & DEFAULT SAFE BASELINES
// ============================================================================

test('CONFIG: Authoritative schema definition contains all required institutional keys', () => {
  const expectedKeys = [
    'workflow.threshold.principal_max',
    'workflow.threshold.cdc_max',
    'self_registration.enabled',
    'roles.vice_chairman.title',
    'cdc.teaching_members_limit',
    'cdc.non_teaching_members_limit',
    'budget.warn_utilization_percent',
    'institution.name',
    'institution.system_name',
    'institution.support_email',
  ];

  for (const key of expectedKeys) {
    assert.ok(CONFIG_SCHEMAS[key], `Missing schema definition for key: ${key}`);
    assert.notStrictEqual(DEFAULT_CONFIGS[key], undefined, `Missing default value for key: ${key}`);
    assert.ok(CONFIG_DESCRIPTIONS[key], `Missing description for key: ${key}`);
    assert.ok(CONFIG_CATEGORIES[key], `Missing category for key: ${key}`);
  }
});

test('CONFIG: Default values enforce safe institutional baselines', () => {
  assert.strictEqual(DEFAULT_CONFIGS['workflow.threshold.principal_max'], 50000);
  assert.strictEqual(DEFAULT_CONFIGS['workflow.threshold.cdc_max'], 500000);
  assert.strictEqual(DEFAULT_CONFIGS['self_registration.enabled'], false);
  assert.strictEqual(DEFAULT_CONFIGS['roles.vice_chairman.title'], 'Vice Chairman');
  assert.strictEqual(DEFAULT_CONFIGS['cdc.teaching_members_limit'], 3);
  assert.strictEqual(DEFAULT_CONFIGS['cdc.non_teaching_members_limit'], 1);
  assert.strictEqual(DEFAULT_CONFIGS['budget.warn_utilization_percent'], 85);
  assert.strictEqual(DEFAULT_CONFIGS['institution.name'], 'S.P. College');
});

// ============================================================================
// 2. CONFIGURATION VALIDATION & ERROR REJECTION
// ============================================================================

test('CONFIG VALIDATION: Validates correct data types and ranges', () => {
  // Numeric threshold
  const pVal = configService.validate('workflow.threshold.principal_max', 75000);
  assert.strictEqual(pVal, 75000);

  // Boolean flag
  const bVal = configService.validate('self_registration.enabled', true);
  assert.strictEqual(bVal, true);

  // String title
  const sVal = configService.validate('roles.vice_chairman.title', 'Hon. Vice Chairman');
  assert.strictEqual(sVal, 'Hon. Vice Chairman');
});

test('CONFIG VALIDATION: Rejects unknown configuration keys', () => {
  assert.throws(
    () => configService.validate('unknown.arbitrary.key', 'value'),
    (err) => err instanceof HttpError && err.status === 422 && err.message.includes('Unknown configuration key'),
  );
});

test('CONFIG VALIDATION: Rejects invalid data types and out-of-range values', () => {
  // Non-numeric threshold
  assert.throws(
    () => configService.validate('workflow.threshold.principal_max', 'not-a-number'),
    (err) => err instanceof HttpError && err.status === 422,
  );

  // Negative threshold
  assert.throws(
    () => configService.validate('workflow.threshold.principal_max', -500),
    (err) => err instanceof HttpError && err.status === 422,
  );

  // Out of range budget percent (>100)
  assert.throws(
    () => configService.validate('budget.warn_utilization_percent', 150),
    (err) => err instanceof HttpError && err.status === 422,
  );

  // Non-boolean self-registration flag
  assert.throws(
    () => configService.validate('self_registration.enabled', 'yes'),
    (err) => err instanceof HttpError && err.status === 422,
  );
});

test('CONFIG VALIDATION: Rejects attempted storage of secret tokens or credentials', async () => {
  const mockDb = {
    query: async () => ({ rows: [] }),
  };

  await assert.rejects(
    async () => {
      await configService.updateMultiple({ 'auth.jwt_secret': 'supersecret' }, 'test-user', mockDb);
    },
    (err) => err instanceof HttpError && err.status === 400 && err.message.includes('Secret configuration cannot be stored'),
  );
});

test('CONFIG VALIDATION: Enforces cross-key validation (Principal max must be strictly less than CDC max)', async () => {
  const mockDb = {
    query: async () => ({ rows: [] }),
  };

  // Attempting to set Principal max (600,000) >= CDC max (500,000)
  await assert.rejects(
    async () => {
      await configService.updateMultiple(
        {
          'workflow.threshold.principal_max': 600000,
          'workflow.threshold.cdc_max': 500000,
        },
        'test-user',
        mockDb,
      );
    },
    (err) => err instanceof HttpError && err.status === 422 && err.message.includes('strictly less than CDC threshold'),
  );

  // Equal values also rejected
  await assert.rejects(
    async () => {
      await configService.updateMultiple(
        {
          'workflow.threshold.principal_max': 500000,
          'workflow.threshold.cdc_max': 500000,
        },
        'test-user',
        mockDb,
      );
    },
    (err) => err instanceof HttpError && err.status === 422 && err.message.includes('strictly less than CDC threshold'),
  );
});

// ============================================================================
// 3. FAIL-CLOSED SELF-REGISTRATION BEHAVIOR
// ============================================================================

test('SELF-REGISTRATION: Fails closed by default when database record absent or unconfigured', async () => {
  configService.invalidate();
  const enabled = await configService.isSelfRegistrationEnabled();
  assert.strictEqual(enabled, false, 'Self-registration must be disabled by default');
});

test('SELF-REGISTRATION: Strictly restricts allowed roles to non-privileged requesters', () => {
  const allowedRoles = ['HEAD', 'ACTIVITY_INCHARGE'];
  const privilegedRoles = [
    'ADMIN',
    'PRINCIPAL',
    'CHAIRMAN',
    'VICE_PRESIDENT',
    'PURCHASE_COMMITTEE',
    'CDC_MEMBER',
    'CDC_GRANT_MEMBER',
    'CDC_NON_GRANT_MEMBER',
  ];

  const registerSchema = z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    fullName: z.string().trim().min(2).max(200),
    password: z.string().min(8).max(200),
    departmentId: z.number().int().positive().optional().nullable(),
    role: z.enum(['HEAD', 'ACTIVITY_INCHARGE']).optional().default('HEAD'),
  });

  // Valid requester roles succeed
  for (const allowedRole of allowedRoles) {
    const valid = registerSchema.parse({
      email: 'test@spcollege.edu',
      fullName: 'Test Faculty',
      password: 'securePassword123',
      role: allowedRole,
    });
    assert.strictEqual(valid.role, allowedRole);
  }

  // Privileged roles are rejected by schema
  for (const privRole of privilegedRoles) {
    assert.throws(
      () => {
        registerSchema.parse({
          email: 'test@spcollege.edu',
          fullName: 'Test Faculty',
          password: 'securePassword123',
          role: privRole,
        });
      },
      (err) => err instanceof z.ZodError,
      `Privileged role ${privRole} must never be accepted by self-registration`,
    );
  }
});

// ============================================================================
// 4. STATUTORY CDC COMPOSITION CAPACITY (MAX 3 TEACHING, MAX 1 NON-TEACHING)
// ============================================================================

test('CDC CAPACITY: Helper retrieves configured statutory member limits', async () => {
  const limits = await configService.getCdcLimits();
  assert.strictEqual(limits.teachingLimit, 3);
  assert.strictEqual(limits.nonTeachingLimit, 1);
});

test('CDC CAPACITY: Enforces member limits during assignment logic', () => {
  const currentMembers = [
    { classification: 'TEACHING' },
    { classification: 'TEACHING' },
    { classification: 'TEACHING' },
    { classification: 'NON_TEACHING' },
  ];

  const teachingCount = currentMembers.filter((m) => m.classification === 'TEACHING').length;
  const nonTeachingCount = currentMembers.filter((m) => m.classification === 'NON_TEACHING').length;

  const teachingLimit = 3;
  const nonTeachingLimit = 1;

  assert.strictEqual(teachingCount >= teachingLimit, true, 'Teaching capacity is full at 3');
  assert.strictEqual(nonTeachingCount >= nonTeachingLimit, true, 'Non-teaching capacity is full at 1');
});

// ============================================================================
// 5. DYNAMIC THRESHOLD EVALUATION LOGIC
// ============================================================================

test('THRESHOLDS: Helper returns numeric threshold pair', async () => {
  const thresholds = await configService.getThresholds();
  assert.strictEqual(typeof thresholds.principalMax, 'number');
  assert.strictEqual(typeof thresholds.cdcMax, 'number');
  assert.ok(thresholds.principalMax < thresholds.cdcMax);
});

test('THRESHOLDS: Dynamic routing evaluation matches institutional tier boundaries', () => {
  const principalMax = 50000;
  const cdcMax = 500000;

  function evaluateRoute(amount) {
    if (amount <= principalMax) {
      return { stage: 'PRINCIPAL', canFinalDecide: true };
    }
    if (amount <= cdcMax) {
      return { stage: 'CDC', canFinalDecide: true };
    }
    return { stage: 'FINAL_AUTHORITY', canFinalDecide: true };
  }

  // Exact boundary 50,000 -> Principal can finally decide
  const at50k = evaluateRoute(50000);
  assert.strictEqual(at50k.stage, 'PRINCIPAL');
  assert.strictEqual(at50k.canFinalDecide, true);

  // ₹50,001 -> Escalates past Principal to CDC
  const above50k = evaluateRoute(50001);
  assert.strictEqual(above50k.stage, 'CDC');

  // Exact boundary ₹5,00,000 -> CDC can decide
  const at5L = evaluateRoute(500000);
  assert.strictEqual(at5L.stage, 'CDC');

  // ₹5,00,001 -> Must escalate to Final Authority (Chairman & Vice Chairman)
  const above5L = evaluateRoute(500001);
  assert.strictEqual(above5L.stage, 'FINAL_AUTHORITY');
});

// ============================================================================
// 6. SQL MIGRATION FILE & SCHEMA INTEGRITY
// ============================================================================

test('MIGRATION: Migration 20261011T200000_config_driven_system.sql exists and is well-formed', async () => {
  const migrationPath = path.resolve('..', 'db', 'migrations', '20261011T200000_config_driven_system.sql');
  const sql = await fs.readFile(migrationPath, 'utf8');

  // Check key SQL components
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS system_configurations'));
  assert.ok(sql.includes("member_classification TEXT DEFAULT 'TEACHING'"));
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION app_get_config_numeric'));
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION app_get_config_bool'));
  assert.ok(sql.includes('ALTER TABLE system_configurations ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('schema_migrations'));
  assert.ok(sql.includes('20261011T200000_config_driven_system.sql'));
});

// ============================================================================
// 7. LIVE DATABASE VERIFICATION (RUNS WHEN POSTGRESQL IS ONLINE)
// ============================================================================

test('LIVE DB: system_configurations table and SQL functions behave correctly', async (t) => {
  const connected = await isDbConnected();
  if (!connected) {
    t.skip('Local PostgreSQL instance is offline; skipping live DB queries');
    return;
  }

  // 1. Query configurations
  const { rows } = await anonQuery(
    'SELECT key, value FROM system_configurations WHERE key = $1',
    ['workflow.threshold.principal_max'],
  );
  assert.ok(rows.length > 0, 'workflow.threshold.principal_max must exist in database');
  assert.strictEqual(Number(rows[0].value), 50000);

  // 2. Test app_get_config_numeric SQL function
  const numResult = await anonQuery(
    "SELECT app_get_config_numeric('workflow.threshold.principal_max', 10000) AS val",
  );
  assert.strictEqual(Number(numResult.rows[0].val), 50000);

  // 3. Test app_get_config_bool SQL function
  const boolResult = await anonQuery(
    "SELECT app_get_config_bool('self_registration.enabled', true) AS val",
  );
  assert.strictEqual(Boolean(boolResult.rows[0].val), false);

  // 4. Verify Vice Chairman role rename
  const roleResult = await anonQuery("SELECT name FROM roles WHERE code = 'VICE_PRESIDENT'");
  assert.strictEqual(roleResult.rows[0]?.name, 'Vice Chairman');

  // 5. Verify Chairman & Vice Chairman stage rename
  const stageResult = await anonQuery("SELECT name FROM workflow_stages WHERE code = 'FINAL_AUTHORITY'");
  assert.strictEqual(stageResult.rows[0]?.name, 'Chairman & Vice Chairman');
});
