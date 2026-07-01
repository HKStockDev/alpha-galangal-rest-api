/** CON-101: returns a user-facing block reason, or null if removal is allowed. */
export function getRemoveMembershipBlockReason(params: {
  actingUserId: string;
  targetUserId: string;
  targetStatus: string;
  targetRole: string;
  otherActiveAdminCount: number;
}): string | null {
  if (params.targetUserId === params.actingUserId) {
    return 'You cannot remove yourself from the organization';
  }

  if (params.targetStatus === 'disabled') {
    return null;
  }

  if (params.targetRole === 'org_admin' && params.otherActiveAdminCount < 1) {
    return 'Cannot remove the last organization admin';
  }

  return null;
}
