import { useEffect, useState } from 'react';

export function WorkingAsField({
  value,
  onChange,
  label = 'Working as'
}: {
  value: string;
  onChange: (actorId: string) => void;
  label?: string;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

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
