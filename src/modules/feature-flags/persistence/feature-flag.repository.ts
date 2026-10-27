import type { QueryExecutor } from '../../../platform/db/types.js';
import type { FeatureFlagKey } from '../domain/catalog.js';
import type { FeatureFlagRecord, FeatureFlagUpdateInput } from '../domain/types.js';

export interface FeatureFlagRepository {
  listAll(executor?: QueryExecutor): Promise<FeatureFlagRecord[]>;
  findByKey(key: FeatureFlagKey, executor?: QueryExecutor): Promise<FeatureFlagRecord | null>;
  upsert(input: FeatureFlagUpdateInput, executor?: QueryExecutor): Promise<FeatureFlagRecord>;
}
