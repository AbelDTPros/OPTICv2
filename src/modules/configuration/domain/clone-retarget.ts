import {
  compactKindKey,
  isMailDefinitionKey,
  isWorkloadDefinitionKey,
  kindKeyFromDefinition,
  kindLabel
} from './kind-key.js';

export interface CloneChild {
  stableKey: string;
  config: Record<string, unknown>;
}

export interface CloneRetarget {
  sourceDefinitionKey: string;
  targetDefinitionKey: string;
  sourceKind: string;
  targetKind: string;
  tokens: Array<[string, string]>;
  formMap: Map<string, string>;
  queueMap: Map<string, string>;
  bulkMap: Map<string, string>;
}

export function shouldRetargetClone(sourceDefinitionKey: string, targetDefinitionKey: string): boolean {
  return sourceDefinitionKey !== targetDefinitionKey;
}

export function createCloneRetarget(
  sourceDefinitionKey: string,
  targetDefinitionKey: string,
  children: Array<{ kind: string; stableKey: string; config: Record<string, unknown> }>
): CloneRetarget {
  const sourceKind = kindKeyFromDefinition(sourceDefinitionKey);
  const targetKind = kindKeyFromDefinition(targetDefinitionKey);
  const tokens = tokenPairs(sourceDefinitionKey, targetDefinitionKey, sourceKind, targetKind);
  const formMap = new Map<string, string>();
  const queueMap = new Map<string, string>();
  const bulkMap = new Map<string, string>();
  for (const child of children) {
    const original = identityKey(child.kind, child.stableKey, child.config);
    if (child.kind === 'form') {
      formMap.set(original, nextPackageKey(original, tokens, targetKind, true));
    } else if (child.kind === 'queue') {
      queueMap.set(original, nextPackageKey(original, tokens, targetKind, true));
    } else if (child.kind === 'bulkAction') {
      bulkMap.set(original, nextPackageKey(original, tokens, targetKind, true));
    }
  }
  return {
    sourceDefinitionKey,
    targetDefinitionKey,
    sourceKind,
    targetKind,
    tokens,
    formMap,
    queueMap,
    bulkMap
  };
}

export function retargetClonedValue(value: unknown, retarget: CloneRetarget): unknown {
  return rewriteValue(value, retarget, 'spec');
}

export function retargetClonedChild(
  kind: string,
  child: CloneChild,
  retarget: CloneRetarget
): CloneChild {
  const rewritten = rewriteValue(child.config, retarget, kind) as Record<string, unknown>;
  const nextKey = mappedIdentity(kind, child.stableKey, child.config, rewritten, retarget);
  applyIdentity(kind, rewritten, nextKey);
  return { stableKey: nextKey, config: rewritten };
}

export function retargetSpawnDefinitionKey(value: string, retarget: CloneRetarget): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed === retarget.sourceDefinitionKey) {
    return pairedTarget(retarget, retarget.sourceDefinitionKey);
  }
  const referencedKind = kindKeyFromDefinition(trimmed);
  if (referencedKind === retarget.sourceKind) {
    return pairedTarget(retarget, trimmed);
  }
  return applyTokens(trimmed, retarget.tokens);
}

function tokenPairs(
  sourceDefinitionKey: string,
  targetDefinitionKey: string,
  sourceKind: string,
  targetKind: string
): Array<[string, string]> {
  const pairs: Array<[string, string]> = [
    [sourceDefinitionKey, targetDefinitionKey],
    [`${sourceKind}_WORKLOAD`, `${targetKind}_WORKLOAD`],
    [`${sourceKind}_MAILITEM`, `${targetKind}_MAILITEM`],
    [`${sourceKind}_MAIL_ITEM`, `${targetKind}_MAIL_ITEM`],
    [sourceKind, targetKind],
    [compactKindKey(sourceKind), compactKindKey(targetKind)],
    [kindLabel(sourceKind), kindLabel(targetKind)],
    [kindLabel(sourceKind).replace(/-/g, ' '), kindLabel(targetKind).replace(/-/g, ' ')]
  ];
  const seen = new Set<string>();
  return pairs
    .filter(([from, to]) => from && to && from !== to && !seen.has(from) && (seen.add(from), true))
    .sort((left, right) => right[0].length - left[0].length);
}

function nextPackageKey(
  original: string,
  tokens: Array<[string, string]>,
  targetKind: string,
  uniquify: boolean
): string {
  const tokenized = applyTokens(original, tokens);
  if (!uniquify || containsKind(tokenized, targetKind)) {
    return tokenized;
  }
  return `${targetKind}_${tokenized}`;
}

function containsKind(value: string, kindKey: string): boolean {
  return value.includes(kindKey) || value.includes(compactKindKey(kindKey));
}

function identityKey(kind: string, stableKey: string, config: Record<string, unknown>): string {
  const field = identityField(kind);
  const fromConfig = field ? config[field] : undefined;
  return typeof fromConfig === 'string' && fromConfig ? fromConfig : stableKey;
}

function mappedIdentity(
  kind: string,
  stableKey: string,
  original: Record<string, unknown>,
  rewritten: Record<string, unknown>,
  retarget: CloneRetarget
): string {
  const originalKey = identityKey(kind, stableKey, original);
  if (kind === 'form') {
    return retarget.formMap.get(originalKey) ?? applyTokens(originalKey, retarget.tokens);
  }
  if (kind === 'queue') {
    return retarget.queueMap.get(originalKey) ?? nextPackageKey(originalKey, retarget.tokens, retarget.targetKind, true);
  }
  if (kind === 'bulkAction') {
    return retarget.bulkMap.get(originalKey) ?? nextPackageKey(originalKey, retarget.tokens, retarget.targetKind, true);
  }
  if (kind === 'stage') {
    return typeof rewritten.stageKey === 'string' ? rewritten.stageKey : originalKey;
  }
  return applyTokens(originalKey, retarget.tokens);
}

function applyIdentity(kind: string, config: Record<string, unknown>, nextKey: string): void {
  const field = identityField(kind);
  if (field) {
    config[field] = nextKey;
  }
}

function identityField(kind: string): string | undefined {
  switch (kind) {
    case 'stage':
      return 'stageKey';
    case 'transition':
      return 'transitionSetKey';
    case 'form':
      return 'formKey';
    case 'action':
      return 'actionKey';
    case 'queue':
      return 'queueKey';
    case 'bulkAction':
      return 'bulkActionKey';
    case 'scheduledAction':
      return 'scheduledActionKey';
    case 'sla':
      return 'slaKey';
    case 'search':
      return 'searchKey';
    default:
      return undefined;
  }
}

function rewriteValue(value: unknown, retarget: CloneRetarget, kind: string): unknown {
  if (typeof value === 'string') {
    return rewriteString(value, retarget, kind);
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteValue(item, retarget, kind));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      if (key === 'spawnDefinitionKey' && typeof nested === 'string') {
        next[key] = retargetSpawnDefinitionKey(nested, retarget);
        continue;
      }
      if (key === 'formKey' && typeof nested === 'string') {
        next[key] = retarget.formMap.get(nested) ?? applyTokens(nested, retarget.tokens);
        continue;
      }
      if (key === 'queueKey' && typeof nested === 'string') {
        next[key] = retarget.queueMap.get(nested) ?? nested;
        continue;
      }
      if (key === 'displayName' && kind === 'queue' && typeof nested === 'string') {
        next[key] = nested;
        continue;
      }
      if (key === 'bulkActionKey' && typeof nested === 'string') {
        next[key] = retarget.bulkMap.get(nested) ?? applyTokens(nested, retarget.tokens);
        continue;
      }
      if ((key === 'bulkActionKeys' || key === 'actionKeys') && Array.isArray(nested)) {
        next[key] = nested.map((item) =>
          typeof item === 'string' && key === 'bulkActionKeys'
            ? (retarget.bulkMap.get(item) ?? applyTokens(item, retarget.tokens))
            : rewriteValue(item, retarget, kind)
        );
        continue;
      }
      if (key === 'stageKey' || key === 'currentStageKey' || key === 'initialStageKey') {
        next[key] = nested;
        continue;
      }
      next[key] = rewriteValue(nested, retarget, kind);
    }
    return next;
  }
  return value;
}

function rewriteString(value: string, retarget: CloneRetarget, kind: string): string {
  if (kind === 'stage' && retarget.queueMap.has(value) && !retarget.formMap.has(value)) {
    return applyTokens(value, retarget.tokens);
  }
  return applyTokens(value, retarget.tokens);
}

function applyTokens(value: string, tokens: Array<[string, string]>): string {
  let next = value;
  for (const [from, to] of tokens) {
    if (next.includes(from)) {
      next = next.split(from).join(to);
    }
  }
  return next;
}

function pairedTarget(retarget: CloneRetarget, sourceRef: string): string {
  if (isMailDefinitionKey(sourceRef)) {
    return `${retarget.targetKind}_MAILITEM`;
  }
  if (isWorkloadDefinitionKey(sourceRef) || sourceRef === retarget.sourceKind) {
    return `${retarget.targetKind}_WORKLOAD`;
  }
  if (sourceRef === retarget.sourceDefinitionKey) {
    const suffix = retarget.sourceDefinitionKey.slice(retarget.sourceKind.length);
    return `${retarget.targetKind}${suffix}`;
  }
  return `${retarget.targetKind}${sourceRef.slice(retarget.sourceKind.length)}`;
}
