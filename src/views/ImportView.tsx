import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Plus, RotateCcw, Upload } from 'lucide-react';
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
  listImportBatches,
  listStFolios,
  reverseStFolio,
  type FxSession,
  type ImportBatch,
  type StFolio,
} from '../lib/db';
import { buildImportDocuments, parseReportFile, type ParsedReport } from '../lib/excel';
import { parseStFolios } from '../lib/domain/fx';
import { errorMessage, formatClp, formatDate } from '../lib/format';

export default function ImportView({
  storeId,
  session,
  onImported,
}: {
  storeId: string;
  session: FxSession;
  onImported: () => void;
}) {
  const [parsed, setParsed] = useState<ParsedReport | null>(null);
  const [stInput, setStInput] = useState('');
  const [activeSt, setActiveSt] = useState<StFolio[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [stDocumentType, setStDocumentType] = useState('BOLETA');
  const [stFolio, setStFolio] = useState('');
  const [stNote, setStNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const manualSt = useMemo(() => parseStFolios(stInput), [stInput]);
  const stSet = useMemo(
    () =>
      new Set([
        ...manualSt,
        ...activeSt.filter((item) => item.status === 'ACTIVE').map((item) => item.folio),
      ]),
    [manualSt, activeSt],
  );

  const build = useMemo(
    () => (parsed ? buildImportDocuments(parsed.groups, stSet) : null),
    [parsed, stSet],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([listStFolios(storeId), listImportBatches(storeId)])
      .then(([stRows, batchRows]) => {
        if (cancelled) return;
        setActiveSt(stRows);
        setBatches(batchRows);
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
  }, [storeId]);

  async function handleFile(file: File | null) {
    if (!file) return;
    setError(null);
    setSuccess(null);
    setWorking(true);
    try {
      const report = await parseReportFile(file);
      setParsed(report);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  async function handleCommit() {
    if (!parsed || !build) return;
    if (build.errors.length > 0) {
      setError('Corrige los errores de la vista previa antes de importar.');
      return;
    }
    if (build.documents.length === 0) {
      setError('No hay documentos para importar.');
      return;
    }

    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      const activeFolios = new Set(
        activeSt.filter((item) => item.status === 'ACTIVE').map((item) => item.folio),
      );
      for (const folio of manualSt) {
        if (!activeFolios.has(folio)) {
          await addStFolio(
            storeId,
            stDocumentType,
            folio,
            'ST ingresado en la importación',
          );
        }
      }

      const batchId = await createImportBatch({
        storeId,
        sessionId: session.id,
        fileName: parsed.fileName,
        sheetName: parsed.sheetName,
        rowsTotal: parsed.rows.length,
      });
      const result = await commitImportBatch(
        storeId,
        session.id,
        batchId,
        build.documents,
      );
      setSuccess(
        `Importación completa: ${result.documents ?? 0} documentos, ${
          result.operations ?? 0
        } operaciones, ${result.void_operations ?? 0} líneas nulas (ST).`,
      );
      setParsed(null);
      const [stRows, batchRows] = await Promise.all([
        listStFolios(storeId),
        listImportBatches(storeId),
      ]);
      setActiveSt(stRows);
      setBatches(batchRows);
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
      await addStFolio(storeId, stDocumentType, stFolio.trim(), stNote.trim());
      setStFolio('');
      setStNote('');
      setActiveSt(await listStFolios(storeId));
      setSuccess('Folio ST registrado.');
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
      setSuccess('ST reversado. Si el documento estaba importado como ST, se reprocesó.');
      onImported();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <Spinner label="Cargando historial de importaciones…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <SectionTitle
            title="Subir reporte diario"
            subtitle="Formato esperado: OPERACION, CAJERO, DOCUMENTO, FOLIO, MONEDA, FECHA, RUT, NOMBRE, MONTO_EXTRANJERA, TIPO_CAMBIO, MONTO_NACIONAL."
          />
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-10 text-center transition-colors hover:border-indigo-400/40 hover:bg-indigo-500/[0.04]">
            <FileSpreadsheet className="h-8 w-8 text-indigo-300" />
            <span className="mt-3 text-sm font-semibold text-slate-200">
              {parsed ? parsed.fileName : 'Seleccionar archivo .xlsx'}
            </span>
            <span className="mt-1 text-xs text-slate-500">
              {parsed
                ? `${parsed.rows.length} filas leídas · hoja ${parsed.sheetName}`
                : 'El archivo se procesa localmente antes de confirmar.'}
            </span>
            <input
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
            />
          </label>

          {parsed && (
            <div className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-xl bg-white/[0.03] px-3 py-2">
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Filas</p>
                <p className="font-semibold text-white">{parsed.rows.length}</p>
              </div>
              <div className="rounded-xl bg-white/[0.03] px-3 py-2">
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Documentos</p>
                <p className="font-semibold text-white">{build?.documents.length ?? 0}</p>
              </div>
              <div className="rounded-xl bg-white/[0.03] px-3 py-2">
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Nulas</p>
                <p className="font-semibold text-amber-300">{build?.voidDocuments ?? 0}</p>
              </div>
              <div className="rounded-xl bg-white/[0.03] px-3 py-2">
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Errores</p>
                <p className="font-semibold text-rose-300">{build?.errors.length ?? 0}</p>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle
            title="Boletas nulas (ST)"
            subtitle="Una boleta nula queda registrada solo para auditoría y no suma en compras, ventas, CLP ni FIFO."
          />
          <textarea
            value={stInput}
            onChange={(event) => setStInput(event.target.value)}
            rows={4}
            placeholder="76876, 76991-77000"
            className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-indigo-400/60"
          />
          <p className="mt-1 text-xs text-slate-500">
            Acepta folios separados por coma, espacio o rango. Los folios activos de la
            base también se excluyen automáticamente.
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-[110px_1fr_auto]">
            <Select
              value={stDocumentType}
              onChange={(event) => setStDocumentType(event.target.value)}
            >
              <option value="BOLETA">BOLETA</option>
              <option value="FACTURA">FACTURA</option>
              <option value="TICKET">TICKET</option>
            </Select>
            <Input
              value={stFolio}
              onChange={(event) => setStFolio(event.target.value)}
              placeholder="Folio ST"
            />
            <Button variant="secondary" onClick={() => void handleAddSt()} disabled={working}>
              <Plus className="h-4 w-4" /> Agregar
            </Button>
          </div>
          <Input
            value={stNote}
            onChange={(event) => setStNote(event.target.value)}
            placeholder="Nota / motivo (opcional)"
            className="mt-2"
          />

          <div className="mt-4 max-h-48 space-y-2 overflow-y-auto">
            {activeSt.length === 0 ? (
              <p className="text-sm text-slate-500">Sin folios ST registrados.</p>
            ) : (
              activeSt.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone={item.status === 'ACTIVE' ? 'amber' : 'slate'}>
                        {item.status === 'ACTIVE' ? 'ST activo' : 'Reversado'}
                      </Badge>
                      <span className="text-sm font-semibold text-slate-200">
                        {item.folio}
                      </span>
                      <span className="text-xs text-slate-500">{item.document_type}</span>
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
      </div>

      {build && (
        <Card>
          <SectionTitle
            title="Vista previa"
            subtitle="Revisa documentos, líneas y estado antes de confirmar."
            action={
              <Button
                onClick={() => void handleCommit()}
                disabled={working || build.errors.length > 0 || build.documents.length === 0}
              >
                <Upload className="h-4 w-4" />
                {working ? 'Importando…' : 'Confirmar importación'}
              </Button>
            }
          />

          {build.errors.length > 0 && (
            <div className="mb-4 max-h-40 overflow-y-auto rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-200">
              {build.errors.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          )}

          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 font-semibold">Folio</th>
                  <th className="px-3 py-2 font-semibold">Tipo</th>
                  <th className="px-3 py-2 font-semibold">Operación</th>
                  <th className="px-3 py-2 text-right font-semibold">Líneas</th>
                  <th className="px-3 py-2 text-right font-semibold">Total CLP</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {build.documents.slice(0, 500).map((document) => (
                  <tr
                    key={`${document.document_type}-${document.folio}-${document.business_date}-${document.source_row_first}`}
                    className="border-b border-white/[0.04]"
                  >
                    <td className="py-2 pr-3 font-semibold text-slate-200">
                      {document.folio || 'Sin folio'}
                    </td>
                    <td className="px-3 py-2 text-slate-400">{document.document_type}</td>
                    <td className="px-3 py-2">
                      <Badge tone={document.operation === 'COMPRA' ? 'green' : 'rose'}>
                        {document.operation}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      {document.lines.length}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      {formatClp(
                        document.lines.reduce((total, line) => total + line.clp_amount, 0),
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={document.status === 'VALID' ? 'indigo' : 'amber'}>
                        {document.status === 'VALID' ? 'Válida' : 'Nula (ST)'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {build.documents.length > 500 && (
            <p className="mt-2 text-xs text-slate-500">
              Mostrando los primeros 500 documentos de {build.documents.length}.
            </p>
          )}
        </Card>
      )}

      <Card>
        <SectionTitle title="Importaciones recientes" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3 font-semibold">Archivo</th>
                <th className="px-3 py-2 font-semibold">Estado</th>
                <th className="px-3 py-2 text-right font-semibold">Filas</th>
                <th className="px-3 py-2 text-right font-semibold">Válidas</th>
                <th className="px-3 py-2 text-right font-semibold">ST</th>
                <th className="px-3 py-2 font-semibold">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id} className="border-b border-white/[0.04]">
                  <td className="py-2 pr-3 text-slate-200">{batch.file_name}</td>
                  <td className="px-3 py-2">
                    <Badge tone={batch.status === 'COMMITTED' ? 'green' : 'slate'}>
                      {batch.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300">{batch.rows_total}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{batch.rows_valid}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{batch.rows_void}</td>
                  <td className="px-3 py-2 text-slate-400">
                    {formatDate(batch.created_at.slice(0, 10))}
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
