import { fieldInputId, validationFailed } from '../../../platform/errors/app-error.js';
import type {
  CompiledSchemaValidator,
  SchemaValidationIssue
} from '../../configuration/definitions/schema-compiler.js';
import { resolveFieldStates } from '../../configuration/domain/resolve-field-state.js';
import { schemaFromForm, sharedEntitySchemaFromForm } from '../../configuration/domain/schema-from-form.js';
import { fieldStoragePath } from '../../configuration/domain/shared-entity-paths.js';
import type {
  FormFieldDefinition,
  FormSectionDefinition,
  JsonSchema,
  StageFormDefinition
} from '../../configuration/domain/types.js';
import { compileBusinessSchema } from '../../configuration/definitions/schema-compiler.js';
import { getAtPath } from './merge-patch.js';

export function withoutRequired(schema: JsonSchema): JsonSchema {
  return stripRequired(structuredClone(schema)) as JsonSchema;
}

export function assertStageDataValid(
  compiled: CompiledSchemaValidator,
  businessData: unknown,
  form: StageFormDefinition | undefined,
  options?: { mode?: 'strict' | 'draft'; schema?: JsonSchema }
): void {
  const mode = options?.mode ?? 'strict';
  const formSchema = form?.schema ? schemaFromForm(form) : undefined;
  const schema =
    mode === 'draft'
      ? compileBusinessSchema(withoutRequired((formSchema ?? options?.schema ?? {}) as JsonSchema))
      : formSchema
        ? compileBusinessSchema(formSchema)
        : compiled;
  const target = form?.schema ? getAtPath(businessData, form.dataPath) : businessData;
  const result = schema.validate(
    formSchema ? pickKnownProperties(target ?? {}, formSchema) : (target ?? {})
  );
  const errors = [...(result.valid ? [] : result.errors)];
  const sharedSchema = form ? sharedEntitySchemaFromForm(form) : undefined;
  if (sharedSchema) {
    const sharedCompiled =
      mode === 'draft'
        ? compileBusinessSchema(withoutRequired(sharedSchema))
        : compileBusinessSchema(sharedSchema);
    const sharedResult = sharedCompiled.validate(pickKnownProperties(businessData ?? {}, sharedSchema));
    if (!sharedResult.valid) {
      errors.push(...sharedResult.errors);
    }
  }
  if (mode === 'strict' && form) {
    errors.push(...collectRepeatingCountMatchIssues(form, target ?? {}));
    errors.push(...collectBehaviorRequiredIssues(form, businessData ?? {}));
  }
  if (errors.length === 0) {
    return;
  }
  const details = dedupeFieldValidationDetails(
    errors.map((error) => {
      const path = resolveIssuePath(error);
      const formField = findFormFieldForIssue(form, path, error.propertyName);
      const fieldKey = formField?.fieldKey ?? error.propertyName ?? pathLeaf(path);
      return {
        field: fieldKey,
        path,
        message: humanizeValidationMessage(error, formField, fieldKey),
        inputId: fieldInputId(fieldKey),
        keyword: error.keyword
      };
    })
  );
  throw validationFailed(
    mode === 'draft' ? 'OPTIC-WF-40051' : 'OPTIC-WF-40050',
    mode === 'draft'
      ? 'Draft data has an invalid type or format. Required fields can still be completed later.'
      : 'Stage data is not valid for this action. Review the highlighted fields and try again.',
    details.map(({ keyword: _keyword, ...detail }) => detail)
  );
}

/** Empty fields often hit both schema minLength and behavior-required; keep one message per field. */
function dedupeFieldValidationDetails<
  T extends { field?: string; path?: string; message: string; keyword?: string }
>(details: T[]): T[] {
  const preferred = new Map<string, T>();
  for (const detail of details) {
    const key = detail.field || detail.path || detail.message;
    const current = preferred.get(key);
    if (!current) {
      preferred.set(key, detail);
      continue;
    }
    if (detail.keyword === 'required' && current.keyword !== 'required') {
      preferred.set(key, detail);
    }
  }
  return [...preferred.values()];
}

function collectBehaviorRequiredIssues(
  form: StageFormDefinition,
  businessData: unknown
): SchemaValidationIssue[] {
  const formValue = getAtPath(businessData, form.dataPath || '$') ?? {};
  const states = resolveFieldStates(form, formValue, undefined, { businessData });
  const issues: SchemaValidationIssue[] = [];
  // Repeating-section fields are validated per row by the array item schema, not as
  // top-level paths ($.dataPath.field). Checking them here falsely fails Complete.
  const fields = form.sections.flatMap((section) => (section.repeatable ? [] : section.fields));
  for (const field of fields) {
    const state = states[field.fieldKey];
    if (!state?.required || !state.visible) {
      continue;
    }
    const storagePath = fieldStoragePath(form, field);
    const value = getAtPath(businessData, storagePath);
    if (!isMissingFieldValue(value)) {
      continue;
    }
    issues.push({
      path: toRelativeIssuePath(storagePath),
      keyword: 'required',
      propertyName: field.fieldKey,
      message: 'must have required property'
    });
  }
  return issues;
}

function isMissingFieldValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) {
    return true;
  }
  return false;
}

function collectRepeatingCountMatchIssues(
  form: StageFormDefinition,
  formValue: unknown
): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = [];
  for (const section of form.sections) {
    if (!section.repeatable || !section.matchCountField || !section.countFieldKey?.trim()) {
      continue;
    }
    const countField = findFieldByKey(form, section.countFieldKey);
    if (!countField) {
      continue;
    }
    const expected = readTruncatedNumber(getAtPath(formValue, countField.path));
    const actual = repeatingItemCount(formValue, section);
    const countPath = toRelativeIssuePath(countField.path);
    if (expected === undefined) {
      issues.push({
        path: countPath,
        keyword: 'type',
        propertyName: pathLeaf(countField.path),
        message: 'Enter how many copies to create before Complete.'
      });
      continue;
    }
    if (expected < 0) {
      issues.push({
        path: countPath,
        keyword: 'minimum',
        propertyName: pathLeaf(countField.path),
        message: 'must be zero or greater.'
      });
      continue;
    }
    if (actual !== expected) {
      const copyLabel = (section.itemLabel?.trim() || 'copy').toLowerCase();
      issues.push({
        path: countPath,
        keyword: 'const',
        propertyName: pathLeaf(countField.path),
        message: `needs ${expected} ${copyLabel} copies, but found ${actual}.`
      });
    }
  }
  return issues;
}

function findFieldByKey(form: StageFormDefinition, fieldKey: string): FormFieldDefinition | undefined {
  for (const section of form.sections) {
    const match = section.fields.find((field) => field.fieldKey === fieldKey);
    if (match) {
      return match;
    }
  }
  return undefined;
}

function repeatingItemCount(formValue: unknown, section: FormSectionDefinition): number {
  const raw = getAtPath(formValue, section.path?.trim() || '$.workloads');
  return Array.isArray(raw) ? raw.length : 0;
}

function readTruncatedNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.trunc(parsed);
}

function toRelativeIssuePath(fieldPath: string): string {
  if (!fieldPath.startsWith('$.') || fieldPath === '$') {
    return '/';
  }
  return `/${fieldPath.slice(2).replaceAll('.', '/')}`;
}

function findFormFieldForIssue(
  form: StageFormDefinition | undefined,
  path: string,
  propertyName?: string
): FormFieldDefinition | undefined {
  if (!form) {
    return undefined;
  }
  const fields = form.sections.flatMap((section) => section.fields);
  const candidates = [propertyName, pathLeaf(path)].filter(
    (value): value is string => Boolean(value && value !== '$')
  );
  for (const candidate of candidates) {
    const match = fields.find(
      (item) =>
        item.fieldKey === candidate ||
        item.path === `$.${candidate}` ||
        item.path === path ||
        item.path.endsWith(`.${candidate}`) ||
        pathLeaf(item.path) === candidate
    );
    if (match) {
      return match;
    }
  }
  return undefined;
}

function humanizeValidationMessage(
  error: SchemaValidationIssue,
  formField: FormFieldDefinition | undefined,
  fallbackKey: string
): string {
  const label = formField?.label?.trim() || fallbackKey;
  const propertyName = error.propertyName ?? pathLeaf(toJsonPath(error.path));
  if (error.keyword === 'required' || /must have required property/i.test(error.message)) {
    return `${label} is required.`;
  }
  let message = error.message;
  if (propertyName && label !== propertyName) {
    message = message
      .replaceAll(`'${propertyName}'`, label)
      .replaceAll(`"${propertyName}"`, label)
      .replaceAll(propertyName, label);
  }
  if (formField?.label?.trim() && !message.toLowerCase().startsWith(label.toLowerCase())) {
    return `${label}: ${message}`;
  }
  return message;
}

function resolveIssuePath(error: SchemaValidationIssue): string {
  const base = toJsonPath(error.path);
  if (error.keyword === 'required' && error.propertyName) {
    return base === '$' ? `$.${error.propertyName}` : `${base}.${error.propertyName}`;
  }
  return base;
}

function pathLeaf(path: string): string {
  return path.replace(/^\$\.?/, '').split('.').filter(Boolean).at(-1) ?? path;
}

function stripRequired(node: unknown): unknown {
  if (!node || typeof node !== 'object') {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((item) => stripRequired(item));
  }
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'required') {
      continue;
    }
    next[key] = stripRequired(value);
  }
  return next;
}

function pickKnownProperties(data: unknown, schema: JsonSchema): unknown {
  if (Array.isArray(data)) {
    const itemSchema = schema.items;
    if (!itemSchema || typeof itemSchema !== 'object' || Array.isArray(itemSchema)) {
      return data;
    }
    return data.map((item) => pickKnownProperties(item, itemSchema as JsonSchema));
  }
  if (data === null || typeof data !== 'object') {
    return data;
  }
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return data;
  }
  const source = data as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, node] of Object.entries(properties as Record<string, unknown>)) {
    if (!(key in source)) {
      continue;
    }
    next[key] =
      node && typeof node === 'object' && !Array.isArray(node)
        ? pickKnownProperties(source[key], node as JsonSchema)
        : source[key];
  }
  return next;
}

function toJsonPath(instancePath: string): string {
  if (!instancePath || instancePath === '/') {
    return '$';
  }
  return `$${instancePath.replaceAll('/', '.')}`;
}
