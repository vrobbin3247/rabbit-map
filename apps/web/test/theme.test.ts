import { beforeEach, describe, expect, it } from 'vitest';
import { applyPref, readPref, resolveTheme, setThemePref } from '../src/theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme', () => {
  it('resolves system against the OS setting, and light or dark as chosen', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('applies and clears the data-theme attribute', () => {
    applyPref('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyPref('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('remembers light and dark, and forgets system', () => {
    setThemePref('dark');
    expect(localStorage.getItem('mindmapper.theme')).toBe('dark');
    expect(readPref()).toBe('dark');
    setThemePref('light');
    expect(readPref()).toBe('light');
    setThemePref('system');
    expect(localStorage.getItem('mindmapper.theme')).toBeNull();
    expect(readPref()).toBe('system');
  });

  it('ignores junk in storage', () => {
    localStorage.setItem('mindmapper.theme', 'purple');
    expect(readPref()).toBe('system');
  });
});
