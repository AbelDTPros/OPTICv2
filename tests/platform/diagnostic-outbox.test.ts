import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandlerMiddleware } from '../../src/middleware/error-handler.js';
import { forbidden } from '../../src/platform/errors/app-error.js';
import { InMemoryOutboxRepository } from '../../src/platform/outbox/in-memory-outbox.repository.js';
import { authHeaders, createTestRuntime } from '../helpers/test-app.js';

describe('diagnostic outbox events', () => {
  it('writes AUTHORIZATION_DENIED for 403 and SYSTEM_ERROR for unexpected 500s', async () => {
    const outbox = new InMemoryOutboxRepository();
    const app = express();
    app.get('/deny', (req, _res, next) => {
      req.actor = { actorId: 'officer@example.gov', roles: ['OFFICER'], correlationId: 'c-deny' };
      next(forbidden());
    });
    app.get('/boom', () => {
      throw new Error('secret-path');
    });
    app.use(errorHandlerMiddleware(outbox));

    const denied = await request(app).get('/deny');
    expect(denied.status).toBe(403);
    expect(outbox.events.some((event) => event.eventType === 'AUTHORIZATION_DENIED')).toBe(true);

    const boom = await request(app).get('/boom');
    expect(boom.status).toBe(500);
    const system = outbox.events.find((event) => event.eventType === 'SYSTEM_ERROR');
    expect(system?.correlationId).toBeDefined();
    expect(JSON.stringify(system?.payload)).not.toContain('secret-path');
  });

  it('does not write diagnostic events for 401 or 404', async () => {
    const runtime = createTestRuntime();
    const unauth = await request(runtime.app).post('/api/v1/config/definitions').send({
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    expect(unauth.status).toBe(401);
    const missing = await request(runtime.app).get('/api/v1/does-not-exist').set(authHeaders);
    expect(missing.status).toBe(404);
    expect(runtime.outbox.events.some((event) => event.eventType === 'AUTHORIZATION_DENIED')).toBe(false);
    expect(runtime.outbox.events.some((event) => event.eventType === 'SYSTEM_ERROR')).toBe(false);
  });
});
