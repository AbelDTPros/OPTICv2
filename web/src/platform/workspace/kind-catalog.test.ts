import { describe, expect, it } from 'vitest';
import { filterWorkKinds, groupWorkKinds, intakeMember, kindKeyFromDefinition, kindLabel } from './kind-catalog.js';

describe('kind catalog', () => {
  it('groups mail and workload definitions under one kind', () => {
    const kinds = groupWorkKinds(
      [
        { definitionKey: 'I_407_MAILITEM', displayName: 'I-407 Mail', entityType: 'MAIL' },
        { definitionKey: 'I_407_WORKLOAD', displayName: 'I-407 Workload', entityType: 'WORKLOAD' },
        { definitionKey: 'I_90', displayName: 'I-90', entityType: 'WORKLOAD' }
      ],
      [
        { definitionKey: 'I_407_MAILITEM', displayName: 'I-407 Mail', version: '0.1.0', lifecycleStatus: 'DRAFT' },
        { definitionKey: 'I_407_WORKLOAD', displayName: 'I-407 Workload', version: '0.1.0', lifecycleStatus: 'DRAFT' },
        { definitionKey: 'I_90', displayName: 'I-90', version: '1.0.0', lifecycleStatus: 'PUBLISHED' }
      ],
      'try'
    );
    expect(kinds.map((kind) => kind.label)).toEqual(['I-407', 'I-90']);
    expect(kinds[0]?.members.map((member) => member.entityType)).toEqual(['MAIL', 'WORKLOAD']);
    expect(intakeMember(kinds[0]!)?.entityType).toBe('MAIL');
    expect(intakeMember(kinds[1]!)?.definitionKey).toBe('I_90');
  });

  it('keeps only published members in live mode', () => {
    const kinds = groupWorkKinds(
      [{ definitionKey: 'I_407_WORKLOAD', displayName: 'I-407 Workload', entityType: 'WORKLOAD' }],
      [
        { definitionKey: 'I_407_WORKLOAD', displayName: 'I-407 Workload', version: '0.1.0', lifecycleStatus: 'DRAFT' }
      ],
      'live'
    );
    expect(kinds).toEqual([]);
  });

  it('keeps only the activated published release in live mode', () => {
    const kinds = groupWorkKinds(
      [{ definitionKey: 'I_407_WORKLOAD', displayName: 'I-407 Workload', entityType: 'WORKLOAD' }],
      [
        {
          definitionKey: 'I_407_WORKLOAD',
          displayName: 'I-407 Workload',
          version: '1.1.0',
          lifecycleStatus: 'PUBLISHED'
        },
        {
          definitionKey: 'I_407_WORKLOAD',
          displayName: 'I-407 Workload',
          version: '0.1.0',
          lifecycleStatus: 'PUBLISHED',
          active: true
        }
      ],
      'live'
    );
    expect(kinds[0]?.members[0]?.version).toBe('0.1.0');
  });

  it('hides published members that are not the Live pointer', () => {
    const kinds = groupWorkKinds(
      [{ definitionKey: 'I_90', displayName: 'I-90', entityType: 'WORKLOAD' }],
      [{ definitionKey: 'I_90', displayName: 'I-90', version: '1.0.0', lifecycleStatus: 'PUBLISHED' }],
      'live'
    );
    expect(kinds).toEqual([]);
  });

  it('prefers the newer draft when two drafts exist', () => {
    const kinds = groupWorkKinds(
      [{ definitionKey: 'I_936_MAIL_ITEM', displayName: 'I-936 Mail', entityType: 'MAIL' }],
      [
        { definitionKey: 'I_936_MAIL_ITEM', displayName: 'I-936 Mail', version: '0.1.0', lifecycleStatus: 'DRAFT' },
        { definitionKey: 'I_936_MAIL_ITEM', displayName: 'I-936 Mail', version: '0.2.0', lifecycleStatus: 'DRAFT' }
      ],
      'try'
    );
    expect(kinds[0]?.members[0]?.version).toBe('0.2.0');
  });

  it('prefers a draft over a published release when trying', () => {
    const kinds = groupWorkKinds(
      [{ definitionKey: 'I_90', displayName: 'I-90', entityType: 'WORKLOAD' }],
      [
        { definitionKey: 'I_90', displayName: 'I-90', version: '1.0.0', lifecycleStatus: 'PUBLISHED' },
        { definitionKey: 'I_90', displayName: 'I-90', version: '1.1.0', lifecycleStatus: 'DRAFT' }
      ],
      'try'
    );
    expect(kinds[0]?.members[0]?.version).toBe('1.1.0');
  });

  it('turns definition suffixes into a form-number label', () => {
    expect(kindKeyFromDefinition('I_407_MAILITEM')).toBe('I_407');
    expect(kindKeyFromDefinition('I_936_MAIL_ITEM')).toBe('I_936');
    expect(kindLabel('I_407')).toBe('I-407');
  });

  it('shortlists kinds as the officer types a form number', () => {
    const kinds = groupWorkKinds(
      [
        { definitionKey: 'I_407_WORKLOAD', displayName: 'I-407 Workload', entityType: 'WORKLOAD' },
        { definitionKey: 'I_90', displayName: 'I-90', entityType: 'WORKLOAD' },
        { definitionKey: 'I_131', displayName: 'I-131', entityType: 'WORKLOAD' }
      ],
      [
        { definitionKey: 'I_407_WORKLOAD', displayName: 'I-407 Workload', version: '0.1.0', lifecycleStatus: 'DRAFT' },
        { definitionKey: 'I_90', displayName: 'I-90', version: '0.1.0', lifecycleStatus: 'DRAFT' },
        { definitionKey: 'I_131', displayName: 'I-131', version: '0.1.0', lifecycleStatus: 'DRAFT' }
      ],
      'try'
    );
    expect(filterWorkKinds(kinds, 'i40').map((kind) => kind.label)).toEqual(['I-407']);
    expect(filterWorkKinds(kinds, '90').map((kind) => kind.label)).toEqual(['I-90']);
    expect(filterWorkKinds(kinds, 'mail')).toEqual([]);
    expect(filterWorkKinds(kinds, '').map((kind) => kind.label)).toEqual(['I-131', 'I-407', 'I-90']);
  });
});
