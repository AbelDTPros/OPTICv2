import { AppError, conflict, validationFailed } from '../../../platform/errors/app-error.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { AuthorizationPort } from '../../../platform/security/authorization-port.js';
import { mintTrackingIdValue } from '../domain/mint-tracking-id.js';
import type { TrackingIdRecord } from '../domain/types.js';
import type { TrackingRepository } from '../persistence/tracking.repository.js';

const ISSUED_TYPES = new Set(['MAIL', 'WORKLOAD']);
const MAX_MINT_ATTEMPTS = 8;

export class TrackingService {
  constructor(
    private readonly tracking: TrackingRepository,
    private readonly authorization: AuthorizationPort
  ) {}

  async mint(actor: ActorContext, entityType: string): Promise<TrackingIdRecord> {
    await this.authorization.assertCanCreateWorkflow(actor);
    const normalized = entityType.trim().toUpperCase();
    if (!ISSUED_TYPES.has(normalized)) {
      throw validationFailed('OPTIC-WF-40094', 'Tracking ids are issued for MAIL or WORKLOAD.', [
        { field: 'entityType', path: 'entityType', message: 'Must be MAIL or WORKLOAD.' }
      ]);
    }

    let lastConflict: AppError | undefined;
    for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt += 1) {
      const trackingId = mintTrackingIdValue(normalized);
      try {
        return await this.tracking.issue(normalized, trackingId, actor.actorId);
      } catch (error) {
        if (error instanceof AppError && error.errorCode === 'OPTIC-WF-40910') {
          lastConflict = error;
          continue;
        }
        throw error;
      }
    }

    throw (
      lastConflict ??
      conflict('OPTIC-WF-40911', 'Could not mint a unique tracking id after several attempts.')
    );
  }
}
