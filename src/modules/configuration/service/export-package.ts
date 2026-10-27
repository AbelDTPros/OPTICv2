import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { collectProjectionRequirements } from '../../queue/domain/projection-requirements.js';
import type { DefinitionRelease } from '../domain/types.js';
import { buildCanonicalPackage, type CanonicalPackage } from './canonical-package.js';

export interface PackageFiles {
  [path: string]: string;
}

export function buildPackageFiles(pkg: CanonicalPackage, release?: DefinitionRelease): PackageFiles {
  const forms = (release?.forms ?? pkg.spec.forms) as Record<string, { formKey?: string; schema?: unknown }>;
  const files: PackageFiles = {
    'manifest.yaml': toYaml({
      apiVersion: pkg.apiVersion,
      kind: pkg.kind,
      metadata: pkg.metadata,
      spec: {
        workflow: 'workflow.yaml',
        dataSchema: 'schemas/workload.schema.json',
        queues: 'queues.yaml',
        actions: 'actions.yaml',
        bulkActions: 'bulk-actions.yaml',
        scheduledActions: 'scheduled-actions.yaml',
        sla: 'sla.yaml',
        search: 'search.yaml',
        projections: 'projections.yaml',
        uiDirectory: 'ui/',
        schemaDirectory: 'schemas/'
      }
    }),
    'workflow.yaml': toYaml(pkg.spec.workflow),
    'actions.yaml': toYaml(pkg.spec.actions),
    'queues.yaml': toYaml(pkg.spec.queues),
    'bulk-actions.yaml': toYaml(pkg.spec.bulkActions),
    'scheduled-actions.yaml': toYaml(pkg.spec.scheduledActions),
    'sla.yaml': toYaml(pkg.spec.slas),
    'search.yaml': toYaml(pkg.spec.search),
    'projections.yaml': toYaml({
      fields: release ? collectProjectionRequirements(release) : []
    }),
    'schemas/workload.schema.json': `${JSON.stringify(pkg.spec.schema, null, 2)}\n`
  };

  for (const [formKey, form] of Object.entries(forms).sort(([left], [right]) => left.localeCompare(right))) {
    const slug = toSlug(formKey);
    files[`ui/${slug}.ui.yaml`] = toYaml(form);
    if (form.schema && typeof form.schema === 'object') {
      files[`schemas/${slug}.schema.json`] = `${JSON.stringify(form.schema, null, 2)}\n`;
    }
  }
  return files;
}

export async function writeLocalPackage(
  exportDir: string,
  definitionKey: string,
  version: string,
  canonicalJson: string,
  checksum: string,
  files?: PackageFiles
): Promise<string> {
  const directory = join(exportDir, definitionKey, version);
  await mkdir(directory, { recursive: true });
  const packagePath = join(directory, 'definition-release.json');
  await writeFile(packagePath, `${canonicalJson}\n`, 'utf8');
  await writeFile(join(directory, 'checksum.sha256'), `${checksum}\n`, 'utf8');
  for (const [relative, content] of Object.entries(files ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    const target = join(directory, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
  }
  return packagePath;
}

export function toYaml(value: unknown): string {
  return `${emitYaml(value, 0)}\n`;
}

function toSlug(key: string): string {
  return key.toLowerCase().replaceAll('_', '-');
}

function emitYaml(value: unknown, indent: number): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    return yamlString(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const pad = '  '.repeat(indent);
    return value
      .map((item) => {
        const rendered = emitYaml(item, indent + 1);
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const [first, ...rest] = rendered.split('\n');
          return [`${pad}- ${first}`, ...rest.map((line) => `${pad}  ${line}`)].join('\n');
        }
        return `${pad}- ${rendered}`;
      })
      .join('\n');
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  if (entries.length === 0) {
    return '{}';
  }
  const pad = '  '.repeat(indent);
  return entries
    .map(([key, child]) => {
      const rendered = emitYaml(child, indent + 1);
      const nested = child !== null && typeof child === 'object';
      if (nested && rendered !== '{}' && rendered !== '[]') {
        return `${pad}${key}:\n${rendered.startsWith(' ') ? rendered : `${'  '.repeat(indent + 1)}${rendered}`}`;
      }
      return `${pad}${key}: ${rendered}`;
    })
    .join('\n');
}

function yamlString(value: string): string {
  if (
    value === '' ||
    /[:#\n\r\t]|^\s|\s$|^(true|false|null|yes|no|on|off)$/i.test(value) ||
    /['"]/.test(value)
  ) {
    return JSON.stringify(value);
  }
  return value;
}

export function previewPackage(release: DefinitionRelease): { package: CanonicalPackage; files: PackageFiles } {
  const pkg = buildCanonicalPackage(release);
  return { package: pkg, files: buildPackageFiles(pkg, release) };
}
