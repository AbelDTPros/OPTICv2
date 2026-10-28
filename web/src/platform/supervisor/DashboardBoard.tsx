import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  canNudgeDashboardTile,
  columnForTile,
  DASHBOARD_TILE_LABELS,
  moveDashboardTile,
  nudgeDashboardTile,
  visibleTiles,
  type DashboardColumnId,
  type DashboardLayoutPrefs,
  type DashboardNudgeDirection,
  type DashboardTileId
} from './dashboard-layout-pref.js';

export function DashboardBoard({
  prefs,
  includeFind,
  onChange,
  renderTile
}: {
  prefs: DashboardLayoutPrefs;
  includeFind: boolean;
  onChange: (next: DashboardLayoutPrefs) => void;
  renderTile: (tileId: DashboardTileId) => ReactNode;
}) {
  const [dragging, setDragging] = useState<DashboardTileId | null>(null);
  const [dropHint, setDropHint] = useState<{
    column: DashboardColumnId;
    index: number;
  } | null>(null);
  const [menuTile, setMenuTile] = useState<DashboardTileId | null>(null);
  const [announce, setAnnounce] = useState('');
  const instructionsId = useId();
  const liveId = useId();
  const menuRef = useRef<HTMLDivElement | null>(null);

  const left = visibleTiles(prefs, 'left', { includeFind });
  const right = visibleTiles(prefs, 'right', { includeFind });
  const leftEmpty = left.length === 0;
  const rightEmpty = right.length === 0;
  const single = (leftEmpty && !rightEmpty) || (rightEmpty && !leftEmpty);
  const nudgeOpts = { includeFind };

  useEffect(() => {
    if (!menuTile) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuTile(null);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuTile(null);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuTile]);

  function readDraggedTile(event: DragEvent): DashboardTileId | null {
    const fromData = event.dataTransfer.getData('text/plain');
    if (
      fromData &&
      (prefs.left.includes(fromData as DashboardTileId) ||
        prefs.right.includes(fromData as DashboardTileId))
    ) {
      return fromData as DashboardTileId;
    }
    return dragging;
  }

  function describePlacement(next: DashboardLayoutPrefs, tileId: DashboardTileId): string {
    const column = columnForTile(next, tileId);
    if (!column) {
      return `${DASHBOARD_TILE_LABELS[tileId]} moved.`;
    }
    const tiles = visibleTiles(next, column, nudgeOpts);
    const position = tiles.indexOf(tileId) + 1;
    const side = column === 'left' ? 'left' : 'right';
    return `${DASHBOARD_TILE_LABELS[tileId]} moved to ${side} column, position ${position} of ${tiles.length}.`;
  }

  function applyMove(next: DashboardLayoutPrefs | null, tileId: DashboardTileId, noOpMessage: string) {
    if (!next) {
      setAnnounce(noOpMessage);
      return;
    }
    onChange(next);
    setAnnounce(describePlacement(next, tileId));
    setMenuTile(null);
    setDragging(null);
    setDropHint(null);
  }

  function dropOn(event: DragEvent, column: DashboardColumnId, index: number) {
    const tileId = readDraggedTile(event);
    if (!tileId) {
      return;
    }
    const next = moveDashboardTile(prefs, tileId, column, index);
    onChange(next);
    setAnnounce(describePlacement(next, tileId));
    setDragging(null);
    setDropHint(null);
    setMenuTile(null);
  }

  function nudge(tileId: DashboardTileId, direction: DashboardNudgeDirection) {
    const label = DASHBOARD_TILE_LABELS[tileId];
    const noOp =
      direction === 'up'
        ? `${label} is already at the top of its column.`
        : direction === 'down'
          ? `${label} is already at the bottom of its column.`
          : direction === 'left'
            ? `${label} is already in the left column.`
            : `${label} is already in the right column.`;
    applyMove(nudgeDashboardTile(prefs, tileId, direction, nudgeOpts), tileId, noOp);
  }

  function columnClass(column: DashboardColumnId, tiles: DashboardTileId[]) {
    const active = dropHint?.column === column;
    return [
      'optic-supervisor-board-column',
      tiles.length === 0 ? 'is-empty' : '',
      active ? 'is-drop-target' : ''
    ]
      .filter(Boolean)
      .join(' ');
  }

  function renderTileChrome(tileId: DashboardTileId, column: DashboardColumnId) {
    const label = DASHBOARD_TILE_LABELS[tileId];
    const open = menuTile === tileId;
    const menuId = `dashboard-tile-menu-${tileId}`;
    return (
      <div
        className="optic-supervisor-board-tile-chrome"
        ref={open ? menuRef : undefined}
        onMouseDown={(event) => event.stopPropagation()}
        onDragStart={(event) => event.preventDefault()}
      >
        <button
          type="button"
          className="optic-supervisor-board-tile-rearrange"
          aria-label={`Rearrange ${label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-describedby={instructionsId}
          title="Rearrange tile. Alt+Arrow keys also work when this control is focused."
          onClick={(event) => {
            event.stopPropagation();
            setMenuTile((current) => (current === tileId ? null : tileId));
          }}
          onKeyDown={(event) => {
            if (!event.altKey) {
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              nudge(tileId, 'up');
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              nudge(tileId, 'down');
              return;
            }
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              nudge(tileId, 'left');
              return;
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              nudge(tileId, 'right');
            }
          }}
        >
          <span aria-hidden="true">⋮⋮</span>
        </button>
        {open ? (
          <div id={menuId} className="optic-supervisor-board-tile-menu" role="menu" aria-label={`Move ${label}`}>
            {(
              [
                ['up', 'Move up'],
                ['down', 'Move down'],
                ['left', 'Move to left column'],
                ['right', 'Move to right column']
              ] as const
            ).map(([direction, text]) => {
              const enabled = canNudgeDashboardTile(prefs, tileId, direction, nudgeOpts);
              // Hide opposite-column no-ops that are permanent for this column.
              if (
                (direction === 'left' && column === 'left') ||
                (direction === 'right' && column === 'right')
              ) {
                return null;
              }
              return (
                <button
                  key={direction}
                  type="button"
                  role="menuitem"
                  className="optic-supervisor-board-tile-menu-item"
                  disabled={!enabled}
                  onClick={() => nudge(tileId, direction)}
                >
                  {text}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  function renderColumn(column: DashboardColumnId, tiles: DashboardTileId[]) {
    return (
      <div
        className={columnClass(column, tiles)}
        data-column={column}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          if ((event.target as HTMLElement).dataset.dropPad != null || tiles.length === 0) {
            setDropHint({ column, index: tiles.length });
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          const index = dropHint?.column === column ? dropHint.index : tiles.length;
          dropOn(event, column, index);
        }}
      >
        {tiles.length === 0 ? (
          <p className="optic-supervisor-board-empty optic-help">Drop a tile here</p>
        ) : null}
        {tiles.map((tileId, index) => (
          <div
            key={tileId}
            className={`optic-supervisor-board-tile${dragging === tileId ? ' is-dragging' : ''}${
              dropHint?.column === column && dropHint.index === index ? ' is-drop-before' : ''
            }`}
            draggable
            onDragStart={(event) => {
              if ((event.target as HTMLElement).closest('.optic-supervisor-board-tile-chrome')) {
                event.preventDefault();
                return;
              }
              setDragging(tileId);
              setMenuTile(null);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', tileId);
            }}
            onDragEnd={() => {
              setDragging(null);
              setDropHint(null);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'move';
              const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
              const before = event.clientY < bounds.top + bounds.height / 2;
              setDropHint({ column, index: before ? index : index + 1 });
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
              const before = event.clientY < bounds.top + bounds.height / 2;
              dropOn(event, column, before ? index : index + 1);
            }}
          >
            {renderTileChrome(tileId, column)}
            <div className="optic-supervisor-board-tile-body">{renderTile(tileId)}</div>
          </div>
        ))}
        <div
          className={`optic-supervisor-board-drop-pad${
            dropHint?.column === column && dropHint.index === tiles.length ? ' is-active' : ''
          }`}
          data-drop-pad=""
          aria-hidden="true"
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            setDropHint({ column, index: tiles.length });
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            dropOn(event, column, tiles.length);
          }}
        />
      </div>
    );
  }

  if (leftEmpty && rightEmpty) {
    return (
      <p className="optic-help optic-supervisor-board-none" role="status">
        Every dashboard tile is hidden. Open Arrange to show some again.
      </p>
    );
  }

  return (
    <div
      className={`optic-supervisor-board${single ? ' is-single' : ''}${dragging ? ' is-dragging' : ''}`}
      aria-label="Dashboard layout"
      aria-describedby={instructionsId}
    >
      <p id={instructionsId} className="optic-visually-hidden">
        Drag a tile to rearrange it. Or open the Rearrange control on a tile for Move up, Move down,
        and Move to the other column. With focus on Rearrange, press Alt+Up Arrow, Alt+Down Arrow,
        Alt+Left Arrow, or Alt+Right Arrow. Layout is saved for this browser.
      </p>
      <div id={liveId} className="optic-visually-hidden" role="status" aria-live="polite">
        {announce}
      </div>
      {single ? (
        <>
          {renderColumn(leftEmpty ? 'right' : 'left', leftEmpty ? right : left)}
          {dragging || menuTile ? (
            renderColumn(leftEmpty ? 'left' : 'right', [])
          ) : (
            <div
              className="optic-supervisor-board-column is-empty optic-supervisor-board-spare-hint"
              aria-hidden="true"
            >
              <p className="optic-supervisor-board-empty optic-help">
                Drag a tile here for a second column
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          {renderColumn('left', left)}
          {renderColumn('right', right)}
        </>
      )}
    </div>
  );
}
