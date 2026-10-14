// Accessible tabs (WAI-ARIA tabs pattern: arrow keys move between tabs). The active tab can live
// in the URL hash so links and the back button work.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabDef {
  id: string;
  label: ReactNode;
  content: () => ReactNode;
  hidden?: boolean;
}

export function Tabs({ tabs, hash = true, className }: { tabs: TabDef[]; hash?: boolean; className?: string }) {
  const visible = tabs.filter((t) => !t.hidden);
  const fromHash = () => {
    const h = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    return visible.some((t) => t.id === h) ? h : (visible[0]?.id ?? '');
  };
  const [active, setActive] = useState(hash ? fromHash : visible[0]?.id ?? '');
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!hash) return;
    const onHash = () => setActive(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });

  const select = (id: string, focus = false) => {
    setActive(id);
    if (hash) history.replaceState(null, '', `#${id}`);
    if (focus) refs.current[id]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const i = visible.findIndex((t) => t.id === active);
    const dir = document.documentElement.dir === 'rtl' ? -1 : 1;
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + dir + visible.length) % visible.length;
    if (e.key === 'ArrowLeft') next = (i - dir + visible.length) % visible.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = visible.length - 1;
    if (next >= 0) {
      e.preventDefault();
      select(visible[next]!.id, true);
    }
  };
  const current = visible.find((t) => t.id === active) ?? visible[0];
  return (
    <div className={className}>
      <div role="tablist" onKeyDown={onKey} className="mb-5 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visible.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            role="tab"
            type="button"
            id={`${base}-${t.id}-tab`}
            aria-controls={`${base}-${t.id}-panel`}
            aria-selected={t.id === current?.id}
            tabIndex={t.id === current?.id ? 0 : -1}
            onClick={() => select(t.id)}
            className={cn(
              '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              t.id === current?.id ? 'border-primary text-primary' : 'border-transparent text-fg-muted hover:text-fg'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {current && (
        <div role="tabpanel" id={`${base}-${current.id}-panel`} aria-labelledby={`${base}-${current.id}-tab`} tabIndex={0} className="focus:outline-none">
          {current.content()}
        </div>
      )}
    </div>
  );
}
