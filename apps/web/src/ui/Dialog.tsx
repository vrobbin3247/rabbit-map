import { useEffect, type ReactNode } from 'react';

export function Dialog({ title, onClose, children, label }: { title?: string; onClose: () => void; children: ReactNode; label?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={label ?? title}>
        {title && <h2 className="m-0 text-base font-semibold">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function PromptDialog({
  title,
  initial = '',
  confirm = 'Save',
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: string;
  confirm?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const v = (new FormData(e.currentTarget).get('v') as string).trim();
          if (v) onSubmit(v);
        }}
      >
        <input name="v" className="field" defaultValue={initial} autoFocus onFocus={(e) => e.currentTarget.select()} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">{confirm}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirm,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirm: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="m-0 muted">{message}</p>
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onClose} autoFocus>Cancel</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirm}</button>
      </div>
    </Dialog>
  );
}
