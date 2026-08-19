'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useServiceWorker } from '@/hooks/use-service-worker';

/**
 * "A new version is ready."
 *
 * Renders nothing of its own. A toast is the right shape here: the update is
 * worth mentioning and never worth blocking on, and sonner is already skinned to
 * the tokens, so a bespoke banner would only be a second thing to keep in step.
 *
 * It sits open until it is answered or dismissed, because the update it is
 * announcing does not expire. Dismissing it is a real answer: the waiting worker
 * keeps waiting, the app keeps running the version it has, and the swap happens
 * the next time the app is opened cold.
 */
export function UpdatePrompt() {
  const { updateReady, applyUpdate } = useServiceWorker();
  const shown = useRef(false);

  useEffect(() => {
    if (!updateReady || shown.current) return;
    shown.current = true;

    toast('A new version is ready', {
      description: 'Reload to pick it up. Nothing in progress is lost.',
      duration: Infinity,
      action: { label: 'Reload', onClick: applyUpdate },
    });
  }, [updateReady, applyUpdate]);

  return null;
}
