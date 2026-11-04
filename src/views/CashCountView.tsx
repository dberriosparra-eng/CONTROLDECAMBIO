import { useEffect, useMemo, useState } from 'react';
import { Calculator, Save } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Input,
  SectionTitle,
  Spinner,
  SuccessBanner,
} from '../components/ui';
import {
  getSessionSummary,
  listCashCounts,
  listCurrencies,
  listDenominations,
  saveCashCounts,
  type Currency,
  type Denomination,
  type FxSession,
  type SessionSummaryRow,
} from '../lib/db';
import { errorMessage, formatClp, formatQty } from '../lib/format';

export default function CashCountView({
  storeId,
  session,
  onSaved,
}: {
  storeId: string;
  session: FxSession;
  onSaved: () => void;
}) {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [denominations, setDenominations] = useState<Denomination[]>([]);
  const [summary, setSummary] = useState<SessionSummaryRow[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState('CLP');
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
      listDenominations(),
      getSessionSummary(session.id),
      listCashCounts(session.id),
    ])
      .then(([currencyRows, denominationRows, summaryRows, countRows]) => {
        if (cancelled) return;
        setCurrencies(currencyRows);
        setDenominations(denominationRows);
        setSummary(summaryRows);

        const next: Record<string, number> = {};
        for (const row of countRows) {
          next[`${row.currency_code}|${row.denomination_value}`] = row.quantity;
        }
        setQuantities(next);
        if (currencyRows.length > 0 && !currencyRows.some((row) => row.code === selected)) {
          setSelected(currencyRows[0].code);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const currentSummary = summary.find((row) => row.currency_code === selected);
  const currentDenominations = denominations.filter(
    (row) => row.currency_code === selected,
  );

  const counted = useMemo(
    () =>
      currentDenominations.reduce(
        (total, denomination) =>
          total + denomination.value * (quantities[`${selected}|${denomination.value}`] ?? 0),
        0,
      ),
    [currentDenominations, quantities, selected],
  );

  const expected = currentSummary?.expected_qty ?? 0;
  const difference = counted - expected;

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const rows = Object.entries(quantities)
        .map(([key, quantity]) => {
          const [currencyCode, value] = key.split('|');
          return {
            currency_code: currencyCode,
            denomination_value: Number(value),
            quantity: Number(quantity) || 0,
          };
        })
        .filter((row) => row.quantity > 0);

      await saveCashCounts(storeId, session.id, rows);
      setSuccess('Conteo físico guardado.');
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label="Cargando denominaciones y conteo…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <Card>
        <SectionTitle
          title="Conteo físico por denominación"
          subtitle="Ingresa la cantidad de billetes/monedas. El total se compara contra el saldo esperado de la sesión."
          action={
            <Button onClick={() => void handleSave()} disabled={saving}>
              <Save className="h-4 w-4" /> {saving ? 'Guardando…' : 'Guardar conteo'}
            </Button>
          }
        />

        <div className="mb-4 flex flex-wrap gap-2">
          {currencies.map((currency) => (
            <button
              key={currency.code}
              type="button"
              onClick={() => setSelected(currency.code)}
              className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${
                selected === currency.code
                  ? 'bg-indigo-500/15 text-indigo-200 ring-1 ring-inset ring-indigo-400/20'
                  : 'bg-white/[0.03] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
              }`}
            >
              {currency.code}
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 font-semibold">Denominación</th>
                  <th className="px-3 py-2 text-right font-semibold">Cantidad</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {currentDenominations.map((denomination) => {
                  const key = `${selected}|${denomination.value}`;
                  const quantity = quantities[key] ?? 0;
                  return (
                    <tr key={denomination.id} className="border-b border-white/[0.04]">
                      <td className="py-2 pr-3 text-slate-200">
                        {selected} {formatQty(denomination.value)}
                        <span className="ml-2 text-xs text-slate-500">
                          {denomination.kind.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={quantity || ''}
                          onChange={(event) =>
                            setQuantities((current) => ({
                              ...current,
                              [key]: Number(event.target.value) || 0,
                            }))
                          }
                          className="text-right"
                          placeholder="0"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-white">
                        {formatClp(denomination.value * quantity)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Contado
              </p>
              <p className="mt-1 text-2xl font-bold text-white">
                {selected === 'CLP' ? formatClp(counted) : `${formatQty(counted)} ${selected}`}
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Esperado
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-200">
                {selected === 'CLP' ? formatClp(expected) : `${formatQty(expected)} ${selected}`}
              </p>
            </div>
            <div
              className={`rounded-2xl border p-4 ${
                Math.abs(difference) < 0.000001
                  ? 'border-emerald-500/20 bg-emerald-500/10'
                  : 'border-amber-500/20 bg-amber-500/10'
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Diferencia
                </p>
                <Badge tone={Math.abs(difference) < 0.000001 ? 'green' : 'amber'}>
                  {Math.abs(difference) < 0.000001 ? 'Cuadrado' : 'Revisar'}
                </Badge>
              </div>
              <p
                className={`mt-1 text-2xl font-bold ${
                  Math.abs(difference) < 0.000001 ? 'text-emerald-300' : 'text-amber-300'
                }`}
              >
                {selected === 'CLP'
                  ? formatClp(difference)
                  : `${formatQty(difference)} ${selected}`}
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-slate-400">
              <p className="flex items-center gap-1.5 font-semibold text-slate-300">
                <Calculator className="h-3.5 w-3.5" /> Cómo se calcula
              </p>
              <p className="mt-1 leading-relaxed">
                Esperado = apertura + compras − ventas ± préstamos/cobros/pagos ± ajustes.
                El conteo se guarda por denominación.
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
