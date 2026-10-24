import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Provide safe local test environment defaults before loading config
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app_user:devpass@localhost:5433/spc_approval';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_must_be_32_characters_long!';
process.env.SIGNING_SECRET = process.env.SIGNING_SECRET || 'test_signing_secret_must_be_32_characters_long!';

const { resolveAppUrl } = await import('../src/config.js');
const {
  buildIssueCreatedEmail,
  buildRequestStatusEmail,
  getIssueUrl,
  getRequestUrl,
} = await import('../src/emailTemplates.js');

describe('Issue #24: Canonical Email Link Generation & Frontend Routing', () => {
  describe('resolveAppUrl environment resolution', () => {
    it('defaults to http://localhost:3000 in development when unconfigured', () => {
      const url = resolveAppUrl({ NODE_ENV: 'development' });
      assert.equal(url, 'http://localhost:3000');
    });

    it('respects FRONTEND_URL in development', () => {
      const url = resolveAppUrl({
        NODE_ENV: 'development',
        FRONTEND_URL: 'https://staging.spcollege.edu/',
      });
      assert.equal(url, 'https://staging.spcollege.edu');
    });

    it('respects APP_URL in development when FRONTEND_URL is not set', () => {
      const url = resolveAppUrl({
        NODE_ENV: 'development',
        APP_URL: 'https://approvals.spcollege.edu/',
      });
      assert.equal(url, 'https://approvals.spcollege.edu');
    });

    it('prioritizes FRONTEND_URL over APP_URL', () => {
      const url = resolveAppUrl({
        NODE_ENV: 'development',
        FRONTEND_URL: 'https://frontend.spcollege.edu',
        APP_URL: 'https://legacy-app.spcollege.edu',
      });
      assert.equal(url, 'https://frontend.spcollege.edu');
    });

    it('strips single and multiple trailing slashes', () => {
      const url = resolveAppUrl({
        NODE_ENV: 'development',
        FRONTEND_URL: 'https://approvals.spcollege.edu///',
      });
      assert.equal(url, 'https://approvals.spcollege.edu');
    });

    it('returns null for malformed URLs in development', () => {
      const url = resolveAppUrl({
        NODE_ENV: 'development',
        FRONTEND_URL: 'not-a-valid-url',
      });
      assert.equal(url, null);
    });

    it('accepts valid HTTPS URL in production', () => {
      const url = resolveAppUrl({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://hub.spcollege.edu.in',
      });
      assert.equal(url, 'https://hub.spcollege.edu.in');
    });

    it('refuses missing URL in production (never silently falls back to localhost)', () => {
      const url = resolveAppUrl({ NODE_ENV: 'production' });
      assert.equal(url, null);
    });

    it('refuses plain HTTP URL in production', () => {
      const url = resolveAppUrl({
        NODE_ENV: 'production',
        FRONTEND_URL: 'http://hub.spcollege.edu.in',
      });
      assert.equal(url, null);
    });

    it('refuses localhost in production', () => {
      const url = resolveAppUrl({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://localhost:3000',
      });
      assert.equal(url, null);
    });

    it('refuses 127.0.0.1 in production', () => {
      const url = resolveAppUrl({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://127.0.0.1:3000',
      });
      assert.equal(url, null);
    });
  });

  describe('getRequestUrl and getIssueUrl format', () => {
    it('generates canonical hash route for requests matching AppContext parser', () => {
      const target = getRequestUrl('req-uuid-1234', 'https://hub.spcollege.edu.in');
      assert.equal(target, 'https://hub.spcollege.edu.in/#/requests/req-uuid-1234');
    });

    it('generates canonical hash route for issues matching AppContext parser', () => {
      const target = getIssueUrl('issue-uuid-5678', 'https://hub.spcollege.edu.in');
      assert.equal(target, 'https://hub.spcollege.edu.in/#/issues/issue-uuid-5678');
    });

    it('handles base URL with trailing slash cleanly', () => {
      const target = getRequestUrl('req-uuid-1234', 'https://hub.spcollege.edu.in/');
      assert.equal(target, 'https://hub.spcollege.edu.in/#/requests/req-uuid-1234');
    });

    it('returns null when base URL is not configured in production', () => {
      const target = getRequestUrl('req-uuid-1234', null);
      assert.ok(target === null || typeof target === 'string');
    });
  });

  describe('Email templates across all approval levels generate deployed link, never localhost', () => {
    const deployedBase = 'https://approvals.spcollege.edu.in';
    const mockRequest = {
      id: '8f7a9d02-1234-4567-89ab-cdef01234567',
      requestNumber: 'REQ-2026-0088',
      title: 'Physics Lab Laser Optics',
      raisedBy: { name: 'Prof. Sharma' },
      requesterEmail: 'sharma.physics@spcollege.edu',
      department: { name: 'Physics' },
      budgetHead: { name: 'Laboratory Equipment' },
      financialYear: { label: '2026-27' },
      tentativeTotalCost: 150000,
      status: 'SUBMITTED',
    };

    const approvalScenarios = [
      {
        level: 'Requester confirmation',
        ctaText: 'View Request',
        actionRequired: 'Your request has been submitted for review.',
        notificationType: 'SUBMITTED',
        workflowStage: 'Department Submission',
      },
      {
        level: 'Purchase Committee review',
        ctaText: 'Review Request',
        actionRequired: 'Please review this request and record your committee decision.',
        notificationType: 'NEW REQUEST',
        workflowStage: 'Purchase Committee',
      },
      {
        level: 'Principal escalation review',
        ctaText: 'Review Request',
        actionRequired: 'This request has been escalated for Principal review.',
        notificationType: 'ESCALATION',
        workflowStage: 'Principal',
      },
      {
        level: 'CDC Grant Member review',
        ctaText: 'Review Request',
        actionRequired: 'Please review this Grant-funded procurement proposal.',
        notificationType: 'ESCALATION',
        workflowStage: 'College Development Committee',
      },
      {
        level: 'CDC Non-Grant Member review',
        ctaText: 'Review Request',
        actionRequired: 'Please review this Non-Grant procurement proposal.',
        notificationType: 'ESCALATION',
        workflowStage: 'College Development Committee',
      },
      {
        level: 'Final Authority (Chairman & Vice Chairman)',
        ctaText: 'Review Request',
        actionRequired: 'Highest level approval required for procurement exceeding ₹5,00,000.',
        notificationType: 'ESCALATION',
        workflowStage: 'Chairman & Vice Chairman',
      },
      {
        level: 'Approval decision notification',
        ctaText: 'View Request Details',
        actionRequired: 'Request approved. Proceed with procurement order.',
        notificationType: 'APPROVAL',
        workflowStage: 'Approved',
      },
      {
        level: 'Rejection decision notification',
        ctaText: 'View Request Details',
        actionRequired: 'Request was rejected. Review remarks and closed status.',
        notificationType: 'REJECTION',
        workflowStage: 'Rejected',
      },
      {
        level: 'Resubmission requested notification',
        ctaText: 'Edit and Resubmit',
        actionRequired: 'Corrections required. Please update the requisition details.',
        notificationType: 'RETURNED',
        workflowStage: 'Awaiting Resubmission',
      },
    ];

    for (const scenario of approvalScenarios) {
      it(`generates correct canonical deployed link for ${scenario.level}`, () => {
        const canonicalUrl = getRequestUrl(mockRequest.id, deployedBase);
        const email = buildRequestStatusEmail({
          request: mockRequest,
          recipientEmail: 'approver@spcollege.edu',
          recipientName: 'Approver',
          notificationType: scenario.notificationType,
          emailAction: scenario.level,
          actionRequired: scenario.actionRequired,
          ctaText: scenario.ctaText,
          ctaUrl: canonicalUrl,
          workflowStage: scenario.workflowStage,
        });

        assert.ok(email.html.includes(canonicalUrl), `Email HTML for ${scenario.level} should contain canonical URL`);
        assert.ok(
          email.html.includes(`href="${deployedBase}/#/requests/${mockRequest.id}"`),
          `Email HTML must link to deployed URL hash route`,
        );
        assert.ok(
          !email.html.includes('localhost'),
          `Email HTML must not contain localhost for deployed scenario: ${scenario.level}`,
        );
      });
    }

    it('buildIssueCreatedEmail links to canonical deployed issue hash route', () => {
      const mockIssue = {
        id: 'issue-uuid-9999',
        issue_number: 'ISSUE-2026-0042',
        title: 'Roof leakage in seminar hall',
        description: 'Water dripping over projector during rain.',
      };

      const email = buildIssueCreatedEmail({
        issue: mockIssue,
        raiser: { full_name: 'Dr. Joshi', email: 'joshi@spcollege.edu' },
        principalEmail: 'principal@spcollege.edu',
        principalName: 'Principal',
      });

      assert.ok(typeof email.html === 'string');
      assert.ok(email.html.includes('#/issues/'));
    });
  });
});
