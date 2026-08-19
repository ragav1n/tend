import { AppOverlays } from '@/components/shell/AppOverlays';
import { MainFrame } from '@/components/shell/MainFrame';
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
      {/* MainFrame owns the width, which differs between a list and a grid, and
          the bottom padding that clears the mobile nav plus the home indicator. */}
      <MainFrame>{children}</MainFrame>
      <AppOverlays />
    </div>
  );
}
