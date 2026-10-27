const MAIL_SUFFIXES = /_(MAILITEM|MAIL_ITEM|MAIL)$/;
const WORKLOAD_SUFFIX = /_WORKLOAD$/;

export function kindKeyFromDefinition(definitionKey: string): string {
  return definitionKey.replace(MAIL_SUFFIXES, '').replace(WORKLOAD_SUFFIX, '');
}

export function kindLabel(kindKey: string): string {
  return kindKey.replace(/_/g, '-');
}

export function compactKindKey(kindKey: string): string {
  return kindKey.replace(/_/g, '');
}

export function isMailDefinitionKey(definitionKey: string): boolean {
  return MAIL_SUFFIXES.test(definitionKey);
}

export function isWorkloadDefinitionKey(definitionKey: string): boolean {
  return WORKLOAD_SUFFIX.test(definitionKey);
}
