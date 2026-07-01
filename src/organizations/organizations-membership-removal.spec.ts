import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getRemoveMembershipBlockReason } from './organizations-membership-removal';

describe('getRemoveMembershipBlockReason (CON-101)', () => {
  it('blocks self-removal', () => {
    const reason = getRemoveMembershipBlockReason({
      actingUserId: 'user-a',
      targetUserId: 'user-a',
      targetStatus: 'active',
      targetRole: 'org_admin',
      otherActiveAdminCount: 2,
    });
    assert.equal(reason, 'You cannot remove yourself from the organization');
  });

  it('blocks removing the last org admin', () => {
    const reason = getRemoveMembershipBlockReason({
      actingUserId: 'user-a',
      targetUserId: 'user-b',
      targetStatus: 'active',
      targetRole: 'org_admin',
      otherActiveAdminCount: 0,
    });
    assert.equal(reason, 'Cannot remove the last organization admin');
  });

  it('allows removing a member when another admin exists', () => {
    const reason = getRemoveMembershipBlockReason({
      actingUserId: 'user-a',
      targetUserId: 'user-b',
      targetStatus: 'active',
      targetRole: 'org_admin',
      otherActiveAdminCount: 1,
    });
    assert.equal(reason, null);
  });

  it('allows removing a non-admin member', () => {
    const reason = getRemoveMembershipBlockReason({
      actingUserId: 'user-a',
      targetUserId: 'user-c',
      targetStatus: 'active',
      targetRole: 'org_member',
      otherActiveAdminCount: 0,
    });
    assert.equal(reason, null);
  });

  it('allows idempotent remove when already disabled', () => {
    const reason = getRemoveMembershipBlockReason({
      actingUserId: 'user-a',
      targetUserId: 'user-b',
      targetStatus: 'disabled',
      targetRole: 'org_admin',
      otherActiveAdminCount: 0,
    });
    assert.equal(reason, null);
  });
});
