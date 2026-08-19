import { serwist } from '@serwist/next/config';

/**
 * How `app/sw.ts` becomes `public/sw.js`.
 *
 * Serwist ships a webpack plugin for Next, and Next 16 makes Turbopack the
 * default for both `dev` and `build`. A webpack config in `next.config.ts` makes
 * a Turbopack build exit rather than warn, and Turbopack supports webpack
 * loaders but not plugins, so the plugin has no migration path. Serwist knows
 * this: its own warning points at issue #54.
 *
 * So the service worker is built by Serwist's CLI as a step of its own, after
 * `next build` has written the output this reads. Nothing about the app build
 * changes, Turbopack stays the default, and `next.config.ts` stays empty.
 *
 * `withNextConfig` reads the resolved Next config to work out `distDir`, then
 * globs `.next/static/**` and `public/**` for the precache manifest and rewrites
 * each path to the URL it will be served from. It also picks up the prerendered
 * HTML of every route, which is what makes a cold offline load open the real app
 * rather than the fallback.
 *
 * Run through `npm run build`. On its own it needs `next build` to have run
 * first, or the manifest comes out nearly empty.
 */
export default await serwist.withNextConfig(() => ({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  esbuildOptions: {
    // The CLI hands esbuild no `define`, and the Serwist runtime guards its
    // development logging with `process.env.NODE_ENV`. Left alone, that
    // identifier survives into the bundle and the worker dies on its first line
    // with "process is not defined", which presents as the app simply never
    // having a service worker.
    define: { 'process.env.NODE_ENV': '"production"' },
  },
}));
