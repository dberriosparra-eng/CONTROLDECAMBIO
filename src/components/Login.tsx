import { useState } from 'react';
import { LockKeyhole, Mail, Wallet } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/format';
import { Button, Card, ErrorBanner, Input } from './ui';

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setMessage('Cuenta creada. Revisa tu correo para confirmar la cuenta.');
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-slate-950 px-4 py-10">
      <div className="pointer-events-none absolute -left-32 top-0 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />

      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-300 via-indigo-500 to-indigo-700 text-slate-950 shadow-2xl shadow-indigo-950/60">
            <Wallet className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-white">
            Control de Cambio
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Caja Temuco · panel interno de divisas
          </p>
        </div>

        <Card>
          <div className="mb-5 flex rounded-xl border border-white/10 bg-slate-950/50 p-1">
            <button
              type="button"
              onClick={() => setMode('signin')}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                mode === 'signin'
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Ingresar
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                mode === 'signup'
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Crear cuenta
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Correo
              </span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <Input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="tu@correo.cl"
                  className="pl-9"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Contraseña
              </span>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <Input
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  className="pl-9"
                />
              </div>
            </label>

            <ErrorBanner message={error} />
            {message && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                {message}
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading
                ? 'Procesando…'
                : mode === 'signin'
                  ? 'Entrar al panel'
                  : 'Crear cuenta'}
            </Button>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs text-slate-600">
          Proyecto independiente · Supabase Auth + RLS
        </p>
      </div>
    </main>
  );
}
