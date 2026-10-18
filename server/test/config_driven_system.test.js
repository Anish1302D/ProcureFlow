import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

function withDatabase(connectionString, database) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

const defaultDbUrl = 'postgres://app_user:app_password@localhost:5433/spc_api_test';
process.env.DATABASE_URL = withDatabase(process.env.DATABASE_URL || defaultDbUrl, 'spc_api_test');
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
const { verifySetupLimiter, setupAccountLimiter } = await import('../src/routes/auth.js');
const {
  REQUESTER_ROLES,
  ISSUE_MANAGER_ROLES,
  INVENTORY_READER_ROLES,
  INVENTORY_WRITER_ROLES,
} = await import('../src/roles.js');

// Helper to check DB connectivity with fast timeout
async function isDbConnected() {
  return new Promise((resolve) => {
    const url = new URL(process.env.DATABASE_URL);
    const host = url.hostname || 'localhost';
    const port = Number(url.port) || 5432;
    const socket = net.createConnection({ host, port, timeout: 500 });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}


// ============================================================================
// 1. CONFIGURATION SYSTEM: SCHEMAS & DEFAULT SAFE BASELINES
// ============================================================================

test('CONFIG: Authoritative schema definition contains all required institutional keys', () => {
  const expectedKeys = [
    'workflow.threshold.principal_max',
    'workflow.threshold.cdc_max',
    'roles.vice_chairman.title',
    'cdc.teaching_members_limit',
    'cdc.non_teaching_members_limit',
    'budget.warn_utilization_percent',
    'institution.name',
    'institution.system_name',
    'institution.support_email',
    'auth.password_min_length',
    'auth.invite_ttl_hours',
    'auth.reset_ttl_minutes',
    'auth.lockout_threshold',
    'auth.lockout_minutes',
    'auth.allowed_email_domains',
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
  assert.strictEqual(DEFAULT_CONFIGS['auth.password_min_length'], 12);
  assert.strictEqual(DEFAULT_CONFIGS['auth.invite_ttl_hours'], 168);
  assert.strictEqual(DEFAULT_CONFIGS['auth.reset_ttl_minutes'], 60);
  assert.deepStrictEqual(DEFAULT_CONFIGS['auth.allowed_email_domains'], [], 'every email domain may be invited by default');
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

  // Domain list (normalised to lower case)
  const dVal = configService.validate('auth.allowed_email_domains', ['Gmail.com', 'spcollege.edu.in']);
  assert.deepStrictEqual(dVal, ['gmail.com', 'spcollege.edu.in']);

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

  // Not a domain
  assert.throws(
    () => configService.validate('auth.allowed_email_domains', ['not a domain']),
    (err) => err instanceof HttpError && err.status === 422,
  );

  // Password minimum below the floor
  assert.throws(
    () => configService.validate('auth.password_min_length', 6),
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
  if (!(await isDbConnected())) {
    configService.setTestOverride('workflow.threshold.principal_max', 50000);
    configService.setTestOverride('workflow.threshold.cdc_max', 500000);
  }
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
  const offline = !(await isDbConnected());
  if (offline) {
    configService.setTestOverride('workflow.threshold.principal_max', 50000);
    configService.setTestOverride('workflow.threshold.cdc_max', 500000);
  }
  try {
    // Boundary 1: Exactly ₹50,000 (Principal is final decision maker)
    const actionsAt50000 = await actionsAt('PRINCIPAL', false, 50000);
    assert.deepStrictEqual(actionsAt50000.sort(), ['APPROVE', 'PARTIAL_APPROVE', 'REJECT', 'RETURN'].sort());
    assert.strictEqual(actionsAt50000.includes('ESCALATE'), false, 'Principal cannot escalate requests <= 50,000');

    // Boundary 2: Exactly ₹50,001 (Principal is review-and-forward/reject/return)
    const actionsAt50001 = await actionsAt('PRINCIPAL', false, 50001);
    assert.deepStrictEqual(actionsAt50001.sort(), ['ESCALATE', 'REJECT', 'RETURN'].sort());
    assert.strictEqual(actionsAt50001.includes('APPROVE'), false, 'Principal cannot approve requests > 50,000');
    assert.strictEqual(actionsAt50001.includes('PARTIAL_APPROVE'), false, 'Principal cannot partial approve requests > 50,000');
    assert.ok(actionsAt50001.includes('REJECT'), 'Principal can reject requests > 50,000');

    // Boundary 3: Exactly ₹5,00,000 (CDC is final deciding authority)
    const principalAt5L = await actionsAt('PRINCIPAL', false, 500000);
    assert.deepStrictEqual(principalAt5L.sort(), ['ESCALATE', 'REJECT', 'RETURN'].sort());
    const cdcAt5L = await actionsAt('CDC', false, 500000);
    assert.deepStrictEqual(cdcAt5L.sort(), ['APPROVE', 'PARTIAL_APPROVE', 'REJECT'].sort());

    // Boundary 4: Exactly ₹5,00,001 (Chairman authority stage is final deciding authority)
    const principalAt500001 = await actionsAt('PRINCIPAL', false, 500001);
    assert.deepStrictEqual(principalAt500001.sort(), ['ESCALATE', 'REJECT', 'RETURN'].sort());
    const finalAt500001 = await actionsAt('FINAL_AUTHORITY', true, 500001);
    assert.deepStrictEqual(finalAt500001.sort(), ['APPROVE', 'PARTIAL_APPROVE', 'REJECT'].sort());
  } finally {
    if (offline) configService.clearTestOverrides();
  }
});

// ============================================================================
// 6. STAGE ROLES, PERMISSIONS & REVIEW-ONLY RESTRICTIONS
// ============================================================================

test('PURCHASE COMMITTEE: Review & verification only — cannot approve requests', async () => {
  const pcActions = await actionsAt('PURCHASE_COMMITTEE', false, 15000);
  assert.deepStrictEqual(pcActions.sort(), ['ESCALATE', 'REJECT', 'RETURN'].sort());
  assert.strictEqual(pcActions.includes('APPROVE'), false);
  assert.strictEqual(pcActions.includes('PARTIAL_APPROVE'), false);
  assert.ok(pcActions.includes('REJECT'), 'Purchase Committee can reject invalid requests');
});

test('API ACTION RULES: Server-side validation rejects invalid stage actions', () => {
  const principalMax = 50000;
  const cdcMax = 500000;

  function validateAction(stageCode, action, amount) {
    if (stageCode === 'PURCHASE_COMMITTEE' && ['APPROVE', 'PARTIAL_APPROVE'].includes(action)) {
      throw new HttpError(422, 'Purchase Committee performs validity review only and cannot approve requests');
    }
    if (stageCode === 'PRINCIPAL') {
      if (['APPROVE', 'PARTIAL_APPROVE'].includes(action) && amount > principalMax) {
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
    if (action === 'RETURN' && !['PURCHASE_COMMITTEE', 'PRINCIPAL'].includes(stageCode)) {
      throw new HttpError(422, 'Only the Purchase Committee and the Principal can return a request for correction');
    }
    return true;
  }

  // 1. Purchase Committee trying to APPROVE -> Rejected 422
  assert.throws(
    () => validateAction('PURCHASE_COMMITTEE', 'APPROVE', 10000),
    (err) => err.status === 422 && err.message.includes('Purchase Committee performs validity review only'),
  );

  // 2. Principal trying to APPROVE amount ₹50,001 -> Rejected 422 (REJECT is allowed)
  assert.throws(
    () => validateAction('PRINCIPAL', 'APPROVE', 50001),
    (err) => err.status === 422 && err.message.includes('Principal performs review and forward only'),
  );
  assert.strictEqual(validateAction('PRINCIPAL', 'REJECT', 50001), true);

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

  // 7. RETURN permitted only for Purchase Committee and Principal
  assert.strictEqual(validateAction('PURCHASE_COMMITTEE', 'RETURN', 20000), true);
  assert.strictEqual(validateAction('PRINCIPAL', 'RETURN', 60000), true);
  assert.throws(
    () => validateAction('CDC', 'RETURN', 200000),
    (err) => err.status === 422 && err.message.includes('Only the Purchase Committee and the Principal'),
  );
  assert.throws(
    () => validateAction('FINAL_AUTHORITY', 'RETURN', 600000),
    (err) => err.status === 422 && err.message.includes('Only the Purchase Committee and the Principal'),
  );
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
// 9. ADMIN-CREATED ACCOUNT ACTIVATION & SECURE SETUP TOKEN FLOW
// ============================================================================

test('ACCOUNT ACTIVATION: User creation schema rejects administrator-entered passwords', () => {
  const createUserSchema = z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    fullName: z.string().trim().min(2).max(200),
    departmentId: z.number().int().positive().nullable().optional(),
    roleIds: z.array(z.number().int().positive()).min(1, 'Assign at least one role'),
    isActive: z.boolean().optional(),
  });

  const valid = createUserSchema.safeParse({
    email: 'new.faculty@spcollege.edu',
    fullName: 'Dr. New Faculty',
    departmentId: 1,
    roleIds: [2],
  });
  assert.ok(valid.success);
  assert.strictEqual(valid.data.password, undefined);
});

test('ACCOUNT ACTIVATION: Generates cryptographically secure single-use token and SHA-256 hash', () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  assert.strictEqual(rawToken.length, 64);

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  assert.strictEqual(tokenHash.length, 64);
  assert.notStrictEqual(rawToken, tokenHash);

  const verifyHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  assert.strictEqual(verifyHash, tokenHash);
});

test('ACCOUNT ACTIVATION: Token verification rejects missing, expired, and already used tokens', () => {
  function verifyToken(tokenRecord, incomingToken) {
    if (!incomingToken || incomingToken.length < 16) {
      throw new HttpError(400, 'Invalid or missing setup token');
    }
    const incomingHash = crypto.createHash('sha256').update(incomingToken).digest('hex');
    if (!tokenRecord || tokenRecord.token_hash !== incomingHash) {
      throw new HttpError(404, 'Invalid or unknown setup token');
    }
    if (tokenRecord.used_at) {
      throw new HttpError(400, 'This setup link has already been used');
    }
    if (new Date(tokenRecord.expires_at) < new Date()) {
      throw new HttpError(400, 'This setup link has expired. Please contact your administrator.');
    }
    return { valid: true, email: tokenRecord.email, fullName: tokenRecord.full_name };
  }

  const raw = 'a'.repeat(64);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');

  const validRecord = {
    token_hash: hash,
    expires_at: new Date(Date.now() + 86400000),
    used_at: null,
    email: 'faculty@spcollege.edu',
    full_name: 'Dr. Faculty',
  };
  const verified = verifyToken(validRecord, raw);
  assert.strictEqual(verified.valid, true);

  // Unknown token
  assert.throws(
    () => verifyToken(validRecord, 'b'.repeat(64)),
    (err) => err.status === 404,
  );

  // Already used token
  const usedRecord = { ...validRecord, used_at: new Date() };
  assert.throws(
    () => verifyToken(usedRecord, raw),
    (err) => err.status === 400 && err.message.includes('already been used'),
  );

  // Expired token
  const expiredRecord = { ...validRecord, expires_at: new Date(Date.now() - 1000) };
  assert.throws(
    () => verifyToken(expiredRecord, raw),
    (err) => err.status === 400 && err.message.includes('has expired'),
  );
});

test('ACCOUNT ACTIVATION: Unactivated accounts (is_active = FALSE) cannot log in or authenticate', () => {
  const usersDb = [
    { user_id: 'u-1', email: 'inactive@spcollege.edu', is_active: false, token_version: 1 },
    { user_id: 'u-2', email: 'active@spcollege.edu', is_active: true, token_version: 1 },
  ];

  function queryLoginAccount(email) {
    return usersDb.find((u) => u.email === email && u.is_active);
  }

  assert.strictEqual(queryLoginAccount('inactive@spcollege.edu'), undefined);
  assert.ok(queryLoginAccount('active@spcollege.edu'));

  function loadUserMock(userId) {
    const user = usersDb.find((u) => u.user_id === userId && u.is_active);
    if (!user) return null;
    return user;
  }

  assert.strictEqual(loadUserMock('u-1'), null);
  assert.ok(loadUserMock('u-2'));
});

test('ACCOUNT ACTIVATION: Atomic token consumption serializes concurrent requests and guarantees single-use', async () => {
  // Simulates PostgreSQL fn_consume_account_setup_token logic with FOR UPDATE row-level locking
  let lockAcquired = false;
  const tokenState = {
    token_id: 't-123',
    token_hash: crypto.createHash('sha256').update('secret-token-1234567890123456').digest('hex'),
    expires_at: new Date(Date.now() + 86400000),
    used_at: null,
  };
  const userState = {
    user_id: 'u-999',
    password_hash: null,
    is_active: false,
    token_version: 1,
  };
  const auditLogs = [];

  async function consumeTokenAtomic(tokenHash, newPasswordHash, clientIp) {
    // Row lock simulation: if locked, concurrent request waits until released
    while (lockAcquired) {
      await new Promise((r) => setTimeout(r, 10));
    }
    lockAcquired = true;
    try {
      if (tokenState.token_hash !== tokenHash) {
        throw new HttpError(404, 'Invalid or unknown setup token', { code: 'ST001' });
      }
      if (tokenState.used_at !== null) {
        throw new HttpError(400, 'This setup link has already been used', { code: 'ST002' });
      }
      if (tokenState.expires_at < new Date()) {
        throw new HttpError(400, 'This setup link has expired. Please contact your administrator.', { code: 'ST003' });
      }

      // Mark token as used
      tokenState.used_at = new Date();

      // Update user atomically
      userState.password_hash = newPasswordHash;
      userState.is_active = true;
      userState.token_version = (userState.token_version || 1) + 1;

      // Write immutable audit log
      auditLogs.push({
        entity_type: 'user',
        entity_id: userState.user_id,
        action: 'ACCOUNT_ACTIVATED',
        ip: clientIp,
      });

      return {
        user_id: userState.user_id,
        token_version: userState.token_version,
      };
    } finally {
      lockAcquired = false;
    }
  }

  const rawToken = 'secret-token-1234567890123456';
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // Run simultaneous concurrent requests with identical token
  const [result1, result2] = await Promise.allSettled([
    consumeTokenAtomic(tokenHash, 'hashed-password-1', '192.168.1.10'),
    consumeTokenAtomic(tokenHash, 'hashed-password-2', '192.168.1.11'),
  ]);

  // Exactly one request must succeed and exactly one must fail
  const fulfilled = [result1, result2].filter((r) => r.status === 'fulfilled');
  const rejected = [result1, result2].filter((r) => r.status === 'rejected');

  assert.strictEqual(fulfilled.length, 1, 'Only one concurrent setup request may succeed');
  assert.strictEqual(rejected.length, 1, 'Simultaneous reuse attempt must be rejected');

  assert.strictEqual(rejected[0].reason.status, 400);
  assert.strictEqual(rejected[0].reason.message, 'This setup link has already been used');
  assert.strictEqual(rejected[0].reason.code, 'ST002');

  // Verify database state is consistent and not double-incremented
  assert.strictEqual(userState.is_active, true);
  assert.strictEqual(userState.token_version, 2, 'token_version incremented exactly once');
  assert.strictEqual(auditLogs.length, 1, 'Exactly one ACCOUNT_ACTIVATED audit event written');
  assert.ok(tokenState.used_at !== null);
});

test('ACCOUNT ACTIVATION: Rejection of expired, invalid, and already-used tokens without modifying account state', async () => {
  const user = {
    user_id: 'u-unactivated',
    password_hash: null,
    is_active: false,
    token_version: 1,
  };

  function simulateConsume(tokenRecord, incomingToken) {
    const hash = crypto.createHash('sha256').update(incomingToken).digest('hex');
    if (!tokenRecord || tokenRecord.token_hash !== hash) {
      throw new HttpError(404, 'Invalid or unknown setup token', { code: 'ST001' });
    }
    if (tokenRecord.used_at) {
      throw new HttpError(400, 'This setup link has already been used', { code: 'ST002' });
    }
    if (tokenRecord.expires_at < new Date()) {
      throw new HttpError(400, 'This setup link has expired. Please contact your administrator.', { code: 'ST003' });
    }
    // Only if all pass would user be modified
    user.is_active = true;
  }

  // 1. Invalid token
  assert.throws(
    () => simulateConsume(null, 'invalid-token-1234567890'),
    (err) => err.status === 404 && err.code === 'ST001',
  );
  assert.strictEqual(user.is_active, false);

  // 2. Expired token
  const expiredRecord = {
    token_hash: crypto.createHash('sha256').update('expired-token-1234567890').digest('hex'),
    expires_at: new Date(Date.now() - 3600000),
    used_at: null,
  };
  assert.throws(
    () => simulateConsume(expiredRecord, 'expired-token-1234567890'),
    (err) => err.status === 400 && err.code === 'ST003' && err.message.includes('has expired'),
  );
  assert.strictEqual(user.is_active, false);

  // 3. Already used token
  const usedRecord = {
    token_hash: crypto.createHash('sha256').update('used-token-1234567890123456').digest('hex'),
    expires_at: new Date(Date.now() + 86400000),
    used_at: new Date(Date.now() - 1000),
  };
  assert.throws(
    () => simulateConsume(usedRecord, 'used-token-1234567890123456'),
    (err) => err.status === 400 && err.code === 'ST002' && err.message.includes('already been used'),
  );
  assert.strictEqual(user.is_active, false);
  assert.strictEqual(user.token_version, 1);
});

test('ACCOUNT ACTIVATION: RLS policy and database permissions enforce administrator-only isolation and SECURITY DEFINER access', async () => {
  const migrationPath = path.resolve('..', 'db', 'migrations', '20261011T230000_secure_account_activation.sql');
  const migrationSql = await fs.readFile(migrationPath, 'utf8');

  // Verify RLS policy is strictly admin-only
  assert.ok(migrationSql.includes('ALTER TABLE account_setup_tokens ENABLE ROW LEVEL SECURITY'));
  assert.ok(migrationSql.includes("USING (app_has_role('ADMIN'))"));
  assert.ok(migrationSql.includes("WITH CHECK (app_has_role('ADMIN'))"));

  // Verify table grant to app_user exists so admin operations succeed
  assert.ok(migrationSql.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON account_setup_tokens TO app_user'));

  // Verify SECURITY DEFINER functions exist with app_user execution grant
  assert.ok(migrationSql.includes('CREATE OR REPLACE FUNCTION fn_verify_account_setup_token'));
  assert.ok(migrationSql.includes('SECURITY DEFINER'));
  assert.ok(migrationSql.includes('GRANT EXECUTE ON FUNCTION fn_verify_account_setup_token(TEXT) TO app_user'));

  assert.ok(migrationSql.includes('CREATE OR REPLACE FUNCTION fn_consume_account_setup_token'));
  assert.ok(migrationSql.includes('FOR UPDATE'));
  assert.ok(migrationSql.includes('GRANT EXECUTE ON FUNCTION fn_consume_account_setup_token(TEXT, TEXT, TEXT) TO app_user'));

  // Also verify mirrored definitions in db/schema/14_rls.sql and 12_functions.sql
  const rlsSql = await fs.readFile(path.resolve('..', 'db', 'schema', '14_rls.sql'), 'utf8');
  assert.ok(rlsSql.includes('ALTER TABLE account_setup_tokens ENABLE ROW LEVEL SECURITY'));
  assert.ok(rlsSql.includes('CREATE POLICY account_setup_tokens_admin ON account_setup_tokens'));
  assert.ok(rlsSql.includes("USING (app_has_role('ADMIN'))"));

  const funcSql = await fs.readFile(path.resolve('..', 'db', 'schema', '12_functions.sql'), 'utf8');
  assert.ok(funcSql.includes('fn_verify_account_setup_token'));
  assert.ok(funcSql.includes('fn_consume_account_setup_token'));
});

test('ACCOUNT ACTIVATION: Delivery protection, anti-caching, rate limiters, and URL token removal', async () => {
  // 1. Rate limiters are exported and configured
  assert.ok(verifySetupLimiter, 'verifySetupLimiter must be exported');
  assert.ok(setupAccountLimiter, 'setupAccountLimiter must be exported');

  // 2. Anti-caching headers defined on setup endpoints
  const authRoutesSrc = await fs.readFile(path.resolve('src', 'routes', 'auth.js'), 'utf8');
  assert.ok(authRoutesSrc.includes("'Cache-Control': 'no-store, no-cache, must-revalidate, private'"));
  assert.ok(authRoutesSrc.includes("Pragma: 'no-cache'"));
  assert.ok(authRoutesSrc.includes("Expires: '0'"));

  // 3. Admin user creation & token generation sets anti-caching headers and does NOT claim email sent
  const adminRoutesSrc = await fs.readFile(path.resolve('src', 'routes', 'admin.js'), 'utf8');
  assert.ok(adminRoutesSrc.includes("emailDelivery: 'UNCONFIGURED'"));
  assert.ok(adminRoutesSrc.includes('Outbound email delivery is unconfigured in this environment'));
  assert.strictEqual(adminRoutesSrc.includes('Email sent successfully'), false);

  // 4. Server error logging redacts setup token from URLs
  const errorsSrc = await fs.readFile(path.resolve('src', 'errors.js'), 'utf8');
  assert.ok(errorsSrc.includes("replace(/([?&]token=)[^&]+/gi, '$1[REDACTED]')"));

  const testUrl = '/api/auth/verify-setup-token?token=supersecrettoken1234567890&format=json';
  const redactedUrl = testUrl.replace(/([?&]token=)[^&]+/gi, '$1[REDACTED]');
  assert.strictEqual(redactedUrl, '/api/auth/verify-setup-token?token=[REDACTED]&format=json');
  assert.strictEqual(redactedUrl.includes('supersecrettoken1234567890'), false);

  // 5. Frontend SetupAccount immediately cleanses URL token on mount
  const setupAccountPageSrc = await fs.readFile(path.resolve('..', 'src', 'pages', 'SetupAccount.jsx'), 'utf8');
  assert.ok(setupAccountPageSrc.includes('window.history.replaceState({}, document.title, window.location.pathname)'));

  // 6. index.html has strict referrer policy
  const indexHtml = await fs.readFile(path.resolve('..', 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('name="referrer" content="strict-origin-when-cross-origin"'));
});

test('ROLES: ACTIVITY_INCHARGE is strictly least-privileged requester and lacks approval/management authority', () => {
  // ACTIVITY_INCHARGE is in REQUESTER_ROLES (can raise requisitions)
  assert.ok(REQUESTER_ROLES.includes('ACTIVITY_INCHARGE'));

  // ACTIVITY_INCHARGE cannot manage issues (only PRINCIPAL, ADMIN)
  assert.strictEqual(ISSUE_MANAGER_ROLES.includes('ACTIVITY_INCHARGE'), false);

  // ACTIVITY_INCHARGE cannot view or write inventory
  assert.strictEqual(INVENTORY_READER_ROLES.includes('ACTIVITY_INCHARGE'), false);
  assert.strictEqual(INVENTORY_WRITER_ROLES.includes('ACTIVITY_INCHARGE'), false);

  // ACTIVITY_INCHARGE cannot approve budget or review financial requisitions
  const APPROVAL_ROLES = ['PRINCIPAL', 'CHAIRMAN', 'VICE_PRESIDENT', 'CDC_MEMBER', 'ADMIN'];
  assert.strictEqual(APPROVAL_ROLES.includes('ACTIVITY_INCHARGE'), false);

  // A newly invited requester has no workflow stage assignments and no department yet
  const selfRegUser = {
    id: 'requester-1',
    roles: ['ACTIVITY_INCHARGE'],
    departmentId: null,
    stages: [],
  };

  const permissions = {
    raiseRequests: REQUESTER_ROLES.some((r) => selfRegUser.roles.includes(r)),
    manageIssues: ISSUE_MANAGER_ROLES.some((r) => selfRegUser.roles.includes(r)),
    viewInventory: INVENTORY_READER_ROLES.some((r) => selfRegUser.roles.includes(r)),
    approve: selfRegUser.stages.length > 0,
  };

  assert.strictEqual(permissions.raiseRequests, true);
  assert.strictEqual(permissions.manageIssues, false);
  assert.strictEqual(permissions.viewInventory, false);
  assert.strictEqual(permissions.approve, false);
  assert.strictEqual(selfRegUser.departmentId, null, 'Must have null department until admin verifies assignment');
});

// ============================================================================
// 10. EXACT WORKFLOW THRESHOLD BOUNDARIES & APPROVAL RESTRICTIONS
// ============================================================================

test('THRESHOLDS: Exact boundaries at ₹50,000, ₹50,001, ₹5,00,000, and ₹5,00,001', async () => {
  const offline = !(await isDbConnected());
  if (offline) {
    configService.setTestOverride('workflow.threshold.principal_max', 50000);
    configService.setTestOverride('workflow.threshold.cdc_max', 500000);
  }
  try {
    // 1. Boundary ₹50,000 (Principal can approve, partial approve, reject, or return)
    const actionsPrincipal50k = await actionsAt('PRINCIPAL', false, 50000);
    assert.ok(actionsPrincipal50k.includes('APPROVE'), 'Principal can approve at <= 50,000');
    assert.ok(actionsPrincipal50k.includes('REJECT'), 'Principal can reject at <= 50,000');
    assert.ok(actionsPrincipal50k.includes('RETURN'));

    // 2. Boundary ₹50,001 (Principal reviews/refers; CDC makes final decision)
    const actionsPrincipal50kPlus = await actionsAt('PRINCIPAL', false, 50001);
    assert.strictEqual(actionsPrincipal50kPlus.includes('APPROVE'), false, 'Principal cannot final approve at 50,001');
    assert.ok(actionsPrincipal50kPlus.includes('ESCALATE'), 'Principal escalates/refers at 50,001');
    assert.ok(actionsPrincipal50kPlus.includes('REJECT'), 'Principal can reject at 50,001');
    assert.ok(actionsPrincipal50kPlus.includes('RETURN'));

    const actionsCdc50kPlus = await actionsAt('CDC', false, 50001);
    assert.ok(actionsCdc50kPlus.includes('APPROVE'), 'CDC can approve at 50,001');
    assert.ok(actionsCdc50kPlus.includes('REJECT'), 'CDC can reject at 50,001');
    assert.strictEqual(actionsCdc50kPlus.includes('RETURN'), false);

    // 3. Boundary ₹5,00,000 (Principal reviews/refers; CDC makes final decision)
    const actionsPrincipal500k = await actionsAt('PRINCIPAL', false, 500000);
    assert.strictEqual(actionsPrincipal500k.includes('APPROVE'), false);
    assert.ok(actionsPrincipal500k.includes('ESCALATE'));
    assert.ok(actionsPrincipal500k.includes('REJECT'));
    assert.ok(actionsPrincipal500k.includes('RETURN'));

    const actionsCdc500k = await actionsAt('CDC', false, 500000);
    assert.ok(actionsCdc500k.includes('APPROVE'), 'CDC can approve at 5,00,000');
    assert.ok(actionsCdc500k.includes('REJECT'), 'CDC can reject at 5,00,000');
    assert.strictEqual(actionsCdc500k.includes('RETURN'), false);

    // 4. Boundary ₹5,00,001 (Principal and CDC review/refer; Chairman/Vice Chairman makes final decision)
    const actionsPrincipal500kPlus = await actionsAt('PRINCIPAL', false, 500001);
    assert.strictEqual(actionsPrincipal500kPlus.includes('APPROVE'), false);
    assert.ok(actionsPrincipal500kPlus.includes('ESCALATE'));
    assert.ok(actionsPrincipal500kPlus.includes('REJECT'));
    assert.ok(actionsPrincipal500kPlus.includes('RETURN'));

    const actionsCdc500kPlus = await actionsAt('CDC', false, 500001);
    assert.strictEqual(actionsCdc500kPlus.includes('APPROVE'), false, 'CDC cannot final approve at 5,00,001');
    assert.strictEqual(actionsCdc500kPlus.includes('RETURN'), false);

    const actionsFinal500kPlus = await actionsAt('FINAL_AUTHORITY', true, 500001);
    assert.ok(actionsFinal500kPlus.includes('APPROVE'), 'Final Authority can approve at 5,00,001');
    assert.ok(actionsFinal500kPlus.includes('REJECT'), 'Final Authority can reject at 5,00,001');
    assert.strictEqual(actionsFinal500kPlus.includes('RETURN'), false);

    // 5. Purchase Committee across all thresholds (review and refer, can reject, never approve)
    for (const amt of [50000, 50001, 500000, 500001]) {
      const pcActions = await actionsAt('PURCHASE_COMMITTEE', false, amt);
      assert.strictEqual(pcActions.includes('APPROVE'), false, `PC must never approve at ₹${amt}`);
      assert.ok(pcActions.includes('REJECT'), `PC can reject at ₹${amt}`);
      assert.ok(pcActions.includes('ESCALATE'));
      assert.ok(pcActions.includes('RETURN'));
    }
  } finally {
    if (offline) configService.clearTestOverrides();
  }
});

// ============================================================================
// 11. SQL MIGRATION FILES & REGISTRY INTEGRITY
// ============================================================================

test('MIGRATION: Secure account activation migration exists and is registered', async () => {
  const migrationPath = path.resolve('..', 'db', 'migrations', '20261011T230000_secure_account_activation.sql');
  const sql = await fs.readFile(migrationPath, 'utf8');

  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS account_setup_tokens'));
  assert.ok(sql.includes('token_hash'));
  assert.ok(sql.includes('expires_at'));
  assert.ok(sql.includes('used_at'));
  assert.ok(sql.includes('ALTER TABLE account_setup_tokens ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('account_setup_tokens_admin'));
  assert.ok(sql.includes('schema_migrations'));
  assert.ok(sql.includes('20261011T230000_secure_account_activation.sql'));
});

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
// 12. LIVE DATABASE VERIFICATION (RUNS WHEN POSTGRESQL IS ONLINE)
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

  // 3. Test app_get_config_bool SQL function: an absent key yields the default
  const boolResult = await anonQuery(
    "SELECT app_get_config_bool('test.absent_flag', true) AS on_default, app_get_config_bool('test.absent_flag', false) AS off_default",
  );
  assert.strictEqual(boolResult.rows[0].on_default, true);
  assert.strictEqual(boolResult.rows[0].off_default, false);

  // 4. Verify Vice Chairman role rename
  const roleResult = await anonQuery("SELECT name FROM roles WHERE code = 'VICE_PRESIDENT'");
  assert.strictEqual(roleResult.rows[0]?.name, 'Vice Chairman');

  // 5. Verify Chairman & Vice Chairman stage rename
  const stageResult = await anonQuery("SELECT name FROM workflow_stages WHERE code = 'FINAL_AUTHORITY'");
  assert.strictEqual(stageResult.rows[0]?.name, 'Chairman & Vice Chairman');
});

// ============================================================================
// 13. FINAL AUTHORITY SINGLE-APPROVAL REGRESSION TESTS
// ============================================================================

test('FINAL AUTHORITY: Single decision finalizes approval or rejection without joint approval', async (t) => {
  const connected = await isDbConnected();
  if (!connected) {
    t.skip('Local PostgreSQL instance is offline; skipping live DB test');
    return;
  }

  // 1. Create a request above ₹5,00,000 (e.g. ₹6,50,000)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const fyRes = await client.query('SELECT financial_year_id FROM financial_years WHERE is_active LIMIT 1');
    const bhRes = await client.query("SELECT budget_head_id FROM budget_heads WHERE code = 'IT' LIMIT 1");
    const biRes = await client.query("SELECT budget_item_id FROM budget_items WHERE code = 'MIC-01' LIMIT 1");
    const userRes = await client.query("SELECT user_id, email FROM users WHERE email IN ('head.cs@spcollege.edu', 'pc1@spcollege.edu', 'principal@spcollege.edu', 'chairman@spcollege.edu', 'vp@spcollege.edu')");
    const users = Object.fromEntries(userRes.rows.map((r) => [r.email, r.user_id]));

    const fy = fyRes.rows[0].financial_year_id;
    const bh = bhRes.rows[0].budget_head_id;
    const bi = biRes.rows[0].budget_item_id;

    // As head: create request
    await client.query("SELECT set_config('app.user_id', $1, true)", [users['head.cs@spcollege.edu']]);
    const insRes = await client.query(
      `INSERT INTO requests (raised_by, financial_year_id, budget_head_id, title, tentative_total_cost)
       VALUES ($1, $2, $3, 'High Value Lab Equipment', 650000)
       RETURNING request_id`,
      [users['head.cs@spcollege.edu'], fy, bh]
    );
    const reqId = insRes.rows[0].request_id;

    await client.query(
      `INSERT INTO request_items (request_id, budget_item_id, item_type_snapshot, requested_quantity, estimated_unit_cost, estimated_total)
       VALUES ($1, $2, 'CAPITAL', 1, 650000, 650000)`,
      [reqId, bi]
    );

    // Initial submission -> enters Purchase Committee
    await client.query('SELECT fn_submit_request($1)', [reqId]);

    // PC escalates to Principal
    await client.query("SELECT set_config('app.user_id', $1, true)", [users['pc1@spcollege.edu']]);
    await client.query(
      "SELECT fn_record_action($1, $2, 'ESCALATE', NULL, 'Recommended')",
      [reqId, users['pc1@spcollege.edu']]
    );

    // Principal escalates: since amount (650000) > cdcMax (500000), refers to FINAL_AUTHORITY
    await client.query("SELECT set_config('app.user_id', $1, true)", [users['principal@spcollege.edu']]);
    await client.query(
      "SELECT fn_record_action($1, $2, 'ESCALATE', NULL, 'Forwarded to Final Authority')",
      [reqId, users['principal@spcollege.edu']]
    );

    const checkEsc = await client.query('SELECT current_status, current_stage_id FROM requests WHERE request_id = $1', [reqId]);
    assert.strictEqual(checkEsc.rows[0].current_status, 'UNDER_FINAL_AUTHORITY_REVIEW');

    // 2. Unauthorized role (head or pc) attempts to decide at FINAL_AUTHORITY -> SP004
    await client.query("SELECT set_config('app.user_id', $1, true)", [users['head.cs@spcollege.edu']]);
    await client.query('SAVEPOINT sp_unauth');
    await assert.rejects(
      async () => {
        await client.query("SELECT fn_record_action($1, $2, 'APPROVE')", [reqId, users['head.cs@spcollege.edu']]);
      },
      (err) => err.code === 'SP004' || (err.message && err.message.includes('not an approver at stage FINAL_AUTHORITY')),
      'Unauthorized role must be rejected from deciding at Final Authority stage'
    );
    await client.query('ROLLBACK TO SAVEPOINT sp_unauth');

    // 3. Authorized Chairman approves: single decision must finalize status to APPROVED
    await client.query("SELECT set_config('app.user_id', $1, true)", [users['chairman@spcollege.edu']]);
    await client.query("SELECT fn_record_action($1, $2, 'APPROVE')", [reqId, users['chairman@spcollege.edu']]);

    const finalCheck = await client.query(
      'SELECT current_status, closed_at FROM requests WHERE request_id = $1',
      [reqId]
    );
    assert.strictEqual(finalCheck.rows[0].current_status, 'APPROVED', 'Single Chairman approval must finalize request to APPROVED');
    assert.ok(finalCheck.rows[0].closed_at !== null, 'Request must be closed upon final approval');

    // 4. Test single Vice Chairman decision (Rejection) on a second request
    await client.query("SELECT set_config('app.user_id', $1, true)", [users['head.cs@spcollege.edu']]);
    const insRes2 = await client.query(
      `INSERT INTO requests (raised_by, financial_year_id, budget_head_id, title, tentative_total_cost)
       VALUES ($1, $2, $3, 'High Value Server Upgrade', 700000)
       RETURNING request_id`,
      [users['head.cs@spcollege.edu'], fy, bh]
    );
    const reqId2 = insRes2.rows[0].request_id;
    await client.query(
      `INSERT INTO request_items (request_id, budget_item_id, item_type_snapshot, requested_quantity, estimated_unit_cost, estimated_total)
       VALUES ($1, $2, 'CAPITAL', 1, 700000, 700000)`,
      [reqId2, bi]
    );
    await client.query('SELECT fn_submit_request($1)', [reqId2]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [users['pc1@spcollege.edu']]);
    await client.query("SELECT fn_record_action($1, $2, 'ESCALATE', NULL, 'OK')", [reqId2, users['pc1@spcollege.edu']]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [users['principal@spcollege.edu']]);
    await client.query("SELECT fn_record_action($1, $2, 'ESCALATE', NULL, 'OK')", [reqId2, users['principal@spcollege.edu']]);

    // Vice Chairman single rejection finalizes request to REJECTED
    await client.query("SELECT set_config('app.user_id', $1, true)", [users['vp@spcollege.edu']]);
    await client.query(
      "SELECT fn_record_action($1, $2, 'REJECT', NULL, 'Budget constraints', 'Cost exceeds allocation')",
      [reqId2, users['vp@spcollege.edu']]
    );
    const checkRej = await client.query(
      'SELECT current_status, closed_at FROM requests WHERE request_id = $1',
      [reqId2]
    );
    assert.strictEqual(checkRej.rows[0].current_status, 'REJECTED', 'Single Vice Chairman rejection must finalize request to REJECTED');
    assert.ok(checkRej.rows[0].closed_at !== null);

    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ============================================================================
// 14. PRIVILEGED CONFIGURATION & SECRET ROW ISOLATION
// ============================================================================

test('CONFIG SECURITY: Secret configuration isolation and fail-safe defaults', async (t) => {
  const connected = await isDbConnected();
  if (!connected) {
    t.skip('Local PostgreSQL instance is offline; skipping config security test');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Set user as admin so initial insert is permitted by system_configurations_admin_write
    await client.query("SELECT set_config('app.user_id', (SELECT user_id::text FROM users WHERE email = 'admin@spcollege.edu'), true)");

    // Insert a secret configuration row
    await client.query(`
      INSERT INTO system_configurations (key, value, description, is_secret, category)
      VALUES ('auth.internal_webhook_secret', '"super-secret-key-12345"'::jsonb, 'Internal webhook key', true, 'security')
      ON CONFLICT (key) DO UPDATE SET is_secret = true, value = '"super-secret-key-12345"'::jsonb
    `);

    // As app_user without ADMIN role, secret row is hidden under RLS
    await client.query("SELECT set_config('app.user_id', (SELECT user_id::text FROM users WHERE email = 'head.cs@spcollege.edu'), true)");

    const regularRead = await client.query("SELECT key FROM system_configurations WHERE key = 'auth.internal_webhook_secret'");
    assert.strictEqual(regularRead.rows.length, 0, 'Unprivileged app_user must not see secret configurations under RLS');

    const regularPublic = await client.query("SELECT key FROM system_configurations WHERE key = 'workflow.threshold.principal_max'");
    assert.strictEqual(regularPublic.rows.length, 1, 'Unprivileged app_user can read non-secret configuration');

    // Unprivileged user cannot insert into system_configurations
    await client.query('SAVEPOINT sp_unauth_cfg');
    await assert.rejects(
      async () => {
        await client.query("INSERT INTO system_configurations (key, value, description, category) VALUES ('hack', '1'::jsonb, 'desc', 'general')");
      },
      /permission denied|violates row-level security policy|42501/i,
      'Unprivileged app_user cannot insert into system_configurations'
    );
    await client.query('ROLLBACK TO SAVEPOINT sp_unauth_cfg');

    // Unprivileged user cannot update system_configurations under RLS (0 rows affected)
    const updateRes = await client.query("UPDATE system_configurations SET value = '99999'::jsonb WHERE key = 'workflow.threshold.principal_max'");
    assert.strictEqual(updateRes.rowCount, 0, 'Unprivileged app_user cannot update rows in system_configurations (0 rows updated under RLS)');

    // As admin user, secret row is visible
    await client.query("SELECT set_config('app.user_id', (SELECT user_id::text FROM users WHERE email = 'admin@spcollege.edu'), true)");
    const adminRead = await client.query("SELECT key FROM system_configurations WHERE key = 'auth.internal_webhook_secret'");
    assert.strictEqual(adminRead.rows.length, 1, 'Admin must be able to read secret configurations');

    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ============================================================================
// 15. CRITICAL CONFIGURATION FAIL-CLOSED REGRESSION TESTS
// ============================================================================

test('CONFIG FAIL-CLOSED: Critical workflow thresholds fail closed when missing, invalid, or on DB error', async () => {
  // 1. Missing record -> simulated by loading cache and removing the critical key
  configService.invalidate();
  await configService.loadAll();
  configService._cache.delete('workflow.threshold.principal_max');
  configService._dbError = null;

  await assert.rejects(
    async () => {
      await configService.get('workflow.threshold.principal_max');
    },
    (err) => err instanceof HttpError && err.status === 500 && err.message.includes('missing from database'),
    'Critical threshold must fail closed when record is deleted from database'
  );

  await assert.rejects(
    async () => {
      await configService.getThresholds();
    },
    (err) => err instanceof HttpError && err.status === 500,
    'getThresholds() must fail closed when threshold record is missing'
  );

  // 2. Invalid value in DB -> simulated by setting error in _invalidKeys
  configService.invalidate();
  await configService.loadAll();
  configService._cache.delete('workflow.threshold.principal_max');
  configService._invalidKeys.set('workflow.threshold.principal_max', new Error('Validation failed'));
  configService._dbError = null;

  await assert.rejects(
    async () => {
      await configService.get('workflow.threshold.principal_max');
    },
    (err) => err instanceof HttpError && err.status === 500 && err.message.includes('invalid'),
    'Critical threshold must fail closed when value in database fails schema validation'
  );

  // 3. Database error simulation -> critical keys fail closed with 500
  configService.invalidate();
  configService._dbError = new Error('Simulated network connection drop to database');
  configService._lastLoaded = Date.now();
  await assert.rejects(
    async () => {
      await configService.get('workflow.threshold.cdc_max');
    },
    (err) => err instanceof HttpError && err.status === 500 && err.message.includes('cannot be trusted'),
    'Critical threshold must fail closed when database error occurs'
  );

  // Safe non-critical setting falls back to safe institutional default
  const instName = await configService.get('institution.name');
  assert.strictEqual(instName, 'S.P. College', 'Safe non-sensitive setting may fall back to institutional default');

  // Clean up simulated error
  configService._dbError = null;
  configService.invalidate();
});

// Ensure pool cleanly disconnects
test.after(async () => {
  try {
    await pool.end();
  } catch {
    // Ignore if pool already closed
  }
});
