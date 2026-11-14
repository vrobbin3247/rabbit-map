import { useEffect } from 'react';
import { useStore } from '../state/store';

export function Banners() {
  const banner = useStore((s) => s.banner);
  const health = useStore((s) => s.health);
  const map = useStore((s) => s.map);

  useEffect(() => {
    if (!banner || banner.sticky) return;
    // A message with a button (Undo) stays longer, so there is time to use it.
    const t = window.setTimeout(() => useStore.getState().setBanner(null), banner.action ? 15000 : 9000);
    return () => window.clearTimeout(t);
  }, [banner]);

  const provider = map ? health?.providers.find((p) => p.id === map.settings.provider) : undefined;
  const providerProblem = map && health && (!provider ? `The provider “${map.settings.provider}” is not available.` : !provider.usable ? [provider.reason, provider.fix].filter(Boolean).join(' ') : null);

  return (
    <div role="status">
      {providerProblem && (
        <div className="banner warn">
          <span className="flex-1">{providerProblem}</span>
          <button className="btn btn-sm" onClick={() => void useStore.getState().loadHealth(true)}>Check again</button>
        </div>
      )}
      {banner && (
        <div className={`banner ${banner.kind}`}>
          <span className="flex-1">{banner.text}</span>
          {banner.action && (
            <button
              className="btn btn-sm"
              onClick={() => {
                const run = banner.action?.run;
                useStore.getState().setBanner(null);
                run?.();
              }}
            >
              {banner.action.label}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" aria-label="Dismiss" onClick={() => useStore.getState().setBanner(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
