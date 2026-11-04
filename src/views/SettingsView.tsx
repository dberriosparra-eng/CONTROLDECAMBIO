import { useEffect, useState } from 'react';
import { Database, KeyRound, RotateCcw, Settings2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  SectionTitle,
  Spinner,
  SuccessBanner,
} from '../components/ui';
import {
  listCurrencies,
  listDenominations,
  listImportBatches,
  listStFolios,
  reverseStFolio,
  type Currency,
  type Denomination,
  type ImportBatch,
  type StFolio,
} from '../lib/db';
import { errorMessage, formatDate } from '../lib/format';

export default function SettingsView({ storeId }: { storeId: string }) {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [denominations, setDenominations] = useState<Denomination[]>([]);
  const [stFolios, setStFolios] = useState<StFolio[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [currencyRows, denominationRows, stRows, batchRows] = await Promise.all([
        listCurrencies(),
        listDenominations(),
        listStFolios(storeId),
        listImportBatches(storeId),
      ]);
      setCurrencies(currencyRows);
      setDenominations(denominationRows);
      setStFolios(stRows);
      setBatches(batchRows);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  async function handleReverse(id: string) {
    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      await reverseStFolio(storeId, id);
      setSuccess('ST reversado.');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <Spinner label="Cargando configuración…" />;

  const activeSt = stFolios.filter((item) => item.status === 'ACTIVE');

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <Database className="h-3.5 w-3.5" /> Monedas
          </p>
          <p className="mt-1 text-2xl font-bold text-white">{currencies.length}</p>
        </Card>
        <Card className="p-4">
          <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <Settings2 className="h-3.5 w-3.5" /> Denominaciones
          </p>
          <p className="mt-1 text-2xl font-bold text-white">{denominations.length}</p>
        </Card>
        <Card className="p-4">
          <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <KeyRound className="h-3.5 w-3.5" /> Nulas activas
          </p>
          <p className="mt-1 text-2xl font-bold text-amber-300">{activeSt.length}</p>
        </Card>
      </div>

      <Card>
        <SectionTitle
          title="Monedas configuradas"
          subtitle="Códigos ISO, decimales y orden de presentación."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-semibold">Código</th>
                <th className="px-3 py-2 font-semibold">Nombre</th>
                <th className="px-3 py-2 text-right font-semibold">Decimales</th>
                <th className="px-3 py-2 text-right font-semibold">Base</th>
              </tr>
            </thead>
            <tbody>
              {currencies.map((currency) => (
                <tr key={currency.code} className="border-b border-white/[0.04]">
                  <td className="py-2 pr-3 font-semibold text-slate-200">{currency.code}</td>
                  <td className="px-3 py-2 text-slate-400">{currency.name}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{currency.decimals}</td>
                  <td className="px-3 py-2 text-right">
                    {currency.is_base ? <Badge tone="indigo">CLP</Badge> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <SectionTitle
          title="Boletas nulas (ST)"
          subtitle="Registro de auditoría. Reversar una nula vuelve a procesar el documento si corresponde."
        />
        {stFolios.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Sin boletas nulas.</p>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {stFolios.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone={item.status === 'ACTIVE' ? 'amber' : 'slate'}>
                      {item.status === 'ACTIVE' ? 'Activo' : 'Reversado'}
                    </Badge>
                    <span className="text-sm font-semibold text-slate-200">{item.folio}</span>
                    <span className="text-xs text-slate-500">{item.document_type}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {formatDate(item.registered_at.slice(0, 10))} · {item.reason}
                  </p>
                </div>
                {item.status === 'ACTIVE' && (
                  <Button
                    variant="ghost"
                    onClick={() => void handleReverse(item.id)}
                    disabled={working}
                  >
                    <RotateCcw className="h-4 w-4" /> Reversar
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle title="Importaciones" subtitle="Últimos lotes cargados." />
        <div className="space-y-2">
          {batches.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Sin importaciones.</p>
          ) : (
            batches.map((batch) => (
              <div
                key={batch.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-200">{batch.file_name}</p>
                  <p className="text-[11px] text-slate-500">
                    {formatDate(batch.created_at.slice(0, 10))} · {batch.rows_total} filas
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={batch.status === 'COMMITTED' ? 'green' : 'slate'}>
                    {batch.status}
                  </Badge>
                  <span className="text-xs text-slate-500">
                    {batch.rows_valid} válidas · {batch.rows_void} ST
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="border-indigo-400/10 bg-indigo-500/[0.04]">
        <SectionTitle
          title="Conexión Supabase"
          subtitle="La app usa la publishable key y RLS. La service_role nunca se expone en el frontend."
        />
        <div className="rounded-xl border border-white/[0.06] bg-slate-950/40 p-3 font-mono text-xs text-slate-400">
          <p>VITE_SUPABASE_URL=https://jlqmteozambgvdlnxecx.supabase.co</p>
          <p>VITE_SUPABASE_PUBLISHABLE_KEY=••••••••</p>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Para aplicar las migraciones usa `npx supabase link --project-ref
          jlqmteozambgvdlnxecx` y `npx supabase db push`. La contraseña de la base no se
          guarda en el repositorio.
        </p>
      </Card>
    </div>
  );
}
