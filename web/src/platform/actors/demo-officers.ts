export const OFFICER_ACTOR_ID = 'officer@example.gov';

const STORAGE_KEY = 'optic.workingAs';

function readStoredOfficerId(): string {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)?.trim();
    return stored || OFFICER_ACTOR_ID;
  } catch {
    return OFFICER_ACTOR_ID;
  }
}

let currentOfficerId = readStoredOfficerId();

export function getCurrentOfficerId(): string {
  return currentOfficerId;
}

export function setCurrentOfficerId(actorId: string): void {
  currentOfficerId = actorId.trim() || OFFICER_ACTOR_ID;
  try {
    sessionStorage.setItem(STORAGE_KEY, currentOfficerId);
  } catch {
    // sessionStorage can be missing in some test hosts
  }
}

export function officerDisplayName(actorId: string | null | undefined): string {
  const value = actorId?.trim();
  return value ? value : 'Unassigned';
}
