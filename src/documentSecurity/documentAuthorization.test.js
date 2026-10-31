import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('Document Authorization, Department Isolation & IDOR Prevention', () => {
  const requesterHeadCS = { id: 'user-head-cs', roles: ['HEAD'], departmentId: 10 };
  const approverPC = { id: 'user-pc', roles: ['PURCHASE_COMMITTEE'], departmentId: null };
  const unauthorizedUserBio = { id: 'user-head-bio', roles: ['HEAD'], departmentId: 20 };
  const adminUser = { id: 'user-admin', roles: ['ADMIN'], departmentId: null };

  const activeRequestCS = {
    requestId: 'req-cs-01',
    departmentId: 10,
    raisedBy: 'user-head-cs',
    currentStageId: 1, // Purchase Committee
    currentStatus: 'UNDER_PURCHASE_COMMITTEE_REVIEW',
  };

  const closedRequestCS = {
    requestId: 'req-cs-02',
    departmentId: 10,
    raisedBy: 'user-head-cs',
    currentStageId: null,
    currentStatus: 'CLOSED',
  };

  const activeAttachment = {
    attachmentId: 'att-cs-001',
    requestId: 'req-cs-01',
    uploadedBy: 'user-head-cs',
    supersededById: null,
    archivedAt: null,
  };

  const alreadySupersededAttachment = {
    attachmentId: 'att-cs-002',
    requestId: 'req-cs-01',
    uploadedBy: 'user-head-cs',
    supersededById: 'att-cs-003',
    archivedAt: null,
  };

  function canViewRequestAttachments(user, req) {
    if (user.roles.includes('ADMIN')) return true;
    if (user.roles.includes('PURCHASE_COMMITTEE') || user.roles.includes('PRINCIPAL') || user.roles.includes('CDC_GRANT_MEMBER')) {
      return true;
    }
    // Requester or same department
    if (req.raisedBy === user.id) return true;
    if (user.departmentId && req.departmentId === user.departmentId) return true;
    return false;
  }

  function canAttachToRequest(user, req) {
    if (['CLOSED', 'CARRIED_FORWARD'].includes(req.currentStatus)) {
      return { allowed: false, status: 409, message: 'This request is closed' };
    }
    if (user.roles.includes('ADMIN')) return { allowed: true };
    const isRaiser = req.raisedBy === user.id;
    const isStaffedAtStage = (user.roles.includes('PURCHASE_COMMITTEE') && req.currentStageId === 1);
    if (isRaiser || isStaffedAtStage) {
      return { allowed: true };
    }
    return { allowed: false, status: 403, message: 'Only the requester or an approver at current stage can attach files' };
  }

  function canSupersedeAttachment(user, attachment, req) {
    if (attachment.supersededById !== null) {
      return { allowed: false, status: 409, message: 'This document has already been superseded' };
    }
    if (attachment.archivedAt !== null) {
      return { allowed: false, status: 409, message: 'This document is archived and cannot be superseded' };
    }
    return canAttachToRequest(user, req);
  }

  function canDownloadAttachment(user, attachment, req) {
    if (attachment.archivedAt !== null) {
      return { allowed: false, status: 404, message: 'Attachment not found' };
    }
    if (!canViewRequestAttachments(user, req)) {
      return { allowed: false, status: 404, message: 'Attachment not found' };
    }
    return { allowed: true };
  }

  test('Requester and current stage approver can view attachments', () => {
    assert.equal(canViewRequestAttachments(requesterHeadCS, activeRequestCS), true);
    assert.equal(canViewRequestAttachments(approverPC, activeRequestCS), true);
    assert.equal(canViewRequestAttachments(adminUser, activeRequestCS), true);
  });

  test('Cross-department user cannot view attachments (IDOR blocked)', () => {
    assert.equal(canViewRequestAttachments(unauthorizedUserBio, activeRequestCS), false);
  });

  test('Superseding fails if document is already superseded (Linear Chain Integrity)', () => {
    const res = canSupersedeAttachment(requesterHeadCS, alreadySupersededAttachment, activeRequestCS);
    assert.equal(res.allowed, false);
    assert.equal(res.status, 409);
    assert.match(res.message, /already been superseded/);
  });

  test('Superseding fails if request is closed (Historical Record Protection)', () => {
    const res = canSupersedeAttachment(requesterHeadCS, activeAttachment, closedRequestCS);
    assert.equal(res.allowed, false);
    assert.equal(res.status, 409);
    assert.match(res.message, /closed/);
  });

  test('Unauthorized user from another department cannot supersede document', () => {
    const res = canSupersedeAttachment(unauthorizedUserBio, activeAttachment, activeRequestCS);
    assert.equal(res.allowed, false);
    assert.equal(res.status, 403);
  });

  test('Download route denies cross-department user with 404 (prevent leaking existence)', () => {
    const res = canDownloadAttachment(unauthorizedUserBio, activeAttachment, activeRequestCS);
    assert.equal(res.allowed, false);
    assert.equal(res.status, 404);
  });

  test('Download route permits authorized requester and approver', () => {
    assert.equal(canDownloadAttachment(requesterHeadCS, activeAttachment, activeRequestCS).allowed, true);
    assert.equal(canDownloadAttachment(approverPC, activeAttachment, activeRequestCS).allowed, true);
  });
});

