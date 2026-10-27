export const PALETTE_COMPONENTS = [
  { component: 'TEXT_INPUT', label: 'Text' },
  { component: 'TEXT_AREA', label: 'Text area' },
  { component: 'NUMBER_INPUT', label: 'Number' },
  { component: 'CURRENCY_INPUT', label: 'Currency' },
  { component: 'DATE_INPUT', label: 'Date' },
  { component: 'BOOLEAN_CHECKBOX', label: 'Checkbox' },
  { component: 'YES_NO_RADIO', label: 'Yes / No' },
  { component: 'RADIO', label: 'Radio buttons' },
  { component: 'SELECT', label: 'Dropdown' },
  { component: 'A_NUMBER_INPUT', label: 'A-Number' },
  { component: 'RECEIPT_NUMBER_INPUT', label: 'Receipt number' },
  { component: 'TRACKING_ID_DISPLAY', label: 'Tracking ID' },
  { component: 'READ_ONLY_VALUE', label: 'Read-only value' },
  { component: 'ALERT', label: 'Alert' }
] as const;

const EXTRA_PALETTE_LABELS: Record<string, string> = {
  MULTI_SELECT: 'Multi-select',
  USER_DISPLAY: 'User display',
  USER_LOOKUP: 'User lookup',
  SECTION: 'Section'
};

export const ALLOWED_FORM_COMPONENTS = new Set([
  ...PALETTE_COMPONENTS.map((item) => item.component),
  ...Object.keys(EXTRA_PALETTE_LABELS)
]);

export function paletteLabel(component: string): string {
  return (
    PALETTE_COMPONENTS.find((item) => item.component === component)?.label ??
    EXTRA_PALETTE_LABELS[component] ??
    component.replaceAll('_', ' ')
  );
}

export function paletteOptions(current?: string): Array<{ component: string; label: string }> {
  const options = PALETTE_COMPONENTS.map((item) => ({ component: item.component, label: item.label }));
  if (current && !options.some((item) => item.component === current)) {
    options.push({ component: current, label: paletteLabel(current) });
  }
  return options;
}

export function nextStableKey(prefix: string, existing: string[]): string {
  const used = new Set(existing);
  if (!used.has(prefix)) {
    return prefix;
  }
  let index = 2;
  while (used.has(`${prefix}_${index}`)) {
    index += 1;
  }
  return `${prefix}_${index}`;
}

export function pathFromFieldKey(fieldKey: string): string {
  const camel = fieldKey
    .toLowerCase()
    .split('_')
    .map((part, index) => (index === 0 ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join('');
  return `$.${camel}`;
}

export function generatedFieldKeyPrefix(component: string): string {
  return component === 'TRACKING_ID_DISPLAY' ? 'TRACKING_ID' : component;
}

export function isGeneratedFieldKey(fieldKey: string, component: string): boolean {
  const prefix = generatedFieldKeyPrefix(component);
  return fieldKey === prefix || new RegExp(`^${prefix}_\\d+$`).test(fieldKey);
}
