'use client';

import { Login } from '../../components/Login';
import { authClient } from '../../lib/auth-client';

export default function LoginPage() {
  return <Login client={authClient} onSignedIn={() => window.location.assign('/')} />;
}
