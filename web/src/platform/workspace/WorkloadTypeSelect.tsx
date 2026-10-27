import { useEffect, useId, useRef, useState } from 'react';
import { StatusPill } from '../ui/Icon.js';
import { filterWorkKinds, type WorkKind } from './kind-catalog.js';

export function WorkloadTypeSelect({
  kinds,
  value,
  disabled,
  onChange
}: {
  kinds: WorkKind[];
  value?: string;
  disabled?: boolean;
  onChange: (kindKey: string) => void;
}) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listboxId = `${baseId}-listbox`;
  const selected = kinds.find((kind) => kind.kindKey === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = filterWorkKinds(kinds, query);
  const active = filtered[activeIndex];
  const activeId = active ? optionId(baseId, active.kindKey) : undefined;

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const selectedIndex = filtered.findIndex((kind) => kind.kindKey === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, value]);

  useEffect(() => {
    if (!open || filtered.length === 0) {
      return;
    }
    setActiveIndex((current) => Math.min(current, filtered.length - 1));
  }, [filtered.length, open]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  function choose(kindKey: string) {
    onChange(kindKey);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function moveActive(next: number) {
    if (filtered.length === 0) {
      return;
    }
    setActiveIndex(Math.max(0, Math.min(next, filtered.length - 1)));
  }

  return (
    <div className="optic-kind-combobox" ref={rootRef}>
      <div className="optic-kind-combobox-field">
        <div className="optic-kind-combobox-control">
          <input
            ref={inputRef}
            id={inputId}
            role="combobox"
            type="text"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            placeholder={selected ? 'Type to search' : 'Select a workload type'}
            value={open ? query : (selected?.label ?? '')}
            aria-labelledby="kind-heading"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={open ? activeId : undefined}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (!open) {
                  setOpen(true);
                  return;
                }
                moveActive(activeIndex + 1);
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (!open) {
                  setOpen(true);
                  return;
                }
                moveActive(activeIndex - 1);
                return;
              }
              if (event.key === 'Home') {
                event.preventDefault();
                setOpen(true);
                moveActive(0);
                return;
              }
              if (event.key === 'End') {
                event.preventDefault();
                setOpen(true);
                moveActive(filtered.length - 1);
                return;
              }
              if (event.key === 'Enter' && open && active) {
                event.preventDefault();
                choose(active.kindKey);
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
              }
            }}
          />
          <button
            type="button"
            className="optic-kind-combobox-toggle"
            tabIndex={-1}
            disabled={disabled}
            aria-label={open ? 'Hide workload types' : 'Show workload types'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setOpen((current) => {
                if (current) {
                  return false;
                }
                inputRef.current?.focus();
                return true;
              });
            }}
          >
            <span aria-hidden="true">{open ? '▴' : '▾'}</span>
          </button>
        </div>
        {open ? (
          <ul id={listboxId} className="optic-kind-combobox-list" role="listbox" aria-label="Workload types">
            {filtered.length === 0 ? (
              <li className="optic-kind-combobox-empty" role="presentation">
                No matching workload types
              </li>
            ) : (
              filtered.map((kind, index) => (
                <li
                  key={kind.kindKey}
                  id={optionId(baseId, kind.kindKey)}
                  role="option"
                  aria-selected={kind.kindKey === value}
                  data-active={index === activeIndex ? 'true' : 'false'}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(kind.kindKey)}
                >
                  <span className="optic-kind-combobox-name">{kind.label}</span>
                  <span className="optic-kind-combobox-meta">
                    {kind.members.map((member) => (member.entityType === 'MAIL' ? 'Mail' : 'Workload')).join(' · ')}
                  </span>
                  <StatusPill>
                    {kind.members.some((member) => member.lifecycleStatus === 'DRAFT')
                      ? 'DRAFT'
                      : kind.members[0]?.lifecycleStatus ?? ''}
                  </StatusPill>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
      <p className="optic-help">Type to search, then choose a type to see its queues.</p>
    </div>
  );
}

function optionId(baseId: string, kindKey: string): string {
  return `${baseId}-opt-${kindKey}`;
}
