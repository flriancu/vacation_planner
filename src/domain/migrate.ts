import { COLLECTION_KEYS, SCHEMA_VERSION, type PlanDoc } from './schema';

export class UnsupportedPlanError extends Error {}

/**
 * Checks a plan file read from storage and brings it to the current schema (§6.4 of the
 * requirements). v1 is the only version so far: this only fills in missing collections,
 * so a file written by an older build still loads.
 */
export function migrate(raw: unknown): PlanDoc {
  if (typeof raw !== 'object' || raw === null) throw new UnsupportedPlanError('The plan file is not a JSON object.');
  const doc = raw as Partial<PlanDoc> & { schemaVersion?: unknown };
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    throw new UnsupportedPlanError(
      `The plan file has schema version ${String(doc.schemaVersion)}; this app reads version ${SCHEMA_VERSION}.`,
    );
  }
  if (!doc.owner || !doc.settings) throw new UnsupportedPlanError('The plan file is missing its owner or settings.');
  const out = { ...doc } as PlanDoc;
  for (const key of COLLECTION_KEYS) (out as Record<string, unknown>)[key] ??= {};
  return out;
}
