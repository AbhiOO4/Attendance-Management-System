/**
 * A site is a valid assignment/transfer destination only when it exists and is
 * live: not soft-deleted, active, and not marked completed. Centralised here so
 * every path that moves an employee or supervisor onto a site agrees on the rule
 * (deferred add, cross-site transfer, scheduled-assignment cron, and the
 * supervisor reassignment flow).
 */
export function isAssignableSite(site) {
  return !!site && !site.isDeleted && site.isActive === true && !site.isCompleted;
}
