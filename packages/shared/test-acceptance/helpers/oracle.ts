// Test-owned oracle for the permission matrix (C2) and canonical DTO examples (C3/C4).
export const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'REVIEWER', 'ANALYST', 'VIEWER', 'PLATFORM_DEV', 'SUPER_ADMIN'] as const;
export type Role = (typeof ROLES)[number];
export const EXPECTED: Record<Role, string[]> = {
  OWNER: ['claims:read', 'claims:assign', 'packets:edit', 'packets:approve', 'demands:send', 'users:read', 'users:manage', 'admins:manage', 'audit:read', 'settings:manage', 'integrations:manage', 'billing:manage', 'tenant:delete', 'import:run', 'import:review', 'export:claims', 'export:packets', 'export:outcomes', 'apikeys:manage'],
  ADMIN: ['claims:read', 'claims:assign', 'packets:edit', 'packets:approve', 'demands:send', 'users:read', 'users:manage', 'audit:read', 'settings:manage', 'integrations:manage', 'import:run', 'import:review', 'export:claims', 'export:packets', 'export:outcomes', 'apikeys:manage'],
  MANAGER: ['claims:read', 'claims:assign', 'packets:edit', 'packets:approve', 'demands:send', 'import:run', 'import:review', 'export:claims', 'export:packets', 'export:outcomes'],
  REVIEWER: ['claims:read', 'packets:edit', 'packets:approve', 'import:run', 'import:review', 'export:claims', 'export:packets', 'export:outcomes'],
  ANALYST: ['claims:read', 'import:run', 'export:claims'],
  VIEWER: ['claims:read'],
  PLATFORM_DEV: ['platform:health', 'platform:flags', 'platform:logs', 'platform:eval'],
  SUPER_ADMIN: ['platform:health', 'platform:tenants:list', 'platform:cross_tenant_read', 'platform:audit'],
};
export const ALL_PERMS = Array.from(new Set(Object.values(EXPECTED).flat())).sort();
export const RANK: Record<string, number> = { OWNER: 6, ADMIN: 5, MANAGER: 4, REVIEWER: 3, ANALYST: 2, VIEWER: 1 };

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const claimSummary = () => ({
  id: U(1), claimNumber: 'CLM-0001', loadNumber: 'LD-5001', invoiceNumber: 'INV-1001', carrierName: 'Acme Freight LLC', shipperName: 'Widget Co',
  perspective: 'SHIPPER', status: 'PENDING_REVIEW', amountClaimedCents: 47500, recoverableCents: 32500, pendingReviewCents: 15000, currency: 'USD',
  assignee: { id: U(2), name: 'Rita Reviewer' }, latestPacket: { revision: 1, status: 'PENDING_REVIEW' },
  createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z',
});
export const packet = () => ({
  id: U(3), claimId: U(1), revision: 1, status: 'PENDING_REVIEW', perspective: 'SHIPPER', loadNumber: 'LD-5001', generatedAt: '2026-10-01T10:00:00.000Z',
  disclaimer: 'Unverified.', demandLetter: 'Letter', currency: 'USD', recoverableCents: 32500, pendingReviewCents: 15000,
  timeline: [{ id: U(4), occurredAt: '2026-03-03T08:00:00.000Z', kind: 'APPOINTMENT', label: 'Appointment', sourceId: U(5) }],
  sources: [{ id: U(5), filename: 'invoice.txt', docType: 'INVOICE', sha256: 'a'.repeat(64), sizeBytes: 100 }],
  findings: [{ id: U(6), ruleId: 'INV-LINEHAUL-RATE', title: 'Linehaul', direction: 'OVERCHARGE', amountCents: 10000, explanation: 'x', calculation: ['a', 'b'], confidence: 0.95, needsHumanReview: false,
    citations: [{ sourceId: U(5), locator: 'line 1', excerpt: 'x' }], governingClause: { sourceId: U(5), label: 'Clause', excerpt: 'x', locator: 'p1' } }],
  verifier: { status: 'NOT_RUN', checkedAt: null, note: null },
  integrity: { contentHash: 'c'.repeat(64), recomputedHash: 'c'.repeat(64), valid: true },
  approvals: [{ id: U(7), action: 'APPROVE', reason: 'Checked everything', packetRevision: 1, fromStatus: 'PENDING_REVIEW', toStatus: 'APPROVED', actor: { id: U(2), name: 'Rita', role: 'REVIEWER' }, createdAt: '2026-10-03T10:00:00.000Z' }],
  createdAt: '2026-10-01T10:00:00.000Z', createdBy: { id: U(2), name: 'Rita' },
});
export const auditEvent = () => ({
  seq: 1, id: U(8), actor: { id: U(2), role: 'OWNER' }, action: 'auth.login.success', targetType: 'user', targetId: U(2), metadata: {}, ip: '10.0.0.1', requestId: 'req-1',
  createdAt: '2026-10-01T10:00:00.000Z', prevHash: '0'.repeat(64), hash: 'f'.repeat(64),
});