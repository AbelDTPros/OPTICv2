import type { FormFieldValidation } from './types.js';

export type ValidationRuleFamily = 'length' | 'number' | 'date' | 'items' | 'none';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validationRuleFamily(component: string): ValidationRuleFamily {
  switch (component) {
    case 'TEXT_INPUT':
    case 'TEXT_AREA':
    case 'A_NUMBER_INPUT':
    case 'RECEIPT_NUMBER_INPUT':
    case 'USER_LOOKUP':
      return 'length';
    case 'NUMBER_INPUT':
    case 'CURRENCY_INPUT':
      return 'number';
    case 'DATE_INPUT':
      return 'date';
    case 'MULTI_SELECT':
      return 'items';
    default:
      return 'none';
  }
}

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
}

export function validationForComponent(
  component: string,
  validation?: FormFieldValidation
): FormFieldValidation | undefined {
  if (!validation) {
    return undefined;
  }
  const family = validationRuleFamily(component);
  const next: FormFieldValidation = {};
  if (family === 'length') {
    copyNumber(next, validation, 'minLength');
    copyNumber(next, validation, 'maxLength');
    if (validation.pattern?.trim()) {
      next.pattern = validation.pattern.trim();
    }
  } else if (family === 'number') {
    copyNumber(next, validation, 'minimum');
    copyNumber(next, validation, 'maximum');
  } else if (family === 'date') {
    if (validation.minDate?.trim() && isIsoDate(validation.minDate.trim())) {
      next.minDate = validation.minDate.trim();
    }
    if (validation.maxDate?.trim() && isIsoDate(validation.maxDate.trim())) {
      next.maxDate = validation.maxDate.trim();
    }
  } else if (family === 'items') {
    copyNumber(next, validation, 'minItems');
    copyNumber(next, validation, 'maxItems');
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function copyNumber(
  target: FormFieldValidation,
  source: FormFieldValidation,
  key: 'minLength' | 'maxLength' | 'minimum' | 'maximum' | 'minItems' | 'maxItems'
): void {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    target[key] = value;
  }
}
