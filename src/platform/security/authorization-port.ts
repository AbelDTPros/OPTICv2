import { forbidden } from '../errors/app-error.js';
import type { ActorContext } from './actor.js';

export interface AuthorizationPort {
  assertCanReadConfiguration(actor: ActorContext): Promise<void>;
  assertCanMutateConfiguration(actor: ActorContext): Promise<void>;
  assertCanSubmitConfiguration(actor: ActorContext): Promise<void>;
  assertCanApproveConfiguration(actor: ActorContext): Promise<void>;
  assertCanPublishConfiguration(actor: ActorContext): Promise<void>;
  assertCanActivateConfiguration(actor: ActorContext): Promise<void>;
  assertCanReadWorkflow(actor: ActorContext): Promise<void>;
  assertCanCreateWorkflow(actor: ActorContext): Promise<void>;
  assertCanReadQueue(actor: ActorContext): Promise<void>;
  assertCanAssignFromQueue(actor: ActorContext, queueKey: string): Promise<void>;
  assertCanReleaseFromQueue(actor: ActorContext, queueKey: string): Promise<void>;
  assertCanReassignWorkflow(actor: ActorContext): Promise<void>;
  canReassignWorkflow(actor: ActorContext): Promise<boolean>;
  assertCanExecuteBulkAction(actor: ActorContext, bulkActionKey: string): Promise<void>;
  assertCanReadBulkOperation(actor: ActorContext): Promise<void>;
  canAccessQueue(actor: ActorContext, queueKey: string): Promise<boolean>;
  canExecuteBulkAction(actor: ActorContext, bulkActionKey: string): Promise<boolean>;
  assertCanReadFeatureFlags(actor: ActorContext): Promise<void>;
  assertCanManageFeatureFlags(actor: ActorContext): Promise<void>;
  assertCanReadAudit(actor: ActorContext): Promise<void>;
  assertCanReadSupervisorDashboard(actor: ActorContext): Promise<void>;
}

const SUPERVISOR_ROLES = new Set(['SUPERVISOR', 'ADMIN']);
const FEATURE_ADMIN_ROLES = new Set(['ADMIN']);

export class AuthenticatedActorAuthorization implements AuthorizationPort {
  async assertCanReadConfiguration(actor: ActorContext): Promise<void> {
    if (!actor.actorId) {
      throw forbidden('Configuration read requires an authenticated actor.');
    }
  }

  async assertCanMutateConfiguration(actor: ActorContext): Promise<void> {
    if (!actor.actorId) {
      throw forbidden('Configuration changes require an authenticated actor.');
    }
  }

  async assertCanSubmitConfiguration(actor: ActorContext): Promise<void> {
    await this.assertCanMutateConfiguration(actor);
  }

  async assertCanApproveConfiguration(actor: ActorContext): Promise<void> {
    await this.assertCanMutateConfiguration(actor);
  }

  async assertCanPublishConfiguration(actor: ActorContext): Promise<void> {
    await this.assertCanMutateConfiguration(actor);
  }

  async assertCanActivateConfiguration(actor: ActorContext): Promise<void> {
    await this.assertCanMutateConfiguration(actor);
  }

  async assertCanReadWorkflow(actor: ActorContext): Promise<void> {
    if (!actor.actorId) {
      throw forbidden('Workflow read requires an authenticated actor.');
    }
  }

  async assertCanCreateWorkflow(actor: ActorContext): Promise<void> {
    if (!actor.actorId) {
      throw forbidden('Workflow changes require an authenticated actor.');
    }
  }

  async assertCanReadQueue(actor: ActorContext): Promise<void> {
    if (!actor.actorId) {
      throw forbidden('Queue read requires an authenticated actor.');
    }
  }

  async assertCanAssignFromQueue(actor: ActorContext, _queueKey: string): Promise<void> {
    if (!actor.actorId) {
      throw forbidden('Queue assignment requires an authenticated actor.');
    }
  }

  async assertCanReleaseFromQueue(actor: ActorContext, _queueKey: string): Promise<void> {
    if (!actor.actorId) {
      throw forbidden('Queue release requires an authenticated actor.');
    }
  }

  async assertCanReassignWorkflow(actor: ActorContext): Promise<void> {
    if (!(await this.canReassignWorkflow(actor))) {
      throw forbidden(
        'Supervisor reassignment requires a SUPERVISOR or ADMIN role.',
        'OPTIC-AUTHZ-40303'
      );
    }
  }

  async canReassignWorkflow(actor: ActorContext): Promise<boolean> {
    return Boolean(actor.actorId) && actor.roles.some((role) => SUPERVISOR_ROLES.has(role.toUpperCase()));
  }

  async canAccessQueue(actor: ActorContext, _queueKey: string): Promise<boolean> {
    return Boolean(actor.actorId);
  }

  async assertCanExecuteBulkAction(actor: ActorContext, _bulkActionKey: string): Promise<void> {
    if (!actor.actorId) {
      throw forbidden('Bulk actions require an authenticated actor.');
    }
  }

  async assertCanReadBulkOperation(actor: ActorContext): Promise<void> {
    if (!actor.actorId) {
      throw forbidden('Bulk operation read requires an authenticated actor.');
    }
  }

  async canExecuteBulkAction(actor: ActorContext, _bulkActionKey: string): Promise<boolean> {
    return Boolean(actor.actorId);
  }

  async assertCanReadFeatureFlags(actor: ActorContext): Promise<void> {
    if (!actor.actorId) {
      throw forbidden('Feature flag read requires an authenticated actor.');
    }
  }

  async assertCanManageFeatureFlags(actor: ActorContext): Promise<void> {
    if (!actor.actorId || !actor.roles.some((role) => FEATURE_ADMIN_ROLES.has(role.toUpperCase()))) {
      throw forbidden(
        'Feature flag administration requires an ADMIN role.',
        'OPTIC-AUTHZ-40304'
      );
    }
  }

  async assertCanReadAudit(actor: ActorContext): Promise<void> {
    if (!actor.actorId || !actor.roles.some((role) => FEATURE_ADMIN_ROLES.has(role.toUpperCase()))) {
      throw forbidden('Audit trail read requires an ADMIN role.', 'OPTIC-AUTHZ-40305');
    }
  }

  async assertCanReadSupervisorDashboard(actor: ActorContext): Promise<void> {
    if (!actor.actorId || !actor.roles.some((role) => SUPERVISOR_ROLES.has(role.toUpperCase()))) {
      throw forbidden(
        'Supervisor dashboard requires a SUPERVISOR or ADMIN role.',
        'OPTIC-AUTHZ-40306'
      );
    }
  }
}
