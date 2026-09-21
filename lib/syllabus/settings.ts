import { DEFAULT_ENDPOINT, DEFAULT_MODEL } from './model';

/**
 * Where the local model lives, remembered per device.
 *
 * Per device and never synced, like the theme and the push subscription. An
 * endpoint is a property of a machine: the laptop with Ollama on it and the
 * phone in your pocket do not share an answer, and syncing one would turn the
 * assist on where it cannot possibly work.
 *
 * Kept out of `prefs` for that reason, and written the same way `list-sort` is,
 * down to swallowing the exception Safari throws in private mode.
 */

const ENDPOINT_KEY = 'tend.model.endpoint';
const MODEL_KEY = 'tend.model.name';

export interface ModelSettings {
  endpoint: string;
  model: string;
}

export function readModelSettings(): ModelSettings {
  return {
    endpoint: read(ENDPOINT_KEY) ?? DEFAULT_ENDPOINT,
    model: read(MODEL_KEY) ?? DEFAULT_MODEL,
  };
}

export function writeModelSettings(next: Partial<ModelSettings>): void {
  if (next.endpoint !== undefined) write(ENDPOINT_KEY, next.endpoint.trim(), DEFAULT_ENDPOINT);
  if (next.model !== undefined) write(MODEL_KEY, next.model.trim(), DEFAULT_MODEL);
}

function read(key: string): string | null {
  try {
    const held = window.localStorage.getItem(key);
    return held === null || held === '' ? null : held;
  } catch {
    return null;
  }
}

/** Clears the key when the value is back to the default, so an untouched
 *  device leaves nothing behind. */
function write(key: string, value: string, fallback: string): void {
  try {
    if (value === '' || value === fallback) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode. The choice lasts as long as the page does.
  }
}
