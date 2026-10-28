import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHELL_NAV_ORDER,
  firstEnabledShellNavView,
  moveShellNavItem,
  normalizeShellNavOrder
} from './shell-nav-order.js';

describe('shell-nav-order', () => {
  it('fills missing destinations after a partial saved order', () => {
    expect(normalizeShellNavOrder(['designer', 'workspace'])).toEqual([
      'designer',
      'workspace',
      'supervisor',
      'admin'
    ]);
  });

  it('ignores unknown entries', () => {
    expect(normalizeShellNavOrder(['workspace', 'nope', 'admin'])).toEqual([
      'workspace',
      'admin',
      'supervisor',
      'designer'
    ]);
  });

  it('moves an item within the order', () => {
    expect(moveShellNavItem([...DEFAULT_SHELL_NAV_ORDER], 0, 2)).toEqual([
      'supervisor',
      'designer',
      'workspace',
      'admin'
    ]);
  });

  it('picks the first enabled destination in nav order', () => {
    expect(
      firstEnabledShellNavView(
        { workspace: true, supervisor: true, designer: true, admin: true },
        ['supervisor', 'workspace', 'designer', 'admin']
      )
    ).toBe('supervisor');
    expect(
      firstEnabledShellNavView(
        { workspace: false, supervisor: true, designer: true, admin: false },
        ['workspace', 'supervisor', 'designer', 'admin']
      )
    ).toBe('supervisor');
    expect(
      firstEnabledShellNavView(
        { workspace: false, supervisor: false, designer: false, admin: false },
        DEFAULT_SHELL_NAV_ORDER
      )
    ).toBeUndefined();
  });
});
