export function fieldInputId(fieldKey: string): string {
  return `field-${fieldKey}`;
}

export function fieldHelpId(fieldKey: string): string {
  return `field-${fieldKey}-help`;
}

export function fieldErrorId(fieldKey: string): string {
  return `field-${fieldKey}-error`;
}

export function describedBy(fieldKey: string, hasHelp: boolean, hasError: boolean): string | undefined {
  const ids = [
    hasHelp ? fieldHelpId(fieldKey) : undefined,
    hasError ? fieldErrorId(fieldKey) : undefined
  ].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}
