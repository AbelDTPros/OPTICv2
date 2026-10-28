export const SHELL_NAV_ORDER_KEY = 'optic.shell.navOrder';

export const DEFAULT_SHELL_NAV_ORDER = [
  'workspace',
  'supervisor',
  'designer',
  'admin'
] as const;

export type ShellNavView = (typeof DEFAULT_SHELL_NAV_ORDER)[number];

export function isShellNavView(value: unknown): value is ShellNavView {
  return (
    value === 'workspace' ||
    value === 'supervisor' ||
    value === 'designer' ||
    value === 'admin'
  );
}

/** Merge saved order with defaults so new surfaces still appear. */
export function normalizeShellNavOrder(raw: unknown): ShellNavView[] {
  const seen = new Set<ShellNavView>();
  const next: ShellNavView[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (isShellNavView(item) && !seen.has(item)) {
        seen.add(item);
        next.push(item);
      }
    }
  }
  for (const item of DEFAULT_SHELL_NAV_ORDER) {
    if (!seen.has(item)) {
      next.push(item);
    }
  }
  return next;
}

export function readShellNavOrder(): ShellNavView[] {
  try {
    const raw = window.localStorage.getItem(SHELL_NAV_ORDER_KEY);
    if (!raw) {
      return [...DEFAULT_SHELL_NAV_ORDER];
    }
    return normalizeShellNavOrder(JSON.parse(raw) as unknown);
  } catch {
    return [...DEFAULT_SHELL_NAV_ORDER];
  }
}

/** First enabled destination in nav order (saved preference, else default). */
export function firstEnabledShellNavView(
  enabled: Partial<Record<ShellNavView, boolean>>,
  order: readonly ShellNavView[] = readShellNavOrder()
): ShellNavView | undefined {
  return order.find((view) => enabled[view]);
}

export function writeShellNavOrder(order: ShellNavView[]): void {
  try {
    window.localStorage.setItem(
      SHELL_NAV_ORDER_KEY,
      JSON.stringify(normalizeShellNavOrder(order))
    );
  } catch {
    // ignore storage failures
  }
}

export function moveShellNavItem(
  order: ShellNavView[],
  fromIndex: number,
  toIndex: number
): ShellNavView[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= order.length ||
    toIndex >= order.length ||
    fromIndex === toIndex
  ) {
    return order;
  }
  const next = [...order];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}
