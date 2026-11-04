import {
  groupReportRows,
  normalizeReportRow,
  type FxNormalizedRow,
  type FxRawReportRow,
  type FxReportGroup,
} from './domain/fx.ts';

export interface ParsedReport {
  fileName: string;
  sheetName: string;
  rows: FxNormalizedRow[];
  groups: FxReportGroup[];
}

export interface ImportLine {
  currency_code: string;
  instrument: string;
  foreign_amount: number;
  fx_rate: number;
  clp_amount: number;
  source_row: number;
}

export interface ImportDocument {
  document_type: string;
  folio: string;
  operation: 'COMPRA' | 'VENTA';
  business_date: string;
  cashier: string;
  is_wholesale: boolean;
  status: 'VALID' | 'VOID_ST';
  missing_folio: boolean;
  source_row_first: number;
  source_row_last: number;
  lines: ImportLine[];
}

export interface BuildImportResult {
  documents: ImportDocument[];
  errors: string[];
  voidDocuments: number;
}

export async function parseReportFile(file: File): Promise<ParsedReport> {
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  const sheets = await readXlsxFile(file);
  const sheet = sheets[0];
  if (!sheet) throw new Error('El archivo no tiene hojas.');

  const headerRow = sheet.data[0] ?? [];
  const headers = headerRow.map((value) => String(value ?? '').trim());
  const dataRows = sheet.data.slice(1);

  if (dataRows.length === 0) {
    throw new Error('La hoja seleccionada no tiene filas de datos.');
  }

  const rawRows = dataRows.map((row) => {
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      if (header) record[header] = row[index] ?? '';
    });
    return record;
  });

  const rows = rawRows.map((row, index) =>
    normalizeReportRow(row as FxRawReportRow, index + 2),
  );

  return {
    fileName: file.name,
    sheetName: sheet.sheet,
    rows,
    groups: groupReportRows(rows),
  };
}

export function buildImportDocuments(
  groups: FxReportGroup[],
  stFolios: Set<string>,
): BuildImportResult {
  const documents: ImportDocument[] = [];
  const errors: string[] = [];
  const folioDates = new Map<string, string>();
  let voidDocuments = 0;

  for (const group of groups) {
    const rowErrors = group.rows.flatMap((row) =>
      row.errors.map((error) => `Fila ${row.sourceRow}: ${error}`),
    );
    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    if (!group.operation) {
      errors.push(`Documento ${group.folio || 'sin folio'}: operación no reconocida.`);
      continue;
    }
    if (!group.businessDate) {
      errors.push(`Documento ${group.folio || 'sin folio'}: fecha inválida.`);
      continue;
    }
    if (group.warnings.some((warning) => warning.includes('mezcla compras y ventas'))) {
      errors.push(`Documento ${group.folio}: mezcla compras y ventas.`);
      continue;
    }

    if (!group.missingFolio) {
      const key = `${group.documentType}|${group.folio}`;
      const previousDate = folioDates.get(key);
      if (previousDate && previousDate !== group.businessDate) {
        errors.push(
          `Folio ${group.folio}: aparece en ${previousDate} y ${group.businessDate}.`,
        );
        continue;
      }
      folioDates.set(key, group.businessDate);
    }

    const isSt = !group.missingFolio && stFolios.has(group.folio);
    if (isSt) voidDocuments += 1;

    const sourceRows = group.rows.map((row) => row.sourceRow);
    documents.push({
      document_type: group.documentType,
      folio: group.folio,
      operation: group.operation,
      business_date: group.businessDate,
      cashier: group.rows[0]?.cashier ?? '',
      is_wholesale: false,
      status: isSt ? 'VOID_ST' : 'VALID',
      missing_folio: group.missingFolio,
      source_row_first: Math.min(...sourceRows),
      source_row_last: Math.max(...sourceRows),
      lines: group.rows.map((row) => ({
        currency_code: row.currency ?? '',
        instrument: row.instrument,
        foreign_amount: row.foreignAmount,
        fx_rate: row.fxRate,
        clp_amount: row.clpAmount,
        source_row: row.sourceRow,
      })),
    });
  }

  return { documents, errors, voidDocuments };
}
