import type { Icon } from '@phosphor-icons/react';
import {
  Briefcase,
  Bug,
  Fire,
  Flag,
  FolderSimple,
  Funnel,
  Heart,
  House,
  Lightning,
  Star,
  Tray,
} from '@phosphor-icons/react/dist/ssr';

/**
 * The icons a saved view can wear.
 *
 * A closed list rather than the whole Phosphor set: importing by name at
 * runtime defeats tree shaking and pulls the entire family into the bundle. The
 * column is free text so an older client meeting a newer icon falls back rather
 * than failing.
 */
export const VIEW_ICONS: Record<string, Icon> = {
  Funnel,
  Star,
  Fire,
  Flag,
  Heart,
  House,
  Briefcase,
  Lightning,
  Bug,
  FolderSimple,
  Tray,
};

export const VIEW_ICON_NAMES = Object.keys(VIEW_ICONS);

export function viewIcon(name: string): Icon {
  return VIEW_ICONS[name] ?? Funnel;
}
