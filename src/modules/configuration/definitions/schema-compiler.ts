import Ajv2020Import, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import { validationFailed } from '../../../platform/errors/app-error.js';
import type { JsonSchema } from '../domain/types.js';

type AjvConstructor = new (options: Record<string, unknown>) => {
  compile: (schema: object) => ValidateFunction;
};

function unwrapDefault<T>(mod: T | { default: T }): T {
  if (mod && typeof mod === 'object' && 'default' in mod) {
    return (mod as { default: T }).default;
  }
  return mod as T;
}

const Ajv2020 = unwrapDefault(Ajv2020Import as AjvConstructor | { default: AjvConstructor });
const addFormats = unwrapDefault(
  addFormatsImport as ((ajv: unknown) => unknown) | { default: (ajv: unknown) => unknown }
);

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateSchema: true
});
addFormats(ajv);
ajv.addKeyword({
  keyword: 'minDate',
  type: 'string',
  schemaType: 'string',
  compile(schema: string) {
    return (data: string) => typeof data === 'string' && data >= schema;
  },
  error: { message: ({ schema }) => `must be on or after ${schema as string}` }
});
ajv.addKeyword({
  keyword: 'maxDate',
  type: 'string',
  schemaType: 'string',
  compile(schema: string) {
    return (data: string) => typeof data === 'string' && data <= schema;
  },
  error: { message: ({ schema }) => `must be on or before ${schema as string}` }
});

export interface SchemaValidationIssue {
  path: string;
  message: string;
  keyword?: string;
  /** Schema property name for required / additionalProperties issues. */
  propertyName?: string;
}

export interface CompiledSchemaValidator {
  compiled: boolean;
  validate(data: unknown): { valid: boolean; errors: SchemaValidationIssue[] };
}

export function compileBusinessSchema(schema: JsonSchema): CompiledSchemaValidator {
  if (!schema || Object.keys(schema).length === 0) {
    return {
      compiled: false,
      validate: () => ({ valid: true, errors: [] })
    };
  }

  let validator: ValidateFunction;
  try {
    validator = ajv.compile(schema);
  } catch (error) {
    throw validationFailed('OPTIC-CONFIG-40021', 'Business JSON Schema could not be compiled.', [
      {
        field: 'schema',
        path: 'schema',
        message: error instanceof Error ? error.message : 'Invalid JSON Schema'
      }
    ]);
  }

  return {
    compiled: true,
    validate(data: unknown) {
      const valid = validator(data);
      const errors = (validator.errors ?? []).map((issue: ErrorObject): SchemaValidationIssue => {
        const propertyName = schemaPropertyName(issue);
        return {
          path: issue.instancePath || issue.schemaPath,
          message: formatAjvMessage(issue, propertyName),
          keyword: issue.keyword,
          propertyName
        };
      });
      return { valid: Boolean(valid), errors };
    }
  };
}

function formatAjvMessage(issue: ErrorObject, propertyName?: string): string {
  const base = issue.message ?? 'Schema validation failed';
  if (issue.keyword === 'additionalProperties' && propertyName) {
    return `${base} ('${propertyName}')`;
  }
  return base;
}

function schemaPropertyName(issue: ErrorObject): string | undefined {
  const params = issue.params;
  if (!params || typeof params !== 'object') {
    return undefined;
  }
  for (const key of ['missingProperty', 'additionalProperty'] as const) {
    if (key in params) {
      const value = (params as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}
