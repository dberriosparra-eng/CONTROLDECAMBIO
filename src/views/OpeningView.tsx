import { useEffect, useMemo, useState } from 'react';
import { Copy, Save } from 'lucide-react';
import {
  Button,
  Card,
  ErrorBanner,
  Input,
  SectionTitle,
  Spinner,
  SuccessBanner,
} from '../components/ui';
import {
  getPreviousSummary,
  getSessionSummary,
  listCurrencies,
  listOpening,
  saveOpening,
  type Currency,
  type FxSession,
  type SessionSummaryRow,
} from '../lib/db';
import { currencyFlag } from '../lib/currencies';
import { errorMessage, formatClp, formatQty, formatRate } from '../lib/format';

type DraftRow = {
  quantity: number;
  unit_cost_clp: number;
};

export default function OpeningView({
  storeId,
  session,
  businessDate,
  onSaved,
}: {
  storeId: string;
  session: FxSession;
  businessDate: string;
  onSaved: () => void;
}) {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [rows, setRows] = useState<Record<string, DraftRow>>({});
  const [previous, setPrevious] = useState<SessionSummaryRow[]>([]);
  const [hasOperations, setHasOperations] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      listCurrencies(),
      listOpening(session.id),
      getSessionSummary(session.id),
      getPreviousSummary(storeId, businessDate),
    ])
      .then(([currencyRows, openingRows, summaryRows, previousRows]) => {
        if (cancelled) return;
        setCurrencies(currencyRows);
        setPrevious(previousRows);

        const openingMap = new Map(
          openingRows.map((row) => [
            row.currency_code,
            { quantity: row.quantity, unit_cost_clp: row.unit_cost_clp },
          ]),
        );
        const summaryMap = new Map(summaryRows.map((row) => [row.currency_code, row]));
        const previousMap = new Map(previousRows.map((row) => [row.currency_code, row]));

        const draft: Record<string, DraftRow> = {};
        for (const currency of currencyRows) {
          const opening = openingMap.get(currency.code);
          const summary = summaryMap.get(currency.code);
          const prev = previousMap.get(currency.code);
          const quantity = opening?.quantity ?? prev?.expected_qty ?? 0;
          const unitCost =
            opening?.unit_cost_clp ??
            (currency.code === 'CLP'
              ? 1
              : prev && prev.expected_qty > 0
                ? prev.current_fifo_value_clp / prev.expected_qty
                : 0);
          draft[currency.code] = {
            quantity,
            unit_cost_clp: currency.code === 'CLP' ? 1 : unitCost,
          };
          void summary;
        }
        setRows(draft);
        setHasOperations(
          summaryRows.some((row) => row.buy_qty !== 0 || row.sell_qty !== 0),
        );
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
  }, [session.id, storeId, businessDate]);

  const totals = useMemo(() => {
    let clp = 0;
    let foreign = 0;
    for (const currency of currencies) {
      const row = rows[currency.code];
      if (!row) continue;
      const value = row.quantity * row.unit_cost_clp;
      if (currency.code === 'CLP') clp += value;
      else foreign += value;
    }
    return { clp, foreign, total: clp + foreign };
  }, [currencies, rows]);

  function updateRow(code: string, patch: Partial<DraftRow>) {
    setRows((current) => ({
      ...current,
      [code]: {
        quantity: current[code]?.quantity ?? 0,
        unit_cost_clp: current[code]?.unit_cost_clp ?? 0,
        ...patch,
      },
    }));
  }

  function prefillPrevious() {
    if (previous.length === 0) return;
    const next: Record<string, DraftRow> = { ...rows };
    for (const row of previous) {
      next[row.currency_code] = {
        quantity: row.expected_qty,
        unit_cost_clp:
          row.currency_code === 'CLP'
            ? 1
            : row.expected_qty > 0
              ? row.current_fifo_value_clp / row.expected_qty
              : 0,
      };
    }
    setRows(next);
    setSuccess('Saldos prellenados desde el cierre anterior. Revisa y guarda.');
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await saveOpening(
        storeId,
        session.id,
        currencies.map((currency) => {
          const row = rows[currency.code] ?? { quantity: 0, unit_cost_clp: 0 };
          return {
            currency_code: currency.code,
            quantity: Number(row.quantity) || 0,
            unit_cost_clp:
              currency.code === 'CLP' ? 1 : Number(row.unit_cost_clp) || 0,
            clp_value:
              (Number(row.quantity) || 0) *
              (currency.code === 'CLP' ? 1 : Number(row.unit_cost_clp) || 0),
          };
        }),
      );
      setSuccess('Apertura guardada. Las capas FIFO quedaron actualizadas.');
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label="Cargando apertura…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <Card>
        <SectionTitle
          title="Saldos iniciales por divisa"
          subtitle="La cantidad y el costo unitario definen las capas FIFO de la jornada. El CLP siempre usa costo 1."
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={prefillPrevious}
                disabled={previous.length === 0 || hasOperations}
              >
                <Copy className="h-4 w-4" /> Usar cierre anterior
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving || hasOperations}>
                <Save className="h-4 w-4" /> {saving ? 'Guardando…' : 'Guardar apertura'}
              </Button>
            </div>
          }
        />

        {hasOperations && (
          <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            La sesión ya tiene operaciones. Para cambiar la apertura primero debes
            reversar o eliminar esas operaciones.
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-semibold">Divisa</th>
                <th className="px-3 py-2 text-right font-semibold">Cantidad</th>
                <th className="px-3 py-2 text-right font-semibold">Costo promedio</th>
                <th className="px-3 py-2 text-right font-semibold">Valor CLP</th>
                <th className="px-3 py-2 text-right font-semibold">Cierre anterior</th>
              </tr>
            </thead>
            <tbody>
              {currencies.map((currency) => {
                const row = rows[currency.code] ?? { quantity: 0, unit_cost_clp: 0 };
                const previousRow = previous.find(
                  (item) => item.currency_code === currency.code,
                );
                return (
                  <tr key={currency.code} className="border-b border-white/[0.04]">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base leading-none">{currencyFlag(currency.code)}</span>
                        <span className="font-semibold text-slate-100">{currency.code}</span>
                        <span className="text-xs text-slate-500">{currency.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Input
                        type="number"
                        min="0"
                        step="0.000001"
                        value={row.quantity}
                        onChange={(event) =>
                          updateRow(currency.code, {
                            quantity: Number(event.target.value),
                          })
                        }
                        disabled={hasOperations}
                        className="text-right"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-400">
                      {formatRate(currency.code === 'CLP' ? 1 : row.unit_cost_clp)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-white">
                      {formatClp(row.quantity * (currency.code === 'CLP' ? 1 : row.unit_cost_clp))}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-400">
                      {previousRow
                        ? `${formatQty(previousRow.expected_qty)} · ${formatRate(
                            previousRow.expected_qty > 0
                              ? previousRow.current_fifo_value_clp / previousRow.expected_qty
                              : 0,
                          )}`
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Caja CLP
          </p>
          <p className="mt-2 text-xl font-bold text-white">{formatClp(totals.clp)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Inventario divisas
          </p>
          <p className="mt-2 text-xl font-bold text-white">{formatClp(totals.foreign)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Capital inicial
          </p>
          <p className="mt-2 text-xl font-bold text-indigo-300">{formatClp(totals.total)}</p>
        </Card>
      </div>
    </div>
  );
}
