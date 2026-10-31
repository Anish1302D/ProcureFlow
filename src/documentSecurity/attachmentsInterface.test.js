import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { validateUploadFile, withHistory } from '../utils/attachmentUtils.js';

describe('Document Version History & Frontend Interface Logic', () => {
  describe('validateUploadFile client-side pre-upload checks', () => {
    test('Rejects null or undefined file selection', () => {
      assert.match(validateUploadFile(null), /No file selected/i);
      assert.match(validateUploadFile(undefined), /No file selected/i);
    });

    test('Rejects empty 0-byte file', () => {
      const emptyFile = { name: 'quote.pdf', size: 0 };
      const err = validateUploadFile(emptyFile);
      assert.match(err, /empty \(0 bytes\)/i);
    });

    test('Rejects oversized file exceeding 10 MB limit', () => {
      const oversizedFile = { name: 'heavy_catalogue.pdf', size: 10 * 1024 * 1024 + 1 };
      const err = validateUploadFile(oversizedFile);
      assert.match(err, /exceeds the 10 MB/i);
    });

    test('Rejects dangerous and unsupported file extensions', () => {
      const blockedFiles = [
        { name: 'malware.exe', size: 1024 },
        { name: 'script.sh', size: 1024 },
        { name: 'macro.vbs', size: 1024 },
        { name: 'archive.zip', size: 1024 },
        { name: 'document.pdf.bat', size: 1024 },
      ];

      for (const file of blockedFiles) {
        const err = validateUploadFile(file);
        assert.match(err, /Only PDF, PNG, JPEG, Word.*and Excel.*accepted/i);
      }
    });

    test('Accepts valid document and image files', () => {
      const validFiles = [
        { name: 'quotation_v1.pdf', size: 500 * 1024 },
        { name: 'invoice.png', size: 200 * 1024 },
        { name: 'photo.jpg', size: 150 * 1024 },
        { name: 'scan.jpeg', size: 300 * 1024 },
        { name: 'specification.docx', size: 100 * 1024 },
        { name: 'budget_sheet.xlsx', size: 80 * 1024 },
      ];

      for (const file of validFiles) {
        assert.equal(validateUploadFile(file), null);
      }
    });
  });

  describe('withHistory supersession chain assembly', () => {
    test('Returns empty array when files is empty or null', () => {
      assert.deepEqual(withHistory([]), []);
      assert.deepEqual(withHistory(null), []);
      assert.deepEqual(withHistory(undefined), []);
    });

    test('Correctly identifies current document and nests earlier versions in order', () => {
      // Chain: v1 -> superseded by v2 -> superseded by v3
      const files = [
        {
          id: 'doc-v1',
          fileName: 'quote_v1.pdf',
          versionNumber: 1,
          supersededById: 'doc-v2',
          uploadedAt: '2026-10-31T10:00:00Z',
        },
        {
          id: 'doc-v2',
          fileName: 'quote_v2.pdf',
          versionNumber: 2,
          supersededById: 'doc-v3',
          uploadedAt: '2026-10-31T11:00:00Z',
        },
        {
          id: 'doc-v3',
          fileName: 'quote_v3.pdf',
          versionNumber: 3,
          supersededById: null,
          uploadedAt: '2026-10-31T12:00:00Z',
        },
      ];

      const current = withHistory(files);
      assert.equal(current.length, 1);
      assert.equal(current[0].id, 'doc-v3');
      assert.equal(current[0].versionNumber, 3);
      assert.equal(current[0].earlier.length, 2);

      // Earlier versions nested in reverse-chronological order: v2, then v1
      assert.equal(current[0].earlier[0].id, 'doc-v2');
      assert.equal(current[0].earlier[0].versionNumber, 2);
      assert.equal(current[0].earlier[1].id, 'doc-v1');
      assert.equal(current[0].earlier[1].versionNumber, 1);
    });

    test('Separates distinct un-superseded documents independently', () => {
      const files = [
        { id: 'doc-quote', fileName: 'quote.pdf', versionNumber: 1, supersededById: null },
        { id: 'doc-spec', fileName: 'spec.docx', versionNumber: 1, supersededById: null },
      ];

      const current = withHistory(files);
      assert.equal(current.length, 2);
      assert.equal(current[0].id, 'doc-quote');
      assert.equal(current[0].earlier.length, 0);
      assert.equal(current[1].id, 'doc-spec');
      assert.equal(current[1].earlier.length, 0);
    });
  });
});
