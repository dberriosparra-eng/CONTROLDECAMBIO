import { useEffect, useState } from 'react';
import type { TabKey } from '../components/Layout';
import {
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

  const debtors = accounts.filter((row) => row.receivable > 0);
  const creditors = accounts.filter((row) => row.payable > 0);

  function subtotals(rows: AccountBalanceRow[], field: 'receivable' | 'payable') {
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.currency_code, (map.get(row.currency_code) ?? 0) + Number(row[field] || 0));
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }
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

      <div>
        <SectionTitle
          title="Cuentas corrientes"
          subtitle="Deudores y acreedores separados por contraparte y divisa, con subtotal por moneda."
          action={
            <Button variant="ghost" onClick={() => onNavigate('accounts')}>
              Gestionar
            </Button>
          }
        />

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-emerald-300">Deudores</p>
                <p className="text-xs text-slate-500">Nos deben</p>
              </div>
              <span className="text-xs text-slate-500">{debtors.length} registros</span>
            </div>
            {debtors.length === 0 ? (
              <EmptyState
                title="Sin deudores"
                description="No hay saldos pendientes a favor."
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[320px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500">
                        <th className="py-2 pr-3 font-semibold">Contraparte</th>
                        <th className="px-3 py-2 font-semibold">Divisa</th>
                        <th className="px-3 py-2 text-right font-semibold">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {debtors.map((row) => (
                        <tr
                          key={`debtor-${row.counterparty_id}-${row.currency_code}`}
                          className="border-b border-white/[0.04]"
                        >
                          <td className="py-2 pr-3 text-slate-200">
                            {row.counterparty_name}
                          </td>
                          <td className="px-3 py-2 text-slate-400">
                            {currencyFlag(row.currency_code)} {row.currency_code}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-emerald-300">
                            {formatQty(row.receivable)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 space-y-1 border-t border-white/10 pt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Subtotal por divisa
                  </p>
                  {subtotals(debtors, 'receivable').map(([currency, total]) => (
                    <div key={`debtor-sub-${currency}`} className="flex justify-between text-xs">
                      <span className="text-slate-400">
                        {currencyFlag(currency)} {currency}
                      </span>
                      <span className="font-semibold text-emerald-300">
                        {formatQty(total)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-rose-300">Acreedores</p>
                <p className="text-xs text-slate-500">Les debemos</p>
              </div>
              <span className="text-xs text-slate-500">{creditors.length} registros</span>
            </div>
            {creditors.length === 0 ? (
              <EmptyState
                title="Sin acreedores"
                description="No hay saldos pendientes por pagar."
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[320px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500">
                        <th className="py-2 pr-3 font-semibold">Contraparte</th>
                        <th className="px-3 py-2 font-semibold">Divisa</th>
                        <th className="px-3 py-2 text-right font-semibold">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creditors.map((row) => (
                        <tr
                          key={`creditor-${row.counterparty_id}-${row.currency_code}`}
                          className="border-b border-white/[0.04]"
                        >
                          <td className="py-2 pr-3 text-slate-200">
                            {row.counterparty_name}
                          </td>
                          <td className="px-3 py-2 text-slate-400">
                            {currencyFlag(row.currency_code)} {row.currency_code}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-rose-300">
                            {formatQty(row.payable)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 space-y-1 border-t border-white/10 pt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Subtotal por divisa
                  </p>
                  {subtotals(creditors, 'payable').map(([currency, total]) => (
                    <div key={`creditor-sub-${currency}`} className="flex justify-between text-xs">
                      <span className="text-slate-400">
                        {currencyFlag(currency)} {currency}
                      </span>
                      <span className="font-semibold text-rose-300">
                        {formatQty(total)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
