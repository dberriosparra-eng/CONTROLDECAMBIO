import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
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
  commitImportBatch,
  createImportBatch,
  ensureCurrency,
  ensureSession,
  listCurrencies,
  listImportBatches,
  listStFolios,
  reverseStFolio,
  type Currency,
  type FxSession,
  type ImportBatch,
  type StFolio,
} from '../lib/db';
import { parseReportFile, type ImportDocument } from '../lib/excel';
import { WORLD_CURRENCIES, currencyFlag, currencyName } from '../lib/currencies';
import { errorMessage, formatClp, formatDate, formatQty, formatRate } from '../lib/format';

type ManualRow = {
  id: string;
  business_date: string;
  operation: 'COMPRA' | 'VENTA';
  currency_code: string;
  instrument: 'EFECTIVO' | 'TRANSFERENCIA';
  folio: string;
  cashier: string;
  foreign_amount: number;
  fx_rate: number;
  clp_amount: number;
  is_void: boolean;
};

function rowId(): string {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildDocuments(rows: ManualRow[]): ImportDocument[] {
  const map = new Map<string, ImportDocument>();

  for (const row of rows) {
    const folio = row.folio.trim();
    const hasFolio = folio !== '' && folio !== '0';
    const status = row.is_void ? 'VOID_ST' : 'VALID';
    const key = hasFolio
      ? `BOLETA|${folio}|${row.business_date}|${row.operation}|${status}`
      : `BOLETA|S/N|${row.id}`;

    let document = map.get(key);
    if (!document) {
      document = {
        document_type: 'BOLETA',
        folio,
        operation: row.operation,
        business_date: row.business_date,
        cashier: row.cashier,
        is_wholesale: false,
        status,
        missing_folio: !hasFolio,
        source_row_first: 0,
        source_row_last: 0,
        lines: [],
      };
      map.set(key, document);
    }

    document.lines.push({
      currency_code: row.currency_code,
      instrument: row.instrument,
      foreign_amount: row.foreign_amount,
      fx_rate: row.fx_rate,
      clp_amount: row.clp_amount,
      source_row: 0,
    });
  }

  return [...map.values()];
}

export default function ImportView({
  storeId,
  session,
  onImported,
}: {
  storeId: string;
  session: FxSession;
  onImported: () => void;
}) {
  const [rows, setRows] = useState<ManualRow[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [activeSt, setActiveSt] = useState<StFolio[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formDate, setFormDate] = useState(session.business_date);
  const [formOperation, setFormOperation] = useState<'COMPRA' | 'VENTA'>('COMPRA');
  const [formCurrency, setFormCurrency] = useState('USD');
  const [formAmount, setFormAmount] = useState('');
  const [formRate, setFormRate] = useState('');
  const [formFolio, setFormFolio] = useState('');
  const [formCashier, setFormCashier] = useState('');
  const [formVoid, setFormVoid] = useState(false);

  const [stFolio, setStFolio] = useState('');
  const [stNote, setStNote] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [currencyRows, stRows, batchRows] = await Promise.all([
        listCurrencies(),
        listStFolios(storeId),
        listImportBatches(storeId),
      ]);
      setCurrencies(currencyRows);
      setActiveSt(stRows);
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

  useEffect(() => {
    setFormDate(session.business_date);
  }, [session.business_date]);

  const formClp = (Number(formAmount) || 0) * (Number(formRate) || 0);

  const byDate = useMemo(() => {
    const map = new Map<string, ManualRow[]>();
    for (const row of rows) {
      const list = map.get(row.business_date) ?? [];
      list.push(row);
      map.set(row.business_date, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const byMonth = useMemo(() => {
    const map = new Map<
      string,
      { month: string; count: number; buyClp: number; sellClp: number; voidCount: number }
    >();
    for (const row of rows) {
      const month = row.business_date.slice(0, 7);
      const current = map.get(month) ?? {
        month,
        count: 0,
        buyClp: 0,
        sellClp: 0,
        voidCount: 0,
      };
      current.count += 1;
      if (row.is_void) {
        current.voidCount += 1;
      } else if (row.operation === 'COMPRA') {
        current.buyClp += row.clp_amount;
      } else {
        current.sellClp += row.clp_amount;
      }
      map.set(month, current);
    }
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [rows]);

  async function handleFile(file: File | null) {
    if (!file) return;
    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      const parsed = await parseReportFile(file);
      const next: ManualRow[] = [];

      for (const group of parsed.groups) {
        const status = group.rows.some((row) => row.errors.length > 0) ? null : 'VALID';
        if (!status || !group.operation || !group.businessDate) continue;

        for (const row of group.rows) {
          next.push({
            id: rowId(),
            business_date: group.businessDate,
            operation: group.operation,
            currency_code: row.currency ?? 'USD',
            instrument: row.instrument === 'TRANSFERENCIA' ? 'TRANSFERENCIA' : 'EFECTIVO',
            folio: group.folio,
            cashier: row.cashier,
            foreign_amount: row.foreignAmount,
            fx_rate: row.fxRate,
            clp_amount: row.clpAmount,
            is_void: false,
          });
        }
      }

      setRows(next);
      setFileName(parsed.fileName);
      setSheetName(parsed.sheetName);
      setSuccess(
        `Se cargaron ${next.length} líneas desde ${parsed.fileName}. Revisa, elimina o agrega las que falten.`,
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  function addManualRow() {
    const amount = Number(formAmount) || 0;
    const rate = Number(formRate) || 0;
    if (!formDate || amount <= 0 || rate <= 0) {
      setError('Completa fecha, cantidad y tipo de cambio.');
      return;
    }

    setRows((current) => [
      ...current,
      {
        id: rowId(),
        business_date: formDate,
        operation: formOperation,
        currency_code: formCurrency,
        instrument: 'EFECTIVO',
        folio: formFolio.trim(),
        cashier: formCashier.trim(),
        foreign_amount: amount,
        fx_rate: rate,
        clp_amount: amount * rate,
        is_void: formVoid,
      },
    ]);
    setFormAmount('');
    setFormRate('');
    setFormFolio('');
    setError(null);
    setSuccess('Línea agregada.');
  }

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  async function handleCommit() {
    if (rows.length === 0) {
      setError('Agrega al menos una línea.');
      return;
    }

    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      const neededCodes = [...new Set(rows.map((row) => row.currency_code))];
      for (const code of neededCodes) {
        if (currencies.some((currency) => currency.code === code)) continue;
        const world = WORLD_CURRENCIES.find((item) => item.code === code);
        if (world) {
          await ensureCurrency({
            code: world.code,
            name: world.name,
            symbol: world.symbol,
            decimals: world.decimals,
          });
        }
      }

      const activeFolios = new Set(
        activeSt.filter((item) => item.status === 'ACTIVE').map((item) => item.folio),
      );
      for (const row of rows) {
        if (!row.is_void) continue;
        const folio = row.folio.trim();
        if (!folio || folio === '0' || activeFolios.has(folio)) continue;
        await addStFolio(storeId, 'BOLETA', folio, 'ST manual');
        activeFolios.add(folio);
      }

      const documents = buildDocuments(rows);
      const documentsByDate = new Map<string, ImportDocument[]>();
      for (const document of documents) {
        const list = documentsByDate.get(document.business_date) ?? [];
        list.push(document);
        documentsByDate.set(document.business_date, list);
      }

      let importedDocuments = 0;
      let importedOperations = 0;
      let voidOperations = 0;

      for (const [date, dateDocuments] of [...documentsByDate.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      )) {
        const targetSession = await ensureSession(storeId, date);
        const batchId = await createImportBatch({
          storeId,
          sessionId: targetSession.id,
          fileName: fileName || 'Carga manual',
          sheetName: sheetName || 'Manual',
          rowsTotal: dateDocuments.length,
        });
        const result = await commitImportBatch(
          storeId,
          targetSession.id,
          batchId,
          dateDocuments,
        );
        importedDocuments += result.documents ?? 0;
        importedOperations += result.operations ?? 0;
        voidOperations += result.void_operations ?? 0;
      }

      setSuccess(
        `Importación completa: ${importedDocuments} documentos, ${importedOperations} operaciones, ${voidOperations} nulas (ST).`,
      );
      setRows([]);
      setFileName('');
      setSheetName('');
      await load();
      onImported();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  async function handleAddSt() {
    if (!stFolio.trim()) return;
    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      await addStFolio(storeId, 'BOLETA', stFolio.trim(), stNote.trim());
      setStFolio('');
      setStNote('');
      setActiveSt(await listStFolios(storeId));
      setSuccess('Folio nulo (ST) registrado.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  async function handleReverseSt(id: string) {
    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      await reverseStFolio(storeId, id);
      setActiveSt(await listStFolios(storeId));
      setSuccess('ST reversado.');
      onImported();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <Spinner label="Cargando importador…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <Card>
        <SectionTitle
          title="Importar reporte"
          subtitle="Carga el archivo o agrega las boletas una por una. Solo se usan boletas."
          action={
            <Button onClick={() => void handleCommit()} disabled={working || rows.length === 0}>
              <Upload className="h-4 w-4" />
              {working ? 'Importando…' : 'Confirmar importación'}
            </Button>
          }
        />

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-8 text-center transition-colors hover:border-indigo-400/40 hover:bg-indigo-500/[0.04]">
              <FileSpreadsheet className="h-8 w-8 text-indigo-300" />
              <span className="mt-3 text-sm font-semibold text-slate-200">
                {fileName || 'Cargar archivo .xlsx (opcional)'}
              </span>
              <span className="mt-1 text-xs text-slate-500">
                Se cargan las líneas para revisarlas y editarlas una a una.
              </span>
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
              />
            </label>

            <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Agregar línea manual
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  type="date"
                  value={formDate}
                  onChange={(event) => setFormDate(event.target.value)}
                />
                <Select
                  value={formOperation}
                  onChange={(event) =>
                    setFormOperation(event.target.value as 'COMPRA' | 'VENTA')
                  }
                >
                  <option value="COMPRA">Compra</option>
                  <option value="VENTA">Venta</option>
                </Select>
                <Select
                  value={formCurrency}
                  onChange={(event) => setFormCurrency(event.target.value)}
                >
                  {WORLD_CURRENCIES.map((currency) => (
                    <option key={currency.code} value={currency.code}>
                      {currency.flag} {currency.code} · {currency.name}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={formAmount}
                  onChange={(event) => setFormAmount(event.target.value)}
                  placeholder="Cantidad de divisa"
                />
                <Input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={formRate}
                  onChange={(event) => setFormRate(event.target.value)}
                  placeholder="Tipo de cambio"
                />
                <Input
                  value={formFolio}
                  onChange={(event) => setFormFolio(event.target.value)}
                  placeholder="Folio boleta"
                />
                <Input
                  value={formCashier}
                  onChange={(event) => setFormCashier(event.target.value)}
                  placeholder="Cajero (opcional)"
                />
                <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-slate-950/40 px-3 py-2 text-sm text-slate-400">
                  <span>CLP calculado</span>
                  <span className="font-semibold text-white">{formatClp(formClp)}</span>
                </div>
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={formVoid}
                  onChange={(event) => setFormVoid(event.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-slate-950 accent-amber-500"
                />
                Marcar como nula (ST)
              </label>
              <Button variant="secondary" onClick={addManualRow} className="mt-3 w-full">
                <Plus className="h-4 w-4" /> Agregar línea
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Resumen por mes
              </p>
              {byMonth.length === 0 ? (
                <p className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-3 text-sm text-slate-500">
                  Sin líneas cargadas.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500">
                        <th className="py-2 pr-3 font-semibold">Mes</th>
                        <th className="px-3 py-2 text-right font-semibold">Líneas</th>
                        <th className="px-3 py-2 text-right font-semibold">Compras CLP</th>
                        <th className="px-3 py-2 text-right font-semibold">Ventas CLP</th>
                        <th className="px-3 py-2 text-right font-semibold">Nulas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byMonth.map((month) => (
                        <tr key={month.month} className="border-b border-white/[0.04]">
                          <td className="py-2 pr-3 font-semibold text-slate-200">
                            {month.month}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-300">{month.count}</td>
                          <td className="px-3 py-2 text-right text-emerald-300">
                            {formatClp(month.buyClp)}
                          </td>
                          <td className="px-3 py-2 text-right text-rose-300">
                            {formatClp(month.sellClp)}
                          </td>
                          <td className="px-3 py-2 text-right text-amber-300">
                            {month.voidCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Detalle por día
              </p>
              {byDate.length === 0 ? (
                <p className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-3 text-sm text-slate-500">
                  Agrega líneas o carga un archivo para comenzar.
                </p>
              ) : (
                <div className="space-y-3">
                  {byDate.map(([date, dayRows]) => {
                    const validRows = dayRows.filter((row) => !row.is_void);
                    const buy = validRows
                      .filter((row) => row.operation === 'COMPRA')
                      .reduce((total, row) => total + row.clp_amount, 0);
                    const sell = validRows
                      .filter((row) => row.operation === 'VENTA')
                      .reduce((total, row) => total + row.clp_amount, 0);
                    return (
                      <div
                        key={date}
                        className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3"
                      >
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-white">{formatDate(date)}</p>
                          <p className="text-[11px] text-slate-500">
                            {dayRows.length} líneas · compras {formatClp(buy)} · ventas{' '}
                            {formatClp(sell)}
                          </p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[720px] text-left text-sm">
                            <thead>
                              <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500">
                                <th className="py-1.5 pr-2 font-semibold">Op.</th>
                                <th className="px-2 py-1.5 font-semibold">Divisa</th>
                                <th className="px-2 py-1.5 text-right font-semibold">Cantidad</th>
                                <th className="px-2 py-1.5 text-right font-semibold">TC</th>
                                <th className="px-2 py-1.5 text-right font-semibold">CLP</th>
                                <th className="px-2 py-1.5 font-semibold">Folio</th>
                                <th className="px-2 py-1.5 font-semibold">Estado</th>
                                <th className="px-2 py-1.5 text-right font-semibold">Acción</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dayRows.map((row) => (
                                <tr key={row.id} className="border-b border-white/[0.04]">
                                  <td className="py-1.5 pr-2">
                                    <Badge
                                      tone={row.operation === 'COMPRA' ? 'green' : 'rose'}
                                    >
                                      {row.operation}
                                    </Badge>
                                  </td>
                                  <td className="px-2 py-1.5 text-slate-200">
                                    {currencyFlag(row.currency_code)} {row.currency_code}
                                  </td>
                                  <td className="px-2 py-1.5 text-right text-slate-300">
                                    {formatQty(row.foreign_amount)}
                                  </td>
                                  <td className="px-2 py-1.5 text-right text-slate-400">
                                    {formatRate(row.fx_rate)}
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-semibold text-white">
                                    {formatClp(row.clp_amount)}
                                  </td>
                                  <td className="px-2 py-1.5 text-slate-400">
                                    {row.folio || 'Sin folio'}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <Badge tone={row.is_void ? 'amber' : 'green'}>
                                      {row.is_void ? 'Nula (ST)' : 'Válida'}
                                    </Badge>
                                  </td>
                                  <td className="px-2 py-1.5 text-right">
                                    <Button
                                      variant="ghost"
                                      onClick={() => removeRow(row.id)}
                                      title="Eliminar línea"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionTitle
            title="Boletas nulas (ST)"
            subtitle="Registra el folio antes de importar o márcalo en la línea manual."
          />
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              value={stFolio}
              onChange={(event) => setStFolio(event.target.value)}
              placeholder="Folio nulo"
            />
            <Button variant="secondary" onClick={() => void handleAddSt()} disabled={working}>
              <Plus className="h-4 w-4" /> Agregar
            </Button>
          </div>
          <Input
            value={stNote}
            onChange={(event) => setStNote(event.target.value)}
            placeholder="Nota (opcional)"
            className="mt-2"
          />
          <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
            {activeSt.length === 0 ? (
              <p className="text-sm text-slate-500">Sin boletas nulas registradas.</p>
            ) : (
              activeSt.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone={item.status === 'ACTIVE' ? 'amber' : 'slate'}>
                        {item.status === 'ACTIVE' ? 'Activa' : 'Reversada'}
                      </Badge>
                      <span className="text-sm font-semibold text-slate-200">{item.folio}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {formatDate(item.registered_at.slice(0, 10))}
                    </p>
                  </div>
                  {item.status === 'ACTIVE' && (
                    <Button
                      variant="ghost"
                      onClick={() => void handleReverseSt(item.id)}
                      disabled={working}
                      title="Reversar ST"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <SectionTitle title="Importaciones recientes" />
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {batches.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">Sin importaciones.</p>
            ) : (
              batches.map((batch) => (
                <div
                  key={batch.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-200">{batch.file_name}</p>
                    <p className="text-[11px] text-slate-500">
                      {formatDate(batch.created_at.slice(0, 10))} · {batch.rows_total} filas
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge tone={batch.status === 'COMMITTED' ? 'green' : 'slate'}>
                      {batch.status}
                    </Badge>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {batch.rows_valid} válidas · {batch.rows_void} nulas
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
