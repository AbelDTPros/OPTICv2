import { useEffect, useId, useRef, useState } from 'react';
import { ButtonLabel, Icon } from '../ui/Icon.js';
import {
  allTilesInOrder,
  DASHBOARD_TILE_LABELS,
  DEFAULT_DASHBOARD_LAYOUT,
  type DashboardLayoutPrefs,
  type DashboardTileId
} from './dashboard-layout-pref.js';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function DashboardLayoutMenu({
  prefs,
  includeFind,
  onChange,
  onReset
}: {
  prefs: DashboardLayoutPrefs;
  includeFind: boolean;
  onChange: (next: DashboardLayoutPrefs) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const panelId = useId();
  const titleId = useId();
  const tiles = allTilesInOrder(prefs).filter((tile) => includeFind || tile !== 'find');

  useEffect(() => {
    if (!open) {
      return;
    }
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : triggerRef.current;
    const panel = panelRef.current;
    const focusable = panel?.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusable?.[0]?.focus();

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !panel) {
        return;
      }
      const nodes = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (nodes.length === 0) {
        return;
      }
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    panel?.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      panel?.removeEventListener('keydown', onKeyDown);
      const restore = previouslyFocused.current ?? triggerRef.current;
      restore?.focus?.();
    };
  }, [open]);

  function setVisible(tile: DashboardTileId, visible: boolean) {
    onChange({
      ...prefs,
      visible: { ...prefs.visible, [tile]: visible }
    });
  }

  return (
    <div className="optic-supervisor-layout-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="optic-guide-button optic-supervisor-layout-trigger"
        aria-label="Arrange dashboard"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        title="Show or hide tiles. Drag tiles on the board, or use each tile’s Rearrange menu / Alt+Arrow keys."
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="layout" />
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          className="optic-supervisor-layout-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <div className="optic-supervisor-layout-panel-head">
            <p id={titleId} className="optic-supervisor-layout-panel-title">
              Layout
            </p>
            <p className="optic-help">
              Toggle tiles here. On the board, drag a tile, open its Rearrange menu, or focus
              Rearrange and press Alt+Arrow keys.
            </p>
          </div>
          <ul className="optic-supervisor-layout-list">
            {tiles.map((tile) => {
              const visible = prefs.visible[tile];
              return (
                <li
                  key={tile}
                  className={`optic-supervisor-layout-item optic-supervisor-layout-item-static${
                    visible ? '' : ' is-hidden'
                  }`}
                >
                  <span className="optic-supervisor-layout-label">
                    {DASHBOARD_TILE_LABELS[tile]}
                  </span>
                  <label className="optic-supervisor-layout-toggle">
                    <span className="optic-visually-hidden">Show {DASHBOARD_TILE_LABELS[tile]}</span>
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={(event) => setVisible(tile, event.target.checked)}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="optic-supervisor-layout-panel-foot">
            <button type="button" className="optic-button-secondary" onClick={() => onReset()}>
              Reset
            </button>
            <button type="button" className="optic-guide-button" onClick={() => setOpen(false)}>
              <ButtonLabel icon="check">Done</ButtonLabel>
            </button>
          </div>
          {JSON.stringify(prefs) === JSON.stringify(DEFAULT_DASHBOARD_LAYOUT) ? null : (
            <p className="optic-help optic-supervisor-layout-hint">Saved on this browser for you.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
