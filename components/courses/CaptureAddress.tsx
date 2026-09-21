'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, EnvelopeSimple } from '@phosphor-icons/react/dist/ssr';
import { cn } from '@/lib/utils';
import { controlClass } from '@/components/ui/Field';

/**
 * Where to forward mail so it becomes a task.
 *
 * Shown rather than explained, because the address is the whole interface and
 * an address you have to go and look up in a dashboard is one you never use.
 *
 * Absent when the deployment has no inbound address set, rather than showing an
 * empty box with instructions for something that will not work. The README
 * covers the setup; this covers the using.
 */
export function CaptureAddress() {
  const address = process.env.NEXT_PUBLIC_CAPTURE_ADDRESS ?? '';
  const [copied, setCopied] = useState(false);

  if (address === '') return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused in some browsers without a gesture it
      // recognises. The address is on screen either way.
      toast('Could not copy', { description: 'The address is above, ready to select.' });
    }
  }

  return (
    <div className="py-3">
      <span className="block text-sm text-text-hi">Mail yourself a task</span>
      <p className="mt-0.5 text-xs leading-snug text-text-lo">
        Forward anything here and it lands in your Inbox. The subject is read the way the
        quick-add field reads it, so &ldquo;Read chapter 4 tomorrow !p2&rdquo; arrives dated. Only
        mail from your own address is accepted.
      </p>

      <div className="mt-2 flex items-center gap-2">
        <span
          className={cn(controlClass, 'min-w-0 flex-1 truncate font-mono text-xs')}
          title={address}
        >
          <EnvelopeSimple size={12} aria-hidden className="mr-1.5 inline align-[-1px]" />
          {address}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copy the capture address"
          className={cn(controlClass, 'inline-flex w-auto shrink-0 items-center gap-1.5 px-3 text-sm')}
        >
          <Copy size={13} aria-hidden />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
