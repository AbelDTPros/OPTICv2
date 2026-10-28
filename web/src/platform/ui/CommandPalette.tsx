import { useEffect, useMemo, useRef, useState } from 'react';

export type CommandPaletteItem = {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  run: () => void;
};

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  commands: CommandPaletteItem[];
};

export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return commands;
    }
    return commands.filter((command) => {
      const hay = `${command.label} ${command.hint ?? ''} ${command.group ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [commands, query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery('');
    setActiveIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) => Math.min(current + 1, Math.max(filtered.length - 1, 0)));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) => Math.max(current - 1, 0));
        return;
      }
      if (event.key === 'Enter') {
        const command = filtered[activeIndex];
        if (!command) {
          return;
        }
        event.preventDefault();
        onClose();
        command.run();
      }
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [activeIndex, filtered, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="optic-command-palette-root">
      <button
        type="button"
        className="optic-command-palette-scrim"
        aria-label="Dismiss command palette"
        onClick={onClose}
      />
      <div
        className="optic-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <label className="optic-command-palette-label" htmlFor="optic-command-palette-input">
          Jump to…
        </label>
        <input
          id="optic-command-palette-input"
          ref={inputRef}
          className="optic-command-palette-input"
          value={query}
          placeholder="Search commands"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="optic-command-palette-list" role="listbox" aria-label="Commands">
          {filtered.length === 0 ? (
            <li className="optic-command-palette-empty">No matching commands</li>
          ) : (
            filtered.map((command, index) => (
              <li key={command.id} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  className="optic-command-palette-item"
                  data-active={index === activeIndex ? 'true' : undefined}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    onClose();
                    command.run();
                  }}
                >
                  <span className="optic-command-palette-item-label">{command.label}</span>
                  {command.hint ? (
                    <span className="optic-command-palette-item-hint">{command.hint}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="optic-command-palette-footer">
          <kbd>↑</kbd>
          <kbd>↓</kbd> move · <kbd>Enter</kbd> run · <kbd>Esc</kbd> close
        </p>
      </div>
    </div>
  );
}
