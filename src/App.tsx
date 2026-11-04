import { useEffect, useState } from 'react';
import type { Session as AuthSession } from '@supabase/supabase-js';
import Layout, { type TabKey } from './components/Layout';
import Login from './components/Login';
import { Card, ErrorBanner, Spinner } from './components/ui';
import { supabase } from './lib/supabase';
import {
  ensureSession,
  ensureStore,
  getStoreName,
  type FxSession,
} from './lib/db';
import { errorMessage, todayIso } from './lib/format';
import DashboardView from './views/DashboardView';
import OpeningView from './views/OpeningView';
import ImportView from './views/ImportView';
import OperationsView from './views/OperationsView';
import WholesaleView from './views/WholesaleView';
import AccountsView from './views/AccountsView';
import ExpensesView from './views/ExpensesView';
import CashCountView from './views/CashCountView';
import CloseView from './views/CloseView';
import HistoryView from './views/HistoryView';
import SettingsView from './views/SettingsView';

function isMissingSchemaError(message: string): boolean {
  return /does not exist|Could not find the function|schema cache|PGRST202|42P01/i.test(
    message,
  );
}

export default function App() {
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState('Caja Temuco');
  const [businessDate, setBusinessDate] = useState(todayIso());
  const [fxSession, setFxSession] = useState<FxSession | null>(null);
  const [active, setActive] = useState<TabKey>('dashboard');
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setAuthSession(data.session);
        setAuthReady(true);
      })
      .catch(() => {
        if (!cancelled) setAuthReady(true);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthSession(session);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authSession) {
      setStoreId(null);
      setFxSession(null);
      setBooting(false);
      return;
    }

    let cancelled = false;
    setBooting(true);
    setBootError(null);

    ensureStore()
      .then(async (id) => {
        if (cancelled) return;
        setStoreId(id);
        const name = await getStoreName(id);
        if (!cancelled) setStoreName(name);
      })
      .catch((caught) => {
        if (!cancelled) setBootError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authSession]);

  useEffect(() => {
    if (!storeId) return;
    let cancelled = false;
    setBootError(null);

    ensureSession(storeId, businessDate)
      .then((session) => {
        if (!cancelled) setFxSession(session);
      })
      .catch((caught) => {
        if (!cancelled) setBootError(errorMessage(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [storeId, businessDate]);

  function refresh() {
    if (storeId) {
      ensureSession(storeId, businessDate)
        .then((session) => setFxSession(session))
        .catch(() => undefined);
    }
  }

  if (!authReady) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-950">
        <Spinner label="Verificando sesión…" />
      </main>
    );
  }

  if (!authSession) return <Login />;

  if (booting || !storeId || !fxSession) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-950 px-4">
        {bootError ? (
          <div className="w-full max-w-xl space-y-3">
            {isMissingSchemaError(bootError) ? (
              <Card>
                <h2 className="text-lg font-semibold text-white">
                  Falta aplicar el esquema en Supabase
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  El usuario existe y el login funciona, pero la base todavía no tiene
                  las tablas del sistema. Ejecuta el archivo{' '}
                  <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-indigo-200">
                    supabase/apply_all_ascii.sql
                  </code>{' '}
                  completo en el SQL Editor de Supabase y vuelve a cargar esta página.
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Detalle técnico: {bootError}
                </p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-4 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
                >
                  Ya apliqué el SQL, reintentar
                </button>
              </Card>
            ) : (
              <>
                <ErrorBanner message={bootError} />
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
                >
                  Reintentar
                </button>
              </>
            )}
          </div>
        ) : (
          <Spinner label="Preparando la jornada…" />
        )}
      </main>
    );
  }

  function renderView() {
    if (!storeId || !fxSession) return null;

    switch (active) {
      case 'opening':
        return (
          <OpeningView
            storeId={storeId}
            session={fxSession}
            businessDate={businessDate}
            onSaved={refresh}
          />
        );
      case 'import':
        return <ImportView storeId={storeId} session={fxSession} onImported={refresh} />;
      case 'operations':
        return <OperationsView storeId={storeId} session={fxSession} onChanged={refresh} />;
      case 'wholesale':
        return <WholesaleView storeId={storeId} session={fxSession} onChanged={refresh} />;
      case 'accounts':
        return <AccountsView storeId={storeId} session={fxSession} onChanged={refresh} />;
      case 'expenses':
        return <ExpensesView storeId={storeId} session={fxSession} onChanged={refresh} />;
      case 'cashcount':
        return <CashCountView storeId={storeId} session={fxSession} onSaved={refresh} />;
      case 'close':
        return <CloseView storeId={storeId} session={fxSession} onClosed={refresh} />;
      case 'history':
        return <HistoryView storeId={storeId} />;
      case 'settings':
        return <SettingsView storeId={storeId} />;
      default:
        return (
          <DashboardView storeId={storeId} session={fxSession} onNavigate={setActive} />
        );
    }
  }

  return (
    <Layout
      active={active}
      onChange={setActive}
      businessDate={businessDate}
      onDateChange={setBusinessDate}
      storeName={storeName}
      userEmail={authSession.user.email ?? ''}
    >
      {fxSession.status !== 'OPEN' && (
        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          La jornada está {fxSession.status.toLowerCase()}. Puedes consultar el cierre,
          pero no registrar nuevas operaciones.
        </div>
      )}
      <div>{renderView()}</div>
    </Layout>
  );
}
