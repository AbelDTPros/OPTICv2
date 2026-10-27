import type { FeatureFlagKey } from './catalog.js';

export interface FeatureFlagRecord {
  key: FeatureFlagKey;
  label: string;
  enabled: boolean;
  description: string;
  rowVersion: number;
  updatedAt: Date;
  updatedBy: string;
  group: 'shell' | 'workspace' | 'designer' | 'api';
}

export interface FeatureFlagUpdateInput {
  key: FeatureFlagKey;
  enabled: boolean;
  expectedRowVersion: number;
  actorId: string;
}
