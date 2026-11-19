import { redirect } from 'next/navigation';

/** The office is the home page now (S6-12c). */
export default function Page(): never {
  redirect('/');
}
