import type { DefinitionLifecycle } from '../../../../src/modules/configuration/domain/types.js';

export interface KindDefinition {
  definitionKey: string;
  displayName: string;
  entityType?: string;
}

export interface KindRelease {
  definitionKey: string;
  displayName: string;
  version: string;
  lifecycleStatus: DefinitionLifecycle;
  /** True when this release is the Live pointer. Live tiles use this, not the newest published. */
  active?: boolean;
}

export interface KindMember {
  definitionKey: string;
  displayName: string;
  entityType: 'MAIL' | 'WORKLOAD';
  version: string;
  lifecycleStatus: DefinitionLifecycle;
}

export interface WorkKind {
  kindKey: string;
  label: string;
  members: KindMember[];
}

const MAIL_SUFFIXES = /_(MAILITEM|MAIL_ITEM|MAIL)$/;
const WORKLOAD_SUFFIX = /_WORKLOAD$/;

export function kindKeyFromDefinition(definitionKey: string): string {
  return definitionKey.replace(MAIL_SUFFIXES, '').replace(WORKLOAD_SUFFIX, '');
}

export function kindLabel(kindKey: string): string {
  return kindKey.replace(/_/g, '-');
}

export function normalizeKindEntityType(entityType?: string): 'MAIL' | 'WORKLOAD' {
  return entityType === 'MAIL' ? 'MAIL' : 'WORKLOAD';
}

export function groupWorkKinds(
  definitions: KindDefinition[],
  releases: KindRelease[],
  mode: 'try' | 'live'
): WorkKind[] {
  const entityByKey = new Map(definitions.map((item) => [item.definitionKey, item]));
  const picked = new Map<string, KindRelease>();
  for (const release of releases) {
    if (mode === 'live' && (release.lifecycleStatus !== 'PUBLISHED' || !release.active)) {
      continue;
    }
    const current = picked.get(release.definitionKey);
    if (!current || compareReleases(release, current, mode) > 0) {
      picked.set(release.definitionKey, release);
    }
  }

  const groups = new Map<string, WorkKind>();
  for (const release of picked.values()) {
    const definition = entityByKey.get(release.definitionKey);
    const kindKey = kindKeyFromDefinition(release.definitionKey);
    const member: KindMember = {
      definitionKey: release.definitionKey,
      displayName: definition?.displayName || release.displayName,
      entityType: normalizeKindEntityType(definition?.entityType),
      version: release.version,
      lifecycleStatus: release.lifecycleStatus
    };
    const group = groups.get(kindKey) ?? {
      kindKey,
      label: kindLabel(kindKey),
      members: []
    };
    group.members.push(member);
    groups.set(kindKey, group);
  }

  return [...groups.values()]
    .map((kind) => ({
      ...kind,
      members: [...kind.members].sort((left, right) => {
        if (left.entityType !== right.entityType) {
          return left.entityType === 'MAIL' ? -1 : 1;
        }
        return left.definitionKey.localeCompare(right.definitionKey);
      })
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function intakeMember(kind: WorkKind): KindMember | undefined {
  return kind.members.find((member) => member.entityType === 'MAIL') ?? kind.members[0];
}

export function filterWorkKinds(kinds: WorkKind[], query: string): WorkKind[] {
  const needle = normalizeKindSearch(query);
  if (!needle) {
    return kinds;
  }
  return kinds.filter((kind) => kindSearchHaystack(kind).includes(needle));
}

function normalizeKindSearch(value: string): string {
  return value.toLowerCase().replace(/[-_\s]+/g, '');
}

function kindSearchHaystack(kind: WorkKind): string {
  return normalizeKindSearch(
    [kind.label, kind.kindKey, ...kind.members.flatMap((member) => [member.displayName, member.definitionKey, member.entityType])].join(
      ' '
    )
  );
}

function compareReleases(left: KindRelease, right: KindRelease, mode: 'try' | 'live'): number {
  const rank = rankRelease(left, mode) - rankRelease(right, mode);
  return rank !== 0 ? rank : compareVersions(left.version, right.version);
}

function rankRelease(release: KindRelease, mode: 'try' | 'live'): number {
  if (mode === 'live') {
    return release.active && release.lifecycleStatus === 'PUBLISHED' ? 3 : 0;
  }
  if (release.lifecycleStatus === 'DRAFT') {
    return 4;
  }
  if (release.lifecycleStatus === 'IN_REVIEW') {
    return 3;
  }
  if (release.lifecycleStatus === 'PUBLISHED') {
    return 2;
  }
  return 1;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}
