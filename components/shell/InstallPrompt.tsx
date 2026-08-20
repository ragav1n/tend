'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Export, PlusSquare, X } from '@phosphor-icons/react/dist/ssr';
import { APP_NAME } from '@/lib/config';
import { MarkTile } from '@/components/brand/Mark';
import { useInstall, type InstallMethod } from '@/hooks/use-install';
import { PRESS_DEPTH } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * "Install Tend."
 *
 * Asked once, and not on the first visit. An install banner that appears before
 * anybody has decided whether they want the app is the pattern everybody has
 * learned to swipe away without reading, and it costs the one chance to ask. So
 * it waits for a second visit, and dismissing it is permanent.
 *
 * A toast rather than a card of its own, because it is the second thing that can
 * float at the bottom of the screen and the first one taught the lesson: two
 * hand-placed prompts land on top of each other the day they both fire, which is
 * exactly the day a new version arrives. Sonner already owns that corner and
 * stacks what goes in it.
 *
 * Two shapes for two platforms. Chrome hands over a real prompt, so there it is
 * one button. Safari hands over nothing, so there it is the gesture, spelled out,
 * with the reason it is worth doing: on iOS the home screen is what makes
 * notifications possible at all.
 */

const VISITS_KEY = 'tend.visits';
const DISMISSED_KEY = 'tend.install.dismissed';

/** One visit is somebody looking. Two is somebody using it. */
const VISITS_BEFORE_ASKING = 2;

function countVisit(): number {
  const current = Number(localStorage.getItem(VISITS_KEY) ?? '0');
  const next = Number.isFinite(current) ? current + 1 : 1;
  localStorage.setItem(VISITS_KEY, String(next));
  return next;
}

export function InstallPrompt() {
  const { ready, installed, method, install } = useInstall();
  const visits = useRef(0);
  const shown = useRef(false);

  useEffect(() => {
    if (visits.current === 0) visits.current = countVisit();
  }, []);

  useEffect(() => {
    if (!ready || installed || method === 'none' || shown.current) return;
    if (localStorage.getItem(DISMISSED_KEY) === '1') return;
    if (visits.current < VISITS_BEFORE_ASKING) return;
    shown.current = true;

    // Asked once, so the answer is remembered whichever way it is given: the
    // close button, a swipe, or accepting the install.
    const remember = () => localStorage.setItem(DISMISSED_KEY, '1');

    toast.custom(
      (id) => (
        <InstallCard
          method={method}
          onInstall={() => {
            remember();
            toast.dismiss(id);
            void install();
          }}
          onDismiss={() => {
            remember();
            toast.dismiss(id);
          }}
        />
      ),
      { duration: Infinity, onDismiss: remember },
    );
  }, [ready, installed, method, install]);

  return null;
}

function InstallCard({
  method,
  onInstall,
  onDismiss,
}: {
  method: InstallMethod;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="relative w-full rounded-md border border-line-bright bg-surface p-4"
      style={{ boxShadow: 'var(--shadow-raised)' }}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Not now"
        className="absolute right-2 top-2 grid size-7 place-items-center rounded-md text-text-lo hover:bg-raised hover:text-text-hi"
      >
        <X size={13} weight="bold" aria-hidden />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <MarkTile size={32} />
        <div className="min-w-0">
          <p className="font-sans text-sm text-text-hi">Install {APP_NAME}</p>

          {method === 'prompt' ? (
            <>
              <p className="mt-1 font-sans text-xs leading-relaxed text-text-lo">
                It opens with no browser bar, starts on Today, and works with no
                connection.
              </p>
              <motion.button
                type="button"
                whileTap={{ y: 1 }}
                transition={PRESS_DEPTH}
                onClick={onInstall}
                className={cn(
                  'mt-3 rounded-md border border-clay-400 bg-clay-600 px-3 py-1.5',
                  'font-sans text-xs text-on-accent hover:bg-clay-500',
                )}
                style={{ boxShadow: 'var(--shadow-flush)' }}
              >
                Install
              </motion.button>
            </>
          ) : (
            <>
              <p className="mt-1 font-sans text-xs leading-relaxed text-text-lo">
                Add it to your home screen. It opens with no Safari bar, and it is what
                lets {APP_NAME} send you a notification.
              </p>
              <ol className="mt-2.5 space-y-1.5 font-sans text-xs text-text-mid">
                <li className="flex items-center gap-2">
                  <Export size={15} className="shrink-0 text-clay-300" aria-hidden />
                  Tap Share
                </li>
                <li className="flex items-center gap-2">
                  <PlusSquare size={15} className="shrink-0 text-clay-300" aria-hidden />
                  Then Add to Home Screen
                </li>
              </ol>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
