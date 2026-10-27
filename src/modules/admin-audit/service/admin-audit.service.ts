import type {
  AuditEventRecord,
  AuditEventRepository,
  AuditFilterOptions,
  AuditListQuery,
  AuditListResult
} from '../../../platform/audit/audit-event.repository.js';
import { forbidden, notFound, validationFailed } from '../../../platform/errors/app-error.js';
import type { ActorContext } from '../../../platform/security/actor.js';
import type { AuthorizationPort } from '../../../platform/security/authorization-port.js';

export interface AdminAuditGates {
  uiEnabled: boolean;
  apiEnabled: boolean;
}

export class AdminAuditService {
  constructor(
    private readonly audit: AuditEventRepository,
    private readonly authorization: AuthorizationPort,
    private readonly adminGates: AdminAuditGates
  ) {}

  getAdminGates(): AdminAuditGates {
    return { ...this.adminGates };
  }

  async list(
    actor: ActorContext,
    query: Omit<AuditListQuery, 'includeEventData'>
  ): Promise<AuditListResult> {
    this.assertAdminApiEnabled();
    await this.authorization.assertCanReadAudit(actor);
    return this.audit.listAdmin({ ...query, includeEventData: false });
  }

  async getByEventId(actor: ActorContext, eventId: string): Promise<AuditEventRecord> {
    this.assertAdminApiEnabled();
    await this.authorization.assertCanReadAudit(actor);
    if (!eventId.trim()) {
      throw validationFailed('OPTIC-AUDIT-40001', 'eventId is required.', [
        { field: 'eventId', path: 'eventId', message: 'Required.' }
      ]);
    }
    const found = await this.audit.findByEventId(eventId.trim());
    if (!found) {
      throw notFound('OPTIC-AUDIT-40401', `Audit event ${eventId} was not found.`);
    }
    return found;
  }

  async filterOptions(actor: ActorContext): Promise<AuditFilterOptions> {
    this.assertAdminApiEnabled();
    await this.authorization.assertCanReadAudit(actor);
    return this.audit.listAdminFilterOptions();
  }

  private assertAdminApiEnabled(): void {
    if (!this.adminGates.apiEnabled) {
      throw forbidden('Feature admin API is disabled in this environment.', 'OPTIC-FEATURE-40302');
    }
  }
}
