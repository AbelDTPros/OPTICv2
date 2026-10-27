import { conflict } from '../../../platform/errors/app-error.js';
import type { QueryExecutor } from '../../../platform/db/types.js';
import { FEATURE_FLAG_CATALOG, type FeatureFlagKey } from '../domain/catalog.js';
import type { FeatureFlagRecord, FeatureFlagUpdateInput } from '../domain/types.js';
import type { FeatureFlagRepository } from './feature-flag.repository.js';

export class InMemoryFeatureFlagRepository implements FeatureFlagRepository {
  private readonly flags = new Map<FeatureFlagKey, FeatureFlagRecord>();

  constructor() {
    const now = new Date();
    for (const entry of FEATURE_FLAG_CATALOG) {
      this.flags.set(entry.key, {
        key: entry.key,
        label: entry.label,
        enabled: entry.defaultEnabled,
        description: entry.description,
        rowVersion: 1,
        updatedAt: now,
        updatedBy: 'system',
        group: entry.group
      });
    }
  }

  async listAll(_executor?: QueryExecutor): Promise<FeatureFlagRecord[]> {
    return FEATURE_FLAG_CATALOG.map((entry) => {
      const row = this.flags.get(entry.key);
      if (!row) {
        throw new Error(`Missing seeded feature flag ${entry.key}`);
      }
      return { ...row, label: entry.label, description: entry.description, group: entry.group };
    });
  }

  async findByKey(key: FeatureFlagKey, _executor?: QueryExecutor): Promise<FeatureFlagRecord | null> {
    const row = this.flags.get(key);
    return row ? { ...row } : null;
  }

  async upsert(input: FeatureFlagUpdateInput, _executor?: QueryExecutor): Promise<FeatureFlagRecord> {
    const current = this.flags.get(input.key);
    if (!current) {
      throw new Error(`Unknown feature flag ${input.key}`);
    }
    if (current.rowVersion !== input.expectedRowVersion) {
      throw conflict(
        'OPTIC-FEATURE-40901',
        `Feature flag ${input.key} was updated by another request.`,
        [{ field: 'expectedRowVersion', path: 'expectedRowVersion', message: 'Row version mismatch.' }]
      );
    }
    const next: FeatureFlagRecord = {
      ...current,
      enabled: input.enabled,
      rowVersion: current.rowVersion + 1,
      updatedAt: new Date(),
      updatedBy: input.actorId
    };
    this.flags.set(input.key, next);
    return { ...next };
  }
}
