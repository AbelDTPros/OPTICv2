import type { ActorContext } from '../platform/security/actor.js';

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      actor?: ActorContext;
    }
  }
}

export {};
