import { validationForComponent } from './field-validation.js';
import { isSharedEntityPath } from './shared-entity-paths.js';
import type { FormFieldDefinition, JsonSchema, StageFormDefinition } from './types.js';

const SCHEMA_SKIP_COMPONENTS = new Set(['ALERT']);
const SCHEMA_PRESERVE_KEYS = ['description', 'title'];
const SCHEMA_INPUT_COMPONENTS = new Set([
  'TEXT_INPUT',
  'TEXT_AREA',
  'NUMBER_INPUT',
  'CURRENCY_INPUT',
  'DATE_INPUT',
  'BOOLEAN_CHECKBOX',
  'YES_NO_RADIO',
  'RADIO',
  'SELECT',
  'MULTI_SELECT',
  'A_NUMBER_INPUT',
  'RECEIPT_NUMBER_INPUT',
  'USER_LOOKUP'
]);

/** Build the form schema from canvas fields. Properties no longer on the canvas are dropped; remaining hand-edits (title, description) are kept. */
export function schemaFromForm(form: StageFormDefinition): JsonSchema {
  const generated: JsonSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    properties: {}
  };
  for (const section of form.sections) {
    if (section.repeatable) {
      const keys = jsonPathKeys(section.path || '$.workloads');
      if (keys.length === 0) {
        continue;
      }
      const itemProperties: Record<string, unknown> = {};
      for (const field of section.fields) {
        assignFieldSchema(itemProperties, field);
      }
      const itemSchema: JsonSchema = {
        type: 'object',
        additionalProperties: false,
        properties: itemProperties
      };
      const itemRequired = requiredPropertyNames(section.fields);
      if (itemRequired.length > 0) {
        itemSchema.required = itemRequired;
      }
      const arraySchema: JsonSchema = {
        type: 'array',
        items: itemSchema
      };
      if (isFiniteNumber(section.minItems)) {
        arraySchema.minItems = section.minItems;
      }
      if (isFiniteNumber(section.maxItems)) {
        arraySchema.maxItems = section.maxItems;
      }
      setSchemaNode(generated, keys, arraySchema);
      if (isFiniteNumber(section.minItems) && section.minItems > 0) {
        markRequiredAtPath(generated, section.path || '$.workloads');
      }
      continue;
    }
    for (const field of section.fields) {
      if (isSharedEntityPath(field.path)) {
        continue;
      }
      assignFieldSchema(ensureProperties(generated), field);
    }
  }
  const required = requiredPropertyNames(
    form.sections.flatMap((section) => (section.repeatable ? [] : section.fields)).filter((field) => !isSharedEntityPath(field.path))
  );
  if (required.length > 0) {
    generated.required = required;
  }
  return mergeSchemaNode(stripSharedPropertiesFromSchema(form.schema), generated);
}

/** Case-root schema fragment for $.workload / $.mailItem fields on this form. */
export function sharedEntitySchemaFromForm(form: StageFormDefinition): JsonSchema | undefined {
  const generated: JsonSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    properties: {}
  };
  let any = false;
  for (const section of form.sections) {
    if (section.repeatable) {
      continue;
    }
    for (const field of section.fields) {
      if (!isSharedEntityPath(field.path)) {
        continue;
      }
      any = true;
      assignFieldSchema(ensureProperties(generated), field);
    }
  }
  if (!any) {
    return undefined;
  }
  for (const field of form.sections.flatMap((section) => (section.repeatable ? [] : section.fields))) {
    if (!field.required || !SCHEMA_INPUT_COMPONENTS.has(field.component) || !isSharedEntityPath(field.path)) {
      continue;
    }
    markRequiredAtPath(generated, field.path);
  }
  return generated;
}

function markRequiredAtPath(schema: JsonSchema, path: string): void {
  const keys = jsonPathKeys(path);
  let cursor = schema;
  for (const [index, key] of keys.entries()) {
    const properties = ensureProperties(cursor);
    if (index === keys.length - 1) {
      const required = Array.isArray(cursor.required) ? [...cursor.required] : [];
      if (!required.includes(key)) {
        cursor.required = [...required, key];
      }
      return;
    }
    let child = properties[key];
    if (!child || typeof child !== 'object' || Array.isArray(child)) {
      child = { type: 'object', additionalProperties: false, properties: {} };
      properties[key] = child;
    }
    cursor = child as JsonSchema;
  }
}

function stripSharedPropertiesFromSchema(schema: JsonSchema | undefined): JsonSchema | undefined {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return schema;
  }
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return schema;
  }
  const nextProps = { ...(properties as Record<string, unknown>) };
  delete nextProps.workload;
  delete nextProps.mailItem;
  return { ...schema, properties: nextProps };
}

function assignFieldSchema(properties: Record<string, unknown>, field: FormFieldDefinition): void {
  if (SCHEMA_SKIP_COMPONENTS.has(field.component)) {
    return;
  }
  const keys = jsonPathKeys(field.path);
  if (keys.length === 0) {
    return;
  }
  const node = schemaNodeForField(field);
  if (keys.length === 1) {
    properties[keys[0]!] = mergeSchemaNode(properties[keys[0]!], node);
    return;
  }
  setSchemaNode({ type: 'object', properties }, keys, node);
}

function schemaNodeForField(field: FormFieldDefinition): JsonSchema {
  const node = schemaTypeForField(field);
  const rules = validationForComponent(field.component, field.validation);
  if (rules?.pattern) {
    node.pattern = rules.pattern;
  }
  if (isFiniteNumber(rules?.minLength)) {
    node.minLength = rules.minLength;
  }
  if (isFiniteNumber(rules?.maxLength)) {
    node.maxLength = rules.maxLength;
  }
  if (isFiniteNumber(rules?.minimum)) {
    node.minimum = rules.minimum;
  }
  if (isFiniteNumber(rules?.maximum)) {
    node.maximum = rules.maximum;
  }
  if (rules?.minDate) {
    node.minDate = rules.minDate;
  }
  if (rules?.maxDate) {
    node.maxDate = rules.maxDate;
  }
  if (isFiniteNumber(rules?.minItems)) {
    node.minItems = rules.minItems;
  }
  if (isFiniteNumber(rules?.maxItems)) {
    node.maxItems = rules.maxItems;
  }
  return node;
}

function schemaTypeForField(field: FormFieldDefinition): JsonSchema {
  switch (field.component) {
    case 'NUMBER_INPUT':
    case 'CURRENCY_INPUT':
      return { type: 'number' };
    case 'BOOLEAN_CHECKBOX':
      return { type: 'boolean' };
    case 'DATE_INPUT':
      return { type: 'string', format: 'date' };
    case 'YES_NO_RADIO':
      return { type: 'string', enum: ['Yes', 'No'] };
    case 'RADIO':
    case 'SELECT':
    case 'MULTI_SELECT': {
      const values = (field.options ?? []).map((option) => option.value).filter(Boolean);
      if (field.component === 'MULTI_SELECT') {
        return values.length > 0 ? { type: 'array', items: { type: 'string', enum: values } } : { type: 'array', items: { type: 'string' } };
      }
      return values.length > 0 ? { type: 'string', enum: values } : { type: 'string' };
    }
    default:
      return { type: 'string' };
  }
}

function requiredPropertyNames(fields: FormFieldDefinition[]): string[] {
  const names: string[] = [];
  for (const field of fields) {
    if (!field.required || !SCHEMA_INPUT_COMPONENTS.has(field.component)) {
      continue;
    }
    const name = jsonPathKeys(field.path).at(-1);
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function jsonPathKeys(path: string): string[] {
  if (!path.startsWith('$.') || path === '$') {
    return [];
  }
  return path.slice(2).split('.').filter(Boolean);
}

function ensureProperties(schema: JsonSchema): Record<string, unknown> {
  const current = schema.properties;
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  schema.properties = next;
  return next;
}

function schemaProperties(schema: JsonSchema): Record<string, unknown> | undefined {
  const current = schema.properties;
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  return undefined;
}

function setSchemaNode(root: JsonSchema, keys: string[], node: JsonSchema): void {
  const properties = ensureProperties(root);
  let cursor = properties;
  for (const [index, key] of keys.entries()) {
    if (index === keys.length - 1) {
      cursor[key] = mergeSchemaNode(cursor[key], node);
      return;
    }
    const objectNode = asObjectSchema(cursor[key]);
    cursor[key] = objectNode;
    cursor = ensureProperties(objectNode);
  }
}

function asObjectSchema(value: unknown): JsonSchema {
  if (value && typeof value === 'object' && !Array.isArray(value) && (value as JsonSchema).type === 'object') {
    return value as JsonSchema;
  }
  return { type: 'object', additionalProperties: false, properties: {} };
}

function mergeSchemaNode(existing: unknown, generated: JsonSchema): JsonSchema {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    return generated;
  }
  const current = existing as JsonSchema;
  if (generated.type === 'object') {
    const generatedProperties = schemaProperties(generated) ?? {};
    const existingProperties = schemaProperties(current) ?? {};
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(generatedProperties)) {
      properties[key] = mergeSchemaNode(existingProperties[key], value as JsonSchema);
    }
    const next: JsonSchema = {
      ...generated,
      properties
    };
    copyPreservedKeys(current, next);
    return next;
  }
  if (generated.type === 'array' && generated.items) {
    const next: JsonSchema = {
      ...generated,
      items: mergeSchemaNode(current.items, generated.items as JsonSchema)
    };
    copyPreservedKeys(current, next);
    return next;
  }
  const next: JsonSchema = { ...current, ...generated };
  delete next.properties;
  delete next.required;
  delete next.items;
  delete next.additionalProperties;
  copyPreservedKeys(current, next);
  return next;
}

function copyPreservedKeys(current: JsonSchema, next: JsonSchema): void {
  for (const key of SCHEMA_PRESERVE_KEYS) {
    if (current[key] !== undefined && next[key] === undefined) {
      next[key] = current[key];
    }
  }
}
