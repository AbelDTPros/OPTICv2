import { describe, expect, it } from 'vitest';
import { DesignerApiError, readDesignerData } from './config-api.js';

describe('readDesignerData', () => {
  it('returns envelope data on success', () => {
    expect(readDesignerData(201, true, { data: { formKey: 'I90_DATA_ENTRY' } })).toEqual({
      formKey: 'I90_DATA_ENTRY'
    });
  });

  it('surfaces OPTIC conflict errors instead of a reachability message', () => {
    expect(() =>
      readDesignerData(409, false, {
        error: {
          errorCode: 'OPTIC-CONFIG-40901',
          summary: 'Definition I_DESIGN already exists.',
          details: []
        }
      })
    ).toThrow(DesignerApiError);
    try {
      readDesignerData(409, false, {
        error: {
          errorCode: 'OPTIC-CONFIG-40901',
          summary: 'Definition I_DESIGN already exists.',
          referenceId: 'OPTIC-8F71C239',
          details: []
        }
      });
    } catch (error) {
      expect(error).toMatchObject({ errorCode: 'OPTIC-CONFIG-40901', referenceId: 'OPTIC-8F71C239' });
      expect((error as DesignerApiError).message).toContain('already exists');
    }
  });

  it('does not call a missing HTML body an OPTIC envelope', () => {
    expect(() => readDesignerData(200, true, null)).toThrow(/empty or HTML/);
  });
});
