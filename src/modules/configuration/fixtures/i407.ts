import type { DefinitionRelease } from '../domain/types.js';
import mailPackage from './i407-mail.json' with { type: 'json' };
import workloadPackage from './i407-workload.json' with { type: 'json' };

function asSeedRelease(
  id: string,
  packaged: Omit<DefinitionRelease, 'id' | 'version' | 'lifecycleStatus' | 'rowVersion'>
): DefinitionRelease {
  return {
    id,
    version: '1.0.0',
    lifecycleStatus: 'PUBLISHED',
    rowVersion: 1,
    ...packaged
  };
}

export const i407MailRelease: DefinitionRelease = asSeedRelease('4071', mailPackage);
export const i407WorkloadRelease: DefinitionRelease = asSeedRelease('4072', workloadPackage);
