import { useEffect, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  Badge,
  Card,
  ErrorBanner,
  SectionTitle,
  Select,
  Spinner,
} from '../components/ui';
import PeriodFilter, { periodRange } from '../components/PeriodFilter';
import {
  listClosures,
  listDailyStats,
  type ClosureRow,
  type DailyStatRow,
} from '../lib/db';
import { currencyFlag, currencyName } from '../lib/currencies';
import { errorMessage, formatClp, formatDate, formatQty, formatRate } from '../lib/format';

export default function HistoryView({ storeId }: { storeId: string }) {
  const initial = periodRange('MES');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [closures, setClosures] = useState<ClosureRow[]>([]);
  const [stats, setStats] = useState<DailyStatRow[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([listClosures(storeId), listDailyStats(storeId, from, to)])
      .then(([closureRows, statRows]) => {
        if (cancelled) return;
        setClosures(closureRows);
        setStats(statRows);
        const currencies = [...new Set(statRows.map((row) => row.currency_code))];
        if (currencies.length > 0 && !currencies.includes(currency)) {
          setCurrency(currencies.includes('USD') ? 'USD' : currencies[0]);
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
  }, [storeId, from, to]);

  const currencies = useMemo(
    () => [...new Set(stats.map((row) => row.currency_code))].sort(),
    [stats],
  );

  const days = useMemo(() => {
    const start = new Date(`${from}T12:00:00`).getTime();
    const end = new Date(`${to}T12:00:00`).getTime();
    return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
  }, [from, to]);

  const useDaily = days <= 31;

  const periods = useMemo(() => {
    const map = new Map<
      string,
      {
        period: string;
        buyQty: number;
        buyClp: number;
        sellQty: number;
        sellClp: number;
      }
    >();

    for (const row of stats) {
      if (row.currency_code !== currency) continue;
      const period = useDaily ? row.business_date : row.business_date.slice(0, 7);
      const current = map.get(period) ?? {
        period,
        buyQty: 0,
        buyClp: 0,
        sellQty: 0,
        sellClp: 0,
      };
      current.buyQty += Number(row.buy_qty) || 0;
      current.buyClp += Number(row.buy_clp) || 0;
      current.sellQty += Number(row.sell_qty) || 0;
      current.sellClp += Number(row.sell_clp) || 0;
      map.set(period, current);
    }

    return [...map.values()]
      .map((row) => ({
        ...row,
        avgBuy: row.buyQty > 0 ? row.buyClp / row.buyQty : 0,
        avgSell: row.sellQty > 0 ? row.sellClp / row.sellQty : 0,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }, [stats, currency, useDaily]);

  const maxRate = Math.max(
    1,
    ...periods.flatMap((row) => [row.avgBuy, row.avgSell]),
  );

  if (loading) return <Spinner label="Cargando histórico…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />

      <Card>
        <SectionTitle
          title={useDaily ? 'Promedios diarios' : 'Promedios mensuales'}
          subtitle="Promedio ponderado por volumen: CLP total ÷ cantidad total. No es promedio de promedios."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <PeriodFilter
                from={from}
                to={to}
                onChange={(nextFrom, nextTo) => {
                  setFrom(nextFrom);
                  setTo(nextTo);
                }}
              />
              <Select
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
                className="w-32"
              >
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {currencyFlag(code)} {code} · {currencyName(code)}
                  </option>
                ))}
              </Select>
            </div>
          }
        />

        {periods.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No hay estadísticas para la divisa seleccionada.
          </p>
        ) : (
          <div className="space-y-5">
            <div className="space-y-4">
              {periods.map((row) => (
                <div key={row.period}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">{row.period}</span>
                    <span className="text-slate-500">
                      Compra {formatRate(row.avgBuy)} · Venta {formatRate(row.avgSell)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="h-2 overflow-hidden rounded-full bg-white/[0.04]">
                      <div
                        className="h-full rounded-full bg-emerald-400/80"
                        style={{ width: `${Math.max(2, (row.avgBuy / maxRate) * 100)}%` }}
                      />
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/[0.04]">
                      <div
                        className="h-full rounded-full bg-rose-400/80"
                        style={{ width: `${Math.max(2, (row.avgSell / maxRate) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3 font-semibold">Mes</th>
                    <th className="px-3 py-2 text-right font-semibold">Compra cantidad</th>
                    <th className="px-3 py-2 text-right font-semibold">Compra CLP</th>
                    <th className="px-3 py-2 text-right font-semibold">Prom. compra</th>
                    <th className="px-3 py-2 text-right font-semibold">Venta cantidad</th>
                    <th className="px-3 py-2 text-right font-semibold">Venta CLP</th>
                    <th className="px-3 py-2 text-right font-semibold">Prom. venta</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((row) => (
                    <tr key={row.period} className="border-b border-white/[0.04]">
                      <td className="py-2 pr-3 font-semibold text-slate-200">{row.period}</td>
                      <td className="px-3 py-2 text-right text-slate-300">
                        {formatQty(row.buyQty)}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-400">
                        {formatClp(row.buyClp)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-300">
                        {formatRate(row.avgBuy)}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-300">
                        {formatQty(row.sellQty)}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-400">
                        {formatClp(row.sellClp)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-rose-300">
                        {formatRate(row.avgSell)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle
          title="Cierres guardados"
          subtitle="Historial de capital, margen y resultado por jornada."
          action={<BarChart3 className="h-5 w-5 text-slate-500" />}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-semibold">Fecha</th>
                <th className="px-3 py-2 font-semibold">Estado</th>
                <th className="px-3 py-2 text-right font-semibold">Caja CLP</th>
                <th className="px-3 py-2 text-right font-semibold">Inventario</th>
                <th className="px-3 py-2 text-right font-semibold">Capital</th>
                <th className="px-3 py-2 text-right font-semibold">Margen</th>
                <th className="px-3 py-2 text-right font-semibold">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {closures.map((row) => (
                <tr key={row.id} className="border-b border-white/[0.04]">
                  <td className="py-2 pr-3 text-slate-200">{formatDate(row.business_date)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={row.status === 'CLOSED' ? 'green' : 'slate'}>
                      {row.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300">
                    {formatClp(row.total_cash_clp)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300">
                    {formatClp(row.total_inventory_clp)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-white">
                    {formatClp(row.total_capital_clp)}
                  </td>
                  <td className="px-3 py-2 text-right text-emerald-300">
                    {formatClp(row.realized_margin_clp)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-indigo-300">
                    {formatClp(row.net_result_clp)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
