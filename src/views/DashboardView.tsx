import { useEffect, useState } from 'react';
import { ArrowUpRight, Banknote, Boxes, TrendingUp } from 'lucide-react';
import type { TabKey } from '../components/Layout';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  SectionTitle,
  Spinner,
  Stat,
} from '../components/ui';
import {
  getSessionMargin,
  listAccountBalances,
  listOperations,
  getSessionSummary,
  type AccountBalanceRow,
  type FxSession,
  type OperationRow,
  type SessionSummaryRow,
} from '../lib/db';
import { currencyFlag, currencyName } from '../lib/currencies';
import { errorMessage, formatClp, formatQty, formatRate } from '../lib/format';

export default function DashboardView({
  storeId,
  session,
  onNavigate,
}: {
  storeId: string;
  session: FxSession;
  onNavigate: (tab: TabKey) => void;
}) {
  const [summary, setSummary] = useState<SessionSummaryRow[]>([]);
  const [operations, setOperations] = useState<OperationRow[]>([]);
  const [accounts, setAccounts] = useState<AccountBalanceRow[]>([]);
  const [margin, setMargin] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getSessionSummary(session.id),
      listOperations(session.id),
      listAccountBalances(storeId),
      getSessionMargin(session.id),
    ])
      .then(([summaryRows, operationRows, accountRows, marginValue]) => {
        if (cancelled) return;
        setSummary(summaryRows);
        setOperations(operationRows);
        setAccounts(accountRows);
        setMargin(marginValue);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session.id, storeId]);

  if (loading) return <Spinner label="Cargando resumen del día…" />;

  const cashClp = summary.find((row) => row.currency_code === 'CLP')?.expected_qty ?? 0;
  const inventoryClp = summary
    .filter((row) => row.currency_code !== 'CLP' && row.expected_qty > 0)
    .reduce((total, row) => total + row.current_fifo_value_clp, 0);
  const visibleSummary = summary.filter(
    (row) =>
      row.opening_qty !== 0 ||
      row.buy_qty !== 0 ||
      row.sell_qty !== 0 ||
      row.expected_qty !== 0,
  );
  const capitalClp = cashClp + inventoryClp;
  const totalBuyClp = summary.reduce((total, row) => total + row.buy_clp, 0);
  const totalSellClp = summary.reduce((total, row) => total + row.sell_clp, 0);

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Capital valorizado"
          value={formatClp(capitalClp)}
          detail="Caja CLP + inventario FIFO"
        />
        <Stat
          label="Caja CLP"
          value={formatClp(cashClp)}
          detail="Saldo esperado de la sesión"
          tone="positive"
        />
        <Stat
          label="Inventario FIFO"
          value={formatClp(inventoryClp)}
          detail="Costo de adquisición remanente"
          tone="warning"
        />
        <Stat
          label="Margen realizado"
          value={formatClp(margin)}
          detail="Ventas menos costo FIFO"
          tone={margin >= 0 ? 'positive' : 'negative'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Compras del día" value={formatClp(totalBuyClp)} />
        <Stat label="Ventas del día" value={formatClp(totalSellClp)} />
        <Stat
          label="Operaciones"
          value={String(operations.length)}
          detail="Líneas válidas y ST registradas"
        />
        <Stat
          label="Cuentas con saldo"
          value={String(accounts.length)}
          detail="Deudores y acreedores por divisa"
        />
      </div>

      <Card>
        <SectionTitle
          title="Saldos por divisa"
          subtitle="Apertura, movimientos netos y valorización FIFO de la jornada."
          action={
            <Button variant="secondary" onClick={() => onNavigate('opening')}>
              Ver apertura
            </Button>
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-semibold">Divisa</th>
                <th className="px-3 py-2 text-right font-semibold">Apertura</th>
                <th className="px-3 py-2 text-right font-semibold">Compras</th>
                <th className="px-3 py-2 text-right font-semibold">Ventas</th>
                <th className="px-3 py-2 text-right font-semibold">Esperado</th>
                <th className="px-3 py-2 text-right font-semibold">Valor FIFO</th>
              </tr>
            </thead>
            <tbody>
              {visibleSummary.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm text-slate-500">
                    No hay divisas con stock en esta sesión. Registra una apertura o
                    agrega una divisa desde Cuadratura.
                  </td>
                </tr>
              )}
              {visibleSummary.map((row) => (
                <tr key={row.currency_code} className="border-b border-white/[0.04]">
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base leading-none">
                        {currencyFlag(row.currency_code)}
                      </span>
                      <span className="font-semibold text-slate-100">
                        {row.currency_code}
                      </span>
                      <span className="text-xs text-slate-500">
                        {currencyName(row.currency_code)}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-300">
                    {formatQty(row.opening_qty)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-emerald-300">
                    {formatQty(row.buy_qty)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-rose-300">
                    {formatQty(row.sell_qty)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-white">
                    {formatQty(row.expected_qty)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-300">
                    {formatClp(row.current_fifo_value_clp)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionTitle
            title="Últimas operaciones"
            subtitle="Compras y ventas de la sesión."
            action={
              <Button variant="ghost" onClick={() => onNavigate('operations')}>
                Ver todas
              </Button>
            }
          />
          {operations.length === 0 ? (
            <EmptyState
              title="Sin operaciones"
              description="Importa el reporte diario para comenzar."
              action={<Button onClick={() => onNavigate('import')}>Importar reporte</Button>}
            />
          ) : (
            <div className="space-y-2">
              {operations.slice(0, 7).map((operation) => (
                <div
                  key={operation.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge
                        tone={operation.operation === 'COMPRA' ? 'green' : 'rose'}
                      >
                        {operation.operation}
                      </Badge>
                      <span className="truncate text-sm font-semibold text-slate-200">
                        {operation.document?.folio || 'Sin folio'}
                      </span>
                      <span className="text-xs text-slate-500">
                        {operation.currency_code}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatQty(operation.foreign_amount)} × {formatRate(operation.fx_rate)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-white">
                      {formatClp(operation.clp_amount)}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {operation.document?.status === 'VALID' ? 'Válida' : 'ST / anulada'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle
            title="Cuentas corrientes"
            subtitle="Deudores y acreedores por divisa."
            action={
              <Button variant="ghost" onClick={() => onNavigate('accounts')}>
                Gestionar
              </Button>
            }
          />
          {accounts.length === 0 ? (
            <EmptyState
              title="Sin cuentas registradas"
              description="Registra préstamos, entregas o ventas a crédito."
              action={<Button onClick={() => onNavigate('accounts')}>Nueva cuenta</Button>}
            />
          ) : (
            <div className="space-y-2">
              {accounts.slice(0, 7).map((account) => (
                <div
                  key={`${account.counterparty_id}-${account.currency_code}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-200">
                      {account.counterparty_name}
                    </p>
                    <p className="text-xs text-slate-500">{account.currency_code}</p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-semibold ${
                        account.net >= 0 ? 'text-emerald-300' : 'text-rose-300'
                      }`}
                    >
                      {formatQty(account.net)}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {account.net >= 0 ? 'Nos deben' : 'Les debemos'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="border-indigo-400/10 bg-indigo-500/[0.04]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300">
              <TrendingUp className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-white">Cierre y valorización FIFO</p>
              <p className="mt-1 text-sm text-slate-400">
                Revisa el conteo físico, las diferencias y el capital antes de cerrar la jornada.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onNavigate('cashcount')}>
              <Banknote className="h-4 w-4" /> Cuadratura
            </Button>
            <Button onClick={() => onNavigate('close')}>
              <Boxes className="h-4 w-4" /> Cerrar día <ArrowUpRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
