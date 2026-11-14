import { useSyncExternalStore } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'mindmapper.theme';
const MEDIA = '(prefers-color-scheme: dark)';

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function systemDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(MEDIA).matches;
}

export function resolveTheme(pref: ThemePref, osDark: boolean): ResolvedTheme {
  return pref === 'system' ? (osDark ? 'dark' : 'light') : pref;
}

/** "system" removes the attribute, so the stylesheet follows the OS setting. */
export function applyPref(pref: ThemePref): void {
  const el = document.documentElement;
  if (pref === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', pref);
}

let pref: ThemePref = typeof localStorage === 'undefined' ? 'system' : readPref();
const listeners = new Set<() => void>();

export function setThemePref(next: ThemePref): void {
  pref = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
  applyPref(next);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const mq = typeof window !== 'undefined' ? window.matchMedia?.(MEDIA) : undefined;
  mq?.addEventListener('change', cb);
  return () => {
    listeners.delete(cb);
    mq?.removeEventListener('change', cb);
  };
}

export function initTheme(): void {
  pref = readPref();
  applyPref(pref);
}

export function useTheme(): { pref: ThemePref; resolved: ResolvedTheme; setPref: (p: ThemePref) => void } {
  const p = useSyncExternalStore(subscribe, () => pref);
  const dark = useSyncExternalStore(subscribe, systemDark);
  return { pref: p, resolved: resolveTheme(p, dark), setPref: setThemePref };
}
