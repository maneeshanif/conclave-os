import { redirect } from 'next/navigation';

/** The old route. The page is a panel over the office now (S6-12c); this only leads there, so old links and bookmarks still work. */
export default function Page(): never {
  redirect('/?panel=campaigns');
}
