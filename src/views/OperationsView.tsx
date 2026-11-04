import { useEffect, useMemo, useState } from 'react';
import { Download, Search, ShieldAlert } from 'lucide-react';
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
  addStFolio,
  listOperations,
  type FxSession,
  type OperationRow,
} from '../lib/db';
import { errorMessage, formatClp, formatDate, formatQty, formatRate } from '../lib/format';

export default function OperationsView({
  storeId,
  session,
  onChanged,
}: {
  storeId: string;
  session: FxSession;
  onChanged: () => void;
}) {
  const [operations, setOperations] = useState<OperationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [operationFilter, setOperationFilter] = useState('ALL');
  const [currencyFilter, setCurrencyFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setOperations(await listOperations(session.id));
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

  const currencies = useMemo(
    () => [...new Set(operations.map((row) => row.currency_code))].sort(),
    [operations],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return operations.filter((row) => {
      if (operationFilter !== 'ALL' && row.operation !== operationFilter) return false;
      if (currencyFilter !== 'ALL' && row.currency_code !== currencyFilter) return false;
      if (statusFilter !== 'ALL' && row.document?.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        (row.document?.folio ?? '').toLowerCase().includes(needle) ||
        (row.document?.cashier ?? '').toLowerCase().includes(needle) ||
        row.currency_code.toLowerCase().includes(needle)
      );
    });
  }, [operations, search, operationFilter, currencyFilter, statusFilter]);

  const totals = useMemo(
    () => ({
      buy: filtered
        .filter((row) => row.operation === 'COMPRA' && row.document?.status === 'VALID')
        .reduce((total, row) => total + row.clp_amount, 0),
      sell: filtered
        .filter((row) => row.operation === 'VENTA' && row.document?.status === 'VALID')
        .reduce((total, row) => total + row.clp_amount, 0),
    }),
    [filtered],
  );

  async function markSt(row: OperationRow) {
    if (!row.document?.folio || row.document.folio === '0') {
      setError('No se puede marcar ST un documento sin folio.');
      return;
    }
    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      await addStFolio(
        storeId,
        row.document.document_type,
        row.document.folio,
        'ST registrado desde operaciones',
      );
      setSuccess(`Folio ${row.document.folio} marcado como ST y excluido de los cálculos.`);
      await load();
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  function exportCsv() {
    const header = [
      'fecha',
      'folio',
      'tipo',
      'operacion',
      'divisa',
      'instrumento',
      'cantidad',
      'tipo_cambio',
      'clp',
      'estado',
      'cajero',
    ];
    const lines = filtered.map((row) =>
      [
        row.business_date,
        row.document?.folio ?? '',
        row.document?.document_type ?? '',
        row.operation,
        row.currency_code,
        row.instrument,
        row.foreign_amount,
        row.fx_rate,
        row.clp_amount,
        row.document?.status ?? '',
        row.document?.cashier ?? '',
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `operaciones-${session.business_date}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <Spinner label="Cargando operaciones…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <Card>
        <SectionTitle
          title="Operaciones del día"
          subtitle="Las boletas ST se muestran para auditoría, pero no suman en los totales."
          action={
            <Button variant="secondary" onClick={exportCsv}>
              <Download className="h-4 w-4" /> Exportar CSV
            </Button>
          }
        />

        <div className="mb-4 grid gap-2 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar folio, cajero o divisa"
              className="pl-9"
            />
          </div>
          <Select
            value={operationFilter}
            onChange={(event) => setOperationFilter(event.target.value)}
          >
            <option value="ALL">Todas las operaciones</option>
            <option value="COMPRA">Compras</option>
            <option value="VENTA">Ventas</option>
          </Select>
          <Select
            value={currencyFilter}
            onChange={(event) => setCurrencyFilter(event.target.value)}
          >
            <option value="ALL">Todas las divisas</option>
            {currencies.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </Select>
          <Select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="ALL">Todos los estados</option>
            <option value="VALID">Válidas</option>
            <option value="VOID_ST">ST</option>
            <option value="VOID_NC">Anuladas NC</option>
          </Select>
        </div>

        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl bg-white/[0.03] px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">Compras</p>
            <p className="font-semibold text-emerald-300">{formatClp(totals.buy)}</p>
          </div>
          <div className="rounded-xl bg-white/[0.03] px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">Ventas</p>
            <p className="font-semibold text-rose-300">{formatClp(totals.sell)}</p>
          </div>
          <div className="rounded-xl bg-white/[0.03] px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">Líneas</p>
            <p className="font-semibold text-white">{filtered.length}</p>
          </div>
        </div>

        <div className="max-h-[600px] overflow-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="sticky top-0 bg-slate-900">
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-semibold">Fecha</th>
                <th className="px-3 py-2 font-semibold">Folio</th>
                <th className="px-3 py-2 font-semibold">Operación</th>
                <th className="px-3 py-2 font-semibold">Divisa</th>
                <th className="px-3 py-2 text-right font-semibold">Cantidad</th>
                <th className="px-3 py-2 text-right font-semibold">TC</th>
                <th className="px-3 py-2 text-right font-semibold">CLP</th>
                <th className="px-3 py-2 font-semibold">Estado</th>
                <th className="px-3 py-2 text-right font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className="border-b border-white/[0.04]">
                  <td className="py-2 pr-3 text-slate-400">{formatDate(row.business_date)}</td>
                  <td className="px-3 py-2 font-semibold text-slate-200">
                    {row.document?.folio || 'Sin folio'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={row.operation === 'COMPRA' ? 'green' : 'rose'}>
                      {row.operation}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-slate-200">{row.currency_code}</span>
                    <span className="ml-1 text-xs text-slate-500">{row.instrument}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300">
                    {formatQty(row.foreign_amount)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-400">
                    {formatRate(row.fx_rate)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-white">
                    {formatClp(row.clp_amount)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      tone={
                        row.document?.status === 'VALID'
                          ? 'green'
                          : row.document?.status === 'VOID_ST'
                            ? 'amber'
                            : 'slate'
                      }
                    >
                      {row.document?.status === 'VALID'
                        ? 'Válida'
                        : row.document?.status === 'VOID_ST'
                          ? 'ST'
                          : row.document?.status ?? '—'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.document?.status === 'VALID' && row.document.folio !== '0' && (
                      <Button
                        variant="ghost"
                        onClick={() => void markSt(row)}
                        disabled={working}
                        title="Marcar como ST"
                      >
                        <ShieldAlert className="h-4 w-4" /> ST
                      </Button>
                    )}
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
