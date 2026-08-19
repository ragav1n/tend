'use client';

import { useEffect, useState } from 'react';
import { isPersisted, storageReport, type StorageReport } from '@/lib/db/persist';

/**
 * What the browser will say about this app's storage, for the settings page.
 *
 * Read-only on purpose. `requestPersistence` is the one that can put a dialog on
 * screen, and opening settings is not a reason to ask for anything. Both values
 * are null until the browser answers, and stay null where it has no answer.
 */
export interface StorageState {
  /** True when the store is out of the browser's evictable bucket. */
  persisted: boolean | null;
  report: StorageReport | null;
}

export function useStorageState(): StorageState {
  const [state, setState] = useState<StorageState>({ persisted: null, report: null });

  useEffect(() => {
    let live = true;
    void Promise.all([isPersisted(), storageReport()]).then(([persisted, report]) => {
      if (live) setState({ persisted, report });
    });
    return () => {
      live = false;
    };
  }, []);

  return state;
}

/** Bytes as something a person can read. Whole numbers under 10, else one place. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
