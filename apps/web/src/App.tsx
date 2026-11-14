import { useEffect } from 'react';
import { Home } from './home/Home';
import { MapView } from './MapView';
import { useStore } from './state/store';

export function App() {
  const hasMap = useStore((s) => !!s.map);
  useEffect(() => {
    void useStore.getState().init();
  }, []);
  return hasMap ? <MapView /> : <Home />;
}
