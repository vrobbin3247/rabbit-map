import { useEffect, useRef } from 'react';
import type { MenuEntry } from '../nav/nodeActions';

/** A keyboard-navigable list of menu items. Arrow keys move, Enter or click runs, Tab closes. */
export function MenuList({ entries, onDone, label }: { entries: MenuEntry[]; onDone: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') onDone();
  };

  return (
    <div ref={ref} role="menu" aria-label={label} onKeyDown={onKeyDown}>
      {entries.map((e, i) =>
        e === 'separator' ? (
          <div key={`s${i}`} role="separator" className="menu-sep" />
        ) : (
          <button
            key={e.id}
            role="menuitem"
            data-action={e.id}
            disabled={e.disabled}
            className={e.danger ? 'danger' : undefined}
            onClick={() => {
              onDone();
              e.run();
            }}
          >
            <span>{e.label}</span>
            {e.hint && <span className="hint">{e.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
