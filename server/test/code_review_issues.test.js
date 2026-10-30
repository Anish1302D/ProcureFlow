import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { detectType, inspectZipContainer } from '../src/storage.js';
import { parseCustomItem, serializeCustomItem } from '../../src/utils/customItem.js';

// Helper to construct a minimal valid ZIP archive buffer in memory
function createMinimalZip(internalFilename) {
  const nameBuffer = Buffer.from(internalFilename, 'utf8');
  const nameLen = nameBuffer.length;

  const lfh = Buffer.alloc(30 + nameLen);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt16LE(0, 6);
  lfh.writeUInt16LE(0, 8);
  lfh.writeUInt16LE(0, 10);
  lfh.writeUInt16LE(0, 12);
  lfh.writeUInt32LE(0, 14);
  lfh.writeUInt32LE(0, 18);
  lfh.writeUInt32LE(0, 22);
  lfh.writeUInt16LE(nameLen, 26);
  lfh.writeUInt16LE(0, 28);
  nameBuffer.copy(lfh, 30);

  const cdh = Buffer.alloc(46 + nameLen);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4);
  cdh.writeUInt16LE(20, 6);
  cdh.writeUInt16LE(0, 8);
  cdh.writeUInt16LE(0, 10);
  cdh.writeUInt16LE(0, 12);
  cdh.writeUInt16LE(0, 14);
  cdh.writeUInt32LE(0, 16);
  cdh.writeUInt32LE(0, 20);
  cdh.writeUInt32LE(0, 24);
  cdh.writeUInt16LE(nameLen, 28);
  cdh.writeUInt16LE(0, 30);
  cdh.writeUInt16LE(0, 32);
  cdh.writeUInt16LE(0, 34);
  cdh.writeUInt16LE(0, 36);
  cdh.writeUInt32LE(0, 38);
  cdh.writeUInt32LE(0, 42);
  nameBuffer.copy(cdh, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdh.length, 12);
  eocd.writeUInt32LE(lfh.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([lfh, cdh, eocd]);
}

test('PREVIOUS REVIEW — ISSUE 1: server package.json specifies Node >=22 requirement', async () => {
  const pkgPath = path.resolve('package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  assert.equal(pkg.engines?.node, '>=22', 'server engines.node must be >=22 to support googleapis@182.0.0');
});

test('PREVIOUS REVIEW — ISSUE 2: XLSX uploaded with generic application/octet-stream is classified as XLSX (and DOCX as DOCX)', () => {
  const xlsxBuffer = createMinimalZip('xl/workbook.xml');
  const docxBuffer = createMinimalZip('word/document.xml');

  assert.equal(inspectZipContainer(xlsxBuffer), 'xlsx');
  assert.equal(inspectZipContainer(docxBuffer), 'docx');

  const xlsxDetected = detectType(xlsxBuffer, 'application/octet-stream');
  assert.notEqual(xlsxDetected, null);
  assert.equal(xlsxDetected.ext, '.xlsx');
  assert.equal(xlsxDetected.mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  const docxDetected = detectType(docxBuffer, 'application/octet-stream');
  assert.notEqual(docxDetected, null);
  assert.equal(docxDetected.ext, '.docx');
  assert.equal(docxDetected.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});

test('PREVIOUS REVIEW — ISSUE 3: Custom item name containing "]" (e.g., "Adapter [Type-C]") round-trips correctly without truncation or stray text', () => {
  const customName = 'Adapter [Type-C]';
  const remarks = 'High speed USB-C cable';

  // 1. Serialize -> store
  const serialized = serializeCustomItem(customName, remarks);

  // 2. Parse -> display
  const parsed = parseCustomItem({ code: 'OTHER' }, serialized);

  assert.equal(parsed.displayName, 'Adapter [Type-C]', 'displayName must match input exactly without truncation');
  assert.equal(parsed.displayRemarks, 'High speed USB-C cable', 'displayRemarks must contain only the user remarks without stray brackets');

  // Test without extra remarks
  const serializedNoRemarks = serializeCustomItem(customName, '');
  const parsedNoRemarks = parseCustomItem({ code: 'OTHER' }, serializedNoRemarks);

  assert.equal(parsedNoRemarks.displayName, 'Adapter [Type-C]');
  assert.equal(parsedNoRemarks.displayRemarks, null);
});

test('PREVIOUS REVIEW 2 — ISSUE 1: 20260927T120000_other_sentinel_items is mirrored into seed and registered in schema_migrations', async () => {
  const migrationsSql = await fs.readFile(path.resolve('../db/schema/17_schema_migrations.sql'), 'utf8');
  assert.ok(migrationsSql.includes("'20260927T120000_other_sentinel_items.sql'"), 'migration must be registered in 17_schema_migrations.sql');

  const seedSql = await fs.readFile(path.resolve('../db/seed/02_sample_master_data.sql'), 'utf8');
  assert.ok(seedSql.includes("'OTHER'"), 'OTHER sentinel budget_head must be mirrored into 02_sample_master_data.sql');
  assert.ok(seedSql.includes("INSERT INTO budget_items"), 'OTHER sentinel budget_items must be mirrored into 02_sample_master_data.sql');
});

test('PREVIOUS REVIEW 2 — ISSUE 2: 20260927T121500_seed_courses is mirrored into seed and registered in schema_migrations', async () => {
  const migrationsSql = await fs.readFile(path.resolve('../db/schema/17_schema_migrations.sql'), 'utf8');
  assert.ok(migrationsSql.includes("'20260927T121500_seed_courses.sql'"), 'migration must be registered in 17_schema_migrations.sql');

  const seedSql = await fs.readFile(path.resolve('../db/seed/02_sample_master_data.sql'), 'utf8');
  assert.ok(seedSql.includes('INSERT INTO courses'), 'courses seeding must be mirrored into 02_sample_master_data.sql');
  assert.ok(seedSql.includes("'Bachelor of Computer Applications'"), 'seeded courses content must be present in 02_sample_master_data.sql');
});

test('PREVIOUS REVIEW 2 — ISSUE 3: Active status toggle in UserManagement.jsx has accessible button semantics', async () => {
  const userManagementJsx = await fs.readFile(path.resolve('../src/pages/UserManagement.jsx'), 'utf8');
  assert.ok(userManagementJsx.includes('role="switch"'), 'toggle must use role="switch"');
  assert.ok(userManagementJsx.includes('aria-checked={form.isActive}'), 'toggle must use aria-checked state');
  assert.ok(userManagementJsx.includes('aria-label='), 'toggle must provide an accessible aria-label');
  assert.ok(!userManagementJsx.includes('onClick={() => set({ isActive: !form.isActive })}>\n              <span'), 'toggle must not be an unaccessible span-in-label');
});

test('LATEST REVIEW — ISSUE 1: storage_backend migration exists, is mirrored, and registered', async () => {
  const migrationPath = path.resolve('../db/migrations/20260927T200000_add_attachment_storage_backend.sql');
  const migrationSql = await fs.readFile(migrationPath, 'utf8');
  assert.ok(migrationSql.includes('storage_backend'), 'migration must alter attachments table to add storage_backend');

  const schemaSql = await fs.readFile(path.resolve('../db/schema/07_audit_and_files.sql'), 'utf8');
  assert.ok(schemaSql.includes('storage_backend'), 'storage_backend column must be mirrored into db/schema/07_audit_and_files.sql');

  const regSql = await fs.readFile(path.resolve('../db/schema/17_schema_migrations.sql'), 'utf8');
  assert.ok(regSql.includes("'20260927T200000_add_attachment_storage_backend.sql'"), 'migration must be registered in 17_schema_migrations.sql');
});

test('LATEST REVIEW — ISSUE 2: admin PATCH /users/:id route blocks self-deactivation', async () => {
  const adminJs = await fs.readFile(path.resolve('src/routes/admin.js'), 'utf8');
  assert.ok(
    adminJs.includes('if (body.isActive === false && userId === req.user.id)'),
    'PATCH /users/:id must block self-deactivation when body.isActive === false',
  );
});

test('LATEST REVIEW — ISSUE 3: admin DELETE /departments/:id single query checks courses and indirect requests via course_id', async () => {
  const adminJs = await fs.readFile(path.resolve('src/routes/admin.js'), 'utf8');
  assert.ok(adminJs.includes('EXISTS (SELECT 1 FROM courses WHERE department_id = $1) AS has_courses'), 'must check courses table');
  assert.ok(adminJs.includes('LEFT JOIN courses c ON c.course_id = r.course_id'), 'must join courses to check indirect requests');
  assert.ok(adminJs.includes('WHERE r.department_id = $1 OR c.department_id = $1'), 'must check direct department_id and indirect course_id');
});
