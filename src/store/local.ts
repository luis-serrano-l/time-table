// Small things that belong to this device and not to the log: when the app was
// last seen alive, a snoozed question, a dismissed hint. Never required: every
// read has a fallback, so a browser that refuses storage still works.

const PREFIX = 'time-table.';

export function readLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage is full or blocked. Nothing here is worth an error.
  }
}

export function clearLocal() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    // As above.
  }
}
