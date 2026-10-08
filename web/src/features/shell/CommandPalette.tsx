import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { useFocusTrap } from '../../components/ui/use-focus-trap';

export interface Command {
  id: string;
  label: string;
  run: () => void;
}

/** Small command palette: dialog "Command menu", textbox "Search commands", listbox of commands. */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  useFocusTrap(ref, true, onClose);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
  }, [commands, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = results[current];
      if (cmd) {
        onClose();
        cmd.run();
      }
    }
  };

  return (
    <>
      <div className="overlay" aria-hidden="true" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className="dialog">
        <h2 id={titleId} className="sr-only">
          Command menu
        </h2>
        <input
          className="input"
          aria-label="Search commands"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results[current] ? `${listId}-${results[current].id}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          data-autofocus
        />
        <ul id={listId} role="listbox" aria-label="Commands" className="mt-2 flex flex-col gap-1">
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${c.id}`}
              role="option"
              aria-selected={i === current}
              className={`cursor-pointer rounded-md px-3 py-2 ${i === current ? 'bg-[var(--color-accent-tint)]' : ''}`}
              onClick={() => {
                onClose();
                c.run();
              }}
              onKeyDown={() => undefined}
            >
              {c.label}
            </li>
          ))}
          {results.length === 0 ? <li className="muted px-3 py-2">No matching commands</li> : null}
        </ul>
      </div>
    </>
  );
}
