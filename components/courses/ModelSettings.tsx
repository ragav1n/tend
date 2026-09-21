'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Sparkle } from '@phosphor-icons/react/dist/ssr';
import { useLocalModel } from '@/hooks/use-local-model';
import { DEFAULT_ENDPOINT } from '@/lib/syllabus/model';
import { cn } from '@/lib/utils';
import { controlClass } from '@/components/ui/Field';

/**
 * Pointing at a local model, if there is one.
 *
 * Entirely optional, and the copy says so first. Nothing in the app needs this:
 * the syllabus grid reads a paste on its own, and a model only fills it in
 * faster. Somebody who never opens this loses one convenience.
 *
 * Per device, not synced, because an endpoint is a property of a machine. The
 * laptop running Ollama and the phone in your pocket do not share an answer.
 *
 * Nothing is probed until asked. Ollama is supposed to be off most of the time,
 * so a check on mount would be a request for an answer that is usually no.
 */
export function ModelSettings() {
  const { settings, probe, checking, check, update } = useLocalModel();
  const [endpoint, setEndpoint] = useState<string | null>(null);

  const shown = endpoint ?? settings.endpoint;

  async function test() {
    const result = await check();
    if (!result.reachable) {
      toast('Nothing answered there', {
        description:
          'Start Ollama, and set OLLAMA_ORIGINS so it accepts requests from this page.',
      });
      return;
    }
    toast(
      result.models.length === 0
        ? 'Reachable, but no models installed'
        : `Reachable, ${result.models.length} ${result.models.length === 1 ? 'model' : 'models'}`,
    );
  }

  return (
    <div className="divide-y divide-line">
      <div className="py-3">
        <label htmlFor="model-endpoint" className="block text-sm text-text-hi">
          Local model
        </label>
        <p className="mt-0.5 text-xs leading-snug text-text-lo">
          Optional. Tend can read a pasted syllabus with a model running on this machine. It sends
          one request when you ask and unloads the model straight after. Nothing leaves the device
          and nothing runs in the background.
        </p>

        <div className="mt-2 flex items-center gap-2">
          <input
            id="model-endpoint"
            value={shown}
            onChange={(event) => setEndpoint(event.target.value)}
            onBlur={() => {
              if (endpoint !== null) update({ endpoint });
              setEndpoint(null);
            }}
            placeholder={DEFAULT_ENDPOINT}
            autoComplete="off"
            spellCheck={false}
            className={cn(controlClass, 'min-w-0 flex-1 font-mono text-xs')}
          />
          <button
            type="button"
            onClick={() => void test()}
            disabled={checking}
            className={cn(controlClass, 'inline-flex w-auto shrink-0 items-center gap-1.5 px-3 text-sm')}
          >
            <Sparkle size={13} aria-hidden />
            {checking ? 'Checking' : 'Check'}
          </button>
        </div>
      </div>

      {probe?.reachable && (
        <div className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <label htmlFor="model-name" className="block text-sm text-text-hi">
              Which model
            </label>
            <p className="mt-0.5 text-xs leading-snug text-text-lo">
              A small one is the right tool. Reading a table is extraction, not reasoning.
            </p>
          </div>
          <select
            id="model-name"
            value={settings.model}
            onChange={(event) => update({ model: event.target.value })}
            className={cn(controlClass, 'w-auto shrink-0 text-sm')}
          >
            {/* The configured one first, even when the server does not have it,
                so the field never silently shows something else. */}
            {!probe.models.includes(settings.model) && (
              <option value={settings.model}>{settings.model} (not installed)</option>
            )}
            {probe.models.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}

      {probe !== null && !probe.reachable && (
        <p className="py-3 text-xs text-text-lo">
          Nothing answered. Two usual reasons, neither of them a problem with Tend: Ollama accepts
          requests from <span className="font-mono">127.0.0.1</span> only unless{' '}
          <span className="font-mono">OLLAMA_ORIGINS</span> names this page, and a browser will not
          let a site served over HTTPS reach a loopback address at all. It works from a local dev
          server.
        </p>
      )}
    </div>
  );
}
