import { redirect } from 'next/navigation';

/** Today is the only sensible landing view for a daily task app. */
export default function Home() {
  redirect('/today');
}
