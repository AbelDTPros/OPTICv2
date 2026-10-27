export interface ActorContext {
  actorId: string;
  actorName?: string;
  actorType?: 'USER' | 'SYSTEM';
  sessionId?: string;
  roles: string[];
  correlationId?: string;
}

export function schedulerActor(correlationId?: string): ActorContext {
  return {
    actorId: 'scheduler',
    actorName: 'Scheduler worker',
    actorType: 'SYSTEM',
    roles: ['SYSTEM'],
    correlationId: correlationId ?? `c-sched-${crypto.randomUUID()}`
  };
}
