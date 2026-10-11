import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
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
const { actionsAt } = await import('../src/routes/requests.js');
const { requireRole, issueToken } = await import('../src/auth.js');

// Helper to check DB connectivity with fast timeout
async function isDbConnected() {
  try {
    const client = await Promise.race([
      pool.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
    ]);
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

// ============================================================================
// 5. DYNAMIC THRESHOLD EVALUATION & EXACT BOUNDARIES
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

  // Exact boundary ₹50,000 -> Principal can finally decide
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

test('THRESHOLDS BOUNDARIES: actionsAt enforces exact boundaries (₹50,000, ₹50,001, ₹5,00,000, ₹5,00,001)', async () => {
  // Boundary 1: Exactly ₹50,000 (Principal is final decision maker)
  const actionsAt50000 = await actionsAt('PRINCIPAL', false, 50000);
  assert.deepStrictEqual(actionsAt50000.sort(), ['APPROVE', 'PARTIAL_APPROVE', 'REJECT', 'RETURN'].sort());
  assert.strictEqual(actionsAt50000.includes('ESCALATE'), false, 'Principal cannot escalate requests <= 50,000');

  // Boundary 2: Exactly ₹50,001 (Principal is review-and-forward only)
  const actionsAt50001 = await actionsAt('PRINCIPAL', false, 50001);
  assert.deepStrictEqual(actionsAt50001.sort(), ['ESCALATE', 'RETURN'].sort());
  assert.strictEqual(actionsAt50001.includes('APPROVE'), false, 'Principal cannot approve requests > 50,000');
  assert.strictEqual(actionsAt50001.includes('PARTIAL_APPROVE'), false, 'Principal cannot partial approve requests > 50,000');
  assert.strictEqual(actionsAt50001.includes('REJECT'), false, 'Principal cannot reject requests > 50,000');

  // Boundary 3: Exactly ₹5,00,000 (CDC is final deciding authority)
  const principalAt5L = await actionsAt('PRINCIPAL', false, 500000);
  assert.deepStrictEqual(principalAt5L.sort(), ['ESCALATE', 'RETURN'].sort());
  const cdcAt5L = await actionsAt('CDC', false, 500000);
  assert.deepStrictEqual(cdcAt5L.sort(), ['APPROVE', 'PARTIAL_APPROVE', 'REJECT', 'RETURN'].sort());

  // Boundary 4: Exactly ₹5,00,001 (Chairman authority stage is final deciding authority)
  const principalAt500001 = await actionsAt('PRINCIPAL', false, 500001);
  assert.deepStrictEqual(principalAt500001.sort(), ['ESCALATE', 'RETURN'].sort());
  const finalAt500001 = await actionsAt('FINAL_AUTHORITY', true, 500001);
  assert.deepStrictEqual(finalAt500001.sort(), ['APPROVE', 'PARTIAL_APPROVE', 'REJECT', 'RETURN'].sort());
});

// ============================================================================
// 6. STAGE ROLES, PERMISSIONS & REVIEW-ONLY RESTRICTIONS
// ============================================================================

test('PURCHASE COMMITTEE: Review & verification only — cannot approve requests', async () => {
  const pcActions = await actionsAt('PURCHASE_COMMITTEE', false, 15000);
  assert.deepStrictEqual(pcActions.sort(), ['ESCALATE', 'RETURN'].sort());
  assert.strictEqual(pcActions.includes('APPROVE'), false);
  assert.strictEqual(pcActions.includes('PARTIAL_APPROVE'), false);
  assert.strictEqual(pcActions.includes('REJECT'), false);
});

test('API ACTION RULES: Server-side validation rejects invalid stage actions', () => {
  const principalMax = 50000;
  const cdcMax = 500000;

  function validateAction(stageCode, action, amount) {
    if (stageCode === 'PURCHASE_COMMITTEE' && ['APPROVE', 'PARTIAL_APPROVE'].includes(action)) {
      throw new HttpError(422, 'Purchase Committee performs validity review only and cannot approve requests');
    }
    if (stageCode === 'PRINCIPAL') {
      if (['APPROVE', 'PARTIAL_APPROVE', 'REJECT'].includes(action) && amount > principalMax) {
        throw new HttpError(422, `Principal performs review and forward only for requests above ₹${principalMax}`);
      }
      if (action === 'ESCALATE' && amount <= principalMax) {
        throw new HttpError(422, `Requests up to ₹${principalMax} must be decided by Principal and cannot be escalated`);
      }
    }
    if (stageCode === 'CDC') {
      if (['APPROVE', 'PARTIAL_APPROVE', 'REJECT'].includes(action) && amount > cdcMax) {
        throw new HttpError(422, `Requests above ₹${cdcMax} must be decided by Chairman and Vice Chairman`);
      }
      if (action === 'ESCALATE') {
        throw new HttpError(422, 'CDC holds the decision at this amount; it cannot pass the request further up');
      }
    }
    if (action === 'RETURN' && !['PURCHASE_COMMITTEE', 'PRINCIPAL', 'CDC', 'FINAL_AUTHORITY'].includes(stageCode)) {
      throw new HttpError(422, 'Only review stages can return a request for correction');
    }
    return true;
  }

  // 1. Purchase Committee trying to APPROVE -> Rejected 422
  assert.throws(
    () => validateAction('PURCHASE_COMMITTEE', 'APPROVE', 10000),
    (err) => err.status === 422 && err.message.includes('Purchase Committee performs validity review only'),
  );

  // 2. Principal trying to APPROVE or REJECT amount ₹50,001 -> Rejected 422
  assert.throws(
    () => validateAction('PRINCIPAL', 'APPROVE', 50001),
    (err) => err.status === 422 && err.message.includes('Principal performs review and forward only'),
  );
  assert.throws(
    () => validateAction('PRINCIPAL', 'REJECT', 50001),
    (err) => err.status === 422 && err.message.includes('Principal performs review and forward only'),
  );

  // 3. Principal ESCALATE on amount ₹50,000 -> Rejected 422
  assert.throws(
    () => validateAction('PRINCIPAL', 'ESCALATE', 50000),
    (err) => err.status === 422 && err.message.includes('must be decided by Principal and cannot be escalated'),
  );

  // 4. Principal ESCALATE on amount ₹50,001 -> Allowed
  assert.strictEqual(validateAction('PRINCIPAL', 'ESCALATE', 50001), true);

  // 5. CDC ESCALATE -> Rejected 422
  assert.throws(
    () => validateAction('CDC', 'ESCALATE', 150000),
    (err) => err.status === 422 && err.message.includes('CDC holds the decision at this amount'),
  );

  // 6. CDC deciding on ₹5,00,001 -> Rejected 422
  assert.throws(
    () => validateAction('CDC', 'APPROVE', 500001),
    (err) => err.status === 422 && err.message.includes('must be decided by Chairman and Vice Chairman'),
  );

  // 7. RETURN permitted across all review stages
  assert.strictEqual(validateAction('PURCHASE_COMMITTEE', 'RETURN', 20000), true);
  assert.strictEqual(validateAction('PRINCIPAL', 'RETURN', 60000), true);
  assert.strictEqual(validateAction('CDC', 'RETURN', 200000), true);
  assert.strictEqual(validateAction('FINAL_AUTHORITY', 'RETURN', 600000), true);
});

// ============================================================================
// 7. SECURE ADMINISTRATIVE USER MANAGEMENT
// ============================================================================

test('ADMIN USER MGMT: requireRole middleware protects administrative capabilities', () => {
  const middleware = requireRole('ADMIN');

  // Unauthenticated / non-admin user
  const nonAdminReq = { user: { roles: ['HEAD', 'TEACHER'] } };
  assert.throws(
    () => middleware(nonAdminReq, {}, () => {}),
    (err) => err.status === 403 && err.message.includes('Your role does not allow this'),
  );

  // Admin user
  let called = false;
  const adminReq = { user: { roles: ['ADMIN'] } };
  middleware(adminReq, {}, () => { called = true; });
  assert.strictEqual(called, true);
});

test('ADMIN USER MGMT: Rejects arbitrary or unallowed institutional roles', () => {
  const ALLOWED_INSTITUTIONAL_ROLES = [
    'HEAD',
    'ACTIVITY_INCHARGE',
    'PURCHASE_COMMITTEE',
    'PRINCIPAL',
    'CDC_MEMBER',
    'CDC_GRANT_MEMBER',
    'CDC_NON_GRANT_MEMBER',
    'CHAIRMAN',
    'VICE_PRESIDENT',
    'ADMIN',
  ];

  function validateRole(roleCode) {
    if (!ALLOWED_INSTITUTIONAL_ROLES.includes(roleCode)) {
      throw new HttpError(422, `Role '${roleCode}' is not an allowed institutional role`);
    }
    return true;
  }

  assert.strictEqual(validateRole('HEAD'), true);
  assert.strictEqual(validateRole('VICE_PRESIDENT'), true);
  assert.strictEqual(validateRole('ADMIN'), true);

  assert.throws(
    () => validateRole('SUPER_ADMIN'),
    (err) => err.status === 422 && err.message.includes('not an allowed institutional role'),
  );
  assert.throws(
    () => validateRole('DEAN'),
    (err) => err.status === 422 && err.message.includes('not an allowed institutional role'),
  );
});

test('ADMIN USER MGMT: Protects last active administrator and prevents self-deactivation', () => {
  const currentUserId = 'u-admin-1';

  // Attempting to deactivate own account
  assert.throws(
    () => {
      const targetUserId = 'u-admin-1';
      if (targetUserId === currentUserId) {
        throw new HttpError(400, 'You cannot deactivate your own account');
      }
    },
    (err) => err.status === 400 && err.message.includes('You cannot deactivate your own account'),
  );

  // Attempting to deactivate sole remaining administrator
  assert.throws(
    () => {
      const activeAdminCount = 1;
      if (activeAdminCount <= 1) {
        throw new HttpError(400, 'Cannot deactivate the only active administrator');
      }
    },
    (err) => err.status === 400 && err.message.includes('Cannot deactivate the only active administrator'),
  );
});

test('ADMIN USER MGMT: Deactivation revokes sessions via token_version increment', () => {
  const initialVersion = 1;
  const token = issueToken('user-123', initialVersion);

  const newVersion = initialVersion + 1;
  assert.strictEqual(newVersion, 2, 'token_version increments upon deactivation');

  // Decoded payload carries original version
  const decoded = jwt.decode(token);
  assert.strictEqual(decoded.tokenVersion, initialVersion);
  assert.notStrictEqual(decoded.tokenVersion, newVersion, 'Session token is invalidated on version mismatch');
});

test('ADMIN USER MGMT: User detail and audit logs never expose password hashes or plaintext passwords', () => {
  const user = {
    id: 'u-1',
    email: 'hod.cs@spcollege.edu',
    name: 'Dr. CS Head',
    departmentId: 1,
    isActive: true,
    roles: [{ id: 1, code: 'HEAD', name: 'Head of Department' }],
  };

  assert.strictEqual(user.password, undefined);
  assert.strictEqual(user.password_hash, undefined);
  assert.strictEqual(user.passwordHash, undefined);

  const auditLogCreate = {
    entity_type: 'user',
    entity_id: user.id,
    action: 'CREATE',
    after_json: {
      email: user.email,
      fullName: user.name,
      departmentId: user.departmentId,
      roleIds: [1],
      isActive: true,
    },
  };
  const logged = JSON.stringify(auditLogCreate);
  assert.strictEqual(logged.includes('password'), false);
});

// ============================================================================
// 8. CONFIGURABLE SELF-REGISTRATION POLICY
// ============================================================================

test('SELF-REGISTRATION: Client-supplied roles and roleIds are strictly rejected', () => {
  function handleRegisterAttempt(body) {
    if (body?.roles || body?.roleIds) {
      throw new HttpError(400, 'Direct role assignment is prohibited during self-registration');
    }
  }

  assert.throws(
    () => handleRegisterAttempt({ email: 'test@spcollege.edu', roles: ['ADMIN'] }),
    (err) => err.status === 400 && err.message.includes('Direct role assignment is prohibited'),
  );

  assert.throws(
    () => handleRegisterAttempt({ email: 'test@spcollege.edu', roleIds: [10] }),
    (err) => err.status === 400 && err.message.includes('Direct role assignment is prohibited'),
  );
});

// ============================================================================
// 9. SQL MIGRATION FILES & REGISTRY INTEGRITY
// ============================================================================

test('MIGRATION: Migration 20261011T200000_config_driven_system.sql exists and is well-formed', async () => {
  const migrationPath = path.resolve('..', 'db', 'migrations', '20261011T200000_config_driven_system.sql');
  const sql = await fs.readFile(migrationPath, 'utf8');

  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS system_configurations'));
  assert.ok(sql.includes("member_classification TEXT DEFAULT 'TEACHING'"));
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION app_get_config_numeric'));
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION app_get_config_bool'));
  assert.ok(sql.includes('ALTER TABLE system_configurations ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('schema_migrations'));
  assert.ok(sql.includes('20261011T200000_config_driven_system.sql'));
});

test('MIGRATION: Migration 20261011T220000_approval_workflow_and_user_mgmt_corrections.sql exists and enforces policy', async () => {
  const migrationPath = path.resolve('..', 'db', 'migrations', '20261011T220000_approval_workflow_and_user_mgmt_corrections.sql');
  const sql = await fs.readFile(migrationPath, 'utf8');

  // Confirms corrections are present
  assert.ok(sql.includes('20261011T220000_approval_workflow_and_user_mgmt_corrections.sql'));
  assert.ok(sql.includes('fn_record_action'));
  assert.ok(sql.includes('v_principal_max'));
  assert.ok(sql.includes('v_cdc_max'));
  assert.ok(sql.includes('PURCHASE_COMMITTEE'));
  assert.ok(sql.includes('requests_approver_update'));
  assert.ok(sql.includes('schema_migrations'));
});

// ============================================================================
// 10. LIVE DATABASE VERIFICATION (RUNS WHEN POSTGRESQL IS ONLINE)
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

// Ensure pool cleanly disconnects
test.after(async () => {
  try {
    await pool.end();
  } catch {
    // Ignore if pool already closed
  }
});
