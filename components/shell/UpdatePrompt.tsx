'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAppUpdate } from '@/hooks/use-app-update';

/**
 * "A new version is ready."
 *
 * Renders nothing of its own. A toast is the right shape: the update is worth
 * mentioning and never worth blocking on, and sonner is already skinned to the
 * tokens, so a bespoke banner would only be a second thing to keep in step.
 *
 * It sits open until it is answered or dismissed, because the update it is
 * announcing does not expire. Dismissing it is a real answer: the waiting worker
 * keeps waiting, the app keeps running the version it has, and settings still
 * says so in words for anyone who wants to look.
 *
 * Raised once per tab. The toast reappearing after every check would be nagging,
 * and the version row in settings is the thing that stays true.
 */
export function UpdatePrompt() {
  const { status, version, latest, apply } = useAppUpdate();
  const shown = useRef(false);

  const ready = status === 'available';
  // A waiting worker raises this on its own, and `latest` is only as fresh as
  // the last check, so it can still be the version this tab is running.
  // Naming it then would read as a prompt to update to what you already have.
  const named = latest !== null && latest !== version ? latest : null;

  useEffect(() => {
    if (!ready || shown.current) return;
    shown.current = true;

    toast('A new version is ready', {
      description: named
        ? `Version ${named}. Reloading takes a second and loses nothing.`
        : 'Reloading takes a second and loses nothing.',
      duration: Infinity,
      action: { label: 'Update', onClick: apply },
    });
  }, [ready, named, apply]);

  return null;
}
