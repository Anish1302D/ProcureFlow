# ProcureFlow Document Security & Versioning Architecture

## 1. Overview & Objectives

ProcureFlow enforces an immutable, auditable, and resilient document management system. Documents attached to requisitions, budget provisions, and campus issues serve as formal evidentiary records for institutional procurement decisions and financial audits.

The document security architecture guarantees:
1. **Upload Security**: Content verification via strict magic bytes inspection, blocking executable binaries, dangerous scripts, spoofed containers, and unverified formats. File-size validation rejects empty files and prevents denial-of-service via oversized payloads.
2. **Path & Filename Sanitization**: Path traversal sequences, control characters, Windows reserved device names, and dangerous double extensions are stripped or rejected.
3. **Storage Abstraction & Parity**: Seamless operation across local disk and Google Drive backends without leaking storage keys or credentials. Failed uploads clean up immediately to prevent orphaned storage blobs.
4. **Server-Side Authorization & RLS**: Multi-tenant departmental isolation enforced via Row-Level Security (RLS) and API guards. Cross-department access attempts (IDOR) are strictly blocked.
5. **Non-Destructive Versioning**: Every document revision is preserved in full. Documents are never silently overwritten. Superseded documents maintain clear forward and backward links (`quotation_v1.pdf → quotation_v2.pdf → quotation_v3.pdf`).
6. **Cryptographic Integrity & Metadata**: Every document captures original and sanitized filenames, MIME type, size, request version association, uploader identity, timestamp, and a SHA-256 cryptographic digest.
7. **Auditable Archival**: Ordinary users and approvers cannot permanently destroy historical records. Deletion is replaced with auditable soft removal/archival with mandatory reasons and immutable audit log records.

---

## 2. Document Versioning & Supersession Chain

```
Draft / Active Requisition
  │
  ├── Attached: quotation_v1.pdf (v1, req_v: 1, SHA-256: 3a7f...)
  │         │
  │         ▼ Superseded by quotation_v2.pdf (Reason: Updated vendor discount)
  │
  ├── Attached: quotation_v2.pdf (v2, req_v: 2, SHA-256: d81c...)
            │
            ▼ Superseded by quotation_v3.pdf (Reason: Corrected GST calculation)

  └── Attached: quotation_v3.pdf (v3, req_v: 2, SHA-256: f409...) [CURRENT]
```

- **Linear Supersession**: When a document is replaced via `POST /api/attachments/:id/supersede`, the previous document points to `superseded_by_id`, incrementing `version_number` while inheriting the parent request association.
- **Race Condition Prevention**: Database transactions acquire row-level locks (`SELECT ... FOR UPDATE`) to prevent concurrent duplicate supersessions.
- **Request Version Synchronization**: Attachments track the active `request_version_number`, ensuring full alignment with multi-iteration resubmission snapshots.

---

## 3. Threat Model & Security Mitigations

| Threat Vector | Mitigation Strategy |
|---|---|
| **MIME / Extension Spoofing** | Primary inspection uses magic byte signatures. Declared MIME and extension must match verified container content. Unverified ZIPs and disguised executables are rejected with HTTP 415. |
| **Executable & Script Uploads** | Windows PE/MZ (`0x4D 0x5A`), Unix ELF (`0x7F 'ELF'`), Mach-O, Java bytecode, shebangs (`#!`), PHP markers, and script content are strictly blocked. |
| **Path Traversal Attacks** | Basename resolution, rejection of `..` segments, path sanitization, and strict path prefix confinement ensure files remain inside designated storage directories. |
| **IDOR / Cross-Department Access** | PostgreSQL RLS policies (`attachments_read`, `attachments_insert`, `attachments_delete`) combined with API endpoint authorization ensure users only access documents within their departmental jurisdiction. |
| **Evidence Tampering / Silent Overwrite** | Hard deletion on historical documents is prohibited. Replaced documents are kept permanently. SHA-256 checksums verify byte integrity. |
| **Accidental or Malicious Deletion** | Replaced by auditable soft archival (`archived_at`, `archived_by`, `archived_reason`). Audit trails record all archival actions. Archived files are blocked from normal downloads. |
