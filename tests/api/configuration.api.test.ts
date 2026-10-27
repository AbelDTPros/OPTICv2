import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { i407Workflow } from '../fixtures/i407-draft.js';
import { authHeaders, createTestRuntime } from '../helpers/test-app.js';

describe('configuration APIs', () => {
  it('rejects unauthenticated mutations', async () => {
    const { app } = createTestRuntime();
    const response = await request(app).post('/api/v1/config/definitions').send({
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    expect(response.status).toBe(401);
    expect(response.body.error.errorCode).toBe('OPTIC-AUTH-40101');
    expect(response.body.meta.correlationId).toBeDefined();
  });

  it('creates a draft definition through the public contract', async () => {
    const { app } = createTestRuntime();
    const created = await request(app)
      .post('/api/v1/config/definitions')
      .set(authHeaders)
      .send({
        definitionKey: 'I_407',
        displayName: 'I-407',
        entityType: 'WORKLOAD'
      });
    expect(created.status).toBe(201);

    const release = await request(app)
      .post('/api/v1/config/definitions/I_407/releases')
      .set(authHeaders)
      .send({ version: '0.1.0' });
    expect(release.status).toBe(201);
    expect(release.body.data.lifecycleStatus).toBe('DRAFT');

    const saved = await request(app)
      .put('/api/v1/config/definitions/I_407/releases/0.1.0/workflow')
      .set(authHeaders)
      .send({
        expectedRowVersion: 0,
        workflow: i407Workflow
      });
    expect(saved.status).toBe(200);
    expect(saved.body.data.workflow.stages).toHaveLength(5);

    const loaded = await request(app)
      .get('/api/v1/config/definitions/I_407/releases/0.1.0')
      .set(authHeaders);
    expect(loaded.status).toBe(200);
    expect(loaded.body.data.workflow.initialStageKey).toBe('DOCUMENT_PREP');
  });

  it('lists saved releases for the designer open picker', async () => {
    const { app } = createTestRuntime();
    await request(app).post('/api/v1/config/definitions').set(authHeaders).send({
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await request(app)
      .post('/api/v1/config/definitions/I_407/releases')
      .set(authHeaders)
      .send({ version: '0.1.0' });
    await request(app).post('/api/v1/config/definitions').set(authHeaders).send({
      definitionKey: 'I_DESIGN',
      displayName: 'Designer demo',
      entityType: 'WORKLOAD'
    });
    await request(app)
      .post('/api/v1/config/definitions/I_DESIGN/releases')
      .set(authHeaders)
      .send({ version: '0.1.0' });

    const listed = await request(app).get('/api/v1/config/releases').set(authHeaders);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([
      {
        definitionKey: 'I_407',
        displayName: 'I-407',
        entityType: 'WORKLOAD',
        version: '0.1.0',
        lifecycleStatus: 'DRAFT',
        active: false
      },
      {
        definitionKey: 'I_DESIGN',
        displayName: 'Designer demo',
        entityType: 'WORKLOAD',
        version: '0.1.0',
        lifecycleStatus: 'DRAFT',
        active: false
      }
    ]);
  });

  it('clones a saved release onto a new definition key', async () => {
    const { app } = createTestRuntime();
    await request(app).post('/api/v1/config/definitions').set(authHeaders).send({
      definitionKey: 'I_90',
      displayName: 'I-90',
      entityType: 'WORKLOAD'
    });
    await request(app)
      .post('/api/v1/config/definitions/I_90/releases')
      .set(authHeaders)
      .send({ version: '1.0.0' });
    await request(app)
      .put('/api/v1/config/definitions/I_90/releases/1.0.0/workflow')
      .set(authHeaders)
      .send({ expectedRowVersion: 0, workflow: i407Workflow });
    await request(app).post('/api/v1/config/definitions').set(authHeaders).send({
      definitionKey: 'I_131',
      displayName: 'I-131 Travel',
      entityType: 'WORKLOAD'
    });

    const cloned = await request(app)
      .post('/api/v1/config/definitions/I_131/releases')
      .set(authHeaders)
      .send({
        version: '1.0.0',
        cloneFromDefinitionKey: 'I_90',
        cloneFromVersion: '1.0.0'
      });
    expect(cloned.status).toBe(201);
    expect(cloned.body.data.definitionKey).toBe('I_131');
    expect(cloned.body.data.displayName).toBe('I-131 Travel');
    expect(cloned.body.data.lifecycleStatus).toBe('DRAFT');
    expect(cloned.body.data.workflow.stages).toHaveLength(5);
  });

  it('returns live health without authentication', async () => {
    const { app } = createTestRuntime();
    const response = await request(app).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('returns an accessible error envelope for unknown routes', async () => {
    const { app } = createTestRuntime();
    const response = await request(app).get('/api/v1/does-not-exist').set(authHeaders);
    expect(response.status).toBe(404);
    expect(response.body.error.errorCode).toBe('OPTIC-SYS-40401');
    expect(response.body.error.summary).toBeDefined();
    expect(response.body.error.referenceId).toMatch(/^OPTIC-/);
    expect(response.body.meta.correlationId).toBeDefined();
  });

  it('rejects a form that would produce an inaccessible UI', async () => {
    const { app } = createTestRuntime();
    await request(app).post('/api/v1/config/definitions').set(authHeaders).send({
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await request(app)
      .post('/api/v1/config/definitions/I_407/releases')
      .set(authHeaders)
      .send({ version: '0.1.0' });

    const response = await request(app)
      .put('/api/v1/config/definitions/I_407/releases/0.1.0/forms/I407_DATA_ENTRY')
      .set(authHeaders)
      .send({
        expectedRowVersion: 0,
        payload: {
          formKey: 'I407_DATA_ENTRY',
          dataPath: '$.dataEntryDetails',
          title: 'Data Entry',
          sections: [
            {
              sectionKey: 'APPLICANT',
              title: 'Applicant Information',
              fields: [
                {
                  fieldKey: 'A_NUMBER',
                  path: '$.ANumber',
                  component: 'A_NUMBER_INPUT',
                  label: ''
                }
              ]
            }
          ]
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.error.errorCode).toBe('OPTIC-CONFIG-40010');
    expect(response.body.error.details[0].inputId).toBe('field-A_NUMBER');
  });

  it('persists form behavior checkbox effects on save and reload', async () => {
    const { app } = createTestRuntime();
    await request(app).post('/api/v1/config/definitions').set(authHeaders).send({
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await request(app)
      .post('/api/v1/config/definitions/I_407/releases')
      .set(authHeaders)
      .send({ version: '0.1.0' });

    const saved = await request(app)
      .put('/api/v1/config/definitions/I_407/releases/0.1.0/forms/I407_DATA_ENTRY')
      .set(authHeaders)
      .send({
        expectedRowVersion: 0,
        payload: {
          formKey: 'I407_DATA_ENTRY',
          dataPath: '$.dataEntryDetails',
          title: 'Data Entry',
          sections: [
            {
              sectionKey: 'APPLICANT',
              title: 'Applicant Information',
              fields: [
                {
                  fieldKey: 'NOTES',
                  path: '$.notes',
                  component: 'TEXT_INPUT',
                  label: 'Notes'
                }
              ]
            }
          ],
          behaviors: [
            {
              behaviorKey: 'REQUIRE_NOTES',
              when: { path: '$.country', operator: 'EQUALS', value: 'US' },
              effects: [{ fieldKey: 'NOTES', visible: true, required: true, readOnly: false }]
            }
          ]
        }
      });
    expect(saved.status).toBe(200);
    expect(saved.body.data.forms.I407_DATA_ENTRY.behaviors[0].effects[0]).toEqual({
      fieldKey: 'NOTES',
      visible: true,
      required: true,
      readOnly: false
    });

    const loaded = await request(app)
      .get('/api/v1/config/definitions/I_407/releases/0.1.0')
      .set(authHeaders);
    expect(loaded.status).toBe(200);
    expect(loaded.body.data.forms.I407_DATA_ENTRY.behaviors[0].effects[0]).toEqual({
      fieldKey: 'NOTES',
      visible: true,
      required: true,
      readOnly: false
    });
  });

  it('deletes a saved draft form', async () => {
    const { app } = createTestRuntime();
    await request(app).post('/api/v1/config/definitions').set(authHeaders).send({
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    await request(app)
      .post('/api/v1/config/definitions/I_407/releases')
      .set(authHeaders)
      .send({ version: '0.1.0' });
    const created = await request(app)
      .put('/api/v1/config/definitions/I_407/releases/0.1.0/forms/I407_DATA_ENTRY')
      .set(authHeaders)
      .send({
        expectedRowVersion: 0,
        payload: {
          formKey: 'I407_DATA_ENTRY',
          dataPath: '$.dataEntryDetails',
          title: 'Data Entry',
          sections: [
            {
              sectionKey: 'APPLICANT',
              title: 'Applicant Information',
              fields: [{ fieldKey: 'NOTES', path: '$.notes', component: 'TEXT_INPUT', label: 'Notes' }]
            }
          ]
        }
      });
    expect(created.status).toBe(200);

    const deleted = await request(app)
      .delete('/api/v1/config/definitions/I_407/releases/0.1.0/forms/I407_DATA_ENTRY')
      .set(authHeaders)
      .send({ expectedRowVersion: created.body.data.rowVersion });
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.forms.I407_DATA_ENTRY).toBeUndefined();

    const missing = await request(app)
      .delete('/api/v1/config/definitions/I_407/releases/0.1.0/forms/I407_DATA_ENTRY')
      .set(authHeaders)
      .send({ expectedRowVersion: deleted.body.data.rowVersion });
    expect(missing.status).toBe(404);
    expect(missing.body.error.errorCode).toBe('OPTIC-CONFIG-40403');
  });

  it('compiles an empty draft and rejects a graph with dangling references', async () => {
    const { app } = createTestRuntime();
    await request(app).post('/api/v1/config/definitions').set(authHeaders).send({
      definitionKey: 'I_90',
      displayName: 'I-90',
      entityType: 'WORKLOAD'
    });
    await request(app)
      .post('/api/v1/config/definitions/I_90/releases')
      .set(authHeaders)
      .send({ version: '0.1.0' });

    const empty = await request(app)
      .get('/api/v1/config/definitions/I_90/releases/0.1.0/compiled')
      .set(authHeaders);
    expect(empty.status).toBe(200);
    expect(empty.body.data.cacheHit).toBe(false);
    expect(empty.body.data.schemaCompiled).toBe(false);

    await request(app)
      .put('/api/v1/config/definitions/I_90/releases/0.1.0/workflow')
      .set(authHeaders)
      .send({
        expectedRowVersion: 0,
        workflow: {
          initialStageKey: 'READY_FOR_DATA_ENTRY',
          terminalStageKeys: ['COMPLETED'],
          stages: [
            {
              stageKey: 'READY_FOR_DATA_ENTRY',
              displayName: 'Ready for Data Entry',
              order: 10,
              formKey: 'MISSING_FORM',
              actionKeys: [],
              assignmentPolicy: { required: true, clearOnTransition: true }
            },
            {
              stageKey: 'COMPLETED',
              displayName: 'Completed',
              order: 999,
              terminal: true,
              actionKeys: [],
              assignmentPolicy: { required: false, clearOnTransition: false }
            }
          ],
          transitionSets: []
        }
      });

    const invalid = await request(app)
      .get('/api/v1/config/definitions/I_90/releases/0.1.0/compiled')
      .set(authHeaders);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.errorCode).toBe('OPTIC-CONFIG-40020');
  });

  it('deletes a DRAFT release and drops an empty definition so the key can be reused', async () => {
    const { app } = createTestRuntime();
    await request(app).post('/api/v1/config/definitions').set(authHeaders).send({
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    const created = await request(app)
      .post('/api/v1/config/definitions/I_407/releases')
      .set(authHeaders)
      .send({ version: '0.1.0' });
    expect(created.status).toBe(201);

    const deleted = await request(app)
      .delete('/api/v1/config/definitions/I_407/releases/0.1.0')
      .set(authHeaders)
      .send({ expectedRowVersion: created.body.data.rowVersion });
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toEqual({
      definitionKey: 'I_407',
      version: '0.1.0',
      definitionRemoved: true
    });

    const missing = await request(app)
      .get('/api/v1/config/definitions/I_407/releases/0.1.0')
      .set(authHeaders);
    expect(missing.status).toBe(404);
    expect(missing.body.error.errorCode).toBe('OPTIC-CONFIG-40402');

    const catalog = await request(app).get('/api/v1/config/releases').set(authHeaders);
    expect(catalog.body.data).toEqual([]);

    const reused = await request(app).post('/api/v1/config/definitions').set(authHeaders).send({
      definitionKey: 'I_407',
      displayName: 'I-407 Workload',
      entityType: 'WORKLOAD'
    });
    expect(reused.status).toBe(201);
  });
});
