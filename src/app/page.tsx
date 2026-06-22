'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';

const ADMIN_EMAIL = 'bhuisompa001@gmail.com';
const ADMIN_NAME = 'Sompa Bhui';
const AUTH_TIMEOUT_MS = 10000;
const LOCAL_PREVIEW_MODE = process.env.NODE_ENV !== 'production';

function withTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${AUTH_TIMEOUT_MS / 1000}s`));
    }, AUTH_TIMEOUT_MS);

    Promise.resolve(promise)
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeoutId));
  });
}

export default function Home() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'unauthenticated' | 'error' | 'preview'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    console.log('[home-page] page initialization');

    if (LOCAL_PREVIEW_MODE) {
      setStatus('preview');
      return;
    }

    async function checkUser() {
      console.log('[home-page] auth check start');
      try {
        const { data: { session } } = await withTimeout(
          supabase.auth.getSession(),
          'Supabase session check'
        );

        if (!session || !session.user) {
          console.log('[home-page] auth check complete: unauthenticated');
          setStatus('unauthenticated');
          return;
        }

        const sessionEmail = session.user.email?.toLowerCase() || '';
        if (sessionEmail === ADMIN_EMAIL) {
          await ensureAdminRecord(session.user.id, sessionEmail);
        }

        const { data: profile, error } = await withTimeout(
          Promise.resolve(
            supabase
              .from('users')
              .select('role')
              .or(`id.eq.${session.user.id},email.eq.${sessionEmail}`)
              .single()
          ),
          'Profile role lookup'
        );

        if (error || !profile?.role) {
          const sessionEmail = session.user.email?.toLowerCase() || '';
          if (sessionEmail === ADMIN_EMAIL) {
            console.warn('[home-page] Admin email detected but no profile role found; routing to admin.');
            router.replace('/admin');
            return;
          }

          setError('Could not resolve your profile role. Please sign in again or contact your administrator.');
          setStatus('error');
          return;
        }

        const role = profile.role;
        console.log('[home-page] auth check role:', role);
        if (role === 'admin') {
          router.replace('/admin');
        } else if (role === 'employee') {
          router.replace('/employee');
        } else {
          setError('Access denied: your account role is not permitted.');
          setStatus('error');
        }
      } catch (err: any) {
        console.error('[home-page] auth check failed:', err);
        setError(err?.message || 'Failed to verify session.');
        setStatus('error');
      }
    }

    void checkUser();
  }, [router]);

  async function ensureAdminRecord(userId: string, emailValue: string) {
    if (emailValue.toLowerCase() !== ADMIN_EMAIL) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);

    try {
      const response = await fetch('/api/ensure-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValue, userId, name: ADMIN_NAME }),
        signal: controller.signal
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `Ensure admin failed with ${response.status}`);
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const { data, error: signInError } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password
        }),
        'Admin sign in'
      );

      if (signInError || !data.session) {
        throw new Error(signInError?.message || 'Invalid login credentials');
      }

      const session = data.session;
      await ensureAdminRecord(session.user.id, session.user.email || '');

      const { data: profileData, error: profileError } = await withTimeout(
        Promise.resolve(
          supabase
            .from('users')
            .select('role')
            .eq('id', session.user.id)
            .single()
        ),
        'Signed-in profile lookup'
      );

      const role = profileData?.role;
      if (role === 'admin') {
        router.replace('/admin');
      } else if (role === 'employee') {
        router.replace('/employee');
      } else if (session.user.email?.toLowerCase() === ADMIN_EMAIL) {
        console.warn('[home-page] Signed-in admin email with missing role. Redirecting to admin dashboard.');
        router.replace('/admin');
      } else {
        throw new Error('Access denied: your account role is not permitted.');
      }
    } catch (err: any) {
      console.error('Admin login failed:', err);
      setError(err?.message || 'Failed to sign in.');
      setStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 gap-4 p-6">
        <Loader2 className="animate-spin text-indigo-600" size={40} />
        <p className="text-slate-500 font-medium font-sans">Verifying session...</p>
      </div>
    );
  }

  if (status === 'preview') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Local preview mode</p>
          <h1 className="mt-3 text-4xl font-black">Employee Monitoring System</h1>
          <p className="mt-3 max-w-xl text-sm text-white/70">
            Supabase auth is bypassed locally so the dashboard stays visible even when the database
            keys are not configured yet.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => router.replace('/admin')}
              className="rounded-2xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300"
            >
              Open Admin Dashboard
            </button>
            <button
              onClick={() => router.replace('/employee')}
              className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10"
            >
              Open Employee Dashboard
            </button>
          </div>
          <p className="mt-6 text-xs text-white/45">
            To test real authentication, set up the Supabase env vars and run the app in production mode.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 font-sans text-center">
      <div className="max-w-xl rounded-3xl border border-slate-200 bg-white p-10 shadow-xl">
        <h1 className="text-4xl font-black text-slate-900 mb-4">Admin Login</h1>
        {status === 'unauthenticated' ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-left text-sm font-semibold text-slate-700 mb-2">Email</label>
              <input
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-slate-900 focus:border-indigo-500 focus:outline-none"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="sompa bhui"
                required
              />
            </div>
            <div>
              <label className="block text-left text-sm font-semibold text-slate-700 mb-2">Password</label>
              <input
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-slate-900 focus:border-indigo-500 focus:outline-none"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
              />
            </div>
            {error && <p className="text-left text-sm text-rose-600">{error}</p>}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-2xl bg-indigo-600 px-4 py-3 text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Signing in…' : 'Sign in as admin'}
            </button>
            <p className="text-sm text-slate-500">
              Only administrators may access this dashboard. Use the Chrome extension login for employee access.
            </p>
          </form>
        ) : (
          <p className="text-rose-500 text-base">{error || 'An unexpected error occurred while resolving your user role.'}</p>
        )}
      </div>
    </div>
  );
}
