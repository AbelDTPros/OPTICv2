import type { QueryExecutor } from '../../../platform/db/types.js';
import { forbidden, notFound, validationFailed } from '../../../platform/errors/app-error.js';
import { createFeatureFlagOutboxEvent } from '../../../platform/outbox/feature-flag-events.js';
import type { OutboxRepository } from '../../../platform/outbox/outbox.repository.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { AuthorizationPort } from '../../../platform/security/authorization-port.js';
import {
  FEATURE_FLAG_CATALOG,
  isFeatureFlagKey,
  type FeatureFlagKey
} from '../domain/catalog.js';
import type { FeatureFlagRecord } from '../domain/types.js';
import type { FeatureFlagRepository } from '../persistence/feature-flag.repository.js';

export interface FeatureAdminGates {
  uiEnabled: boolean;
  apiEnabled: boolean;
}

export class FeatureFlagService {
  constructor(
    private readonly repository: FeatureFlagRepository,
    private readonly authorization: AuthorizationPort,
    private readonly runInTransaction: <T>(work: (executor?: QueryExecutor) => Promise<T>) => Promise<T>,
    private readonly outbox: OutboxRepository,
    private readonly adminGates: FeatureAdminGates
  ) {}

  getAdminGates(): FeatureAdminGates {
    return { ...this.adminGates };
  }

  async listEffective(actor: ActorContext): Promise<{
    flags: Record<FeatureFlagKey, boolean>;
    admin: FeatureAdminGates;
  }> {
    await this.authorization.assertCanReadFeatureFlags(actor);
    const rows = await this.repository.listAll();
    const flags = Object.fromEntries(rows.map((row) => [row.key, row.enabled])) as Record<
      FeatureFlagKey,
      boolean
    >;
    for (const entry of FEATURE_FLAG_CATALOG) {
      if (flags[entry.key] === undefined) {
        flags[entry.key] = entry.defaultEnabled;
      }
    }
    return { flags, admin: this.getAdminGates() };
  }

  async listAdmin(actor: ActorContext): Promise<FeatureFlagRecord[]> {
    this.assertAdminApiEnabled();
    await this.authorization.assertCanManageFeatureFlags(actor);
    return this.repository.listAll();
  }

  async isEnabled(key: FeatureFlagKey): Promise<boolean> {
    const row = await this.repository.findByKey(key);
    if (!row) {
      const entry = FEATURE_FLAG_CATALOG.find((item) => item.key === key);
      return entry?.defaultEnabled ?? false;
    }
    return row.enabled;
  }

  async assertEnabled(key: FeatureFlagKey): Promise<void> {
    if (!(await this.isEnabled(key))) {
      throw forbidden(`Feature ${key} is disabled.`, 'OPTIC-FEATURE-40301');
    }
  }

  async update(
    actor: ActorContext,
    input: { key: string; enabled: boolean; expectedRowVersion: number }
  ): Promise<FeatureFlagRecord> {
    this.assertAdminApiEnabled();
    await this.authorization.assertCanManageFeatureFlags(actor);
    if (!isFeatureFlagKey(input.key)) {
      throw notFound('OPTIC-FEATURE-40401', `Unknown feature flag ${input.key}.`);
    }
    const flagKey: FeatureFlagKey = input.key;
    if (!Number.isInteger(input.expectedRowVersion) || input.expectedRowVersion < 1) {
      throw validationFailed('OPTIC-FEATURE-40001', 'expectedRowVersion must be a positive integer.', [
        { field: 'expectedRowVersion', path: 'expectedRowVersion', message: 'Must be a positive integer.' }
      ]);
    }

    return this.runInTransaction(async (executor) => {
      const previous = await this.repository.findByKey(flagKey, executor);
      const previousEnabled = previous?.enabled ?? true;
      const updated = await this.repository.upsert(
        {
          key: flagKey,
          enabled: input.enabled,
          expectedRowVersion: input.expectedRowVersion,
          actorId: actor.actorId
        },
        executor
      );
      await this.outbox.append(
        createFeatureFlagOutboxEvent({
          actor,
          flagKey,
          enabled: updated.enabled,
          previousEnabled
        }),
        executor
      );
      return updated;
    });
  }

  private assertAdminApiEnabled(): void {
    if (!this.adminGates.apiEnabled) {
      throw forbidden('Feature admin API is disabled in this environment.', 'OPTIC-FEATURE-40302');
    }
  }
}
