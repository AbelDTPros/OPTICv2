import { useId, useRef, useState } from 'react';
import { Icon, type IconName } from '../ui/Icon.js';
import {
  isShellNavView,
  moveShellNavItem,
  readShellNavOrder,
  writeShellNavOrder,
  type ShellNavView
} from './shell-nav-order.js';

const VIEW_META: Record<ShellNavView, { label: string; icon: IconName }> = {
  workspace: { label: 'Workspace', icon: 'queue' },
  supervisor: { label: 'Dashboard', icon: 'live' },
  designer: { label: 'Designer', icon: 'designer' },
  admin: { label: 'Admin', icon: 'settings' }
};

export function PrimaryShellNav({
  enabled,
  currentView,
  onSelect
}: {
  enabled: Record<ShellNavView, boolean>;
  currentView: ShellNavView;
  onSelect: (view: ShellNavView) => void;
}) {
  const instructionsId = useId();
  const liveId = useId();
  const [order, setOrder] = useState<ShellNavView[]>(readShellNavOrder);
  const [dragging, setDragging] = useState<ShellNavView | null>(null);
  const [dropTarget, setDropTarget] = useState<ShellNavView | null>(null);
  const [announce, setAnnounce] = useState('');
  const suppressClickRef = useRef(false);

  const visible = order.filter((view) => enabled[view]);

  function persist(nextOrder: ShellNavView[]) {
    setOrder(nextOrder);
    writeShellNavOrder(nextOrder);
  }

  function announceMove(view: ShellNavView, nextVisible: ShellNavView[]) {
    const index = nextVisible.indexOf(view);
    if (index < 0) {
      return;
    }
    setAnnounce(
      `${VIEW_META[view].label} moved to position ${index + 1} of ${nextVisible.length}.`
    );
  }

  function reorderVisible(fromView: ShellNavView, toView: ShellNavView) {
    if (fromView === toView) {
      return;
    }
    const fromVisible = visible.indexOf(fromView);
    const toVisible = visible.indexOf(toView);
    if (fromVisible < 0 || toVisible < 0) {
      return;
    }
    const fullFrom = order.indexOf(fromView);
    const fullTo = order.indexOf(toView);
    const nextOrder = moveShellNavItem(order, fullFrom, fullTo);
    const nextVisible = nextOrder.filter((view) => enabled[view]);
    persist(nextOrder);
    announceMove(fromView, nextVisible);
  }

  function moveFocused(view: ShellNavView, direction: -1 | 1) {
    const index = visible.indexOf(view);
    const target = visible[index + direction];
    if (!target) {
      setAnnounce(
        direction < 0
          ? `${VIEW_META[view].label} is already first.`
          : `${VIEW_META[view].label} is already last.`
      );
      return;
    }
    reorderVisible(view, target);
  }

  return (
    <>
      <p id={instructionsId} className="optic-visually-hidden">
        Drag a navigation button to reorder it. With focus on a button, press Alt+Left Arrow or
        Alt+Right Arrow to move it. Order is saved for this browser.
      </p>
      <div id={liveId} className="optic-visually-hidden" role="status" aria-live="polite">
        {announce}
      </div>
      <nav
        className="optic-demo-nav optic-shell-primary-nav"
        aria-label="Primary"
        aria-describedby={instructionsId}
      >
        {visible.map((view) => {
          const meta = VIEW_META[view];
          const isDragging = dragging === view;
          const isDropTarget = dropTarget === view && dragging != null && dragging !== view;
          return (
            <button
              key={view}
              type="button"
              draggable
              aria-current={currentView === view ? 'page' : undefined}
              aria-describedby={instructionsId}
              aria-grabbed={isDragging}
              data-dragging={isDragging ? 'true' : undefined}
              data-drop-target={isDropTarget ? 'true' : undefined}
              className="optic-shell-nav-item"
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                onSelect(view);
              }}
              onKeyDown={(event) => {
                if (!event.altKey) {
                  return;
                }
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  moveFocused(view, -1);
                  return;
                }
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  moveFocused(view, 1);
                }
              }}
              onDragStart={(event) => {
                suppressClickRef.current = false;
                setDragging(view);
                setAnnounce(`Dragging ${meta.label}. Drop on another item to reorder.`);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', view);
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                if (dragging && dragging !== view) {
                  setDropTarget(view);
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                if (dragging && dragging !== view) {
                  setDropTarget(view);
                }
              }}
              onDragLeave={() => {
                setDropTarget((current) => (current === view ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from =
                  (event.dataTransfer.getData('text/plain') as ShellNavView | '') || dragging;
                if (from && isShellNavView(from)) {
                  suppressClickRef.current = true;
                  reorderVisible(from, view);
                }
                setDragging(null);
                setDropTarget(null);
              }}
              onDragEnd={() => {
                if (dragging) {
                  suppressClickRef.current = true;
                }
                setDragging(null);
                setDropTarget(null);
              }}
            >
              <Icon name={meta.icon} />
              {meta.label}
            </button>
          );
        })}
      </nav>
    </>
  );
}
