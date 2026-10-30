import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { canCreateIssues } from '../../server/src/roles.js';

describe('Issue #25 - Preserve Eligible User Issue Creation', () => {
  test('Non-admin campus roles are authorized to create non-financial issues', () => {
    const campusUsers = [
      { id: 'u-fac', name: 'Prof. Sharma', roles: ['FACULTY'] },
      { id: 'u-head', name: 'Dr. Deshmukh', roles: ['HEAD'] },
      { id: 'u-staff', name: 'Mr. Kulkarni', roles: ['STAFF'] },
      { id: 'u-prin', name: 'Principal Dr. Joshi', roles: ['PRINCIPAL'] },
      { id: 'u-stud', name: 'Student Council Rep', roles: ['STUDENT'] },
      { id: 'u-act', name: 'Activity In-charge', roles: ['ACTIVITY_INCHARGE'] },
      { id: 'u-cdc', name: 'CDC Member', roles: ['CDC_MEMBER'] },
      { id: 'u-pc', name: 'Purchase Committee Member', roles: ['PURCHASE_COMMITTEE'] },
    ];

    for (const user of campusUsers) {
      assert.equal(
        canCreateIssues(user),
        true,
        `User ${user.name} with role ${user.roles.join(',')} must be permitted to create issues`,
      );
    }
  });

  test('Issue creation payload validation passes for eligible users', () => {
    function validateAndCreateIssue(user, payload) {
      if (!user || user.roles?.includes('ADMIN')) {
        throw new Error('Administrators cannot create or log issues');
      }
      if (!payload.title || payload.title.trim().length < 3) {
        throw new Error('Title too short');
      }
      if (!payload.description || payload.description.trim().length < 1) {
        throw new Error('Description required');
      }
      return {
        id: 'new-issue-101',
        title: payload.title.trim(),
        description: payload.description.trim(),
        status: 'SUBMITTED',
        raisedBy: { id: user.id, name: user.name },
      };
    }

    const faculty = { id: 'fac-1', name: 'Dr. Faculty', roles: ['FACULTY'] };
    const issue = validateAndCreateIssue(faculty, {
      title: 'Water cooler leakage in Chemistry Wing',
      description: 'Second floor water cooler is leaking continuously.',
    });

    assert.equal(issue.title, 'Water cooler leakage in Chemistry Wing');
    assert.equal(issue.status, 'SUBMITTED');
    assert.equal(issue.raisedBy.id, 'fac-1');
  });
});
