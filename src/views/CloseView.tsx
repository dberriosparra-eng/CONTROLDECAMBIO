import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileDown, Printer } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Input,
  SectionTitle,
  Spinner,
  SuccessBanner,
} from '../components/ui';
import {
  closeSession,
  getSessionMargin,
  getSessionSummary,
  listAccountBalances,
  listCashCounts,
  listClosures,
  listCurrencyMargins,
  listExpenses,
  listWholesaleDeals,
  type AccountBalanceRow,
  type CashCountRow,
  type ClosureRow,
  type CurrencyMarginRow,
  type ExpenseRow,
  type FxSession,
  type SessionSummaryRow,
  type WholesaleDealRow,
} from '../lib/db';
import { currencyFlag } from '../lib/currencies';
import { errorMessage, formatClp, formatDate, formatQty, formatRate } from '../lib/format';

export default function CloseView({
  storeId,
  storeName,
  session,
  onClosed,
}: {
  storeId: string;
  storeName: string;
  session: FxSession;
  onClosed: () => void;
}) {
  const [summary, setSummary] = useState<SessionSummaryRow[]>([]);
  const [accounts, setAccounts] = useState<AccountBalanceRow[]>([]);
  const [counts, setCounts] = useState<CashCountRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [wholesaleDeals, setWholesaleDeals] = useState<WholesaleDealRow[]>([]);
  const [margins, setMargins] = useState<CurrencyMarginRow[]>([]);
  const [closures, setClosures] = useState<ClosureRow[]>([]);
  const [margin, setMargin] = useState(0);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const loadIdRef = useRef(0);

  async function load() {
    const loadId = ++loadIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const [
        summaryRows,
        accountRows,
        countRows,
        expenseRows,
        wholesaleRows,
        marginRows,
        closureRows,
        marginValue,
      ] = await Promise.all([
        getSessionSummary(session.id),
        listAccountBalances(storeId),
        listCashCounts(session.id),
        listExpenses(session.id),
        listWholesaleDeals(storeId),
        listCurrencyMargins(session.id),
        listClosures(storeId),
        getSessionMargin(session.id),
      ]);
      if (loadId !== loadIdRef.current) return;
      setSummary(summaryRows);
      setAccounts(accountRows);
      setCounts(countRows);
      setExpenses(expenseRows);
      setWholesaleDeals(wholesaleRows);
      setMargins(marginRows);
      setClosures(closureRows);
      setMargin(marginValue);
    } catch (caught) {
      if (loadId !== loadIdRef.current) return;
      setError(errorMessage(caught));
    } finally {
      if (loadId === loadIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, storeId]);

  const totals = useMemo(() => {
    const cashClp = summary.find((row) => row.currency_code === 'CLP')?.expected_qty ?? 0;
    const inventoryClp = summary
      .filter((row) => row.currency_code !== 'CLP')
      .reduce((total, row) => total + row.current_fifo_value_clp, 0);
    const expensesClp = expenses.reduce(
      (total, row) => total + Number(row.amount_clp || 0),
      0,
    );
    return {
      cashClp,
      inventoryClp,
      capitalClp: cashClp + inventoryClp,
      margin,
      expensesClp,
      net: margin - expensesClp,
    };
  }, [summary, margin, expenses]);

  const countByCurrency = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of counts) {
      map.set(row.currency_code, (map.get(row.currency_code) ?? 0) + row.total);
    }
    return map;
  }, [counts]);

  const currentClosure = closures.find((row) => row.session_id === session.id) ?? null;
  const closeDeals = wholesaleDeals.filter(
    (deal) => deal.session_id === session.id || deal.status !== 'CERRADO',
  );

  const visibleSummary = summary.filter(
    (row) =>
      row.expected_qty !== 0 ||
      row.opening_qty !== 0 ||
      row.buy_qty !== 0 ||
      row.sell_qty !== 0 ||
      (countByCurrency.get(row.currency_code) ?? 0) !== 0,
  );

  const visibleMargins = margins.filter(
    (row) => row.sales_clp !== 0 || row.margin_clp !== 0,
  );

  async function handlePdf() {
    const { generateClosePdf } = await import('../lib/close-pdf');
    generateClosePdf({
      storeName,
      businessDate: session.business_date,
      summary: visibleSummary,
      margins: visibleMargins,
      expenses,
      accounts,
      wholesale: closeDeals,
      counts,
      totals: {
        cashClp: totals.cashClp,
        inventoryClp: totals.inventoryClp,
        capitalClp: totals.capitalClp,
        marginClp: totals.margin,
        expensesClp: totals.expensesClp,
        netResultClp: totals.net,
      },
    });
  }

  async function handleClose() {
    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      await closeSession(storeId, session.id, notes.trim());
      setSuccess('Día cerrado. El cierre quedó guardado con su snapshot.');
      await load();
      onClosed();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <Spinner label="Preparando cierre…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white">
            Cierre {formatDate(session.business_date)}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Reporte jerárquico de caja, inventario FIFO, cuentas y conteo físico.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handlePdf}>
            <FileDown className="h-4 w-4" /> PDF
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Imprimir
          </Button>
          <Button onClick={() => void handleClose()} disabled={working || session.status === 'CLOSED'}>
            <CheckCircle2 className="h-4 w-4" />
            {session.status === 'CLOSED' ? 'Día cerrado' : working ? 'Cerrando…' : 'Cerrar día'}
          </Button>
        </div>
      </div>

      {currentClosure && (
        <Card className="border-emerald-500/20 bg-emerald-500/[0.04]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-200">Cierre guardado</p>
              <p className="mt-1 text-xs text-emerald-300/70">
                {formatDate(currentClosure.business_date)} · resultado{' '}
                {formatClp(currentClosure.net_result_clp)}
              </p>
            </div>
            <Badge tone="green">CLOSED</Badge>
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Caja CLP</p>
          <p className="mt-1 text-xl font-bold text-white">{formatClp(totals.cashClp)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Inventario FIFO</p>
          <p className="mt-1 text-xl font-bold text-white">{formatClp(totals.inventoryClp)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Capital total</p>
          <p className="mt-1 text-xl font-bold text-indigo-300">{formatClp(totals.capitalClp)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            Resultado neto
          </p>
          <p
            className={`mt-1 text-xl font-bold ${
              totals.net >= 0 ? 'text-emerald-300' : 'text-rose-300'
            }`}
          >
            {formatClp(totals.net)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Margen {formatClp(totals.margin)} − gastos {formatClp(totals.expensesClp)}
          </p>
        </Card>
      </div>

      <Card>
        <SectionTitle title="1. Saldo inicial por divisa" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-semibold">Divisa</th>
                <th className="px-3 py-2 text-right font-semibold">Cantidad</th>
                <th className="px-3 py-2 text-right font-semibold">Valor CLP</th>
              </tr>
            </thead>
            <tbody>
              {visibleSummary.map((row) => (
                <tr key={row.currency_code} className="border-b border-white/[0.04]">
                  <td className="py-2 pr-3 font-semibold text-slate-200">{row.currency_code}</td>
                  <td className="px-3 py-2 text-right text-slate-300">
                    {formatQty(row.opening_qty)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300">
                    {formatClp(row.opening_clp)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <SectionTitle title="2. Movimientos del día" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-semibold">Divisa</th>
                <th className="px-3 py-2 text-right font-semibold">Compra</th>
                <th className="px-3 py-2 text-right font-semibold">CLP compra</th>
                <th className="px-3 py-2 text-right font-semibold">Venta</th>
                <th className="px-3 py-2 text-right font-semibold">CLP venta</th>
                <th className="px-3 py-2 text-right font-semibold">Esperado</th>
              </tr>
            </thead>
            <tbody>
              {visibleSummary.map((row) => (
                <tr key={row.currency_code} className="border-b border-white/[0.04]">
                  <td className="py-2 pr-3 font-semibold text-slate-200">{row.currency_code}</td>
                  <td className="px-3 py-2 text-right text-emerald-300">{formatQty(row.buy_qty)}</td>
                  <td className="px-3 py-2 text-right text-slate-400">{formatClp(row.buy_clp)}</td>
                  <td className="px-3 py-2 text-right text-rose-300">{formatQty(row.sell_qty)}</td>
                  <td className="px-3 py-2 text-right text-slate-400">{formatClp(row.sell_clp)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-white">
                    {formatQty(row.expected_qty)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <SectionTitle
          title="2.b Gastos del día"
          subtitle={`Total gastos: ${formatClp(totals.expensesClp)}`}
        />
        {expenses.length === 0 ? (
          <EmptyState title="Sin gastos registrados" />
        ) : (
          <div className="space-y-2">
            {expenses.map((expense) => (
              <div
                key={expense.id}
                className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2"
              >
                <div>
                  <p className="text-sm text-slate-200">{expense.concept}</p>
                  <p className="text-[11px] text-slate-500">{expense.category}</p>
                </div>
                <p className="text-sm font-semibold text-rose-300">
                  {formatClp(expense.amount_clp)}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle
          title="3. Rentabilidad por divisa (antes de gastos)"
          subtitle="Margen bruto de cada divisa. Los gastos se descuentan después para obtener el resultado final."
        />
        {visibleMargins.length === 0 ? (
          <EmptyState
            title="Sin ventas en la sesión"
            description="No hay margen realizado por divisa."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 font-semibold">Divisa</th>
                  <th className="px-3 py-2 text-right font-semibold">Ventas CLP</th>
                  <th className="px-3 py-2 text-right font-semibold">Costo FIFO</th>
                  <th className="px-3 py-2 text-right font-semibold">Margen</th>
                  <th className="px-3 py-2 text-right font-semibold">Margen %</th>
                </tr>
              </thead>
              <tbody>
                {visibleMargins.map((row) => (
                  <tr key={row.currency_code} className="border-b border-white/[0.04]">
                    <td className="py-2 pr-3 font-semibold text-slate-200">
                      {currencyFlag(row.currency_code)} {row.currency_code}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      {formatClp(row.sales_clp)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-400">
                      {formatClp(row.cost_clp)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold ${
                        row.margin_clp >= 0 ? 'text-emerald-300' : 'text-rose-300'
                      }`}
                    >
                      {formatClp(row.margin_clp)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      {Number(row.margin_pct || 0).toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/10">
                  <td className="py-2 pr-3 font-semibold text-white">Total margen bruto</td>
                  <td colSpan={2} />
                  <td className="px-3 py-2 text-right font-bold text-emerald-300">
                    {formatClp(totals.margin)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            Margen bruto antes de gastos
          </p>
          <p className="mt-1 text-xl font-bold text-emerald-300">{formatClp(totals.margin)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Gastos</p>
          <p className="mt-1 text-xl font-bold text-rose-300">{formatClp(totals.expensesClp)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            Resultado final
          </p>
          <p
            className={`mt-1 text-xl font-bold ${
              totals.net >= 0 ? 'text-emerald-300' : 'text-rose-300'
            }`}
          >
            {formatClp(totals.net)}
          </p>
        </Card>
      </div>

      <Card>
        <SectionTitle
          title="4. Cierres mayoristas"
          subtitle="Precio pactado con proveedores/clientes, entregas y pagos parciales."
        />
        {closeDeals.length === 0 ? (
          <EmptyState
            title="Sin cierres mayoristas"
            description="No hay cierres pactados registrados."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 font-semibold">Contraparte</th>
                  <th className="px-3 py-2 font-semibold">Tipo</th>
                  <th className="px-3 py-2 font-semibold">Divisa</th>
                  <th className="px-3 py-2 text-right font-semibold">Pactado</th>
                  <th className="px-3 py-2 text-right font-semibold">Entregado</th>
                  <th className="px-3 py-2 text-right font-semibold">Pagado</th>
                  <th className="px-3 py-2 text-right font-semibold">Pendiente</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {closeDeals.map((deal) => (
                  <tr key={deal.id} className="border-b border-white/[0.04]">
                    <td className="py-2 pr-3 text-slate-200">{deal.counterparty_name}</td>
                    <td className="px-3 py-2">
                      <Badge tone={deal.deal_type === 'COMPRA' ? 'green' : 'rose'}>
                        {deal.deal_type}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-200">
                      {deal.currency_code}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      {formatQty(deal.agreed_qty)} @ {formatRate(deal.agreed_rate)}
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-300">
                      {formatQty(deal.delivered_qty)}
                    </td>
                    <td className="px-3 py-2 text-right text-indigo-300">
                      {formatClp(deal.paid_clp)}
                    </td>
                    <td className="px-3 py-2 text-right text-amber-300">
                      {formatQty(deal.pending_qty)} / {formatClp(deal.pending_clp)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        tone={
                          deal.status === 'CERRADO'
                            ? 'green'
                            : deal.status === 'PARCIAL'
                              ? 'amber'
                              : 'indigo'
                        }
                      >
                        {deal.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle title="5. Deudores y acreedores" />
        {accounts.length === 0 ? (
          <EmptyState title="Sin saldos de cuentas corrientes" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 font-semibold">Contraparte</th>
                  <th className="px-3 py-2 font-semibold">Divisa</th>
                  <th className="px-3 py-2 text-right font-semibold">Nos deben</th>
                  <th className="px-3 py-2 text-right font-semibold">Les debemos</th>
                  <th className="px-3 py-2 text-right font-semibold">Neto</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((row) => (
                  <tr
                    key={`${row.counterparty_id}-${row.currency_code}`}
                    className="border-b border-white/[0.04]"
                  >
                    <td className="py-2 pr-3 text-slate-200">{row.counterparty_name}</td>
                    <td className="px-3 py-2 text-slate-400">{row.currency_code}</td>
                    <td className="px-3 py-2 text-right text-emerald-300">
                      {formatQty(row.receivable)}
                    </td>
                    <td className="px-3 py-2 text-right text-rose-300">
                      {formatQty(row.payable)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-white">
                      {formatQty(row.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle title="6. Conteo físico y diferencias" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-semibold">Divisa</th>
                <th className="px-3 py-2 text-right font-semibold">Contado</th>
                <th className="px-3 py-2 text-right font-semibold">Esperado</th>
                <th className="px-3 py-2 text-right font-semibold">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {visibleSummary.map((row) => {
                const counted = countByCurrency.get(row.currency_code) ?? 0;
                const difference = counted - row.expected_qty;
                return (
                  <tr key={row.currency_code} className="border-b border-white/[0.04]">
                    <td className="py-2 pr-3 font-semibold text-slate-200">{row.currency_code}</td>
                    <td className="px-3 py-2 text-right text-slate-300">{formatQty(counted)}</td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      {formatQty(row.expected_qty)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold ${
                        Math.abs(difference) < 0.000001 ? 'text-emerald-300' : 'text-amber-300'
                      }`}
                    >
                      {formatQty(difference)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <SectionTitle
          title="7. Observaciones del cierre"
          subtitle="La diferencia de cuadratura no bloquea el cierre, pero queda registrada."
        />
        <Input
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Comentario de cierre, diferencias, responsables…"
        />
        <div className="mt-4 flex justify-end">
          <Button
            onClick={() => void handleClose()}
            disabled={working || session.status === 'CLOSED'}
          >
            <CheckCircle2 className="h-4 w-4" />
            {session.status === 'CLOSED' ? 'Día cerrado' : 'Guardar cierre'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
