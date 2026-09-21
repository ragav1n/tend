'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { probeModel, DEFAULT_ENDPOINT, DEFAULT_MODEL, type ProbeResult } from '@/lib/syllabus/model';
import { readModelSettings, writeModelSettings, type ModelSettings } from '@/lib/syllabus/settings';

/**
 * Whether a local model is reachable, and which one.
 *
 * The settings come through `useSyncExternalStore`, the same way the theme and
 * the per-list sort do: localStorage is outside React, and seeding state from
 * an effect is both a setState per mount and a cascading render the lint rule
 * here rejects. The snapshot is a string so React's identity check compares by
 * value; an object would be a fresh reference every call and would loop.
 *
 * The probe is ordinary state, because it is set from a click rather than from
 * a render, and it starts as null on purpose. "Not asked yet" and "asked, and
 * nothing is there" are different states and only the second should hide the
 * button. Nothing polls: Ollama is supposed to be off most of the time, so a
 * timer would be a request every few seconds for an answer that is usually no.
 */

const listeners = new Set<() => void>();

function subscribe(notify: () => void): () => void {
  window.addEventListener('storage', notify);
  listeners.add(notify);
  return () => {
    window.removeEventListener('storage', notify);
    listeners.delete(notify);
  };
}

function snapshot(): string {
  const { endpoint, model } = readModelSettings();
  return `${endpoint}\u0000${model}`;
}

/** The server has no storage, and this is what the prerendered HTML shows. */
const serverSnapshot = () => `${DEFAULT_ENDPOINT}\u0000${DEFAULT_MODEL}`;

export function useLocalModel(): {
  settings: ModelSettings;
  probe: ProbeResult | null;
  checking: boolean;
  check: () => Promise<ProbeResult>;
  update: (next: Partial<ModelSettings>) => void;
} {
  const packed = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [checking, setChecking] = useState(false);

  const settings = useMemo(() => {
    const [endpoint = DEFAULT_ENDPOINT, model = DEFAULT_MODEL] = packed.split('\u0000');
    return { endpoint, model };
  }, [packed]);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const result = await probeModel(readModelSettings().endpoint);
      setProbe(result);
      return result;
    } finally {
      setChecking(false);
    }
  }, []);

  const update = useCallback((next: Partial<ModelSettings>) => {
    writeModelSettings(next);
    for (const notify of listeners) notify();
    // The old answer was about the old endpoint, so it stops being true.
    setProbe(null);
  }, []);

  return { settings, probe, checking, check, update };
}
