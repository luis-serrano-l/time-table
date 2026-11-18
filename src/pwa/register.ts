import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

// A new version never reloads the app by surprise: it waits until asked.
let waiting = false;
let apply: ((reload?: boolean) => Promise<void>) | undefined;
const listeners = new Set<() => void>();

export function startUpdates() {
  if (import.meta.env.DEV) return;
  apply = registerSW({
    onNeedRefresh() {
      waiting = true;
      listeners.forEach((l) => l());
    },
  });
}

export function useUpdateWaiting(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => waiting,
  );
}

export function applyUpdate() {
  void apply?.(true);
}
