import { afterEach, describe, expect, it } from 'vitest';
import {
  OFFICER_ACTOR_ID,
  getCurrentOfficerId,
  officerDisplayName,
  setCurrentOfficerId
} from './demo-officers.js';

afterEach(() => {
  setCurrentOfficerId(OFFICER_ACTOR_ID);
});

describe('current officer', () => {
  it('shows the stored assignee as-is and Unassigned when empty', () => {
    expect(officerDisplayName(OFFICER_ACTOR_ID)).toBe(OFFICER_ACTOR_ID);
    expect(officerDisplayName('Jordan Lee')).toBe('Jordan Lee');
    expect(officerDisplayName(null)).toBe('Unassigned');
    expect(officerDisplayName('  ')).toBe('Unassigned');
  });

  it('accepts any typed working-as name', () => {
    expect(getCurrentOfficerId()).toBe(OFFICER_ACTOR_ID);
    setCurrentOfficerId('Jordan Lee');
    expect(getCurrentOfficerId()).toBe('Jordan Lee');
    setCurrentOfficerId('  casey.officer@example.gov  ');
    expect(getCurrentOfficerId()).toBe('casey.officer@example.gov');
    setCurrentOfficerId('   ');
    expect(getCurrentOfficerId()).toBe(OFFICER_ACTOR_ID);
  });
});
