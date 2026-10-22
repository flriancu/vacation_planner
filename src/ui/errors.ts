import { UnsupportedPlanError } from '../domain/migrate';
import { AuthExpiredError } from '../google/auth';
import { DriveError, PlanFileGoneError } from '../google/drive';
import type { MessageKey } from '../i18n';
import { OtherOwnerError, PlanMissingError, PlanRemovedError, SaveConflictError } from '../sync/DocumentSync';

/** What went wrong, in the user's words (the technical text goes under "Technical details"). */
export function errorMessage(e: unknown): MessageKey {
  if (e instanceof AuthExpiredError) return 'err.auth';
  if (e instanceof PlanRemovedError) return 'err.removed';
  if (e instanceof PlanMissingError) return 'err.missingCopy';
  if (e instanceof PlanFileGoneError) return e.reason === 'trashed' ? 'err.removed' : 'err.missing';
  if (e instanceof OtherOwnerError) return 'err.owner';
  if (e instanceof UnsupportedPlanError) {
    return ({ json: 'err.json', notPlan: 'err.notPlan', version: 'err.version', tooBig: 'err.fileTooBig' } as const)[e.reason];
  }
  if (e instanceof SaveConflictError) return 'err.conflict';
  if (e instanceof DriveError) {
    if (e.status === 0) return 'err.network';
    if (e.rateLimited) return 'err.google';
    if (e.status === 403) return 'err.forbidden';
    if (e.status === 413) return 'err.tooBig';
    if (e.status === 404) return 'err.missing';
    return 'err.google';
  }
  return 'err.generic';
}

export function errorDetail(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
