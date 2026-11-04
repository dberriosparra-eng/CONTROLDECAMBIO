/**
 * Reglas puras del módulo de casa de cambio/divisas.
 *
 * No importa Supabase, React ni alias de rutas: se puede probar con
 * `node --test` y reutilizar tanto en el cliente como en funciones server-side.
 *
 * Convenciones:
 * - Fechas de negocio: string ISO `YYYY-MM-DD`.
 * - Cantidades de divisa: number con hasta 6 decimales.
 * - Montos CLP: number con hasta 2 decimales.
 * - Tipos de cambio: CLP por 1 unidad de la divisa.
 */

export type FxOperationType = 'COMPRA' | 'VENTA';
export type FxDocumentStatus = 'VALID' | 'VOID_ST' | 'VOID_NC' | 'VOID_OTHER' | 'REVIEW';
export type FxInstrument = 'EFECTIVO' | 'TRANSFERENCIA' | 'OTRO';
export type FxAccountSide = 'RECEIVABLE' | 'PAYABLE';

export interface FxRawReportRow {
  OPERACION?: unknown;
  CAJERO?: unknown;
  DOCUMENTO?: unknown;
  FOLIO?: unknown;
  MONEDA?: unknown;
  FECHA?: unknown;
  RUT?: unknown;
  NOMBRE?: unknown;
  MONTO_EXTRANJERA?: unknown;
  TIPO_CAMBIO?: unknown;
  MONTO_NACIONAL?: unknown;
}

export interface FxNormalizedRow {
  sourceRow: number;
  operation: FxOperationType | null;
  cashier: string;
  documentType: string;
  folio: string;
  currency: string | null;
  instrument: FxInstrument;
  businessDate: string | null;
  rut: string;
  name: string;
  foreignAmount: number;
  fxRate: number;
  clpAmount: number;
  missingFolio: boolean;
  errors: string[];
  warnings: string[];
}

export interface FxReportGroup {
  key: string;
  documentType: string;
  folio: string;
  businessDate: string | null;
  operation: FxOperationType | null;
  missingFolio: boolean;
  rows: FxNormalizedRow[];
  warnings: string[];
}

export interface FxDailyStats {
  businessDate: string;
  currency: string;
  instrument: string;
  buyQty: number;
  buyClp: number;
  sellQty: number;
  sellClp: number;
  avgBuyRate: number;
  avgSellRate: number;
  buyCount: number;
  sellCount: number;
  spread: number;
  spreadPct: number;
}

export interface FxOperationForStats {
  documentStatus: FxDocumentStatus;
  businessDate: string;
  currency: string;
  instrument?: string;
  operation: FxOperationType;
  foreignAmount: number;
  clpAmount: number;
  isWholesale?: boolean;
}

export interface FxFifoLot {
  id: string;
  currency: string;
  acquiredAt: string;
  sequence: number;
  originalQty: number;
  remainingQty: number;
  unitCostClp: number;
}

export interface FxFifoConsumption {
  lotId: string;
  quantity: number;
  unitCostClp: number;
  totalCostClp: number;
}

export interface FxFifoResult {
  consumptions: FxFifoConsumption[];
  lots: FxFifoLot[];
  totalCostClp: number;
  shortfall: number;
}

export interface FxPurchaseInput {
  id?: string;
  currency: string;
  acquiredAt: string;
  sequence?: number;
  quantity: number;
  clpAmount: number;
}

export interface FxSaleInput {
  currency: string;
  quantity: number;
  clpAmount: number;
}

export interface FxSaleResult extends FxFifoResult {
  marginClp: number;
}

export interface FxAccountLine {
  counterpartyId: string;
  currency: string;
  side: FxAccountSide;
  amountDelta: number;
}

export interface FxAccountBalance {
  counterpartyId: string;
  currency: string;
  receivable: number;
  payable: number;
  net: number;
}

export interface FxInventoryMovementLike {
  currency: string;
  quantityDelta: number;
}

export interface FxDenominationCount {
  value: number;
  quantity: number;
}

export interface FxCloseInput {
  cashClp: number;
  inventoryValueClp: number;
  realizedMarginClp: number;
  fxResultClp: number;
  expensesClp: number;
}

export interface FxCloseTotals {
  totalCapitalClp: number;
  netResultClp: number;
}

const DEFAULT_ALIASES: Record<string, { currency: string; instrument: FxInstrument }> = {
  DOLAR: { currency: 'USD', instrument: 'EFECTIVO' },
  'DOLAR USA': { currency: 'USD', instrument: 'EFECTIVO' },
  USD: { currency: 'USD', instrument: 'EFECTIVO' },
  'PESO ARGENTINO': { currency: 'ARS', instrument: 'EFECTIVO' },
  ARGENTINO: { currency: 'ARS', instrument: 'EFECTIVO' },
  ARS: { currency: 'ARS', instrument: 'EFECTIVO' },
  'ARGENTINO T': { currency: 'ARS', instrument: 'TRANSFERENCIA' },
  'REAL BRASIL': { currency: 'BRL', instrument: 'EFECTIVO' },
  REAL: { currency: 'BRL', instrument: 'EFECTIVO' },
  BRL: { currency: 'BRL', instrument: 'EFECTIVO' },
  EURO: { currency: 'EUR', instrument: 'EFECTIVO' },
  EUROS: { currency: 'EUR', instrument: 'EFECTIVO' },
  EUR: { currency: 'EUR', instrument: 'EFECTIVO' },
  'DOLAR AUSTRALIANO': { currency: 'AUD', instrument: 'EFECTIVO' },
  AUD: { currency: 'AUD', instrument: 'EFECTIVO' },
  'DOLAR NEOZELANDES': { currency: 'NZD', instrument: 'EFECTIVO' },
  NZD: { currency: 'NZD', instrument: 'EFECTIVO' },
  'DOLAR CANADIENSE': { currency: 'CAD', instrument: 'EFECTIVO' },
  CAD: { currency: 'CAD', instrument: 'EFECTIVO' },
  'PESO COLOMBIANO': { currency: 'COP', instrument: 'EFECTIVO' },
  COP: { currency: 'COP', instrument: 'EFECTIVO' },
  'SOL PERUANO': { currency: 'PEN', instrument: 'EFECTIVO' },
  PEN: { currency: 'PEN', instrument: 'EFECTIVO' },
  'LIBRA ESTERLINA': { currency: 'GBP', instrument: 'EFECTIVO' },
  GBP: { currency: 'GBP', instrument: 'EFECTIVO' },
  BOLIVIANO: { currency: 'BOB', instrument: 'EFECTIVO' },
  BOB: { currency: 'BOB', instrument: 'EFECTIVO' },
  'PESO URUGUAYO': { currency: 'UYU', instrument: 'EFECTIVO' },
  UYU: { currency: 'UYU', instrument: 'EFECTIVO' },
  'PESO MEXICANO': { currency: 'MXN', instrument: 'EFECTIVO' },
  MXN: { currency: 'MXN', instrument: 'EFECTIVO' },
  'FRANCO SUIZO': { currency: 'CHF', instrument: 'EFECTIVO' },
  CHF: { currency: 'CHF', instrument: 'EFECTIVO' },
  GUARANI: { currency: 'PYG', instrument: 'EFECTIVO' },
  PYG: { currency: 'PYG', instrument: 'EFECTIVO' },
};

/** Normaliza una etiqueta para compararla sin acentos, mayúsculas ni espacios extra. */
export function canonicalAlias(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Resuelve una etiqueta de moneda del reporte a un código ISO y un instrumento.
 * Devuelve `null` si no hay alias conocido.
 */
export function normalizeCurrency(
  value: unknown,
  aliases: Record<string, { currency: string; instrument: FxInstrument }> = DEFAULT_ALIASES,
): { currency: string; instrument: FxInstrument } | null {
  const key = canonicalAlias(String(value ?? ''));
  if (!key) return null;
  const direct = aliases[key];
  if (direct) return direct;
  if (/^[A-Z]{3}$/.test(key)) return { currency: key, instrument: 'EFECTIVO' };
  return null;
}

/** Convierte un folio de Excel a texto, sin `.0` accidental. */
export function normalizeFolio(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '');
  }
  return String(value).replace(/\u00a0/g, ' ').trim().replace(/\.0+$/, '');
}

/** Parsea números con formato chileno/latino o anglosajón. */
export function parseFxNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (value === null || value === undefined) return null;

  const cleaned = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/[^\d.,-]/g, '')
    .trim();
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === ',') return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (lastComma >= 0) {
    const decimals = cleaned.length - lastComma - 1;
    const parts = cleaned.split(',');
    normalized = decimals === 3 && parts.length === 2 ? cleaned.replace(',', '') : cleaned.replace(',', '.');
  } else if (lastDot >= 0) {
    const decimals = cleaned.length - lastDot - 1;
    const parts = cleaned.split('.');
    normalized = decimals === 3 && parts.length === 2 ? cleaned.replace('.', '') : cleaned;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parsea fecha ISO, dd-mm-yyyy, dd/mm/yyyy o serial de Excel. */
export function parseFxDate(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }

  const text = String(value ?? '').trim();
  if (!text) return null;

  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return buildIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) {
    return buildIsoDate(Number(match[3]), Number(match[2]), Number(match[1]));
  }

  return null;
}

function buildIsoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Normaliza y valida una fila del reporte diario. */
export function normalizeReportRow(
  raw: FxRawReportRow,
  sourceRow: number,
  aliases?: Record<string, { currency: string; instrument: FxInstrument }>,
): FxNormalizedRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  const operationText = canonicalAlias(String(raw.OPERACION ?? ''));
  const operation: FxOperationType | null =
    operationText === 'COMPRA' ? 'COMPRA' : operationText === 'VENTA' ? 'VENTA' : null;
  if (!operation) errors.push(`Operación no reconocida: "${String(raw.OPERACION ?? '')}".`);

  const documentType = canonicalAlias(String(raw.DOCUMENTO ?? 'BOLETA')) || 'BOLETA';
  const folio = normalizeFolio(raw.FOLIO);
  const missingFolio = folio === '' || folio === '0';
  if (missingFolio) warnings.push('Folio vacío o 0: se registrará como boleta sin folio.');

  const currencyInfo = normalizeCurrency(raw.MONEDA, aliases);
  if (!currencyInfo) errors.push(`Moneda no reconocida: "${String(raw.MONEDA ?? '')}".`);

  const businessDate = parseFxDate(raw.FECHA);
  if (!businessDate) errors.push(`Fecha inválida: "${String(raw.FECHA ?? '')}".`);

  const foreignAmount = parseFxNumber(raw.MONTO_EXTRANJERA);
  const fxRate = parseFxNumber(raw.TIPO_CAMBIO);
  const clpAmount = parseFxNumber(raw.MONTO_NACIONAL);

  if (foreignAmount === null || foreignAmount <= 0) {
    errors.push('El monto extranjero debe ser un número mayor a 0.');
  }
  if (fxRate === null || fxRate <= 0) {
    errors.push('El tipo de cambio debe ser un número mayor a 0.');
  }
  if (clpAmount === null || clpAmount < 0) {
    errors.push('El monto nacional debe ser un número mayor o igual a 0.');
  }

  if (
    foreignAmount !== null &&
    fxRate !== null &&
    clpAmount !== null &&
    foreignAmount > 0 &&
    fxRate > 0
  ) {
    const expected = foreignAmount * fxRate;
    const tolerance = Math.max(1, Math.abs(clpAmount) * 0.0001);
    if (Math.abs(expected - clpAmount) > tolerance) {
      warnings.push(
        `Monto nacional no coincide con cantidad × tipo de cambio (${expected.toFixed(2)} vs ${clpAmount.toFixed(2)}).`,
      );
    }
  }

  return {
    sourceRow,
    operation,
    cashier: String(raw.CAJERO ?? '').trim(),
    documentType,
    folio,
    currency: currencyInfo?.currency ?? null,
    instrument: currencyInfo?.instrument ?? 'EFECTIVO',
    businessDate,
    rut: String(raw.RUT ?? '').trim(),
    name: String(raw.NOMBRE ?? '').trim(),
    foreignAmount: foreignAmount ?? 0,
    fxRate: fxRate ?? 0,
    clpAmount: clpAmount ?? 0,
    missingFolio,
    errors,
    warnings,
  };
}

/** Agrupa filas normalizadas por documento. Un folio multi-moneda es un solo documento. */
export function groupReportRows(rows: FxNormalizedRow[]): FxReportGroup[] {
  const groups = new Map<string, FxReportGroup>();

  for (const row of rows) {
    const key = row.missingFolio
      ? `${row.documentType}|S/N|${row.sourceRow}`
      : `${row.documentType}|${row.folio}|${row.businessDate ?? 'sin-fecha'}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        documentType: row.documentType,
        folio: row.folio,
        businessDate: row.businessDate,
        operation: row.operation,
        missingFolio: row.missingFolio,
        rows: [],
        warnings: [],
      };
      groups.set(key, group);
    }

    group.rows.push(row);

    if (group.operation && row.operation && group.operation !== row.operation) {
      group.warnings.push('El documento mezcla compras y ventas.');
    }
    if (group.businessDate && row.businessDate && group.businessDate !== row.businessDate) {
      group.warnings.push('El documento tiene fechas distintas entre líneas.');
    }
  }

  for (const group of groups.values()) {
    const seen = new Set<string>();
    for (const row of group.rows) {
      const lineKey = `${row.currency ?? '?'}|${row.instrument}`;
      if (seen.has(lineKey)) {
        group.warnings.push(`Línea duplicada para ${row.currency ?? 'moneda desconocida'} (${row.instrument}).`);
      }
      seen.add(lineKey);
    }
  }

  return [...groups.values()];
}

/** Calcula estadísticas diarias por divisa, excluyendo cualquier documento no válido (ST incluido). */
export function computeDailyFxStats(
  operations: FxOperationForStats[],
  options: { includeWholesale?: boolean; onlyWholesale?: boolean } = {},
): FxDailyStats[] {
  const includeWholesale = options.includeWholesale ?? true;
  const onlyWholesale = options.onlyWholesale ?? false;
  const groups = new Map<string, FxDailyStats>();

  for (const operation of operations) {
    if (operation.documentStatus !== 'VALID') continue;
    if (!includeWholesale && operation.isWholesale) continue;
    if (onlyWholesale && !operation.isWholesale) continue;

    const instrument = operation.instrument ?? 'EFECTIVO';
    const key = `${operation.businessDate}|${operation.currency}|${instrument}`;
    let stats = groups.get(key);
    if (!stats) {
      stats = {
        businessDate: operation.businessDate,
        currency: operation.currency,
        instrument,
        buyQty: 0,
        buyClp: 0,
        sellQty: 0,
        sellClp: 0,
        avgBuyRate: 0,
        avgSellRate: 0,
        buyCount: 0,
        sellCount: 0,
        spread: 0,
        spreadPct: 0,
      };
      groups.set(key, stats);
    }

    if (operation.operation === 'COMPRA') {
      stats.buyQty += operation.foreignAmount;
      stats.buyClp += operation.clpAmount;
      stats.buyCount += 1;
    } else {
      stats.sellQty += operation.foreignAmount;
      stats.sellClp += operation.clpAmount;
      stats.sellCount += 1;
    }
  }

  for (const stats of groups.values()) {
    stats.avgBuyRate = safeDivide(stats.buyClp, stats.buyQty);
    stats.avgSellRate = safeDivide(stats.sellClp, stats.sellQty);
    stats.spread = stats.avgSellRate - stats.avgBuyRate;
    stats.spreadPct = stats.avgBuyRate > 0 ? (stats.spread / stats.avgBuyRate) * 100 : 0;
  }

  return [...groups.values()].sort(
    (a, b) =>
      a.businessDate.localeCompare(b.businessDate) ||
      a.currency.localeCompare(b.currency) ||
      a.instrument.localeCompare(b.instrument),
  );
}

/** Consume capas FIFO en orden cronológico. No muta el arreglo original. */
export function consumeFifo(
  lots: FxFifoLot[],
  currency: string,
  quantity: number,
): FxFifoResult {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('La cantidad FIFO debe ser un número mayor a 0.');
  }

  const nextLots = lots.map((lot) => ({ ...lot }));
  const consumptions: FxFifoConsumption[] = [];
  let need = roundQty(quantity);
  let totalCostClp = 0;

  const ordered = nextLots
    .filter((lot) => lot.currency === currency && lot.remainingQty > 0)
    .sort((a, b) => a.acquiredAt.localeCompare(b.acquiredAt) || a.sequence - b.sequence);

  for (const lot of ordered) {
    if (need <= 0) break;
    const take = roundQty(Math.min(lot.remainingQty, need));
    if (take <= 0) continue;

    const totalCost = roundMoney(take * lot.unitCostClp);
    lot.remainingQty = roundQty(lot.remainingQty - take);
    need = roundQty(need - take);
    totalCostClp = roundMoney(totalCostClp + totalCost);

    consumptions.push({
      lotId: lot.id,
      quantity: take,
      unitCostClp: lot.unitCostClp,
      totalCostClp: totalCost,
    });
  }

  return {
    consumptions,
    lots: nextLots,
    totalCostClp,
    shortfall: roundQty(Math.max(0, need)),
  };
}

/** Agrega una compra como nueva capa FIFO. */
export function applyPurchase(
  lots: FxFifoLot[],
  purchase: FxPurchaseInput,
): { lots: FxFifoLot[]; lot: FxFifoLot } {
  if (!Number.isFinite(purchase.quantity) || purchase.quantity <= 0) {
    throw new Error('La cantidad de compra debe ser mayor a 0.');
  }
  if (!Number.isFinite(purchase.clpAmount) || purchase.clpAmount < 0) {
    throw new Error('El monto CLP de compra debe ser mayor o igual a 0.');
  }

  const maxSequence = lots.reduce((max, lot) => Math.max(max, lot.sequence), 0);
  const lot: FxFifoLot = {
    id: purchase.id ?? `lot-${purchase.currency}-${maxSequence + 1}`,
    currency: purchase.currency,
    acquiredAt: purchase.acquiredAt,
    sequence: purchase.sequence ?? maxSequence + 1,
    originalQty: roundQty(purchase.quantity),
    remainingQty: roundQty(purchase.quantity),
    unitCostClp: purchase.quantity > 0 ? purchase.clpAmount / purchase.quantity : 0,
  };

  return { lots: [...lots.map((item) => ({ ...item })), lot], lot };
}

/** Aplica una venta: consume FIFO, calcula costo y margen realizado. */
export function applySale(lots: FxFifoLot[], sale: FxSaleInput): FxSaleResult {
  const result = consumeFifo(lots, sale.currency, sale.quantity);
  return {
    ...result,
    marginClp: roundMoney(sale.clpAmount - result.totalCostClp),
  };
}

/** Saldos de cuentas corrientes por contraparte y divisa. */
export function computeAccountBalances(lines: FxAccountLine[]): FxAccountBalance[] {
  const groups = new Map<string, FxAccountBalance>();

  for (const line of lines) {
    const key = `${line.counterpartyId}|${line.currency}`;
    let balance = groups.get(key);
    if (!balance) {
      balance = {
        counterpartyId: line.counterpartyId,
        currency: line.currency,
        receivable: 0,
        payable: 0,
        net: 0,
      };
      groups.set(key, balance);
    }

    if (line.side === 'RECEIVABLE') {
      balance.receivable = roundQty(balance.receivable + line.amountDelta);
    } else {
      balance.payable = roundQty(balance.payable + line.amountDelta);
    }
  }

  for (const balance of groups.values()) {
    balance.net = roundQty(balance.receivable - balance.payable);
  }

  return [...groups.values()].sort(
    (a, b) =>
      a.counterpartyId.localeCompare(b.counterpartyId) ||
      a.currency.localeCompare(b.currency),
  );
}

/** Saldo esperado por divisa: apertura + movimientos. */
export function computeExpectedBalances(
  opening: Record<string, number>,
  movements: FxInventoryMovementLike[],
): Record<string, number> {
  const balances: Record<string, number> = {};

  for (const [currency, quantity] of Object.entries(opening)) {
    balances[currency] = roundQty(quantity);
  }

  for (const movement of movements) {
    balances[movement.currency] = roundQty(
      (balances[movement.currency] ?? 0) + movement.quantityDelta,
    );
  }

  return balances;
}

/** Total contado a partir de denominaciones. */
export function computeCashCount(counts: FxDenominationCount[]): number {
  return roundMoney(
    counts.reduce((total, item) => total + (Number(item.value) || 0) * (Number(item.quantity) || 0), 0),
  );
}

/** Diferencia de cuadratura: contado − esperado. */
export function computeCashDifference(expected: number, counted: number): number {
  return roundMoney(counted - expected);
}

/** Totales de cierre. */
export function computeCloseTotals(input: FxCloseInput): FxCloseTotals {
  return {
    totalCapitalClp: roundMoney(input.cashClp + input.inventoryValueClp),
    netResultClp: roundMoney(
      input.realizedMarginClp + input.fxResultClp - input.expensesClp,
    ),
  };
}

/**
 * Parsea una lista de folios ST escrita por el usuario.
 * Acepta comas, puntos y comas, espacios, saltos de línea y rangos `a-b`.
 */
export function parseStFolios(input: string): string[] {
  const tokens = input
    .replace(/\u00a0/g, ' ')
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const folios = new Set<string>();

  for (const token of tokens) {
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) continue;
      const from = Math.min(start, end);
      const to = Math.max(start, end);
      if (to - from > 10_000) continue;
      for (let folio = from; folio <= to; folio += 1) {
        if (folio > 0) folios.add(String(folio));
      }
      continue;
    }

    const normalized = normalizeFolio(token);
    if (/^\d+$/.test(normalized) && normalized !== '0') {
      folios.add(normalized);
    }
  }

  return [...folios].sort((a, b) => Number(a) - Number(b));
}

/** ¿El estado del documento suma en los cálculos? */
export function isCountableDocument(status: FxDocumentStatus): boolean {
  return status === 'VALID';
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQty(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
