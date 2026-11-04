import { useState } from 'react';
import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  FileUp,
  Handshake,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Settings2,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { classNames, formatDate } from '../lib/format';

export type TabKey =
  | 'dashboard'
  | 'opening'
  | 'import'
  | 'operations'
  | 'wholesale'
  | 'accounts'
  | 'expenses'
  | 'cashcount'
  | 'close'
  | 'history'
  | 'settings';

const NAV: Array<{
  label: string;
  items: Array<{ id: TabKey; label: string; icon: typeof LayoutDashboard }>;
}> = [
  {
    label: 'Operación diaria',
    items: [
      { id: 'dashboard', label: 'Resumen', icon: LayoutDashboard },
      { id: 'opening', label: 'Apertura', icon: Wallet },
      { id: 'import', label: 'Importar reporte', icon: FileUp },
      { id: 'operations', label: 'Operaciones', icon: ArrowLeftRight },
      { id: 'wholesale', label: 'Mayoristas', icon: Handshake },
      { id: 'cashcount', label: 'Cuadratura', icon: Banknote },
      { id: 'close', label: 'Cierre', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Gestión',
    items: [
      { id: 'accounts', label: 'Cuentas corrientes', icon: Users },
      { id: 'expenses', label: 'Gastos', icon: Receipt },
      { id: 'history', label: 'Histórico', icon: BarChart3 },
      { id: 'settings', label: 'Configuración', icon: Settings2 },
    ],
  },
];

const LABELS: Record<TabKey, string> = {
  dashboard: 'Resumen',
  opening: 'Apertura de caja',
  import: 'Importar reporte',
  operations: 'Operaciones del día',
  wholesale: 'Cierres mayoristas',
  accounts: 'Cuentas corrientes',
  expenses: 'Gastos del día',
  cashcount: 'Cuadratura',
  close: 'Cierre del día',
  history: 'Histórico',
  settings: 'Configuración',
};

export default function Layout({
  active,
  onChange,
  businessDate,
  onDateChange,
  storeName,
  userEmail,
  children,
}: {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  businessDate: string;
  onDateChange: (date: string) => void;
  storeName: string;
  userEmail: string;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  async function signOut() {
    await supabase.auth.signOut();
  }

  function navigate(tab: TabKey) {
    onChange(tab);
    setMobileOpen(false);
  }

  const sidebar = (
    <aside className="flex h-full w-[272px] shrink-0 flex-col border-r border-white/[0.06] bg-slate-950/95">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-300 via-indigo-500 to-indigo-700 text-slate-950 shadow-lg shadow-indigo-950/60">
            <Wallet className="h-5 w-5" />
          </span>
          <div>
            <p className="text-base font-bold leading-none tracking-tight text-white">
              control<span className="text-indigo-400">.</span>cambio
            </p>
            <p className="mt-1 text-[11px] text-slate-500">Caja Temuco</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="rounded-lg p-2 text-slate-400 hover:bg-white/[0.06] hover:text-white lg:hidden"
          aria-label="Cerrar menú"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mx-3 mb-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Negocio
        </p>
        <p className="mt-1 truncate text-sm font-semibold text-slate-200">{storeName}</p>
        <p className="mt-0.5 truncate text-[11px] text-slate-500">{userEmail}</p>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {NAV.map((group) => (
          <div key={group.label}>
            <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
              {group.label}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.id)}
                    className={classNames(
                      'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-indigo-500/15 text-indigo-200 ring-1 ring-inset ring-indigo-400/20'
                        : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.06] p-3">
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-200"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-slate-950">
      <div className="hidden lg:block">{sidebar}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 shadow-2xl shadow-black/60">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] bg-slate-950/80 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-400 hover:bg-white/[0.06] hover:text-white lg:hidden"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-white">
                {LABELS[active]}
              </h1>
              <p className="text-xs text-slate-500">
                {formatDate(businessDate)} · jornada operativa
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="date"
                value={businessDate}
                onChange={(event) => onDateChange(event.target.value)}
                className="rounded-xl border border-white/10 bg-slate-950/60 py-2 pl-9 pr-3 text-sm text-slate-200 outline-none focus:border-indigo-400/60"
              />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-5 lg:px-6">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
