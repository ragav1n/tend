'use client';

import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowsClockwise,
  CheckCircle,
  CloudSlash,
  SignIn,
  WarningCircle,
} from '@phosphor-icons/react/dist/ssr';
import { useQueueCounts, useStartSync, useSyncState } from '@/hooks/use-sync';
import { LINEAR_SPIN, QUICK_FADE } from '@/lib/motion';
import type { SyncStatus } from '@/lib/sync/machine';
import { cn } from '@/lib/utils';

/**
 * What sync is doing, in as few words as possible.
 *
 * The rule this follows: say nothing when there is nothing to say. A badge
 * announcing "Synced" forever trains people to ignore it, and then it fails to
 * get their attention on the one day it says "Offline, 40 changes waiting". So
 * on a phone it hides itself entirely while everything is fine, and on a desktop
 * rail, where there is room, it sits quietly at the bottom.
 *
 * Nothing here gates the app. Signed out is a state with a link, not a wall.
 */

interface Appearance {
  label: string;
  icon: typeof CheckCircle;
  tone: string;
  spin?: boolean;
  /** Worth interrupting for. Anything false stays hidden on a phone. */
  loud?: boolean;
  href?: string;
}

function appearanceFor(status: SyncStatus, pending: number): Appearance {
  switch (status) {
    case 'boot':
    case 'opening_db':
      return { label: 'Starting', icon: ArrowsClockwise, tone: 'text-text-lo', spin: true };
    case 'hydrating':
      return { label: 'Setting up', icon: ArrowsClockwise, tone: 'text-clay-300', spin: true, loud: true };
    case 'pushing':
    case 'pulling':
      return { label: 'Syncing', icon: ArrowsClockwise, tone: 'text-text-lo', spin: true };
    case 'no_session':
      return { label: 'Sign in to sync', icon: SignIn, tone: 'text-text-lo', loud: true, href: '/signin' };
    case 'reauth_required':
      return { label: 'Sign in again', icon: SignIn, tone: 'text-clay-200', loud: true, href: '/signin' };
    case 'offline':
      return {
        label: pending > 0 ? `Offline, ${pending} waiting` : 'Offline',
        icon: CloudSlash,
        tone: 'text-text-lo',
        loud: pending > 0,
      };
    case 'backoff':
      return { label: 'Retrying', icon: ArrowsClockwise, tone: 'text-text-lo', spin: true };
    case 'paused_quota':
      return { label: 'Storage full', icon: WarningCircle, tone: 'text-clay-200', loud: true };
    case 'fatal':
      return { label: 'Sync stopped', icon: WarningCircle, tone: 'text-clay-200', loud: true };
    case 'follower':
      // Another tab is doing the work. Saying so would be noise.
      return { label: 'Synced', icon: CheckCircle, tone: 'text-olive-300' };
    case 'idle':
      return pending > 0
        ? { label: `${pending} waiting`, icon: ArrowsClockwise, tone: 'text-text-lo' }
        : { label: 'Synced', icon: CheckCircle, tone: 'text-olive-300' };
  }
}

export function SyncBadge() {
  useStartSync();
  const state = useSyncState();
  const { pending } = useQueueCounts();

  const look = appearanceFor(state.status, pending);
  const Icon = look.icon;

  const body = (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border border-line px-2.5 py-1',
        'bg-surface/90 text-[0.6875rem] backdrop-blur-sm',
        look.tone,
      )}
      title={state.lastError ?? undefined}
    >
      <motion.span
        animate={look.spin ? { rotate: 360 } : { rotate: 0 }}
        transition={look.spin ? LINEAR_SPIN : { duration: 0 }}
        className="grid place-items-center"
      >
        <Icon size={12} weight="bold" aria-hidden />
      </motion.span>
      {look.label}
    </span>
  );

  return (
    <div
      className={cn(
        // Phone: floats above the bottom nav, and only when it has something
        // worth saying. Desktop: parked at the foot of the rail.
        'safe-x pointer-events-auto fixed bottom-[4.75rem] left-1/2 z-30 -translate-x-1/2',
        'md:bottom-4 md:left-3 md:translate-x-0',
        look.loud ? 'block' : 'hidden md:block',
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={look.label}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={QUICK_FADE}
          role="status"
          aria-live="polite"
        >
          {look.href ? (
            <Link href={look.href} className="inline-block">
              {body}
            </Link>
          ) : (
            body
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
