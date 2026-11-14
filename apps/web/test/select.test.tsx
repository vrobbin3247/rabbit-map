import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select } from '../src/ui/Select';

afterEach(cleanup);

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta', disabled: true },
  { value: 'c', label: 'Gamma' },
  { value: 'd', label: 'Delta' },
];

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState('a');
  return <Select label="Letter" value={v} options={OPTIONS} onChange={(x) => { setV(x); onChange?.(x); }} />;
}

const box = () => screen.getByRole('combobox', { name: 'Letter' });

describe('Select', () => {
  it('shows the chosen label, opens on click, and picks with the mouse', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(box().textContent).toContain('Alpha');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(box());
    expect(box().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Alpha✓', 'Beta', 'Gamma', 'Delta']);
    fireEvent.click(screen.getByRole('option', { name: 'Gamma' }));
    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box().textContent).toContain('Gamma');
  });

  it('keyboard: arrows skip a disabled option, Enter chooses, Escape closes without choosing', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(box(), { key: 'ArrowDown' }); // opens on the current value
    fireEvent.keyDown(box(), { key: 'ArrowDown' }); // Alpha -> skips disabled Beta -> Gamma
    expect(box().getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Gamma' }).id);
    fireEvent.keyDown(box(), { key: 'End' });
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.keyDown(box(), { key: 'End' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('d');
  });

  it('typing a letter jumps to a match, and a disabled option cannot be chosen', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(box());
    fireEvent.click(screen.getByRole('option', { name: 'Beta' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: 'd' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('d');
  });

  it('Escape is not passed on, so it does not also stop a running generation', () => {
    const outer = vi.fn();
    render(<div onKeyDown={outer}><Harness /></div>);
    fireEvent.click(box());
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(outer).not.toHaveBeenCalled();
  });
});
