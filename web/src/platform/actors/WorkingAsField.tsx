import { useEffect, useState } from 'react';

export function WorkingAsField({
  value,
  onChange,
  label = 'Working as',
  readOnly = false
}: {
  value: string;
  onChange: (actorId: string) => void;
  label?: string;
  /** When true, show identity only (ICAM / fixed demo officer — no override). */
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  if (readOnly) {
    return (
      <p className="optic-working-as optic-working-as-readonly" role="group" aria-label={label}>
        <span className="optic-working-as-label">{label}</span>
        <strong className="optic-working-as-value">{value}</strong>
      </p>
    );
  }

  function commit() {
    const next = draft.trim();
    if (!next) {
      setDraft(value);
      return;
    }
    if (next !== value) {
      onChange(next);
    }
  }

  return (
    <label className="optic-working-as">
      {label}
      <input
        type="text"
        value={draft}
        autoComplete="username"
        spellCheck={false}
        placeholder="Name or email"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}
