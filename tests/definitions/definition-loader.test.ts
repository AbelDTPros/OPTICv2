import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/errors/app-error.js';
import { DefinitionLoader } from '../../src/modules/configuration/definitions/definition-loader.js';
import { compileBusinessSchema } from '../../src/modules/configuration/definitions/schema-compiler.js';
import { InMemoryDefinitionRepository } from '../../src/modules/configuration/persistence/in-memory-definition.repository.js';
import { DefinitionReleaseService } from '../../src/modules/configuration/service/definition-release.service.js';
import { InMemoryOutboxRepository } from '../../src/platform/outbox/in-memory-outbox.repository.js';
import { AuthenticatedActorAuthorization } from '../../src/platform/security/authorization-port.js';
import { branchingRelease } from '../fixtures/definitions/branching.js';
import { linearRelease, linearWorkloadSchema } from '../fixtures/definitions/linear.js';

const actor = { actorId: 'configurator@example.gov', roles: ['CONFIGURATOR'], correlationId: 'c-loader' };

describe('DefinitionLoader', () => {
  it('compiles a linear workflow and a branching workflow', () => {
    const loader = new DefinitionLoader(new InMemoryDefinitionRepository());
    const linear = loader.compile(linearRelease);
    const branching = loader.compile(branchingRelease);

    expect(linear.cacheKey).toBe('definition-release:I_90:1.0.0');
    expect(linear.schema.compiled).toBe(true);
    expect(linear.compiledRegexes).toBeInstanceOf(Map);
    expect(branching.release.workflow.transitionSets[0]?.rules[0]?.targetStageKey).toBe('FRAUD_REVIEW');
    expect(
      branching.release.workflow.transitionSets.find((set) => set.transitionSetKey === 'COMPLETE_PAYMENT')
        ?.rules[0]?.targetStageKey
    ).toBe('REJECTED');
    expect(loader.getCache().size()).toBe(2);
  });

  it('caches immutable releases by definition_release_id and not DRAFT', () => {
    const loader = new DefinitionLoader(new InMemoryDefinitionRepository());
    loader.compile(linearRelease);
    expect(loader.getCache().peekByReleaseId('101')).toBeDefined();

    loader.compile({ ...linearRelease, id: '102', lifecycleStatus: 'DRAFT', version: '0.1.0' });
    expect(loader.getCache().peekByReleaseId('102')).toBeUndefined();
    expect(loader.getCache().size()).toBe(1);
  });

  it('rejects an unknown rule operator when compiling a release', () => {
    const loader = new DefinitionLoader(new InMemoryDefinitionRepository());
    try {
      loader.compile({
        ...linearRelease,
        workflow: {
          ...linearRelease.workflow,
          transitionSets: [
            {
              transitionSetKey: 'COMPLETE_DATA_ENTRY_TRANSITIONS',
              evaluationMode: 'FIRST_MATCH',
              rules: [
                {
                  ruleKey: 'BAD_OPERATOR',
                  priority: 10,
                  when: { path: '$.flag', operator: 'EVAL' as unknown as 'EQUALS', value: true },
                  targetStageKey: 'COMPLETED'
                }
              ],
              defaultTargetStageKey: 'COMPLETED'
            }
          ]
        }
      });
      throw new Error('expected compile to reject the operator');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).errorCode).toBe('OPTIC-CONFIG-40024');
    }
  });

  it('compiles when a terminal stage still names a removed transition set', () => {
    const loader = new DefinitionLoader(new InMemoryDefinitionRepository());
    const compiled = loader.compile({
      ...linearRelease,
      workflow: {
        ...linearRelease.workflow,
        stages: linearRelease.workflow.stages.map((stage) =>
          stage.stageKey === 'COMPLETED' ? { ...stage, transitionSetKey: 'FROM_STAGE_3' } : stage
        )
      }
    });
    expect(compiled.release.workflow.stages.find((stage) => stage.stageKey === 'COMPLETED')?.terminal).toBe(true);
  });

  it('rejects a dangling form reference', () => {
    const loader = new DefinitionLoader(new InMemoryDefinitionRepository());
    expect(() =>
      loader.compile({
        ...linearRelease,
        forms: {}
      })
    ).toThrowError(/reference validation/);
  });

  it('rejects a transition that points at a missing stage', () => {
    const loader = new DefinitionLoader(new InMemoryDefinitionRepository());
    try {
      loader.compile({
        ...linearRelease,
        workflow: {
          ...linearRelease.workflow,
          transitionSets: [
            {
              transitionSetKey: 'COMPLETE_DATA_ENTRY_TRANSITIONS',
              evaluationMode: 'FIRST_MATCH',
              rules: [],
              defaultTargetStageKey: 'DOES_NOT_EXIST'
            }
          ]
        }
      });
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(JSON.stringify((error as AppError).details)).toContain('DOES_NOT_EXIST');
    }
  });

  it('loads a persisted DRAFT by key/version and by release id without caching', async () => {
    const repository = new InMemoryDefinitionRepository();
    const service = new DefinitionReleaseService(
      repository,
      new AuthenticatedActorAuthorization(),
      async (work) => work(),
      new InMemoryOutboxRepository()
    );
    await service.createDefinition(actor, {
      definitionKey: 'I_407',
      displayName: 'I-407',
      entityType: 'WORKLOAD'
    });
    const draft = await service.createDraftRelease(actor, { definitionKey: 'I_407', version: '0.1.0' });
    const loader = new DefinitionLoader(repository);
    const byKey = await loader.loadByKeyVersion('I_407', '0.1.0');
    const byId = await loader.loadByReleaseId(draft.id);
    expect(byKey.version).toBe('0.1.0');
    expect(byId.releaseId).toBe(draft.id);
    expect(loader.getCache().size()).toBe(0);
  });

  it('compiles JSON Schema and validates business data', () => {
    const schema = compileBusinessSchema(linearWorkloadSchema);
    expect(schema.validate({ dataEntryDetails: { receiptNumber: 'ABC123' } }).valid).toBe(true);
    expect(schema.validate({ dataEntryDetails: {} }).valid).toBe(false);
  });
});
