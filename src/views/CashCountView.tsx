import { useEffect, useMemo, useState } from 'react';
import { Calculator, Plus, Save } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Input,
  SectionTitle,
  Select,
  Spinner,
  SuccessBanner,
} from '../components/ui';
import {
  ensureCurrency,
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
import { WORLD_CURRENCIES, currencyFlag } from '../lib/currencies';
import { errorMessage, formatClp, formatQty } from '../lib/format';

type ManualRow = { value: number; quantity: number };

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
  const [manualRows, setManualRows] = useState<Record<string, ManualRow>>({});
  const [selected, setSelected] = useState('CLP');
  const [addCode, setAddCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [currencyRows, denominationRows, summaryRows, countRows] = await Promise.all([
        listCurrencies(),
        listDenominations(),
        getSessionSummary(session.id),
        listCashCounts(session.id),
      ]);
      setCurrencies(currencyRows);
      setDenominations(denominationRows);
      setSummary(summaryRows);

      const next: Record<string, number> = {};
      for (const row of countRows) {
        next[`${row.currency_code}|${row.denomination_value}`] = row.quantity;
      }
      setQuantities(next);

      const stockCodes = summaryRows
        .filter((row) => row.expected_qty > 0)
        .map((row) => row.currency_code);
      if (stockCodes.length > 0 && !stockCodes.includes(selected)) {
        setSelected(stockCodes.includes('CLP') ? 'CLP' : stockCodes[0]);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const stockCodes = useMemo(
    () =>
      new Set(
        summary
          .filter((row) => row.expected_qty > 0)
          .map((row) => row.currency_code),
      ),
    [summary],
  );

  const visibleCurrencies = useMemo(
    () => currencies.filter((currency) => stockCodes.has(currency.code) || currency.code === selected),
    [currencies, stockCodes, selected],
  );

  const currentCurrency = currencies.find((currency) => currency.code === selected);
  const currentSummary = summary.find((row) => row.currency_code === selected);
  const currentDenominations = denominations.filter(
    (row) =>
      row.currency_code === selected && (selected === 'CLP' ? true : row.kind === 'BILLETE'),
  );
  const bills = currentDenominations.filter((row) => row.kind === 'BILLETE');
  const coins = currentDenominations.filter((row) => row.kind === 'MONEDA');
  const manual = manualRows[selected] ?? { value: 0, quantity: 0 };

  const counted = useMemo(() => {
    const fromDenominations = currentDenominations.reduce(
      (total, denomination) =>
        total + denomination.value * (quantities[`${selected}|${denomination.value}`] ?? 0),
      0,
    );
    return fromDenominations + (manual.value || 0) * (manual.quantity || 0);
  }, [currentDenominations, quantities, selected, manual]);

  const expected = currentSummary?.expected_qty ?? 0;
  const difference = counted - expected;

  function updateManual(patch: Partial<ManualRow>) {
    setManualRows((current) => ({
      ...current,
      [selected]: {
        value: current[selected]?.value ?? 0,
        quantity: current[selected]?.quantity ?? 0,
        ...patch,
      },
    }));
  }

  async function handleAddCurrency() {
    const world = WORLD_CURRENCIES.find((item) => item.code === addCode);
    if (!world) return;
    setAdding(true);
    setError(null);
    setSuccess(null);
    try {
      await ensureCurrency({
        code: world.code,
        name: world.name,
        symbol: world.symbol,
        decimals: world.decimals,
      });
      await load();
      setSelected(world.code);
      setAddCode('');
      setSuccess(`${world.flag} ${world.name} agregada. Ya puedes contar sus billetes.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setAdding(false);
    }
  }

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

      for (const [currencyCode, row] of Object.entries(manualRows)) {
        if (!row.value || !row.quantity) continue;
        const exists = denominations.some(
          (denomination) =>
            denomination.currency_code === currencyCode &&
            denomination.value === row.value,
        );
        if (!exists) {
          rows.push({
            currency_code: currencyCode,
            denomination_value: row.value,
            quantity: row.quantity,
          });
        }
      }

      await saveCashCounts(storeId, session.id, rows);
      setSuccess('Conteo físico guardado.');
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  function renderDenominationTable(
    title: string,
    rows: Denomination[],
    emptyText: string,
  ) {
    return (
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {title}
        </p>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-3 text-sm text-slate-500">
            {emptyText}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 font-semibold">Denominación</th>
                  <th className="px-3 py-2 text-right font-semibold">Cantidad</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((denomination) => {
                  const key = `${selected}|${denomination.value}`;
                  const quantity = quantities[key] ?? 0;
                  return (
                    <tr key={denomination.id} className="border-b border-white/[0.04]">
                      <td className="py-2 pr-3 text-slate-200">
                        {selected} {formatQty(denomination.value)}
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
        )}
      </div>
    );
  }

  if (loading) return <Spinner label="Cargando denominaciones y conteo…" />;

  const availableToAdd = WORLD_CURRENCIES.filter(
    (world) => !currencies.some((currency) => currency.code === world.code),
  );

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <Card>
        <SectionTitle
          title="Conteo físico por denominación"
          subtitle="Solo se muestran divisas con stock. Los billetes se cuentan por separado de las monedas CLP."
          action={
            <Button onClick={() => void handleSave()} disabled={saving}>
              <Save className="h-4 w-4" /> {saving ? 'Guardando…' : 'Guardar conteo'}
            </Button>
          }
        />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {visibleCurrencies.map((currency) => (
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
              <span className="mr-1">{currencyFlag(currency.code)}</span>
              {currency.code}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2">
            <Select
              value={addCode}
              onChange={(event) => setAddCode(event.target.value)}
              className="w-48"
            >
              <option value="">Agregar divisa…</option>
              {availableToAdd.map((world) => (
                <option key={world.code} value={world.code}>
                  {world.flag} {world.code} · {world.name}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              onClick={() => void handleAddCurrency()}
              disabled={!addCode || adding}
            >
              <Plus className="h-4 w-4" /> {adding ? 'Agregando…' : 'Agregar'}
            </Button>
          </div>
        </div>

        {visibleCurrencies.length === 0 && (
          <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            No hay divisas con stock en esta sesión. Agrega una divisa para comenzar a
            contar o registra una apertura.
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-2xl font-bold text-white">
              <span className="mr-2">{currencyFlag(selected)}</span>
              {selected}
            </p>
            <p className="text-sm text-slate-400">
              {currentCurrency?.name ?? 'Divisa'} · esperado{' '}
              {selected === 'CLP' ? formatClp(expected) : `${formatQty(expected)} ${selected}`}
            </p>
          </div>
          <Badge tone={Math.abs(difference) < 0.000001 ? 'green' : 'amber'}>
            {Math.abs(difference) < 0.000001 ? 'Cuadrado' : 'Revisar diferencia'}
          </Badge>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
          <div className="space-y-5">
            {renderDenominationTable(
              'Billetes',
              bills,
              'No hay denominaciones de billetes configuradas para esta divisa.',
            )}

            {selected === 'CLP' &&
              renderDenominationTable(
                'Monedas (solo CLP)',
                coins,
                'No hay monedas CLP configuradas.',
              )}

            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Otra denominación
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={manual.value || ''}
                  onChange={(event) =>
                    updateManual({ value: Number(event.target.value) || 0 })
                  }
                  placeholder={`Valor en ${selected}`}
                />
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={manual.quantity || ''}
                  onChange={(event) =>
                    updateManual({ quantity: Number(event.target.value) || 0 })
                  }
                  placeholder="Cantidad"
                />
              </div>
            </div>
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
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Diferencia
              </p>
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
