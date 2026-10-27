import { DesignerApiError } from '../api/api-error.js';
import { readDesignerData } from '../designers/config-api.js';

export interface FeatureAdminGates {
  uiEnabled: boolean;
  apiEnabled: boolean;
}

export interface EffectiveFeatures {
  flags: Record<string, boolean>;
  admin: FeatureAdminGates;
}

export interface AdminFeatureFlag {
  key: string;
  label: string;
  enabled: boolean;
  description: string;
  rowVersion: number;
  updatedAt: string;
  updatedBy: string;
  group: string;
}

const ACTOR_ID = 'admin@example.gov';

export async function fetchEffectiveFeatures(): Promise<EffectiveFeatures> {
  return api('/api/v1/features');
}

export async function listAdminFeatures(): Promise<{ flags: AdminFeatureFlag[]; admin: FeatureAdminGates }> {
  return api('/api/v1/admin/features', {
    headers: {
      'X-Actor-Roles': 'ADMIN'
    }
  });
}

export async function updateAdminFeature(
  flagKey: string,
  body: { enabled: boolean; expectedRowVersion: number }
): Promise<AdminFeatureFlag> {
  return api(`/api/v1/admin/features/${encodeURIComponent(flagKey)}`, {
    method: 'PUT',
    headers: {
      'X-Actor-Roles': 'ADMIN'
    },
    body: JSON.stringify(body)
  });
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: 'Bearer dev-token',
    'X-Actor-Id': ACTOR_ID,
    ...(init.headers as Record<string, string> | undefined)
  };
  if (init.body) {
    headers['Content-Type'] = 'application/json';
  }
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new DesignerApiError('The browser could not reach /api for feature flags.');
  }
  return readDesignerData<T>(response.status, response.ok, await readJson(response));
}

async function readJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
