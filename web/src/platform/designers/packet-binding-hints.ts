import type {
  FormSectionDefinition,
  PacketFieldBinding,
  PacketFieldBindingMode,
  StageFormDefinition
} from '../../../../src/modules/configuration/domain/types.js';

export interface PacketBindingFieldHint {
  formKey: string;
  fieldKey: string;
  role: 'parent' | 'child';
  mode: PacketFieldBindingMode;
  linkedFieldKey: string;
  /** Workload definition the mail section spawns (parent-side hints). */
  spawnDefinitionKey?: string;
  /** Mail definition that authored the binding (child-side hints). */
  sourceDefinitionKey?: string;
  sourceDisplayName?: string;
}

/** Parent-side hints for fields on mail release forms (sync from release forms). */
export function collectParentPacketBindingHints(
  forms: Record<string, StageFormDefinition>
): PacketBindingFieldHint[] {
  const hints: PacketBindingFieldHint[] = [];
  for (const form of Object.values(forms)) {
    for (const section of form.sections) {
      if (!section.repeatable || !section.spawnDefinitionKey?.trim()) {
        continue;
      }
      for (const binding of section.packetFieldBindings ?? []) {
        if (!isCompleteBinding(binding)) {
          continue;
        }
        const home = resolveParentFieldHome(forms, form, section, binding);
        if (!home) {
          continue;
        }
        hints.push({
          formKey: home.formKey,
          fieldKey: home.fieldKey,
          role: 'parent',
          mode: binding.mode,
          linkedFieldKey: binding.childFieldKey,
          spawnDefinitionKey: section.spawnDefinitionKey.trim()
        });
      }
    }
  }
  return hints;
}

/** Child-side hints from one mail release that spawns `childDefinitionKey`. */
export function collectChildPacketBindingHints(
  mailForms: Record<string, StageFormDefinition>,
  mailDefinitionKey: string,
  childDefinitionKey: string,
  options?: { mailDisplayName?: string }
): PacketBindingFieldHint[] {
  const target = childDefinitionKey.trim();
  if (!target) {
    return [];
  }
  const hints: PacketBindingFieldHint[] = [];
  for (const form of Object.values(mailForms)) {
    for (const section of form.sections) {
      if (!section.repeatable || section.spawnDefinitionKey?.trim() !== target) {
        continue;
      }
      for (const binding of section.packetFieldBindings ?? []) {
        if (!isCompleteBinding(binding)) {
          continue;
        }
        hints.push({
          formKey: '', // filled by caller for the open child form
          fieldKey: binding.childFieldKey,
          role: 'child',
          mode: binding.mode,
          linkedFieldKey: binding.parentFieldKey,
          sourceDefinitionKey: mailDefinitionKey,
          sourceDisplayName: options?.mailDisplayName
        });
      }
    }
  }
  return hints;
}

export function hintsForField(
  hints: PacketBindingFieldHint[],
  formKey: string,
  fieldKey: string
): PacketBindingFieldHint[] {
  return hints.filter((hint) => {
    if (hint.role === 'parent') {
      return hint.formKey === formKey && hint.fieldKey === fieldKey;
    }
    return hint.fieldKey === fieldKey;
  });
}

export function packetBindingChipLabel(hint: PacketBindingFieldHint): string {
  if (hint.role === 'parent') {
    if (hint.mode === 'INHERIT_ONCE') {
      return '→ workload once';
    }
    if (hint.mode === 'PROJECT_PARENT') {
      return '→ workload live';
    }
    return '↔ workload live';
  }
  if (hint.mode === 'INHERIT_ONCE') {
    return '← mail once';
  }
  if (hint.mode === 'PROJECT_PARENT') {
    return '← mail live';
  }
  return '→ mail live';
}

export function packetBindingModeLabel(mode: PacketFieldBindingMode): string {
  if (mode === 'INHERIT_ONCE') {
    return 'Copy once when workload is created';
  }
  if (mode === 'PROJECT_PARENT') {
    return 'Always show mail value on the workload';
  }
  return 'Always show workload value back on the mail row';
}

export function packetBindingModeSummary(mode: PacketFieldBindingMode): string {
  if (mode === 'INHERIT_ONCE') {
    return 'copy once';
  }
  if (mode === 'PROJECT_PARENT') {
    return 'mail → workload';
  }
  return 'workload → mail';
}

export function packetBindingDetail(hint: PacketBindingFieldHint): string {
  const modeLabel = packetBindingModeLabel(hint.mode);
  if (hint.role === 'parent') {
    const target = hint.spawnDefinitionKey ? ` on ${hint.spawnDefinitionKey}` : '';
    return `Field link: ${modeLabel} · workload field ${hint.linkedFieldKey}${target}.`;
  }
  const source =
    hint.sourceDisplayName?.trim() ||
    hint.sourceDefinitionKey?.trim() ||
    'mail';
  return `Field link: ${modeLabel} · mail field ${hint.linkedFieldKey} (${source}).`;
}

function isCompleteBinding(binding: PacketFieldBinding): binding is PacketFieldBinding & {
  mode: PacketFieldBindingMode;
} {
  return Boolean(
    binding.parentFieldKey?.trim() &&
      binding.childFieldKey?.trim() &&
      (binding.mode === 'INHERIT_ONCE' ||
        binding.mode === 'PROJECT_CHILD' ||
        binding.mode === 'PROJECT_PARENT')
  );
}

function resolveParentFieldHome(
  forms: Record<string, StageFormDefinition>,
  spawnForm: StageFormDefinition,
  spawnSection: FormSectionDefinition,
  binding: PacketFieldBinding
): { formKey: string; fieldKey: string } | undefined {
  const key = binding.parentFieldKey.trim();
  const scope =
    binding.parentScope ??
    (spawnSection.fields.some((field) => field.fieldKey === key) ? 'ROW' : 'PACKET');
  if (scope === 'ROW') {
    if (spawnSection.fields.some((field) => field.fieldKey === key)) {
      return { formKey: spawnForm.formKey, fieldKey: key };
    }
    return undefined;
  }
  const ordered = [
    spawnForm,
    ...Object.values(forms).filter((form) => form.formKey !== spawnForm.formKey)
  ];
  for (const form of ordered) {
    for (const section of form.sections) {
      if (section.repeatable) {
        continue;
      }
      if (section.fields.some((field) => field.fieldKey === key)) {
        return { formKey: form.formKey, fieldKey: key };
      }
    }
  }
  return undefined;
}
