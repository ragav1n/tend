import { Sidebar } from '@/components/shell/Sidebar';

/**
 * The authenticated shell.
 *
 * A server component that renders one client component, which is the supported
 * shape in Next 16: there is no way to mark a whole route group as client
 * rendered, so each page carries its own directive. The payoff is that the shell
 * chrome, fonts and tokens land in the first HTML paint while the task data
 * arrives from IndexedDB a few milliseconds later, so nothing shifts.
 *
 * This group's HTML contains zero user data, which is what makes it safe for the
 * service worker to cache navigations in phase 3.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh md:pl-[232px]">
      <Sidebar />
      {/* Bottom padding clears the mobile nav bar plus the home indicator. */}
      <main className="safe-top safe-x mx-auto w-full max-w-2xl px-4 pb-28 pt-6 md:pb-10 md:pt-10">
        {children}
      </main>
    </div>
  );
}
