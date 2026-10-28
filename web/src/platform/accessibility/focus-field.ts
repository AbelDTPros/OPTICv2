/** Scroll a field into view and move keyboard focus to a usable control. */
export function focusFormField(inputId: string): void {
  focusElement(document.getElementById(inputId));
}

export function focusElement(target: HTMLElement | null | undefined): void {
  if (!target) {
    return;
  }
  scrollWithinNearestScroller(target);
  const focusable = resolveFocusable(target);
  focusable?.focus?.({ preventScroll: true });
}

/**
 * Scroll only the nearest overflow container (e.g. .optic-case-body).
 * Avoid document scrollIntoView — fragment jumps squash sticky/fixed case drawers.
 */
function scrollWithinNearestScroller(target: HTMLElement): void {
  const scroller = nearestScrollContainer(target);
  if (!scroller) {
    return;
  }
  const targetRect = target.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const padding = 28;
  const above = targetRect.top - scrollerRect.top - padding;
  const below = targetRect.bottom - scrollerRect.bottom + padding;
  let delta = 0;
  if (above < 0) {
    delta = above;
  } else if (below > 0) {
    delta = below;
  } else {
    const centerDelta =
      targetRect.top + targetRect.height / 2 - (scrollerRect.top + scrollerRect.height / 2);
    if (Math.abs(centerDelta) > scrollerRect.height * 0.25) {
      delta = centerDelta;
    }
  }
  if (delta !== 0) {
    scroller.scrollBy({ top: delta, behavior: 'smooth' });
  }
}

function nearestScrollContainer(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.documentElement) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function resolveFocusable(target: HTMLElement): HTMLElement | null {
  if (target.matches('input, select, textarea, button')) {
    return target;
  }
  if (target.getAttribute('role') === 'radiogroup') {
    return target.querySelector<HTMLElement>('input[type="radio"]:not(:disabled)') ?? target;
  }
  return (
    target.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)'
    ) ?? (target.tabIndex >= 0 ? target : null)
  );
}
