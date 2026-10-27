import { describe, expect, it } from 'vitest';
import { demoDesignerForm, demoDesignerQueue, demoDesignerWorkflow } from './demo-draft.js';
import {
  addStage,
  addTransitionSet,
  arrangeStageLayouts,
  attachOutboundTransitions,
  collectWorkflowIssues,
  connectStages,
  catalogFromRelease,
  findCycles,
  layoutEdges,
  listEdges,
  listFormsInWorkflowOrder,
  listProjectableFormFields,
  listQueuesInWorkflowOrder,
  listRulePathOptions,
  outboundBinding,
  removeTransitionSet,
  reorderRulePriority,
  retargetActionTransitionSet,
  updateStage,
  STAGE_NODE_HEIGHT,
  STAGE_NODE_WIDTH
} from './workflow-model.js';

describe('workflow designer model', () => {
  it('adds a stage and requires an initial stage', () => {
    const next = addStage(demoDesignerWorkflow);
    expect(next.stages.some((stage) => stage.stageKey === 'STAGE')).toBe(true);
    expect(next.stages.find((stage) => stage.stageKey === 'STAGE')?.assignmentPolicy).toEqual({
      required: false,
      clearOnTransition: true,
      allowAssign: true,
      allowReassign: true,
      allowRelease: true
    });
    expect(collectWorkflowIssues({ ...next, initialStageKey: '' }).some((issue) => issue.path === 'initialStageKey')).toBe(
      true
    );
  });

  it('reports an explicit cycle when a default target points backward', () => {
    const cyclic = {
      ...demoDesignerWorkflow,
      transitionSets: [
        {
          transitionSetKey: 'LOOP',
          evaluationMode: 'FIRST_MATCH' as const,
          rules: [],
          defaultTargetStageKey: 'READY_FOR_DATA_ENTRY'
        }
      ]
    };
    expect(findCycles(cyclic).join(' ')).toContain('READY_FOR_DATA_ENTRY');
  });

  it('flags a stage that cannot be reached from the initial stage', () => {
    const next = addStage(demoDesignerWorkflow);
    expect(
      collectWorkflowIssues(next).some((issue) => issue.message.includes('STAGE is unreachable'))
    ).toBe(true);
  });

  it('flags a transition action with no destination', () => {
    const emptySet = {
      ...demoDesignerWorkflow,
      transitionSets: [
        {
          transitionSetKey: 'EMPTY',
          evaluationMode: 'FIRST_MATCH' as const,
          rules: []
        }
      ]
    };
    expect(
      collectWorkflowIssues(emptySet, {
        actions: { COMPLETE: { type: 'TRANSITION', transitionSetKey: 'EMPTY' } }
      }).some((issue) => issue.message.includes('has no reachable destination'))
    ).toBe(true);
  });

  it('lists forms in workflow stage order', () => {
    const scanning = {
      ...demoDesignerForm,
      formKey: 'SCANNING',
      title: 'Scanning'
    };
    const dataEntry = {
      ...demoDesignerForm,
      formKey: 'DATA_ENTRY',
      title: 'Data Entry'
    };
    const orphan = {
      ...demoDesignerForm,
      formKey: 'ORPHAN',
      title: 'Unused'
    };
    const workflow = {
      ...demoDesignerWorkflow,
      stages: [
        {
          ...demoDesignerWorkflow.stages[0]!,
          stageKey: 'READY_FOR_SCANNING',
          displayName: 'Ready for Scanning',
          order: 5,
          formKey: 'SCANNING'
        },
        {
          ...demoDesignerWorkflow.stages[0]!,
          stageKey: 'READY_FOR_DATA_ENTRY',
          displayName: 'Ready for Data Entry',
          order: 10,
          formKey: 'DATA_ENTRY'
        },
        demoDesignerWorkflow.stages[1]!
      ]
    };
    expect(
      listFormsInWorkflowOrder(
        { DATA_ENTRY: dataEntry, SCANNING: scanning, ORPHAN: orphan },
        workflow
      ).map((form) => form.formKey)
    ).toEqual(['SCANNING', 'DATA_ENTRY', 'ORPHAN']);
  });

  it('lists queues in workflow stage order', () => {
    const scanning = {
      ...demoDesignerQueue,
      queueKey: 'SCANNING_Q',
      displayName: 'Scanning'
    };
    const dataEntry = {
      ...demoDesignerQueue,
      queueKey: 'DATA_ENTRY_Q',
      displayName: 'Data Entry'
    };
    const orphan = {
      ...demoDesignerQueue,
      queueKey: 'ORPHAN_Q',
      displayName: 'Unused'
    };
    const workflow = {
      ...demoDesignerWorkflow,
      stages: [
        {
          ...demoDesignerWorkflow.stages[0]!,
          stageKey: 'READY_FOR_SCANNING',
          displayName: 'Ready for Scanning',
          order: 5,
          queueKey: 'SCANNING_Q'
        },
        {
          ...demoDesignerWorkflow.stages[0]!,
          stageKey: 'READY_FOR_DATA_ENTRY',
          displayName: 'Ready for Data Entry',
          order: 10,
          queueKey: 'DATA_ENTRY_Q'
        },
        demoDesignerWorkflow.stages[1]!
      ]
    };
    expect(
      listQueuesInWorkflowOrder(
        { DATA_ENTRY_Q: dataEntry, SCANNING_Q: scanning, ORPHAN_Q: orphan },
        workflow
      ).map((queue) => queue.queueKey)
    ).toEqual(['SCANNING_Q', 'DATA_ENTRY_Q', 'ORPHAN_Q']);
  });

  it('lists projectable form fields for queue projection pickers', () => {
    expect(listProjectableFormFields({ [demoDesignerForm.formKey]: demoDesignerForm })).toEqual([
      {
        fieldKey: 'A_NUMBER',
        label: 'A-Number',
        path: '$.dataEntryDetails.ANumber',
        group: 'Data Entry · Applicant Information'
      },
      {
        fieldKey: 'RECEIPT_NUMBER',
        label: 'Receipt Number',
        path: '$.dataEntryDetails.receiptNumber',
        group: 'Data Entry · Applicant Information'
      }
    ]);
  });

  it('lists projectable form fields in workflow stage order', () => {
    const scanning = {
      ...demoDesignerForm,
      formKey: 'SCANNING',
      title: 'Scanning',
      dataPath: '$.scanningDetails',
      sections: [
        {
          sectionKey: 'SCAN',
          title: 'Scan',
          layout: 'ONE_COLUMN' as const,
          fields: [
            {
              ...demoDesignerForm.sections[0]!.fields[0]!,
              fieldKey: 'BARCODE',
              label: 'Barcode',
              path: '$.barcode'
            }
          ]
        }
      ]
    };
    const dataEntry = {
      ...demoDesignerForm,
      formKey: 'DATA_ENTRY',
      title: 'Data Entry'
    };
    const workflow = {
      ...demoDesignerWorkflow,
      stages: [
        {
          ...demoDesignerWorkflow.stages[0]!,
          stageKey: 'READY_FOR_SCANNING',
          order: 5,
          formKey: 'SCANNING'
        },
        {
          ...demoDesignerWorkflow.stages[0]!,
          stageKey: 'READY_FOR_DATA_ENTRY',
          order: 10,
          formKey: 'DATA_ENTRY'
        },
        demoDesignerWorkflow.stages[1]!
      ]
    };
    // Object key order puts DATA_ENTRY first; workflow order must put Scanning first.
    expect(
      listProjectableFormFields({ DATA_ENTRY: dataEntry, SCANNING: scanning }, workflow).map(
        (field) => field.path
      )
    ).toEqual(['$.scanningDetails.barcode', '$.dataEntryDetails.ANumber', '$.dataEntryDetails.receiptNumber']);
  });

  it('lists form fields as JSONPath options for transition rules', () => {
    const options = listRulePathOptions({ [demoDesignerForm.formKey]: demoDesignerForm });
    expect(options.map((item) => item.value)).toEqual([
      '$workflow.currentStageKey',
      '$workflow.assignedTo',
      '$.dataEntryDetails.ANumber',
      '$.dataEntryDetails.receiptNumber'
    ]);
    expect(options.find((item) => item.value === '$.dataEntryDetails.ANumber')).toMatchObject({
      label: 'A-Number · $.dataEntryDetails.ANumber',
      group: 'Data Entry · Applicant Information'
    });
    expect(options.find((item) => item.value === '$workflow.currentStageKey')?.group).toBe('Workflow');
  });

  it('limits form-behavior paths to the focused form plus shared roots from siblings', () => {
    const tracking = {
      ...demoDesignerForm,
      formKey: 'TRACKING',
      title: 'Tracking',
      dataPath: '$.trackingDetails',
      sections: [
        {
          sectionKey: 'STATUS',
          title: 'Status',
          fields: [
            {
              fieldKey: 'WORKLOAD_STATUS',
              path: '$.workload.workloadStatus',
              component: 'RADIO_BUTTONS' as const,
              label: 'Workload Status',
              options: [
                { value: 'Accepted', label: 'Accepted' },
                { value: 'Rejected', label: 'Rejected' }
              ]
            },
            {
              fieldKey: 'NOTES',
              path: '$.notes',
              component: 'TEXT_INPUT' as const,
              label: 'Notes'
            }
          ]
        }
      ]
    };
    const options = listRulePathOptions(
      { [demoDesignerForm.formKey]: demoDesignerForm, TRACKING: tracking },
      { formBehaviorFocus: demoDesignerForm.formKey }
    );
    const values = options.map((item) => item.value);
    expect(values).toContain('$.dataEntryDetails.receiptNumber');
    expect(values).toContain('$.workload.workloadStatus');
    expect(values).not.toContain('$.trackingDetails.notes');
    expect(options.find((item) => item.value === '$.workload.workloadStatus')).toMatchObject({
      label: 'Workload Status · $.workload.workloadStatus',
      group: 'Shared · workload'
    });
  });

  it('prefers the focused form when the same shared path is hosted on two forms', () => {
    const dataEntry = {
      ...demoDesignerForm,
      formKey: 'DATA_ENTRY',
      title: 'Data Entry',
      dataPath: '$.dataEntryDetails',
      sections: [
        {
          sectionKey: 'TRACKING',
          title: 'Tracking',
          fields: [
            {
              fieldKey: 'WORKLOAD_STATUS',
              path: '$.workload.workloadStatus',
              component: 'SELECT' as const,
              label: 'Status (DE)',
              options: [{ value: 'Accepted', label: 'Accepted' }]
            }
          ]
        }
      ]
    };
    const scanning = {
      ...demoDesignerForm,
      formKey: 'SCANNING',
      title: 'Scanning',
      dataPath: '$.scanningDetails',
      sections: [
        {
          sectionKey: 'TRACKING',
          title: 'Tracking',
          fields: [
            {
              fieldKey: 'WORKLOAD_STATUS',
              path: '$.workload.workloadStatus',
              component: 'SELECT' as const,
              label: 'Status (Scan)',
              options: [
                { value: 'Accepted', label: 'Accepted' },
                { value: 'Rejected', label: 'Rejected' }
              ]
            }
          ]
        }
      ]
    };
    const onScanning = listRulePathOptions(
      { DATA_ENTRY: dataEntry, SCANNING: scanning },
      { formBehaviorFocus: 'SCANNING' }
    );
    expect(onScanning.find((item) => item.value === '$.workload.workloadStatus')).toMatchObject({
      label: 'Status (Scan) · $.workload.workloadStatus',
      group: 'Shared · workload'
    });
  });

  it('gives a new stage its own outbound transition set', () => {
    const catalog = { actions: { COMPLETE: { type: 'TRANSITION', transitionSetKey: 'FROM_DATA_ENTRY' } } };
    const next = addStage(demoDesignerWorkflow, catalog);
    const created = next.stages.find((stage) => stage.stageKey === 'STAGE');
    expect(created?.transitionSetKey).toBe('FROM_STAGE');
    expect(created?.actionKeys).toContain('COMPLETE');
    expect(next.transitionSets.map((set) => set.transitionSetKey)).toContain('FROM_STAGE');
    expect(outboundBinding(next, created!, catalog).kind).toBe('owned');
  });

  it('keeps a later stage on shared Complete rules until it gets its own set', () => {
    const catalog = { actions: { COMPLETE: { type: 'TRANSITION', transitionSetKey: 'FROM_DATA_ENTRY' } } };
    const shipping = {
      stageKey: 'READY_FOR_SHIPPING',
      displayName: 'Ready for Shipping',
      order: 20,
      actionKeys: ['COMPLETE'],
      assignmentPolicy: { required: false, clearOnTransition: true }
    };
    const withShipping = {
      ...demoDesignerWorkflow,
      stages: [demoDesignerWorkflow.stages[0]!, shipping, demoDesignerWorkflow.stages[1]!]
    };
    expect(outboundBinding(withShipping, shipping, catalog)).toMatchObject({
      kind: 'shared',
      ownerDisplayName: 'Ready for Data Entry'
    });
    const split = attachOutboundTransitions(withShipping, 'READY_FOR_SHIPPING', catalog);
    const nextShipping = split.stages.find((stage) => stage.stageKey === 'READY_FOR_SHIPPING')!;
    expect(nextShipping.transitionSetKey).toBe('FROM_READY_FOR_SHIPPING');
    expect(outboundBinding(split, nextShipping, catalog).kind).toBe('owned');
    expect(listEdges(split, catalog).filter((edge) => edge.from === 'READY_FOR_DATA_ENTRY').map((edge) => edge.to)).toEqual([
      'COMPLETED'
    ]);
  });

  it('connects stages with auto-fork and prefers otherwise then a new rule', () => {
    const catalog = { actions: { COMPLETE: { type: 'TRANSITION', transitionSetKey: 'FROM_DATA_ENTRY' } } };
    const shipping = {
      stageKey: 'READY_FOR_SHIPPING',
      displayName: 'Ready for Shipping',
      order: 20,
      actionKeys: ['COMPLETE'],
      assignmentPolicy: { required: false, clearOnTransition: true }
    };
    const withShipping = {
      ...demoDesignerWorkflow,
      stages: [demoDesignerWorkflow.stages[0]!, shipping, demoDesignerWorkflow.stages[1]!],
      transitionSets: [
        {
          transitionSetKey: 'FROM_DATA_ENTRY',
          evaluationMode: 'FIRST_MATCH' as const,
          rules: [],
          defaultTargetStageKey: 'COMPLETED'
        }
      ]
    };
    const first = connectStages(withShipping, 'READY_FOR_SHIPPING', 'COMPLETED', catalog);
    const owned = first.workflow.stages.find((stage) => stage.stageKey === 'READY_FOR_SHIPPING')!;
    expect(owned.transitionSetKey).toBe('FROM_READY_FOR_SHIPPING');
    expect(first.edge).toMatchObject({ kind: 'default', from: 'READY_FOR_SHIPPING', to: 'COMPLETED' });
    const second = connectStages(first.workflow, 'READY_FOR_SHIPPING', 'READY_FOR_DATA_ENTRY', catalog);
    expect(second.edge).toMatchObject({
      kind: 'rule',
      from: 'READY_FOR_SHIPPING',
      to: 'READY_FOR_DATA_ENTRY',
      ruleKey: expect.stringMatching(/^RULE/)
    });
    const set = second.workflow.transitionSets.find((item) => item.transitionSetKey === 'FROM_READY_FOR_SHIPPING')!;
    expect(set.defaultTargetStageKey).toBe('COMPLETED');
    expect(set.rules).toHaveLength(1);
    expect(listEdges(withShipping, catalog).filter((edge) => edge.from === 'READY_FOR_DATA_ENTRY')).toEqual(
      listEdges(second.workflow, catalog).filter((edge) => edge.from === 'READY_FOR_DATA_ENTRY')
    );
  });

  it('labels default edges as Default and keeps rule priority on edges', () => {
    const catalog = { actions: { COMPLETE: { type: 'TRANSITION', transitionSetKey: 'FROM_DATA_ENTRY' } } };
    const withRule = {
      ...demoDesignerWorkflow,
      transitionSets: [
        {
          transitionSetKey: 'FROM_DATA_ENTRY',
          evaluationMode: 'FIRST_MATCH' as const,
          rules: [
            {
              ruleKey: 'WHEN_REJECTED',
              priority: 1,
              when: { path: '$.status', operator: 'EQUALS', value: 'Rejected' },
              targetStageKey: 'COMPLETED'
            }
          ],
          defaultTargetStageKey: 'COMPLETED'
        }
      ]
    };
    const edges = listEdges(withRule, catalog).filter((edge) => edge.from === 'READY_FOR_DATA_ENTRY');
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'default', label: 'Default', to: 'COMPLETED' }),
        expect.objectContaining({ kind: 'rule', ruleKey: 'WHEN_REJECTED', priority: 1, label: 'WHEN_REJECTED' })
      ])
    );
  });

  it('reorders rule priority and renumbers densely', () => {
    const workflow = {
      ...demoDesignerWorkflow,
      transitionSets: [
        {
          transitionSetKey: 'FROM_DATA_ENTRY',
          evaluationMode: 'FIRST_MATCH' as const,
          rules: [
            {
              ruleKey: 'FIRST',
              priority: 1,
              when: { path: '$.a', operator: 'EQUALS', value: '1' },
              targetStageKey: 'COMPLETED'
            },
            {
              ruleKey: 'SECOND',
              priority: 5,
              when: { path: '$.b', operator: 'EQUALS', value: '2' },
              targetStageKey: 'COMPLETED'
            },
            {
              ruleKey: 'THIRD',
              priority: 9,
              when: { path: '$.c', operator: 'EQUALS', value: '3' },
              targetStageKey: 'COMPLETED'
            }
          ],
          defaultTargetStageKey: 'COMPLETED'
        }
      ]
    };
    const later = reorderRulePriority(workflow, 'FROM_DATA_ENTRY', 'FIRST', 1);
    expect(
      later.transitionSets[0]!.rules
        .slice()
        .sort((left, right) => left.priority - right.priority)
        .map((rule) => ({ ruleKey: rule.ruleKey, priority: rule.priority }))
    ).toEqual([
      { ruleKey: 'SECOND', priority: 1 },
      { ruleKey: 'FIRST', priority: 2 },
      { ruleKey: 'THIRD', priority: 3 }
    ]);
    expect(reorderRulePriority(later, 'FROM_DATA_ENTRY', 'SECOND', -1)).toEqual(later);
  });

  it('lists timer edges from Catalog scheduled TRANSITION actions', () => {
    const catalog = catalogFromRelease({
      actions: { COMPLETE: { type: 'TRANSITION', transitionSetKey: 'FROM_DATA_ENTRY' } },
      scheduledActions: {
        HOLD_EXPIRE: {
          trigger: { type: 'STAGE_ENTERED', stageKey: 'READY_FOR_DATA_ENTRY' },
          delay: { source: 'CONFIG', duration: { days: 90 } },
          action: { type: 'TRANSITION', targetStage: 'COMPLETED' }
        },
        NUDGE: {
          trigger: { type: 'STAGE_ENTERED', stageKey: 'READY_FOR_DATA_ENTRY' },
          delay: { source: 'CONFIG', duration: { hours: 24 } },
          action: { type: 'NOTIFICATION' }
        }
      }
    });
    const edges = listEdges(demoDesignerWorkflow, catalog).filter((edge) => edge.from === 'READY_FOR_DATA_ENTRY');
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'default', to: 'COMPLETED' }),
        expect.objectContaining({
          kind: 'timer',
          scheduledActionKey: 'HOLD_EXPIRE',
          to: 'COMPLETED',
          delaySummary: '90d',
          label: 'HOLD_EXPIRE'
        })
      ])
    );
    expect(edges.some((edge) => edge.scheduledActionKey === 'NUDGE')).toBe(false);
  });

  it('removes an unused transition set and keeps sets that stages still use', () => {
    const catalog = { actions: { COMPLETE: { type: 'TRANSITION', transitionSetKey: 'FROM_DATA_ENTRY' } } };
    const withExtra = addTransitionSet(demoDesignerWorkflow);
    const extraKey = withExtra.transitionSets.find((set) => set.transitionSetKey.startsWith('TRANSITIONS'))?.transitionSetKey;
    expect(extraKey).toBeTruthy();
    const removed = removeTransitionSet(withExtra, extraKey!, catalog);
    expect(removed.transitionSets.map((set) => set.transitionSetKey)).not.toContain(extraKey);
    expect(removeTransitionSet(demoDesignerWorkflow, 'FROM_DATA_ENTRY', catalog).transitionSets).toHaveLength(
      demoDesignerWorkflow.transitionSets.length
    );
  });

  it('removes a leftover clone set even when Complete still names it', () => {
    const catalog = { actions: { COMPLETE: { type: 'TRANSITION', transitionSetKey: 'FROM_DATA_ENTRY' } } };
    const mailStage = {
      stageKey: 'MAIL_INTAKE',
      displayName: 'Mail intake',
      order: 10,
      actionKeys: ['COMPLETE'],
      transitionSetKey: 'FROM_MAIL_INTAKE',
      assignmentPolicy: { required: false, clearOnTransition: true }
    };
    const workflow = {
      ...demoDesignerWorkflow,
      initialStageKey: 'MAIL_INTAKE',
      stages: [mailStage, demoDesignerWorkflow.stages[1]!],
      transitionSets: [
        demoDesignerWorkflow.transitionSets[0]!,
        {
          transitionSetKey: 'FROM_MAIL_INTAKE',
          evaluationMode: 'FIRST_MATCH' as const,
          rules: [],
          defaultTargetStageKey: 'COMPLETED'
        }
      ]
    };
    const removed = removeTransitionSet(workflow, 'FROM_DATA_ENTRY', catalog);
    expect(removed.transitionSets.map((set) => set.transitionSetKey)).toEqual(['FROM_MAIL_INTAKE']);
    expect(retargetActionTransitionSet(catalog.actions, 'FROM_DATA_ENTRY', 'FROM_MAIL_INTAKE').COMPLETE?.transitionSetKey).toBe(
      'FROM_MAIL_INTAKE'
    );
  });

  it('clears a leftover Complete path when a stage becomes terminal', () => {
    const marked = updateStage(demoDesignerWorkflow, 'READY_FOR_DATA_ENTRY', { terminal: true });
    const stage = marked.stages.find((item) => item.stageKey === 'READY_FOR_DATA_ENTRY');
    expect(stage?.terminal).toBe(true);
    expect(stage?.transitionSetKey).toBeUndefined();
  });

  it('does not treat a missing transition set on a terminal stage as a workflow issue', () => {
    const workflow = {
      ...demoDesignerWorkflow,
      stages: demoDesignerWorkflow.stages.map((stage) =>
        stage.stageKey === 'COMPLETED' ? { ...stage, transitionSetKey: 'FROM_STAGE_3' } : stage
      )
    };
    expect(collectWorkflowIssues(workflow).some((issue) => issue.message.includes('FROM_STAGE_3'))).toBe(false);
  });

  it('arranges a linear workflow left to right along the path', () => {
    const workflow = {
      initialStageKey: 'A',
      terminalStageKeys: ['C'],
      stages: [
        stageAt('A', 10, { x: 900, y: 400 }, 'FROM_A'),
        stageAt('B', 20, { x: 20, y: 20 }, 'FROM_B'),
        stageAt('C', 30, { x: 40, y: 900 }, undefined, true)
      ],
      transitionSets: [
        { transitionSetKey: 'FROM_A', evaluationMode: 'FIRST_MATCH' as const, rules: [], defaultTargetStageKey: 'B' },
        { transitionSetKey: 'FROM_B', evaluationMode: 'FIRST_MATCH' as const, rules: [], defaultTargetStageKey: 'C' }
      ]
    };
    const arranged = arrangeStageLayouts(workflow);
    const a = arranged.stages.find((stage) => stage.stageKey === 'A')!.layout!;
    const b = arranged.stages.find((stage) => stage.stageKey === 'B')!.layout!;
    const c = arranged.stages.find((stage) => stage.stageKey === 'C')!.layout!;
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y);
  });

  it('stacks parallel branches in the same column and joins again to the right', () => {
    const workflow = {
      initialStageKey: 'START',
      terminalStageKeys: ['DONE'],
      stages: [
        stageAt('START', 10, { x: 0, y: 0 }, 'FROM_START'),
        stageAt('LEFT', 20, { x: 0, y: 0 }, 'FROM_LEFT'),
        stageAt('RIGHT', 30, { x: 0, y: 0 }, 'FROM_RIGHT'),
        stageAt('DONE', 40, { x: 0, y: 0 }, undefined, true)
      ],
      transitionSets: [
        {
          transitionSetKey: 'FROM_START',
          evaluationMode: 'FIRST_MATCH' as const,
          rules: [
            {
              ruleKey: 'TO_LEFT',
              priority: 1,
              when: { path: '$.x', operator: 'EQUALS', value: '1' },
              targetStageKey: 'LEFT'
            }
          ],
          defaultTargetStageKey: 'RIGHT'
        },
        {
          transitionSetKey: 'FROM_LEFT',
          evaluationMode: 'FIRST_MATCH' as const,
          rules: [],
          defaultTargetStageKey: 'DONE'
        },
        {
          transitionSetKey: 'FROM_RIGHT',
          evaluationMode: 'FIRST_MATCH' as const,
          rules: [],
          defaultTargetStageKey: 'DONE'
        }
      ]
    };
    const arranged = arrangeStageLayouts(workflow);
    const start = arranged.stages.find((stage) => stage.stageKey === 'START')!.layout!;
    const left = arranged.stages.find((stage) => stage.stageKey === 'LEFT')!.layout!;
    const right = arranged.stages.find((stage) => stage.stageKey === 'RIGHT')!.layout!;
    const done = arranged.stages.find((stage) => stage.stageKey === 'DONE')!.layout!;
    expect(start.x).toBeLessThan(left.x);
    expect(left.x).toBe(right.x);
    expect(left.y).not.toBe(right.y);
    expect(done.x).toBeGreaterThan(left.x);
  });

  it('arranges stages with no transitions in author order on one row', () => {
    const workflow = {
      initialStageKey: 'START',
      terminalStageKeys: ['DONE'],
      stages: [
        stageAt('START', 10, { x: 500, y: 500 }),
        stageAt('MID', 20, { x: 10, y: 10 }),
        stageAt('DONE', 30, { x: 0, y: 0 }, undefined, true)
      ],
      transitionSets: []
    };
    const arranged = arrangeStageLayouts(workflow);
    const start = arranged.stages.find((stage) => stage.stageKey === 'START')!.layout!;
    const mid = arranged.stages.find((stage) => stage.stageKey === 'MID')!.layout!;
    const done = arranged.stages.find((stage) => stage.stageKey === 'DONE')!.layout!;
    expect(start.x).toBeLessThan(mid.x);
    expect(mid.x).toBeLessThan(done.x);
    expect(start.y).toBe(mid.y);
    expect(mid.y).toBe(done.y);
  });

  it('attaches a forward arrow to the right side of the source and the left side of the target', () => {
    const catalog = { actions: { COMPLETE: { type: 'TRANSITION', transitionSetKey: 'FROM_A' } } };
    const from = { x: 40, y: 48 };
    const to = { x: 40 + STAGE_NODE_WIDTH + 108, y: 48 };
    const workflow = {
      initialStageKey: 'A',
      terminalStageKeys: ['B'],
      stages: [
        {
          stageKey: 'A',
          displayName: 'A',
          order: 10,
          actionKeys: ['COMPLETE'],
          transitionSetKey: 'FROM_A',
          assignmentPolicy: { required: false, clearOnTransition: true },
          layout: from
        },
        {
          stageKey: 'B',
          displayName: 'B',
          order: 20,
          terminal: true,
          actionKeys: [],
          assignmentPolicy: { required: false, clearOnTransition: false },
          layout: to
        }
      ],
      transitionSets: [
        { transitionSetKey: 'FROM_A', evaluationMode: 'FIRST_MATCH' as const, rules: [], defaultTargetStageKey: 'B' }
      ]
    };
    const [edge] = layoutEdges(workflow, catalog, workflow.stages);
    const points = [...(edge?.d.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g) ?? [])].map((match) => ({
      x: Number(match[1]),
      y: Number(match[2])
    }));
    expect(points[0]).toEqual({ x: from.x + STAGE_NODE_WIDTH, y: from.y + STAGE_NODE_HEIGHT / 2 });
    expect(points.at(-1)).toEqual({ x: to.x, y: to.y + STAGE_NODE_HEIGHT / 2 });
    expect(edge?.d).toContain(' C ');
  });

  it('reroutes inverted edges so their curves do not cross', () => {
    const catalog = { actions: { COMPLETE: { type: 'TRANSITION', transitionSetKey: 'FROM_A' } } };
    const workflow = {
      initialStageKey: 'A',
      terminalStageKeys: [],
      stages: [
        stageAt('A', 10, { x: 40, y: 80 }, 'FROM_A'),
        stageAt('B', 20, { x: 400, y: 80 }, undefined, true),
        stageAt('C', 30, { x: 40, y: 280 }, 'FROM_C'),
        stageAt('D', 40, { x: 400, y: 280 }, undefined, true)
      ],
      transitionSets: [
        { transitionSetKey: 'FROM_A', evaluationMode: 'FIRST_MATCH' as const, rules: [], defaultTargetStageKey: 'D' },
        { transitionSetKey: 'FROM_C', evaluationMode: 'FIRST_MATCH' as const, rules: [], defaultTargetStageKey: 'B' }
      ]
    };
    const routed = layoutEdges(workflow, catalog, workflow.stages);
    const ad = routed.find((edge) => edge.from === 'A' && edge.to === 'D');
    const cb = routed.find((edge) => edge.from === 'C' && edge.to === 'B');
    expect(ad && cb).toBeTruthy();
    expect(curvesCross(ad!.d, cb!.d)).toBe(false);
    expect(Math.min(...pathPolyline(cb!.d).map((point) => point.y))).toBeLessThan(80);
    expect(Math.max(...pathPolyline(ad!.d).map((point) => point.y))).toBeGreaterThan(376);
  });
});

function stageAt(
  stageKey: string,
  order: number,
  layout: { x: number; y: number },
  transitionSetKey?: string,
  terminal = false
) {
  return {
    stageKey,
    displayName: stageKey,
    order,
    terminal,
    actionKeys: terminal ? [] : ['COMPLETE'],
    transitionSetKey,
    assignmentPolicy: { required: false, clearOnTransition: true },
    layout
  };
}

function curvesCross(left: string, right: string): boolean {
  const a = pathPolyline(left);
  const b = pathPolyline(right);
  for (let i = 0; i < a.length - 1; i += 1) {
    for (let j = 0; j < b.length - 1; j += 1) {
      if (testSegmentsIntersect(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) {
        return true;
      }
    }
  }
  return false;
}

function pathPolyline(d: string): Array<{ x: number; y: number }> {
  const parts = d.match(/[MLQC][^MLQC]*/g) ?? [];
  let x = 0;
  let y = 0;
  const points: Array<{ x: number; y: number }> = [];
  for (const part of parts) {
    const command = part[0];
    const n = [...part.slice(1).matchAll(/(-?\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
    if (command === 'M' || command === 'L') {
      x = n[0] ?? x;
      y = n[1] ?? y;
      points.push({ x, y });
    } else if (command === 'Q') {
      const p0 = { x, y };
      const x1 = n[0] ?? x;
      const y1 = n[1] ?? y;
      const x2 = n[2] ?? x;
      const y2 = n[3] ?? y;
      for (let i = 1; i <= 8; i += 1) {
        const t = i / 8;
        const u = 1 - t;
        points.push({
          x: u * u * p0.x + 2 * u * t * x1 + t * t * x2,
          y: u * u * p0.y + 2 * u * t * y1 + t * t * y2
        });
      }
      x = x2;
      y = y2;
    } else if (command === 'C') {
      const p0 = { x, y };
      const p1 = { x: n[0] ?? x, y: n[1] ?? y };
      const p2 = { x: n[2] ?? x, y: n[3] ?? y };
      const p3 = { x: n[4] ?? x, y: n[5] ?? y };
      for (let i = 1; i <= 12; i += 1) {
        const t = i / 12;
        const u = 1 - t;
        points.push({
          x: u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x,
          y: u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y
        });
      }
      x = p3.x;
      y = p3.y;
    }
  }
  return points;
}

function testSegmentsIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number }
): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-6) {
    return false;
  }
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}
