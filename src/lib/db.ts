import { supabase } from './supabase';

export type Currency = {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  is_base: boolean;
  is_active: boolean;
  sort_order: number;
};

export type FxSession = {
  id: string;
  store_id: string;
  business_date: string;
  status: 'OPEN' | 'CLOSED' | 'REVIEW' | 'REOPENED';
  opening_mode: 'PREVIOUS_CLOSE' | 'MANUAL' | 'IMPORT';
  opened_at: string;
  closed_at: string | null;
};

export type OpeningRow = {
  currency_code: string;
  quantity: number;
  unit_cost_clp: number;
  clp_value: number;
};

export type OperationRow = {
  id: string;
  business_date: string;
  operation: 'COMPRA' | 'VENTA';
  currency_code: string;
  instrument: string;
  foreign_amount: number;
  fx_rate: number;
  clp_amount: number;
  line_no: number;
  document: {
    folio: string;
    document_type: string;
    status: string;
    cashier: string | null;
    is_wholesale: boolean;
  } | null;
};

export type Counterparty = {
  id: string;
  name: string;
  rut: string | null;
  kind: string;
  is_active: boolean;
};

export type AccountBalanceRow = {
  counterparty_id: string;
  currency_code: string;
  receivable: number;
  payable: number;
  net: number;
  counterparty_name?: string;
};

export type CashCountRow = {
  currency_code: string;
  denomination_value: number;
  quantity: number;
  total: number;
};

export type SessionSummaryRow = {
  currency_code: string;
  opening_qty: number;
  opening_clp: number;
  buy_qty: number;
  buy_clp: number;
  sell_qty: number;
  sell_clp: number;
  net_movement_qty: number;
  expected_qty: number;
  current_fifo_value_clp: number;
};

export type ClosureRow = {
  id: string;
  session_id: string;
  business_date: string;
  status: string;
  total_cash_clp: number;
  total_inventory_clp: number;
  total_capital_clp: number;
  realized_margin_clp: number;
  fx_result_clp: number;
  expenses_clp: number;
  net_result_clp: number;
  closed_at: string | null;
};

export type Denomination = {
  id: string;
  currency_code: string;
  value: number;
  kind: string;
  sort_order: number;
};

export type DailyStatRow = {
  business_date: string;
  currency_code: string;
  instrument: string;
  buy_qty: number;
  buy_clp: number;
  sell_qty: number;
  sell_clp: number;
  avg_buy_rate: number;
  avg_sell_rate: number;
  buy_count: number;
  sell_count: number;
};

export type WholesaleDealRow = {
  id: string;
  store_id: string;
  session_id: string;
  counterparty_id: string;
  counterparty_name?: string;
  deal_type: 'COMPRA' | 'VENTA';
  currency_code: string;
  agreed_qty: number;
  agreed_rate: number;
  agreed_clp: number;
  business_date: string;
  status: 'ABIERTO' | 'PARCIAL' | 'CERRADO' | 'ANULADO';
  notes: string | null;
  created_at: string;
  delivered_qty: number;
  paid_clp: number;
  pending_qty: number;
  pending_clp: number;
};

export type WholesaleSettlementRow = {
  id: string;
  deal_id: string;
  session_id: string;
  settlement_type: 'ENTREGA_DIVISA' | 'PAGO_CLP' | 'AJUSTE';
  currency_code: string;
  amount: number;
  fx_rate: number;
  clp_amount: number;
  business_date: string;
  note: string | null;
  created_at: string;
};

export type ExpenseRow = {
  id: string;
  business_date: string;
  concept: string;
  category: string;
  amount_clp: number;
  note: string | null;
  created_at: string;
};

export type StFolio = {
  id: string;
  document_type: string;
  folio: string;
  reason: string;
  status: 'ACTIVE' | 'REVERSED';
  registered_at: string;
  reversed_at: string | null;
};

export type ImportBatch = {
  id: string;
  file_name: string;
  status: string;
  rows_total: number;
  rows_valid: number;
  rows_void: number;
  rows_error: number;
  created_at: string;
};

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export async function ensureStore(): Promise<string> {
  const { data, error } = await supabase.rpc('fx_ensure_store', {
    p_name: 'Caja Temuco',
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function getStoreName(storeId: string): Promise<string> {
  const { data, error } = await supabase
    .from('stores')
    .select('name')
    .eq('id', storeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { name?: string } | null)?.name ?? 'Caja Temuco';
}

export async function ensureCurrency(input: {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc('fx_ensure_currency', {
    p_code: input.code,
    p_name: input.name,
    p_symbol: input.symbol,
    p_decimals: input.decimals,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function listCurrencies(): Promise<Currency[]> {
  const { data, error } = await supabase
    .from('fx_currencies')
    .select('code, name, symbol, decimals, is_base, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  return unwrap(data as Currency[] | null, error);
}

export async function ensureSession(
  storeId: string,
  businessDate: string,
): Promise<FxSession> {
  const { data, error } = await supabase.rpc('fx_ensure_session', {
    p_store_id: storeId,
    p_business_date: businessDate,
    p_opening_mode: 'MANUAL',
  });
  if (error) throw new Error(error.message);
  return data as FxSession;
}

export async function getSession(
  storeId: string,
  businessDate: string,
): Promise<FxSession | null> {
  const { data, error } = await supabase
    .from('fx_sessions')
    .select('*')
    .eq('store_id', storeId)
    .eq('business_date', businessDate)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as FxSession | null;
}

export async function listOpening(sessionId: string): Promise<OpeningRow[]> {
  const { data, error } = await supabase
    .from('fx_opening_balances')
    .select('currency_code, quantity, unit_cost_clp, clp_value')
    .eq('session_id', sessionId)
    .order('currency_code');
  return unwrap(data as OpeningRow[] | null, error);
}

export async function saveOpening(
  storeId: string,
  sessionId: string,
  rows: OpeningRow[],
): Promise<void> {
  const { error } = await supabase.rpc('fx_save_opening', {
    p_store_id: storeId,
    p_session_id: sessionId,
    p_balances: rows,
  });
  if (error) throw new Error(error.message);
}

export async function listOperations(sessionId: string): Promise<OperationRow[]> {
  const { data, error } = await supabase
    .from('fx_operations')
    .select(
      'id, business_date, operation, currency_code, instrument, foreign_amount, fx_rate, clp_amount, line_no, document:fx_documents!inner(folio, document_type, status, cashier, is_wholesale)',
    )
    .eq('session_id', sessionId)
    .order('business_date', { ascending: true })
    .order('line_no', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OperationRow[];
}

export async function listCounterparties(storeId: string): Promise<Counterparty[]> {
  const { data, error } = await supabase
    .from('fx_counterparties')
    .select('id, name, rut, kind, is_active')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .order('name');
  return unwrap(data as Counterparty[] | null, error);
}

export async function createCounterparty(
  storeId: string,
  name: string,
  kind: string,
): Promise<Counterparty> {
  const { data, error } = await supabase
    .from('fx_counterparties')
    .insert({ store_id: storeId, name, kind })
    .select('id, name, rut, kind, is_active')
    .single();
  if (error) throw new Error(error.message);
  return data as Counterparty;
}

export async function listAccountBalances(storeId: string): Promise<AccountBalanceRow[]> {
  const { data, error } = await supabase
    .from('fx_account_balances')
    .select('counterparty_id, currency_code, receivable, payable, net')
    .eq('store_id', storeId)
    .order('currency_code');
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as AccountBalanceRow[];
  if (rows.length === 0) return rows;

  const counterparties = await listCounterparties(storeId);
  const names = new Map(counterparties.map((item) => [item.id, item.name]));
  return rows.map((row) => ({
    ...row,
    counterparty_name: names.get(row.counterparty_id) ?? 'Sin nombre',
  }));
}

export async function registerAccountMovement(input: {
  storeId: string;
  sessionId: string;
  counterpartyId: string;
  movementType: string;
  businessDate: string;
  note: string;
  lines: Array<{
    currency_code: string;
    side: 'RECEIVABLE' | 'PAYABLE';
    amount_delta: number;
    fx_rate?: number;
    clp_equivalent?: number;
    inventory_delta?: number;
    unit_cost_clp?: number;
  }>;
}): Promise<string> {
  const { data, error } = await supabase.rpc('fx_register_account_movement', {
    p_store_id: input.storeId,
    p_session_id: input.sessionId,
    p_counterparty_id: input.counterpartyId,
    p_movement_type: input.movementType,
    p_business_date: input.businessDate,
    p_note: input.note,
    p_lines: input.lines,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function getSessionSummary(sessionId: string): Promise<SessionSummaryRow[]> {
  const { data, error } = await supabase
    .from('fx_session_currency_summary')
    .select(
      'currency_code, opening_qty, opening_clp, buy_qty, buy_clp, sell_qty, sell_clp, net_movement_qty, expected_qty, current_fifo_value_clp',
    )
    .eq('session_id', sessionId)
    .order('currency_code');
  return unwrap(data as SessionSummaryRow[] | null, error);
}

export async function listCashCounts(sessionId: string): Promise<CashCountRow[]> {
  const { data, error } = await supabase
    .from('fx_cash_counts')
    .select('currency_code, denomination_value, quantity, total')
    .eq('session_id', sessionId)
    .order('currency_code')
    .order('denomination_value', { ascending: false });
  return unwrap(data as CashCountRow[] | null, error);
}

export async function saveCashCounts(
  storeId: string,
  sessionId: string,
  counts: Array<{
    currency_code: string;
    denomination_value: number;
    quantity: number;
  }>,
): Promise<void> {
  const { error } = await supabase.rpc('fx_save_cash_counts', {
    p_store_id: storeId,
    p_session_id: sessionId,
    p_counts: counts,
  });
  if (error) throw new Error(error.message);
}

export async function closeSession(
  storeId: string,
  sessionId: string,
  notes: string,
): Promise<ClosureRow> {
  const { data, error } = await supabase.rpc('fx_close_session', {
    p_store_id: storeId,
    p_session_id: sessionId,
    p_notes: notes,
  });
  if (error) throw new Error(error.message);
  return data as ClosureRow;
}

export async function listClosures(storeId: string): Promise<ClosureRow[]> {
  const { data, error } = await supabase
    .from('fx_closures')
    .select(
      'id, session_id, business_date, status, total_cash_clp, total_inventory_clp, total_capital_clp, realized_margin_clp, fx_result_clp, expenses_clp, net_result_clp, closed_at',
    )
    .eq('store_id', storeId)
    .order('business_date', { ascending: false });
  return unwrap(data as ClosureRow[] | null, error);
}

export async function listStFolios(storeId: string): Promise<StFolio[]> {
  const { data, error } = await supabase
    .from('fx_st_folios')
    .select('id, document_type, folio, reason, status, registered_at, reversed_at')
    .eq('store_id', storeId)
    .order('registered_at', { ascending: false });
  return unwrap(data as StFolio[] | null, error);
}

export async function addStFolio(
  storeId: string,
  documentType: string,
  folio: string,
  note: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('fx_add_st_folio', {
    p_store_id: storeId,
    p_document_type: documentType,
    p_folio: folio,
    p_reason: 'ST',
    p_note: note,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function reverseStFolio(storeId: string, stId: string): Promise<void> {
  const { error } = await supabase.rpc('fx_reverse_st_folio', {
    p_store_id: storeId,
    p_st_id: stId,
  });
  if (error) throw new Error(error.message);
}

export async function createImportBatch(input: {
  storeId: string;
  sessionId: string;
  fileName: string;
  sheetName: string;
  rowsTotal: number;
}): Promise<string> {
  const { data, error } = await supabase
    .from('fx_import_batches')
    .insert({
      store_id: input.storeId,
      session_id: input.sessionId,
      file_name: input.fileName,
      sheet_name: input.sheetName,
      status: 'PREVIEW',
      rows_total: input.rowsTotal,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function commitImportBatch(
  storeId: string,
  sessionId: string,
  batchId: string,
  documents: unknown[],
): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('fx_import_batch', {
    p_store_id: storeId,
    p_session_id: sessionId,
    p_batch_id: batchId,
    p_documents: documents,
  });
  if (error) throw new Error(error.message);
  return data as Record<string, number>;
}

export async function listImportBatches(storeId: string): Promise<ImportBatch[]> {
  const { data, error } = await supabase
    .from('fx_import_batches')
    .select('id, file_name, status, rows_total, rows_valid, rows_void, rows_error, created_at')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(20);
  return unwrap(data as ImportBatch[] | null, error);
}

export async function getPreviousSummary(
  storeId: string,
  businessDate: string,
): Promise<SessionSummaryRow[]> {
  const { data: previous, error: previousError } = await supabase
    .from('fx_sessions')
    .select('id')
    .eq('store_id', storeId)
    .lt('business_date', businessDate)
    .order('business_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (previousError) throw new Error(previousError.message);
  if (!previous) return [];

  return getSessionSummary((previous as { id: string }).id);
}

export async function listDenominations(): Promise<Denomination[]> {
  const { data, error } = await supabase
    .from('fx_denominations')
    .select('id, currency_code, value, kind, sort_order')
    .order('currency_code')
    .order('value', { ascending: false });
  return unwrap(data as Denomination[] | null, error);
}

export async function getSessionMargin(sessionId: string): Promise<number> {
  const { data, error } = await supabase
    .from('fx_session_margin')
    .select('realized_margin_clp')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Number((data as { realized_margin_clp?: number } | null)?.realized_margin_clp ?? 0);
}

export async function listWholesaleDeals(storeId: string): Promise<WholesaleDealRow[]> {
  const { data, error } = await supabase
    .from('fx_wholesale_deals_status')
    .select(
      'id, store_id, session_id, counterparty_id, deal_type, currency_code, agreed_qty, agreed_rate, agreed_clp, business_date, status, notes, created_at, delivered_qty, paid_clp, pending_qty, pending_clp',
    )
    .eq('store_id', storeId)
    .order('business_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as WholesaleDealRow[];
  if (rows.length === 0) return rows;

  const counterparties = await listCounterparties(storeId);
  const names = new Map(counterparties.map((item) => [item.id, item.name]));
  return rows.map((row) => ({
    ...row,
    counterparty_name: names.get(row.counterparty_id) ?? 'Sin nombre',
  }));
}

export async function createWholesaleDeal(input: {
  storeId: string;
  sessionId: string;
  counterpartyId: string;
  dealType: 'COMPRA' | 'VENTA';
  currencyCode: string;
  agreedQty: number;
  agreedRate: number;
  businessDate: string;
  notes: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('fx_register_wholesale_deal', {
    p_store_id: input.storeId,
    p_session_id: input.sessionId,
    p_counterparty_id: input.counterpartyId,
    p_deal_type: input.dealType,
    p_currency_code: input.currencyCode,
    p_agreed_qty: input.agreedQty,
    p_agreed_rate: input.agreedRate,
    p_business_date: input.businessDate,
    p_notes: input.notes,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function registerWholesaleSettlement(input: {
  storeId: string;
  dealId: string;
  sessionId: string;
  settlementType: 'ENTREGA_DIVISA' | 'PAGO_CLP';
  amount: number;
  businessDate: string;
  note: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('fx_register_wholesale_settlement', {
    p_store_id: input.storeId,
    p_deal_id: input.dealId,
    p_session_id: input.sessionId,
    p_settlement_type: input.settlementType,
    p_amount: input.amount,
    p_business_date: input.businessDate,
    p_note: input.note,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function listWholesaleSettlements(
  dealId: string,
): Promise<WholesaleSettlementRow[]> {
  const { data, error } = await supabase
    .from('fx_wholesale_settlements')
    .select(
      'id, deal_id, session_id, settlement_type, currency_code, amount, fx_rate, clp_amount, business_date, note, created_at',
    )
    .eq('deal_id', dealId)
    .order('business_date', { ascending: true })
    .order('created_at', { ascending: true });
  return unwrap(data as WholesaleSettlementRow[] | null, error);
}

export async function listExpenses(sessionId: string): Promise<ExpenseRow[]> {
  const { data, error } = await supabase
    .from('fx_expenses')
    .select('id, business_date, concept, category, amount_clp, note, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false });
  return unwrap(data as ExpenseRow[] | null, error);
}

export async function listExpensesRange(
  storeId: string,
  fromDate: string,
  toDate: string,
): Promise<ExpenseRow[]> {
  const { data, error } = await supabase
    .from('fx_expenses')
    .select('id, business_date, concept, category, amount_clp, note, created_at')
    .eq('store_id', storeId)
    .gte('business_date', fromDate)
    .lte('business_date', toDate)
    .order('business_date', { ascending: false })
    .order('created_at', { ascending: false });
  return unwrap(data as ExpenseRow[] | null, error);
}

export async function registerExpense(input: {
  storeId: string;
  sessionId: string;
  businessDate: string;
  concept: string;
  category: string;
  amountClp: number;
  note: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('fx_register_expense', {
    p_store_id: input.storeId,
    p_session_id: input.sessionId,
    p_business_date: input.businessDate,
    p_concept: input.concept,
    p_category: input.category,
    p_amount_clp: input.amountClp,
    p_note: input.note,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function listDailyStats(
  storeId: string,
  fromDate: string,
  toDate: string,
): Promise<DailyStatRow[]> {
  const { data, error } = await supabase
    .from('fx_daily_currency_stats')
    .select(
      'business_date, currency_code, instrument, buy_qty, buy_clp, sell_qty, sell_clp, avg_buy_rate, avg_sell_rate, buy_count, sell_count',
    )
    .eq('store_id', storeId)
    .gte('business_date', fromDate)
    .lte('business_date', toDate)
    .order('business_date', { ascending: true })
    .order('currency_code', { ascending: true });
  return unwrap(data as DailyStatRow[] | null, error);
}
