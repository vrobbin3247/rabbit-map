import type { ReactNode } from 'react';
import { useTheme, type ThemePref } from '../theme';

const OPTIONS: { value: ThemePref; label: string; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'Light',
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
      </>
    ),
  },
  { value: 'system', label: 'System', icon: (<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>) },
  { value: 'dark', label: 'Dark', icon: <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /> },
];

/** Light, System (follow the OS) or Dark. The choice is remembered in this browser. */
export function ThemeToggle() {
  const { pref, setPref } = useTheme();
  return (
    <div className="seg" role="group" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          className={`seg-btn ${pref === o.value ? 'on' : ''}`}
          aria-pressed={pref === o.value}
          aria-label={`${o.label} theme`}
          title={`${o.label} theme`}
          onClick={() => setPref(o.value)}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {o.icon}
          </svg>
        </button>
      ))}
    </div>
  );
}
