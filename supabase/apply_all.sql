-- ===========================================================================
-- Caja Temuco - SQL consolidado para pegar en el SQL Editor de Supabase
-- Orden: esquema/vistas/RLS y luego funciones transaccionales.
-- ===========================================================================

-- ============================================================================
-- Caja Temuco Â· MÃ³dulo de casa de cambio/divisas
-- ============================================================================
-- MigraciÃ³n de referencia para el mÃ³dulo "Divisas".
--
-- IMPORTANTE:
--   * NO estÃ¡ aplicada en el Supabase remoto.
--   * Requiere las tablas public.stores y public.store_members y la funciÃ³n
--     public.is_store_member(uuid) del esquema maestro.
--   * EstÃ¡ diseÃ±ada para PostgreSQL 15+ / Supabase.
--   * Los importes CLP usan numeric(20,2); las cantidades, numeric(24,6);
--     los tipos de cambio, numeric(20,8).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 00. Base multi-tenant mÃ­nima
-- ----------------------------------------------------------------------------
-- Este proyecto es independiente de NEXO. Si la base ya tiene stores /
-- store_members, estas sentencias no las reemplazan.

CREATE TABLE IF NOT EXISTS public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  slug text,
  currency text NOT NULL DEFAULT 'CLP',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CLP';
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS stores_slug_unique_idx
  ON public.stores (lower(slug))
  WHERE nullif(btrim(slug), '') IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.store_members (
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, user_id)
);

CREATE OR REPLACE FUNCTION public.is_store_member(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.store_members
    WHERE store_id = p_store_id
      AND user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_store_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_store_member(uuid) TO authenticated;

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stores_member_read ON public.stores;
CREATE POLICY stores_member_read ON public.stores
  FOR SELECT TO authenticated USING (public.is_store_member(id));

DROP POLICY IF EXISTS store_members_read_self ON public.store_members;
CREATE POLICY store_members_read_self ON public.store_members
  FOR SELECT TO authenticated USING (user_id = auth.uid());

GRANT SELECT ON public.stores TO authenticated;
GRANT SELECT ON public.store_members TO authenticated;

-- ----------------------------------------------------------------------------
-- 01. ConfiguraciÃ³n: monedas, alias y denominaciones
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fx_currencies (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  name text NOT NULL,
  symbol text NOT NULL DEFAULT '',
  decimals smallint NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 6),
  is_base boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.fx_currencies (code, name, symbol, decimals, is_base, sort_order)
VALUES
  ('CLP', 'Peso chileno', '$', 0, true, 0),
  ('USD', 'DÃ³lar estadounidense', 'US$', 2, false, 10),
  ('ARS', 'Peso argentino', 'AR$', 2, false, 20),
  ('BRL', 'Real brasileÃ±o', 'R$', 2, false, 30),
  ('EUR', 'Euro', 'â‚¬', 2, false, 40),
  ('NZD', 'DÃ³lar neozelandÃ©s', 'NZ$', 2, false, 50),
  ('AUD', 'DÃ³lar australiano', 'A$', 2, false, 60),
  ('CAD', 'DÃ³lar canadiense', 'C$', 2, false, 70),
  ('COP', 'Peso colombiano', 'COL$', 2, false, 80),
  ('PEN', 'Sol peruano', 'S/', 2, false, 90),
  ('GBP', 'Libra esterlina', 'Â£', 2, false, 100),
  ('BOB', 'Boliviano', 'Bs', 2, false, 110),
  ('UYU', 'Peso uruguayo', '$U', 2, false, 120),
  ('MXN', 'Peso mexicano', 'MX$', 2, false, 130),
  ('CHF', 'Franco suizo', 'CHF', 2, false, 140),
  ('PYG', 'GuaranÃ­ paraguayo', 'â‚²', 0, false, 150)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.fx_currency_aliases (
  alias text PRIMARY KEY,
  currency_code text NOT NULL REFERENCES public.fx_currencies(code) ON DELETE CASCADE,
  instrument text NOT NULL DEFAULT 'EFECTIVO'
    CHECK (instrument IN ('EFECTIVO', 'TRANSFERENCIA', 'OTRO')),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.fx_currency_aliases (alias, currency_code, instrument)
VALUES
  ('DOLAR', 'USD', 'EFECTIVO'),
  ('DÃ“LAR', 'USD', 'EFECTIVO'),
  ('DOLAR USA', 'USD', 'EFECTIVO'),
  ('DÃ“LAR USA', 'USD', 'EFECTIVO'),
  ('USD', 'USD', 'EFECTIVO'),
  ('PESO ARGENTINO', 'ARS', 'EFECTIVO'),
  ('ARGENTINO', 'ARS', 'EFECTIVO'),
  ('ARS', 'ARS', 'EFECTIVO'),
  ('ARGENTINO T', 'ARS', 'TRANSFERENCIA'),
  ('REAL BRASIL', 'BRL', 'EFECTIVO'),
  ('REAL', 'BRL', 'EFECTIVO'),
  ('BRL', 'BRL', 'EFECTIVO'),
  ('EURO', 'EUR', 'EFECTIVO'),
  ('EUROS', 'EUR', 'EFECTIVO'),
  ('EUR', 'EUR', 'EFECTIVO'),
  ('DOLAR AUSTRALIANO', 'AUD', 'EFECTIVO'),
  ('DÃ“LAR AUSTRALIANO', 'AUD', 'EFECTIVO'),
  ('AUD', 'AUD', 'EFECTIVO'),
  ('DOLAR NEOZELANDES', 'NZD', 'EFECTIVO'),
  ('DÃ“LAR NEOZELANDÃ‰S', 'NZD', 'EFECTIVO'),
  ('NZD', 'NZD', 'EFECTIVO'),
  ('DOLAR CANADIENSE', 'CAD', 'EFECTIVO'),
  ('DÃ“LAR CANADIENSE', 'CAD', 'EFECTIVO'),
  ('CAD', 'CAD', 'EFECTIVO'),
  ('PESO COLOMBIANO', 'COP', 'EFECTIVO'),
  ('COP', 'COP', 'EFECTIVO'),
  ('SOL PERUANO', 'PEN', 'EFECTIVO'),
  ('PEN', 'PEN', 'EFECTIVO'),
  ('LIBRA ESTERLINA', 'GBP', 'EFECTIVO'),
  ('GBP', 'GBP', 'EFECTIVO'),
  ('BOLIVIANO', 'BOB', 'EFECTIVO'),
  ('BOB', 'BOB', 'EFECTIVO'),
  ('PESO URUGUAYO', 'UYU', 'EFECTIVO'),
  ('UYU', 'UYU', 'EFECTIVO'),
  ('PESO MEXICANO', 'MXN', 'EFECTIVO'),
  ('MXN', 'MXN', 'EFECTIVO'),
  ('FRANCO SUIZO', 'CHF', 'EFECTIVO'),
  ('CHF', 'CHF', 'EFECTIVO'),
  ('GUARANI', 'PYG', 'EFECTIVO'),
  ('GUARANÃ', 'PYG', 'EFECTIVO'),
  ('PYG', 'PYG', 'EFECTIVO')
ON CONFLICT (alias) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.fx_denominations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currency_code text NOT NULL REFERENCES public.fx_currencies(code) ON DELETE CASCADE,
  value numeric(20,4) NOT NULL CHECK (value > 0),
  kind text NOT NULL DEFAULT 'BILLETE' CHECK (kind IN ('BILLETE', 'MONEDA')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (currency_code, value, kind)
);

-- Denominaciones base. Son editables desde ConfiguraciÃ³n; se siembran las mÃ¡s
-- usadas para que la cuadratura funcione desde el primer dÃ­a.
INSERT INTO public.fx_denominations (currency_code, value, kind, sort_order)
VALUES
  ('CLP', 20000, 'BILLETE', 10), ('CLP', 10000, 'BILLETE', 20),
  ('CLP', 5000, 'BILLETE', 30), ('CLP', 2000, 'BILLETE', 40),
  ('CLP', 1000, 'BILLETE', 50), ('CLP', 500, 'MONEDA', 60),
  ('CLP', 100, 'MONEDA', 70), ('CLP', 50, 'MONEDA', 80),
  ('CLP', 10, 'MONEDA', 90),
  ('USD', 100, 'BILLETE', 10), ('USD', 50, 'BILLETE', 20),
  ('USD', 20, 'BILLETE', 30), ('USD', 10, 'BILLETE', 40),
  ('USD', 5, 'BILLETE', 50), ('USD', 2, 'BILLETE', 60),
  ('USD', 1, 'BILLETE', 70),
  ('ARS', 20000, 'BILLETE', 10), ('ARS', 10000, 'BILLETE', 20),
  ('ARS', 2000, 'BILLETE', 30), ('ARS', 1000, 'BILLETE', 40),
  ('ARS', 500, 'BILLETE', 50), ('ARS', 200, 'BILLETE', 60),
  ('ARS', 100, 'BILLETE', 70), ('ARS', 50, 'BILLETE', 80),
  ('ARS', 20, 'BILLETE', 90), ('ARS', 10, 'BILLETE', 100),
  ('BRL', 200, 'BILLETE', 10), ('BRL', 100, 'BILLETE', 20),
  ('BRL', 50, 'BILLETE', 30), ('BRL', 20, 'BILLETE', 40),
  ('BRL', 10, 'BILLETE', 50), ('BRL', 5, 'BILLETE', 60),
  ('BRL', 2, 'BILLETE', 70),
  ('EUR', 500, 'BILLETE', 10), ('EUR', 200, 'BILLETE', 20),
  ('EUR', 100, 'BILLETE', 30), ('EUR', 50, 'BILLETE', 40),
  ('EUR', 20, 'BILLETE', 50), ('EUR', 10, 'BILLETE', 60),
  ('EUR', 5, 'BILLETE', 70),
  ('NZD', 100, 'BILLETE', 10), ('NZD', 50, 'BILLETE', 20),
  ('NZD', 20, 'BILLETE', 30), ('NZD', 10, 'BILLETE', 40),
  ('NZD', 5, 'BILLETE', 50),
  ('AUD', 100, 'BILLETE', 10), ('AUD', 50, 'BILLETE', 20),
  ('AUD', 20, 'BILLETE', 30), ('AUD', 10, 'BILLETE', 40),
  ('AUD', 5, 'BILLETE', 50),
  ('CAD', 100, 'BILLETE', 10), ('CAD', 50, 'BILLETE', 20),
  ('CAD', 20, 'BILLETE', 30), ('CAD', 10, 'BILLETE', 40),
  ('CAD', 5, 'BILLETE', 50),
  ('COP', 100000, 'BILLETE', 10), ('COP', 50000, 'BILLETE', 20),
  ('COP', 20000, 'BILLETE', 30), ('COP', 10000, 'BILLETE', 40),
  ('COP', 5000, 'BILLETE', 50), ('COP', 2000, 'BILLETE', 60),
  ('COP', 1000, 'BILLETE', 70),
  ('PEN', 200, 'BILLETE', 10), ('PEN', 100, 'BILLETE', 20),
  ('PEN', 50, 'BILLETE', 30), ('PEN', 20, 'BILLETE', 40),
  ('PEN', 10, 'BILLETE', 50),
  ('GBP', 50, 'BILLETE', 10), ('GBP', 20, 'BILLETE', 20),
  ('GBP', 10, 'BILLETE', 30), ('GBP', 5, 'BILLETE', 40),
  ('BOB', 200, 'BILLETE', 10), ('BOB', 100, 'BILLETE', 20),
  ('BOB', 50, 'BILLETE', 30), ('BOB', 20, 'BILLETE', 40),
  ('BOB', 10, 'BILLETE', 50),
  ('UYU', 2000, 'BILLETE', 10), ('UYU', 1000, 'BILLETE', 20),
  ('UYU', 500, 'BILLETE', 30), ('UYU', 200, 'BILLETE', 40),
  ('UYU', 100, 'BILLETE', 50), ('UYU', 50, 'BILLETE', 60),
  ('MXN', 1000, 'BILLETE', 10), ('MXN', 500, 'BILLETE', 20),
  ('MXN', 200, 'BILLETE', 30), ('MXN', 100, 'BILLETE', 40),
  ('MXN', 50, 'BILLETE', 50), ('MXN', 20, 'BILLETE', 60),
  ('CHF', 1000, 'BILLETE', 10), ('CHF', 200, 'BILLETE', 20),
  ('CHF', 100, 'BILLETE', 30), ('CHF', 50, 'BILLETE', 40),
  ('CHF', 20, 'BILLETE', 50), ('CHF', 10, 'BILLETE', 60),
  ('PYG', 100000, 'BILLETE', 10), ('PYG', 50000, 'BILLETE', 20),
  ('PYG', 20000, 'BILLETE', 30), ('PYG', 10000, 'BILLETE', 40),
  ('PYG', 5000, 'BILLETE', 50), ('PYG', 2000, 'BILLETE', 60),
  ('PYG', 1000, 'BILLETE', 70)
ON CONFLICT (currency_code, value, kind) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.fx_cashiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, name)
);

-- ----------------------------------------------------------------------------
-- 02. Sesiones y apertura
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fx_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'CLOSED', 'REVIEW', 'REOPENED')),
  opening_mode text NOT NULL DEFAULT 'MANUAL'
    CHECK (opening_mode IN ('PREVIOUS_CLOSE', 'MANUAL', 'IMPORT')),
  previous_session_id uuid REFERENCES public.fx_sessions(id) ON DELETE SET NULL,
  opened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  notes text,
  UNIQUE (store_id, business_date),
  CHECK ((status IN ('CLOSED') AND closed_at IS NOT NULL) OR status <> 'CLOSED')
);

CREATE INDEX IF NOT EXISTS fx_sessions_store_date_idx
  ON public.fx_sessions (store_id, business_date DESC);

CREATE TABLE IF NOT EXISTS public.fx_opening_balances (
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.fx_sessions(id) ON DELETE CASCADE,
  currency_code text NOT NULL REFERENCES public.fx_currencies(code) ON DELETE RESTRICT,
  quantity numeric(24,6) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_cost_clp numeric(20,8) NOT NULL DEFAULT 0 CHECK (unit_cost_clp >= 0),
  clp_value numeric(20,2) NOT NULL DEFAULT 0 CHECK (clp_value >= 0),
  source text NOT NULL DEFAULT 'MANUAL'
    CHECK (source IN ('PREVIOUS_CLOSE', 'MANUAL', 'INITIAL_IMPORT')),
  note text,
  PRIMARY KEY (session_id, currency_code)
);

-- ----------------------------------------------------------------------------
-- 03. ImportaciÃ³n de reportes
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fx_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.fx_sessions(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  file_hash text,
  sheet_name text,
  status text NOT NULL DEFAULT 'PREVIEW'
    CHECK (status IN ('PREVIEW', 'COMMITTED', 'FAILED', 'REVERSED')),
  rows_total integer NOT NULL DEFAULT 0 CHECK (rows_total >= 0),
  rows_valid integer NOT NULL DEFAULT 0 CHECK (rows_valid >= 0),
  rows_void integer NOT NULL DEFAULT 0 CHECK (rows_void >= 0),
  rows_error integer NOT NULL DEFAULT 0 CHECK (rows_error >= 0),
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz
);

CREATE INDEX IF NOT EXISTS fx_import_batches_store_created_idx
  ON public.fx_import_batches (store_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.fx_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.fx_import_batches(id) ON DELETE CASCADE,
  row_number integer NOT NULL CHECK (row_number > 0),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'VALID'
    CHECK (status IN ('VALID', 'VOID_ST', 'ERROR', 'DUPLICATE', 'SKIPPED')),
  error text,
  document_id uuid,
  operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS fx_import_rows_batch_idx
  ON public.fx_import_rows (batch_id, status);

-- ----------------------------------------------------------------------------
-- 04. Documentos y operaciones
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fx_counterparties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  rut text,
  kind text NOT NULL DEFAULT 'TERCERO'
    CHECK (kind IN ('CLIENTE', 'PROVEEDOR', 'TERCERO', 'EMPRESA')),
  phone text,
  email text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fx_counterparties_store_name_idx
  ON public.fx_counterparties (store_id, lower(name));

CREATE TABLE IF NOT EXISTS public.fx_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.fx_sessions(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  operation text NOT NULL CHECK (operation IN ('COMPRA', 'VENTA', 'TRASLADO', 'AJUSTE')),
  document_type text NOT NULL DEFAULT 'BOLETA'
    CHECK (document_type IN ('BOLETA', 'FACTURA', 'TICKET', 'OTRO')),
  folio text NOT NULL DEFAULT '',
  cashier text,
  counterparty_id uuid REFERENCES public.fx_counterparties(id) ON DELETE SET NULL,
  is_wholesale boolean NOT NULL DEFAULT false,
  ticket_code text,
  status text NOT NULL DEFAULT 'VALID'
    CHECK (status IN ('VALID', 'VOID_ST', 'VOID_NC', 'VOID_OTHER', 'REVIEW')),
  void_reason text,
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  import_batch_id uuid REFERENCES public.fx_import_batches(id) ON DELETE SET NULL,
  source_row_first integer,
  source_row_last integer,
  missing_folio boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (missing_folio = false OR btrim(folio) = '' OR folio = '0')
);

CREATE INDEX IF NOT EXISTS fx_documents_store_date_idx
  ON public.fx_documents (store_id, business_date, status);

CREATE UNIQUE INDEX IF NOT EXISTS fx_documents_folio_unique_idx
  ON public.fx_documents (store_id, document_type, folio)
  WHERE btrim(folio) <> '' AND folio <> '0';

CREATE INDEX IF NOT EXISTS fx_documents_folio_lookup_idx
  ON public.fx_documents (store_id, document_type, folio);

CREATE TABLE IF NOT EXISTS public.fx_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.fx_documents(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.fx_sessions(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  operation text NOT NULL CHECK (operation IN ('COMPRA', 'VENTA')),
  currency_code text NOT NULL REFERENCES public.fx_currencies(code) ON DELETE RESTRICT,
  instrument text NOT NULL DEFAULT 'EFECTIVO'
    CHECK (instrument IN ('EFECTIVO', 'TRANSFERENCIA', 'OTRO')),
  foreign_amount numeric(24,6) NOT NULL CHECK (foreign_amount > 0),
  fx_rate numeric(20,8) NOT NULL CHECK (fx_rate > 0),
  clp_amount numeric(20,2) NOT NULL CHECK (clp_amount >= 0),
  line_no integer NOT NULL DEFAULT 1 CHECK (line_no > 0),
  source_row integer,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, line_no)
);

CREATE INDEX IF NOT EXISTS fx_operations_store_date_currency_idx
  ON public.fx_operations (store_id, business_date, currency_code, operation);

CREATE INDEX IF NOT EXISTS fx_operations_session_idx
  ON public.fx_operations (session_id);

-- ----------------------------------------------------------------------------
-- 05. Boletas ST
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fx_st_folios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  document_type text NOT NULL DEFAULT 'BOLETA'
    CHECK (document_type IN ('BOLETA', 'FACTURA', 'TICKET', 'OTRO')),
  folio text NOT NULL CHECK (btrim(folio) <> '' AND folio <> '0'),
  reason text NOT NULL DEFAULT 'ST',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVERSED')),
  registered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  reversed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reversed_at timestamptz,
  note text,
  CHECK ((status = 'REVERSED' AND reversed_at IS NOT NULL) OR status = 'ACTIVE')
);

CREATE UNIQUE INDEX IF NOT EXISTS fx_st_folios_active_unique_idx
  ON public.fx_st_folios (store_id, document_type, folio)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS fx_st_folios_store_status_idx
  ON public.fx_st_folios (store_id, status, folio);

-- ----------------------------------------------------------------------------
-- 06. FIFO e inventario
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fx_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  currency_code text NOT NULL REFERENCES public.fx_currencies(code) ON DELETE RESTRICT,
  session_id uuid REFERENCES public.fx_sessions(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'OPENING'
    CHECK (source_type IN ('OPENING', 'PURCHASE', 'LOAN_IN', 'TRANSFER_IN', 'REPAYMENT_IN', 'ADJUSTMENT')),
  source_operation_id uuid REFERENCES public.fx_operations(id) ON DELETE SET NULL,
  source_account_movement_id uuid,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  lot_seq bigint GENERATED ALWAYS AS IDENTITY,
  original_qty numeric(24,6) NOT NULL CHECK (original_qty > 0),
  remaining_qty numeric(24,6) NOT NULL CHECK (remaining_qty >= 0),
  unit_cost_clp numeric(20,8) NOT NULL CHECK (unit_cost_clp >= 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (remaining_qty <= original_qty)
);

CREATE INDEX IF NOT EXISTS fx_lots_fifo_idx
  ON public.fx_lots (store_id, currency_code, acquired_at, lot_seq)
  WHERE remaining_qty > 0;

CREATE INDEX IF NOT EXISTS fx_lots_operation_idx
  ON public.fx_lots (source_operation_id);

CREATE TABLE IF NOT EXISTS public.fx_lot_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  lot_id uuid NOT NULL REFERENCES public.fx_lots(id) ON DELETE RESTRICT,
  operation_id uuid REFERENCES public.fx_operations(id) ON DELETE CASCADE,
  account_movement_id uuid,
  quantity numeric(24,6) NOT NULL CHECK (quantity > 0),
  unit_cost_clp numeric(20,8) NOT NULL CHECK (unit_cost_clp >= 0),
  total_cost_clp numeric(20,2) NOT NULL CHECK (total_cost_clp >= 0),
  consumed_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fx_lot_consumptions_operation_idx
  ON public.fx_lot_consumptions (operation_id);

CREATE INDEX IF NOT EXISTS fx_lot_consumptions_lot_idx
  ON public.fx_lot_consumptions (lot_id);

CREATE TABLE IF NOT EXISTS public.fx_inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.fx_sessions(id) ON DELETE CASCADE,
  currency_code text NOT NULL REFERENCES public.fx_currencies(code) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN (
    'OPENING', 'PURCHASE', 'SALE', 'LOAN_OUT', 'LOAN_IN',
    'REPAYMENT_IN', 'REPAYMENT_OUT', 'TRANSFER_IN', 'TRANSFER_OUT',
    'ADJUSTMENT', 'COUNT_ADJUSTMENT', 'EXPENSE'
  )),
  quantity_delta numeric(24,6) NOT NULL CHECK (quantity_delta <> 0),
  unit_cost_clp numeric(20,8),
  clp_delta numeric(20,2) NOT NULL DEFAULT 0,
  reference_type text,
  reference_id uuid,
  business_date date NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fx_inventory_movements_session_idx
  ON public.fx_inventory_movements (session_id, currency_code);

CREATE INDEX IF NOT EXISTS fx_inventory_movements_store_date_idx
  ON public.fx_inventory_movements (store_id, business_date, currency_code);

-- ----------------------------------------------------------------------------
-- 07. Cuentas corrientes
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fx_account_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.fx_sessions(id) ON DELETE CASCADE,
  counterparty_id uuid NOT NULL REFERENCES public.fx_counterparties(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN (
    'PRESTAMO_OTORGADO', 'PRESTAMO_RECIBIDO', 'COBRO_DEUDA',
    'PAGO_DEUDA', 'ENTREGA', 'RETIRO', 'VENTA_CREDITO',
    'COMPRA_CREDITO', 'AJUSTE'
  )),
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVERSED')),
  reverses_id uuid REFERENCES public.fx_account_movements(id) ON DELETE SET NULL,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fx_account_movements_store_date_idx
  ON public.fx_account_movements (store_id, business_date DESC);

CREATE INDEX IF NOT EXISTS fx_account_movements_counterparty_idx
  ON public.fx_account_movements (counterparty_id, business_date DESC);

CREATE TABLE IF NOT EXISTS public.fx_account_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  movement_id uuid NOT NULL REFERENCES public.fx_account_movements(id) ON DELETE CASCADE,
  currency_code text NOT NULL REFERENCES public.fx_currencies(code) ON DELETE RESTRICT,
  side text NOT NULL CHECK (side IN ('RECEIVABLE', 'PAYABLE')),
  amount_delta numeric(24,6) NOT NULL CHECK (amount_delta <> 0),
  fx_rate numeric(20,8) CHECK (fx_rate IS NULL OR fx_rate > 0),
  clp_equivalent numeric(20,2) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fx_account_lines_balance_idx
  ON public.fx_account_lines (store_id, currency_code, side);

CREATE INDEX IF NOT EXISTS fx_account_lines_movement_idx
  ON public.fx_account_lines (movement_id);

-- Relaciones diferidas: los movimientos de cuenta corriente pueden originar
-- capas FIFO (prÃ©stamo recibido) o consumos (prÃ©stamo otorgado).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fx_lots_source_account_movement_fk'
  ) THEN
    ALTER TABLE public.fx_lots
      ADD CONSTRAINT fx_lots_source_account_movement_fk
      FOREIGN KEY (source_account_movement_id)
      REFERENCES public.fx_account_movements(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fx_lot_consumptions_account_movement_fk'
  ) THEN
    ALTER TABLE public.fx_lot_consumptions
      ADD CONSTRAINT fx_lot_consumptions_account_movement_fk
      FOREIGN KEY (account_movement_id)
      REFERENCES public.fx_account_movements(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 08. Conteo fÃ­sico, cierre y gastos
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fx_cash_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.fx_sessions(id) ON DELETE CASCADE,
  currency_code text NOT NULL REFERENCES public.fx_currencies(code) ON DELETE RESTRICT,
  denomination_id uuid REFERENCES public.fx_denominations(id) ON DELETE SET NULL,
  denomination_value numeric(20,4) NOT NULL CHECK (denomination_value > 0),
  quantity numeric(24,6) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  total numeric(20,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  counted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fx_cash_counts_session_idx
  ON public.fx_cash_counts (session_id, currency_code);

CREATE TABLE IF NOT EXISTS public.fx_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  session_id uuid NOT NULL UNIQUE REFERENCES public.fx_sessions(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CLOSED', 'REOPENED')),
  total_cash_clp numeric(20,2) NOT NULL DEFAULT 0,
  total_inventory_clp numeric(20,2) NOT NULL DEFAULT 0,
  total_capital_clp numeric(20,2) NOT NULL DEFAULT 0,
  realized_margin_clp numeric(20,2) NOT NULL DEFAULT 0,
  fx_result_clp numeric(20,2) NOT NULL DEFAULT 0,
  expenses_clp numeric(20,2) NOT NULL DEFAULT 0,
  net_result_clp numeric(20,2) NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fx_closures_store_date_idx
  ON public.fx_closures (store_id, business_date DESC);

CREATE TABLE IF NOT EXISTS public.fx_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.fx_sessions(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  concept text NOT NULL CHECK (length(btrim(concept)) BETWEEN 1 AND 240),
  category text NOT NULL DEFAULT 'OTROS',
  amount_clp numeric(20,2) NOT NULL CHECK (amount_clp >= 0),
  currency_code text NOT NULL DEFAULT 'CLP' REFERENCES public.fx_currencies(code) ON DELETE RESTRICT,
  amount_currency numeric(24,6) NOT NULL DEFAULT 0 CHECK (amount_currency >= 0),
  fx_rate numeric(20,8) CHECK (fx_rate IS NULL OR fx_rate > 0),
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fx_expenses_session_idx
  ON public.fx_expenses (session_id, business_date);

-- ----------------------------------------------------------------------------
-- 09. Vistas de cÃ¡lculo
-- ----------------------------------------------------------------------------

-- Ãšnica fuente vÃ¡lida para compras/ventas: excluye cualquier documento anulado.
CREATE OR REPLACE VIEW public.fx_valid_operations AS
SELECT
  o.id,
  o.store_id,
  o.document_id,
  o.session_id,
  o.business_date,
  o.operation,
  o.currency_code,
  o.instrument,
  o.foreign_amount,
  o.fx_rate,
  o.clp_amount,
  o.line_no,
  o.source_row,
  d.document_type,
  d.folio,
  d.cashier,
  d.counterparty_id,
  d.is_wholesale,
  d.ticket_code,
  d.status AS document_status
FROM public.fx_operations o
JOIN public.fx_documents d ON d.id = o.document_id
WHERE d.status = 'VALID';

CREATE OR REPLACE VIEW public.fx_daily_currency_stats AS
SELECT
  store_id,
  business_date,
  currency_code,
  instrument,
  SUM(CASE WHEN operation = 'COMPRA' THEN foreign_amount ELSE 0 END) AS buy_qty,
  SUM(CASE WHEN operation = 'COMPRA' THEN clp_amount ELSE 0 END) AS buy_clp,
  SUM(CASE WHEN operation = 'VENTA' THEN foreign_amount ELSE 0 END) AS sell_qty,
  SUM(CASE WHEN operation = 'VENTA' THEN clp_amount ELSE 0 END) AS sell_clp,
  CASE
    WHEN SUM(CASE WHEN operation = 'COMPRA' THEN foreign_amount ELSE 0 END) > 0
    THEN SUM(CASE WHEN operation = 'COMPRA' THEN clp_amount ELSE 0 END)
         / SUM(CASE WHEN operation = 'COMPRA' THEN foreign_amount ELSE 0 END)
    ELSE 0
  END AS avg_buy_rate,
  CASE
    WHEN SUM(CASE WHEN operation = 'VENTA' THEN foreign_amount ELSE 0 END) > 0
    THEN SUM(CASE WHEN operation = 'VENTA' THEN clp_amount ELSE 0 END)
         / SUM(CASE WHEN operation = 'VENTA' THEN foreign_amount ELSE 0 END)
    ELSE 0
  END AS avg_sell_rate,
  SUM(CASE WHEN operation = 'COMPRA' THEN 1 ELSE 0 END) AS buy_count,
  SUM(CASE WHEN operation = 'VENTA' THEN 1 ELSE 0 END) AS sell_count
FROM public.fx_valid_operations
GROUP BY store_id, business_date, currency_code, instrument;

-- Saldo esperado por sesiÃ³n: apertura + movimientos de esa sesiÃ³n.
-- No sumar movimientos de todas las sesiones: cada apertura ya reinicia el dÃ­a.
CREATE OR REPLACE VIEW public.fx_session_inventory_balance AS
SELECT
  s.id AS session_id,
  s.store_id,
  s.business_date,
  c.code AS currency_code,
  COALESCE(o.quantity, 0) + COALESCE(m.quantity_delta, 0) AS quantity
FROM public.fx_sessions s
CROSS JOIN public.fx_currencies c
LEFT JOIN public.fx_opening_balances o
  ON o.session_id = s.id AND o.currency_code = c.code
LEFT JOIN (
  SELECT session_id, currency_code, SUM(quantity_delta) AS quantity_delta
  FROM public.fx_inventory_movements
  GROUP BY session_id, currency_code
) m ON m.session_id = s.id AND m.currency_code = c.code
WHERE c.is_active;

-- ValorizaciÃ³n FIFO actual de las divisas (sin CLP; el CLP se toma del saldo
-- esperado de la sesiÃ³n). Las capas persisten entre sesiones.
CREATE OR REPLACE VIEW public.fx_inventory_valuation AS
SELECT
  store_id,
  currency_code,
  SUM(remaining_qty) AS quantity,
  SUM(remaining_qty * unit_cost_clp) AS value_clp
FROM public.fx_lots
WHERE remaining_qty > 0
GROUP BY store_id, currency_code;

CREATE OR REPLACE VIEW public.fx_session_margin AS
SELECT
  o.store_id,
  o.session_id,
  SUM(o.clp_amount - COALESCE(c.cost, 0)) AS realized_margin_clp
FROM public.fx_valid_operations o
LEFT JOIN (
  SELECT operation_id, SUM(total_cost_clp) AS cost
  FROM public.fx_lot_consumptions
  WHERE reversed_at IS NULL
  GROUP BY operation_id
) c ON c.operation_id = o.id
WHERE o.operation = 'VENTA'
GROUP BY o.store_id, o.session_id;

CREATE OR REPLACE VIEW public.fx_account_balances AS
SELECT
  l.store_id,
  m.counterparty_id,
  l.currency_code,
  SUM(CASE WHEN l.side = 'RECEIVABLE' THEN l.amount_delta ELSE 0 END) AS receivable,
  SUM(CASE WHEN l.side = 'PAYABLE' THEN l.amount_delta ELSE 0 END) AS payable,
  SUM(CASE WHEN l.side = 'RECEIVABLE' THEN l.amount_delta ELSE -l.amount_delta END) AS net
FROM public.fx_account_lines l
JOIN public.fx_account_movements m ON m.id = l.movement_id
WHERE m.status = 'ACTIVE'
GROUP BY l.store_id, m.counterparty_id, l.currency_code;

CREATE OR REPLACE VIEW public.fx_session_currency_summary AS
SELECT
  s.id AS session_id,
  s.store_id,
  s.business_date,
  c.code AS currency_code,
  COALESCE(o.quantity, 0) AS opening_qty,
  COALESCE(o.clp_value, 0) AS opening_clp,
  COALESCE(p.buy_qty, 0) AS buy_qty,
  COALESCE(p.buy_clp, 0) AS buy_clp,
  COALESCE(p.sell_qty, 0) AS sell_qty,
  COALESCE(p.sell_clp, 0) AS sell_clp,
  COALESCE(m.quantity_delta, 0) AS net_movement_qty,
  COALESCE(o.quantity, 0) + COALESCE(m.quantity_delta, 0) AS expected_qty,
  COALESCE(v.value_clp, 0) AS current_fifo_value_clp
FROM public.fx_sessions s
CROSS JOIN public.fx_currencies c
LEFT JOIN public.fx_opening_balances o
  ON o.session_id = s.id AND o.currency_code = c.code
LEFT JOIN (
  SELECT
    session_id,
    currency_code,
    SUM(CASE WHEN operation = 'COMPRA' THEN foreign_amount ELSE 0 END) AS buy_qty,
    SUM(CASE WHEN operation = 'COMPRA' THEN clp_amount ELSE 0 END) AS buy_clp,
    SUM(CASE WHEN operation = 'VENTA' THEN foreign_amount ELSE 0 END) AS sell_qty,
    SUM(CASE WHEN operation = 'VENTA' THEN clp_amount ELSE 0 END) AS sell_clp
  FROM public.fx_valid_operations
  GROUP BY session_id, currency_code
) p ON p.session_id = s.id AND p.currency_code = c.code
LEFT JOIN (
  SELECT session_id, currency_code, SUM(quantity_delta) AS quantity_delta
  FROM public.fx_inventory_movements
  GROUP BY session_id, currency_code
) m ON m.session_id = s.id AND m.currency_code = c.code
LEFT JOIN (
  SELECT store_id, currency_code, SUM(remaining_qty * unit_cost_clp) AS value_clp
  FROM public.fx_lots
  WHERE remaining_qty > 0
  GROUP BY store_id, currency_code
) v ON v.store_id = s.store_id AND v.currency_code = c.code
WHERE c.is_active;

-- ----------------------------------------------------------------------------
-- 10. FunciÃ³n FIFO
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_consume_fifo(
  p_store_id uuid,
  p_currency_code text,
  p_quantity numeric,
  p_operation_id uuid DEFAULT NULL,
  p_account_movement_id uuid DEFAULT NULL,
  p_consumed_at timestamptz DEFAULT now()
)
RETURNS TABLE (
  lot_id uuid,
  quantity numeric,
  unit_cost_clp numeric,
  total_cost_clp numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_need numeric := p_quantity;
  v_lot record;
  v_take numeric;
  v_lot_id uuid;
  v_unit_cost numeric;
  v_total_cost numeric;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Usuario sin acceso a esta tienda';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad FIFO debe ser mayor a 0';
  END IF;

  FOR v_lot IN
    SELECT l.id, l.remaining_qty, l.unit_cost_clp
    FROM public.fx_lots l
    WHERE l.store_id = p_store_id
      AND l.currency_code = p_currency_code
      AND l.remaining_qty > 0
    ORDER BY l.acquired_at ASC, l.lot_seq ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_need <= 0;

    v_take := LEAST(v_lot.remaining_qty, v_need);
    v_lot_id := v_lot.id;
    v_unit_cost := v_lot.unit_cost_clp;
    v_total_cost := ROUND(v_take * v_unit_cost, 2);

    UPDATE public.fx_lots
    SET remaining_qty = remaining_qty - v_take
    WHERE id = v_lot_id;

    INSERT INTO public.fx_lot_consumptions (
      store_id, lot_id, operation_id, account_movement_id,
      quantity, unit_cost_clp, total_cost_clp, consumed_at
    ) VALUES (
      p_store_id, v_lot_id, p_operation_id, p_account_movement_id,
      v_take, v_unit_cost, v_total_cost, p_consumed_at
    );

    lot_id := v_lot_id;
    quantity := v_take;
    unit_cost_clp := v_unit_cost;
    total_cost_clp := v_total_cost;
    RETURN NEXT;

    v_need := v_need - v_take;
  END LOOP;

  IF v_need > 0 THEN
    RAISE EXCEPTION 'Inventario FIFO insuficiente para %: faltan % unidades',
      p_currency_code, v_need;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_consume_fifo(uuid, text, numeric, uuid, uuid, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_consume_fifo(uuid, text, numeric, uuid, uuid, timestamptz)
  TO authenticated;

-- Restaura las capas consumidas por una venta anulada. No borra el historial:
-- marca el consumo como reversado y devuelve la cantidad al lote.
CREATE OR REPLACE FUNCTION public.fx_reverse_sale_fifo(
  p_store_id uuid,
  p_operation_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_row record;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Usuario sin acceso a esta tienda';
  END IF;

  FOR v_row IN
    SELECT c.id, c.lot_id, c.quantity
    FROM public.fx_lot_consumptions c
    WHERE c.store_id = p_store_id
      AND c.operation_id = p_operation_id
      AND c.reversed_at IS NULL
    FOR UPDATE
  LOOP
    UPDATE public.fx_lots
    SET remaining_qty = remaining_qty + v_row.quantity
    WHERE id = v_row.lot_id;

    UPDATE public.fx_lot_consumptions
    SET reversed_at = now()
    WHERE id = v_row.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_reverse_sale_fifo(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_reverse_sale_fifo(uuid, uuid)
  TO authenticated;

-- ----------------------------------------------------------------------------
-- 11. RLS y permisos
-- ----------------------------------------------------------------------------

ALTER TABLE public.fx_currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_currency_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_denominations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fx_currencies_read ON public.fx_currencies;
CREATE POLICY fx_currencies_read ON public.fx_currencies
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS fx_currency_aliases_read ON public.fx_currency_aliases;
CREATE POLICY fx_currency_aliases_read ON public.fx_currency_aliases
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS fx_denominations_read ON public.fx_denominations;
CREATE POLICY fx_denominations_read ON public.fx_denominations
  FOR SELECT TO authenticated USING (true);

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'fx_cashiers', 'fx_sessions', 'fx_opening_balances',
    'fx_import_batches', 'fx_import_rows',
    'fx_counterparties', 'fx_documents', 'fx_operations',
    'fx_st_folios', 'fx_lots', 'fx_lot_consumptions',
    'fx_inventory_movements', 'fx_account_movements', 'fx_account_lines',
    'fx_cash_counts', 'fx_closures', 'fx_expenses'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_member_access', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_store_member(store_id)) WITH CHECK (public.is_store_member(store_id))',
      t || '_member_access', t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.fx_cashiers,
  public.fx_sessions,
  public.fx_opening_balances,
  public.fx_import_batches,
  public.fx_import_rows,
  public.fx_counterparties,
  public.fx_documents,
  public.fx_operations,
  public.fx_st_folios,
  public.fx_lots,
  public.fx_lot_consumptions,
  public.fx_inventory_movements,
  public.fx_account_movements,
  public.fx_account_lines,
  public.fx_cash_counts,
  public.fx_closures,
  public.fx_expenses
TO authenticated;

GRANT SELECT ON
  public.fx_currencies,
  public.fx_currency_aliases,
  public.fx_denominations,
  public.fx_valid_operations,
  public.fx_daily_currency_stats,
  public.fx_session_inventory_balance,
  public.fx_inventory_valuation,
  public.fx_session_margin,
  public.fx_account_balances,
  public.fx_session_currency_summary
TO authenticated;

-- ============================================================================
-- DespuÃ©s de aplicar:
--   1. Sembrar la apertura con capas FIFO (no solo cantidades).
--   2. Implementar el parser de Excel y el commit transaccional.
--   3. Reemplazar los cÃ¡lculos de la planilla por las vistas y funciones.
--   4. Probar la migraciÃ³n con Reporte.xlsx y CAJA TEMUCO V5.xlsx.
-- ============================================================================


-- ============================================================================
-- Caja Temuco Â· RPC transaccionales
-- ============================================================================
-- Requiere 202611040002_fx_casa_cambio.sql.
-- Estas funciones concentran las operaciones que deben ser atÃ³micas:
-- apertura, importaciÃ³n, cuentas corrientes, conteo y cierre.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 01. Tienda y sesiÃ³n
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_ensure_store(p_name text DEFAULT 'Caja Temuco')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_store uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'SesiÃ³n requerida';
  END IF;

  SELECT store_id INTO v_store
  FROM public.store_members
  WHERE user_id = v_user
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_store IS NOT NULL THEN
    RETURN v_store;
  END IF;

  INSERT INTO public.stores (name, slug, currency)
  VALUES (
    COALESCE(NULLIF(btrim(p_name), ''), 'Caja Temuco'),
    'caja-temuco-' || substr(replace(v_user::text, '-', ''), 1, 12),
    'CLP'
  )
  RETURNING id INTO v_store;

  INSERT INTO public.store_members (store_id, user_id, role)
  VALUES (v_store, v_user, 'admin');

  RETURN v_store;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_ensure_store(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_ensure_store(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fx_ensure_session(
  p_store_id uuid,
  p_business_date date,
  p_opening_mode text DEFAULT 'MANUAL'
)
RETURNS public.fx_sessions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session public.fx_sessions;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Usuario sin acceso a esta tienda';
  END IF;
  IF p_opening_mode NOT IN ('PREVIOUS_CLOSE', 'MANUAL', 'IMPORT') THEN
    RAISE EXCEPTION 'Modo de apertura invÃ¡lido';
  END IF;

  SELECT * INTO v_session
  FROM public.fx_sessions
  WHERE store_id = p_store_id AND business_date = p_business_date;

  IF FOUND THEN
    RETURN v_session;
  END IF;

  INSERT INTO public.fx_sessions (store_id, business_date, opening_mode, opened_by)
  VALUES (p_store_id, p_business_date, p_opening_mode, auth.uid())
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_ensure_session(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_ensure_session(uuid, date, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 02. Apertura
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_save_opening(
  p_store_id uuid,
  p_session_id uuid,
  p_balances jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session public.fx_sessions;
  v_item jsonb;
  v_currency text;
  v_qty numeric;
  v_cost numeric;
  v_clp numeric;
  v_existing_qty numeric;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Usuario sin acceso a esta tienda';
  END IF;
  IF p_balances IS NULL OR jsonb_typeof(p_balances) <> 'array' THEN
    RAISE EXCEPTION 'La apertura debe ser un arreglo de saldos';
  END IF;

  SELECT * INTO v_session
  FROM public.fx_sessions
  WHERE id = p_session_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SesiÃ³n no encontrada';
  END IF;
  IF v_session.status <> 'OPEN' THEN
    RAISE EXCEPTION 'La sesiÃ³n no estÃ¡ abierta';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fx_operations WHERE session_id = p_session_id) THEN
    RAISE EXCEPTION 'No se puede cambiar la apertura: la sesiÃ³n ya tiene operaciones';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.fx_lots l
    JOIN public.fx_lot_consumptions c ON c.lot_id = l.id
    WHERE l.session_id = p_session_id AND l.source_type = 'OPENING'
  ) THEN
    RAISE EXCEPTION 'No se puede cambiar la apertura: hay capas FIFO ya consumidas';
  END IF;

  -- Las capas FIFO persisten entre sesiones. Solo se eliminan capas de
  -- apertura de esta sesiÃ³n que todavÃ­a no hayan sido consumidas.
  DELETE FROM public.fx_lots l
  WHERE l.session_id = p_session_id
    AND l.source_type = 'OPENING'
    AND NOT EXISTS (
      SELECT 1 FROM public.fx_lot_consumptions c WHERE c.lot_id = l.id
    );

  DELETE FROM public.fx_opening_balances WHERE session_id = p_session_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_balances)
  LOOP
    v_currency := upper(btrim(COALESCE(v_item->>'currency_code', '')));
    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    v_cost := COALESCE((v_item->>'unit_cost_clp')::numeric, 0);

    IF v_qty < 0 OR v_cost < 0 THEN
      RAISE EXCEPTION 'Cantidad o costo de apertura invÃ¡lido para %', v_currency;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.fx_currencies WHERE code = v_currency) THEN
      RAISE EXCEPTION 'Moneda no vÃ¡lida: %', v_currency;
    END IF;

    v_clp := ROUND(v_qty * v_cost, 2);

    INSERT INTO public.fx_opening_balances (
      store_id, session_id, currency_code, quantity, unit_cost_clp, clp_value, source
    ) VALUES (
      p_store_id, p_session_id, v_currency, v_qty, v_cost, v_clp, 'MANUAL'
    );

    -- El CLP no usa capas FIFO. Para las divisas, la apertura debe coincidir
    -- con las capas existentes; si no, se crea un ajuste o se consume FIFO.
    IF v_currency <> 'CLP' THEN
      SELECT COALESCE(SUM(remaining_qty), 0) INTO v_existing_qty
      FROM public.fx_lots
      WHERE store_id = p_store_id
        AND currency_code = v_currency
        AND remaining_qty > 0;

      IF v_qty > v_existing_qty + 0.000001 THEN
        INSERT INTO public.fx_lots (
          store_id, currency_code, session_id, source_type,
          acquired_at, original_qty, remaining_qty, unit_cost_clp, note
        ) VALUES (
          p_store_id, v_currency, p_session_id,
          CASE WHEN v_existing_qty = 0 THEN 'OPENING' ELSE 'ADJUSTMENT' END,
          v_session.business_date::timestamp, v_qty - v_existing_qty, v_qty - v_existing_qty,
          v_cost, 'Apertura'
        );
      ELSIF v_qty < v_existing_qty - 0.000001 THEN
        PERFORM * FROM public.fx_consume_fifo(
          p_store_id, v_currency, v_existing_qty - v_qty, NULL, NULL,
          v_session.business_date::timestamp
        );
      END IF;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_save_opening(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_save_opening(uuid, uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 03. ImportaciÃ³n transaccional
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_import_batch(
  p_store_id uuid,
  p_session_id uuid,
  p_batch_id uuid,
  p_documents jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session public.fx_sessions;
  v_doc jsonb;
  v_line jsonb;
  v_doc_id uuid;
  v_op_id uuid;
  v_folio text;
  v_doc_type text;
  v_operation text;
  v_status text;
  v_business_date date;
  v_currency text;
  v_instrument text;
  v_foreign numeric;
  v_rate numeric;
  v_clp numeric;
  v_line_index integer;
  v_source_row integer;
  v_acquired timestamptz;
  v_inserted_docs integer := 0;
  v_inserted_ops integer := 0;
  v_skipped_docs integer := 0;
  v_void_ops integer := 0;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Usuario sin acceso a esta tienda';
  END IF;
  IF p_documents IS NULL OR jsonb_typeof(p_documents) <> 'array' THEN
    RAISE EXCEPTION 'El lote debe ser un arreglo de documentos';
  END IF;

  SELECT * INTO v_session
  FROM public.fx_sessions
  WHERE id = p_session_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SesiÃ³n no encontrada';
  END IF;
  IF v_session.status <> 'OPEN' THEN
    RAISE EXCEPTION 'La sesiÃ³n no estÃ¡ abierta';
  END IF;

  FOR v_doc IN SELECT value FROM jsonb_array_elements(p_documents)
  LOOP
    v_folio := btrim(COALESCE(v_doc->>'folio', ''));
    v_doc_type := upper(COALESCE(NULLIF(btrim(v_doc->>'document_type'), ''), 'BOLETA'));
    v_operation := upper(COALESCE(v_doc->>'operation', ''));
    v_status := upper(COALESCE(v_doc->>'status', 'VALID'));
    v_business_date := COALESCE((v_doc->>'business_date')::date, v_session.business_date);

    IF v_operation NOT IN ('COMPRA', 'VENTA') THEN
      RAISE EXCEPTION 'OperaciÃ³n de documento invÃ¡lida: %', v_operation;
    END IF;
    IF v_doc_type NOT IN ('BOLETA', 'FACTURA', 'TICKET', 'OTRO') THEN
      RAISE EXCEPTION 'Tipo de documento invÃ¡lido: %', v_doc_type;
    END IF;
    IF v_status NOT IN ('VALID', 'VOID_ST', 'VOID_NC', 'VOID_OTHER', 'REVIEW') THEN
      RAISE EXCEPTION 'Estado de documento invÃ¡lido: %', v_status;
    END IF;

    v_doc_id := NULL;
    IF v_folio <> '' AND v_folio <> '0' THEN
      SELECT id INTO v_doc_id
      FROM public.fx_documents
      WHERE store_id = p_store_id
        AND document_type = v_doc_type
        AND folio = v_folio;

      IF v_doc_id IS NOT NULL THEN
        v_skipped_docs := v_skipped_docs + 1;
        CONTINUE;
      END IF;
    END IF;

    INSERT INTO public.fx_documents (
      store_id, session_id, business_date, operation, document_type, folio,
      cashier, is_wholesale, ticket_code, status, import_batch_id,
      source_row_first, source_row_last, missing_folio
    ) VALUES (
      p_store_id, p_session_id, v_business_date, v_operation, v_doc_type, v_folio,
      NULLIF(btrim(COALESCE(v_doc->>'cashier', '')), ''),
      COALESCE((v_doc->>'is_wholesale')::boolean, false),
      NULLIF(btrim(COALESCE(v_doc->>'ticket_code', '')), ''),
      v_status, p_batch_id,
      NULLIF((v_doc->>'source_row_first')::integer, 0),
      NULLIF((v_doc->>'source_row_last')::integer, 0),
      COALESCE((v_doc->>'missing_folio')::boolean, v_folio = '' OR v_folio = '0')
    ) RETURNING id INTO v_doc_id;

    v_inserted_docs := v_inserted_docs + 1;
    v_line_index := 0;

    FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(v_doc->'lines', '[]'::jsonb))
    LOOP
      v_line_index := v_line_index + 1;
      v_currency := upper(btrim(COALESCE(v_line->>'currency_code', '')));
      v_instrument := upper(COALESCE(NULLIF(btrim(v_line->>'instrument'), ''), 'EFECTIVO'));
      v_foreign := COALESCE((v_line->>'foreign_amount')::numeric, 0);
      v_rate := COALESCE((v_line->>'fx_rate')::numeric, 0);
      v_clp := COALESCE((v_line->>'clp_amount')::numeric, 0);
      v_source_row := NULLIF((v_line->>'source_row')::integer, 0);
      v_acquired := v_business_date::timestamp + (v_line_index || ' minutes')::interval;

      IF v_foreign <= 0 OR v_rate <= 0 OR v_clp < 0 THEN
        RAISE EXCEPTION 'LÃ­nea invÃ¡lida para el folio %', v_folio;
      END IF;
      IF v_instrument NOT IN ('EFECTIVO', 'TRANSFERENCIA', 'OTRO') THEN
        RAISE EXCEPTION 'Instrumento invÃ¡lido: %', v_instrument;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.fx_currencies WHERE code = v_currency) THEN
        RAISE EXCEPTION 'Moneda no vÃ¡lida: %', v_currency;
      END IF;

      INSERT INTO public.fx_operations (
        store_id, document_id, session_id, business_date, operation,
        currency_code, instrument, foreign_amount, fx_rate, clp_amount,
        line_no, source_row, raw
      ) VALUES (
        p_store_id, v_doc_id, p_session_id, v_business_date, v_operation,
        v_currency, v_instrument, v_foreign, v_rate, v_clp,
        v_line_index, v_source_row, v_line
      ) RETURNING id INTO v_op_id;

      v_inserted_ops := v_inserted_ops + 1;

      IF v_status <> 'VALID' THEN
        v_void_ops := v_void_ops + 1;
        CONTINUE;
      END IF;

      IF v_operation = 'COMPRA' THEN
        INSERT INTO public.fx_lots (
          store_id, currency_code, session_id, source_type, source_operation_id,
          acquired_at, original_qty, remaining_qty, unit_cost_clp, note
        ) VALUES (
          p_store_id, v_currency, p_session_id, 'PURCHASE', v_op_id,
          v_acquired, v_foreign, v_foreign, v_clp / v_foreign, 'Compra ' || v_folio
        );

        INSERT INTO public.fx_inventory_movements (
          store_id, session_id, currency_code, movement_type,
          quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
          business_date, note
        ) VALUES (
          p_store_id, p_session_id, v_currency, 'PURCHASE',
          v_foreign, v_clp / v_foreign, 0, 'OPERATION', v_op_id,
          v_business_date, 'Compra ' || v_folio
        );

        INSERT INTO public.fx_inventory_movements (
          store_id, session_id, currency_code, movement_type,
          quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
          business_date, note
        ) VALUES (
          p_store_id, p_session_id, 'CLP', 'PURCHASE',
          -v_clp, 1, -v_clp, 'OPERATION', v_op_id,
          v_business_date, 'Pago compra ' || v_folio
        );
      ELSE
        PERFORM * FROM public.fx_consume_fifo(
          p_store_id, v_currency, v_foreign, v_op_id, NULL, v_acquired
        );

        INSERT INTO public.fx_inventory_movements (
          store_id, session_id, currency_code, movement_type,
          quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
          business_date, note
        ) VALUES (
          p_store_id, p_session_id, v_currency, 'SALE',
          -v_foreign, v_rate, 0, 'OPERATION', v_op_id,
          v_business_date, 'Venta ' || v_folio
        );

        INSERT INTO public.fx_inventory_movements (
          store_id, session_id, currency_code, movement_type,
          quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
          business_date, note
        ) VALUES (
          p_store_id, p_session_id, 'CLP', 'SALE',
          v_clp, 1, v_clp, 'OPERATION', v_op_id,
          v_business_date, 'Cobro venta ' || v_folio
        );
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.fx_import_batches
  SET status = 'COMMITTED',
      committed_at = now(),
      rows_valid = v_inserted_ops,
      rows_void = v_void_ops,
      rows_error = 0
  WHERE id = p_batch_id AND store_id = p_store_id;

  RETURN jsonb_build_object(
    'documents', v_inserted_docs,
    'operations', v_inserted_ops,
    'skipped_documents', v_skipped_docs,
    'void_operations', v_void_ops
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fx_import_batch(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_import_batch(uuid, uuid, uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 04. Cuentas corrientes
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_register_account_movement(
  p_store_id uuid,
  p_session_id uuid,
  p_counterparty_id uuid,
  p_movement_type text,
  p_business_date date,
  p_note text,
  p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session public.fx_sessions;
  v_movement_id uuid;
  v_line jsonb;
  v_currency text;
  v_side text;
  v_amount numeric;
  v_rate numeric;
  v_clp numeric;
  v_inventory_delta numeric;
  v_unit_cost numeric;
  v_source_type text;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Usuario sin acceso a esta tienda';
  END IF;
  IF p_movement_type NOT IN (
    'PRESTAMO_OTORGADO', 'PRESTAMO_RECIBIDO', 'COBRO_DEUDA',
    'PAGO_DEUDA', 'ENTREGA', 'RETIRO', 'VENTA_CREDITO',
    'COMPRA_CREDITO', 'AJUSTE'
  ) THEN
    RAISE EXCEPTION 'Tipo de movimiento invÃ¡lido';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'El movimiento debe tener al menos una lÃ­nea';
  END IF;

  SELECT * INTO v_session
  FROM public.fx_sessions
  WHERE id = p_session_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SesiÃ³n no encontrada';
  END IF;
  IF v_session.status <> 'OPEN' THEN
    RAISE EXCEPTION 'La sesiÃ³n no estÃ¡ abierta';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.fx_counterparties
    WHERE id = p_counterparty_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Contraparte no vÃ¡lida';
  END IF;

  INSERT INTO public.fx_account_movements (
    store_id, session_id, counterparty_id, movement_type,
    business_date, status, note, created_by
  ) VALUES (
    p_store_id, p_session_id, p_counterparty_id, p_movement_type,
    p_business_date, 'ACTIVE', p_note, auth.uid()
  ) RETURNING id INTO v_movement_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_currency := upper(btrim(COALESCE(v_line->>'currency_code', '')));
    v_side := upper(btrim(COALESCE(v_line->>'side', '')));
    v_amount := COALESCE((v_line->>'amount_delta')::numeric, 0);
    v_rate := NULLIF((v_line->>'fx_rate')::numeric, 0);
    v_clp := COALESCE((v_line->>'clp_equivalent')::numeric, 0);
    v_inventory_delta := COALESCE((v_line->>'inventory_delta')::numeric, 0);
    v_unit_cost := COALESCE((v_line->>'unit_cost_clp')::numeric, v_rate, 1);

    IF v_side NOT IN ('RECEIVABLE', 'PAYABLE') THEN
      RAISE EXCEPTION 'Lado de cuenta invÃ¡lido: %', v_side;
    END IF;
    IF v_amount = 0 THEN
      RAISE EXCEPTION 'El monto de la lÃ­nea no puede ser 0';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.fx_currencies WHERE code = v_currency) THEN
      RAISE EXCEPTION 'Moneda no vÃ¡lida: %', v_currency;
    END IF;

    IF v_clp = 0 AND v_rate IS NOT NULL THEN
      v_clp := ROUND(abs(v_amount) * v_rate, 2);
    END IF;

    INSERT INTO public.fx_account_lines (
      store_id, movement_id, currency_code, side, amount_delta,
      fx_rate, clp_equivalent, note
    ) VALUES (
      p_store_id, v_movement_id, v_currency, v_side, v_amount,
      v_rate, v_clp, NULL
    );

    IF v_inventory_delta <> 0 THEN
      IF v_currency = 'CLP' THEN
        INSERT INTO public.fx_inventory_movements (
          store_id, session_id, currency_code, movement_type,
          quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
          business_date, note
        ) VALUES (
          p_store_id, p_session_id, 'CLP', 'ADJUSTMENT',
          v_inventory_delta, 1, v_inventory_delta, 'ACCOUNT_MOVEMENT', v_movement_id,
          p_business_date, p_note
        );
      ELSIF v_inventory_delta > 0 THEN
        v_source_type := CASE
          WHEN p_movement_type = 'PRESTAMO_RECIBIDO' THEN 'LOAN_IN'
          WHEN p_movement_type = 'COBRO_DEUDA' THEN 'REPAYMENT_IN'
          ELSE 'ADJUSTMENT'
        END;

        INSERT INTO public.fx_lots (
          store_id, currency_code, session_id, source_type,
          source_account_movement_id, acquired_at,
          original_qty, remaining_qty, unit_cost_clp, note
        ) VALUES (
          p_store_id, v_currency, p_session_id, v_source_type,
          v_movement_id, now(),
          v_inventory_delta, v_inventory_delta, v_unit_cost, p_note
        );

        INSERT INTO public.fx_inventory_movements (
          store_id, session_id, currency_code, movement_type,
          quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
          business_date, note
        ) VALUES (
          p_store_id, p_session_id, v_currency,
          CASE WHEN v_source_type = 'LOAN_IN' THEN 'LOAN_IN' ELSE 'REPAYMENT_IN' END,
          v_inventory_delta, v_unit_cost, 0, 'ACCOUNT_MOVEMENT', v_movement_id,
          p_business_date, p_note
        );
      ELSE
        PERFORM * FROM public.fx_consume_fifo(
          p_store_id, v_currency, abs(v_inventory_delta), NULL, v_movement_id, now()
        );

        INSERT INTO public.fx_inventory_movements (
          store_id, session_id, currency_code, movement_type,
          quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
          business_date, note
        ) VALUES (
          p_store_id, p_session_id, v_currency,
          CASE WHEN p_movement_type = 'PRESTAMO_OTORGADO' THEN 'LOAN_OUT' ELSE 'REPAYMENT_OUT' END,
          v_inventory_delta, v_unit_cost, 0, 'ACCOUNT_MOVEMENT', v_movement_id,
          p_business_date, p_note
        );
      END IF;
    END IF;
  END LOOP;

  RETURN v_movement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_register_account_movement(uuid, uuid, uuid, text, date, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_register_account_movement(uuid, uuid, uuid, text, date, text, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 05. Conteo fÃ­sico
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_save_cash_counts(
  p_store_id uuid,
  p_session_id uuid,
  p_counts jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session public.fx_sessions;
  v_item jsonb;
  v_currency text;
  v_value numeric;
  v_quantity numeric;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Usuario sin acceso a esta tienda';
  END IF;
  IF p_counts IS NULL OR jsonb_typeof(p_counts) <> 'array' THEN
    RAISE EXCEPTION 'El conteo debe ser un arreglo';
  END IF;

  SELECT * INTO v_session
  FROM public.fx_sessions
  WHERE id = p_session_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SesiÃ³n no encontrada';
  END IF;
  IF v_session.status <> 'OPEN' THEN
    RAISE EXCEPTION 'La sesiÃ³n no estÃ¡ abierta';
  END IF;

  DELETE FROM public.fx_cash_counts WHERE session_id = p_session_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_counts)
  LOOP
    v_currency := upper(btrim(COALESCE(v_item->>'currency_code', '')));
    v_value := COALESCE((v_item->>'denomination_value')::numeric, 0);
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);

    IF v_value <= 0 OR v_quantity < 0 THEN
      RAISE EXCEPTION 'DenominaciÃ³n o cantidad invÃ¡lida para %', v_currency;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.fx_currencies WHERE code = v_currency) THEN
      RAISE EXCEPTION 'Moneda no vÃ¡lida: %', v_currency;
    END IF;

    INSERT INTO public.fx_cash_counts (
      store_id, session_id, currency_code, denomination_id,
      denomination_value, quantity, total, counted_by
    ) VALUES (
      p_store_id, p_session_id, v_currency,
      NULLIF((v_item->>'denomination_id')::uuid, NULL),
      v_value, v_quantity, ROUND(v_value * v_quantity, 2), auth.uid()
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_save_cash_counts(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_save_cash_counts(uuid, uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 06. Gastos
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_register_expense(
  p_store_id uuid,
  p_session_id uuid,
  p_business_date date,
  p_concept text,
  p_category text,
  p_amount_clp numeric,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session public.fx_sessions;
  v_expense_id uuid;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Usuario sin acceso a esta tienda';
  END IF;
  IF p_amount_clp IS NULL OR p_amount_clp < 0 THEN
    RAISE EXCEPTION 'El monto del gasto debe ser mayor o igual a 0';
  END IF;
  IF length(btrim(COALESCE(p_concept, ''))) = 0 THEN
    RAISE EXCEPTION 'El concepto del gasto es obligatorio';
  END IF;

  SELECT * INTO v_session
  FROM public.fx_sessions
  WHERE id = p_session_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SesiÃ³n no encontrada';
  END IF;
  IF v_session.status <> 'OPEN' THEN
    RAISE EXCEPTION 'La sesiÃ³n no estÃ¡ abierta';
  END IF;

  INSERT INTO public.fx_expenses (
    store_id, session_id, business_date, concept, category,
    amount_clp, currency_code, amount_currency, fx_rate, note, created_by
  ) VALUES (
    p_store_id, p_session_id, p_business_date, btrim(p_concept),
    COALESCE(NULLIF(btrim(p_category), ''), 'OTROS'),
    p_amount_clp, 'CLP', p_amount_clp, 1, p_note, auth.uid()
  ) RETURNING id INTO v_expense_id;

  INSERT INTO public.fx_inventory_movements (
    store_id, session_id, currency_code, movement_type,
    quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
    business_date, note
  ) VALUES (
    p_store_id, p_session_id, 'CLP', 'EXPENSE',
    -p_amount_clp, 1, -p_amount_clp, 'EXPENSE', v_expense_id,
    p_business_date, p_concept
  );

  RETURN v_expense_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_register_expense(uuid, uuid, date, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_register_expense(uuid, uuid, date, text, text, numeric, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 07. Cierre
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_close_session(
  p_store_id uuid,
  p_session_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS public.fx_closures
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session public.fx_sessions;
  v_closure public.fx_closures;
  v_cash_clp numeric := 0;
  v_inventory_clp numeric := 0;
  v_margin_clp numeric := 0;
  v_fx_result_clp numeric := 0;
  v_expenses_clp numeric := 0;
  v_net_result_clp numeric := 0;
  v_capital_clp numeric := 0;
  v_snapshot jsonb;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Usuario sin acceso a esta tienda';
  END IF;

  SELECT * INTO v_session
  FROM public.fx_sessions
  WHERE id = p_session_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SesiÃ³n no encontrada';
  END IF;
  IF v_session.status = 'CLOSED' THEN
    SELECT * INTO v_closure FROM public.fx_closures WHERE session_id = p_session_id;
    RETURN v_closure;
  END IF;

  SELECT COALESCE(expected_qty, 0) INTO v_cash_clp
  FROM public.fx_session_currency_summary
  WHERE session_id = p_session_id AND currency_code = 'CLP';

  SELECT COALESCE(SUM(current_fifo_value_clp), 0) INTO v_inventory_clp
  FROM public.fx_session_currency_summary
  WHERE session_id = p_session_id AND currency_code <> 'CLP';

  SELECT COALESCE(SUM(o.clp_amount - COALESCE(c.cost, 0)), 0) INTO v_margin_clp
  FROM public.fx_valid_operations o
  LEFT JOIN (
    SELECT operation_id, SUM(total_cost_clp) AS cost
    FROM public.fx_lot_consumptions
    WHERE reversed_at IS NULL
    GROUP BY operation_id
  ) c ON c.operation_id = o.id
  WHERE o.session_id = p_session_id
    AND o.operation = 'VENTA';

  SELECT COALESCE(SUM(amount_clp), 0) INTO v_expenses_clp
  FROM public.fx_expenses
  WHERE session_id = p_session_id;

  v_net_result_clp := ROUND(v_margin_clp + v_fx_result_clp - v_expenses_clp, 2);
  v_capital_clp := ROUND(v_cash_clp + v_inventory_clp, 2);

  v_snapshot := jsonb_build_object(
    'session', to_jsonb(v_session),
    'cash_clp', v_cash_clp,
    'inventory_clp', v_inventory_clp,
    'capital_clp', v_capital_clp,
    'margin_clp', v_margin_clp,
    'expenses_clp', v_expenses_clp,
    'net_result_clp', v_net_result_clp,
    'currencies', COALESCE((
      SELECT jsonb_agg(to_jsonb(s))
      FROM public.fx_session_currency_summary s
      WHERE s.session_id = p_session_id
    ), '[]'::jsonb),
    'accounts', COALESCE((
      SELECT jsonb_agg(to_jsonb(a))
      FROM public.fx_account_balances a
      WHERE a.store_id = p_store_id
    ), '[]'::jsonb),
    'counts', COALESCE((
      SELECT jsonb_agg(to_jsonb(c))
      FROM public.fx_cash_counts c
      WHERE c.session_id = p_session_id
    ), '[]'::jsonb)
  );

  INSERT INTO public.fx_closures (
    store_id, session_id, business_date, status,
    total_cash_clp, total_inventory_clp, total_capital_clp,
    realized_margin_clp, fx_result_clp, expenses_clp, net_result_clp,
    snapshot, notes, closed_by, closed_at
  ) VALUES (
    p_store_id, p_session_id, v_session.business_date, 'CLOSED',
    v_cash_clp, v_inventory_clp, v_capital_clp,
    v_margin_clp, v_fx_result_clp, v_expenses_clp, v_net_result_clp,
    v_snapshot, p_notes, auth.uid(), now()
  )
  ON CONFLICT (session_id) DO UPDATE SET
    status = 'CLOSED',
    total_cash_clp = EXCLUDED.total_cash_clp,
    total_inventory_clp = EXCLUDED.total_inventory_clp,
    total_capital_clp = EXCLUDED.total_capital_clp,
    realized_margin_clp = EXCLUDED.realized_margin_clp,
    fx_result_clp = EXCLUDED.fx_result_clp,
    expenses_clp = EXCLUDED.expenses_clp,
    net_result_clp = EXCLUDED.net_result_clp,
    snapshot = EXCLUDED.snapshot,
    notes = EXCLUDED.notes,
    closed_by = EXCLUDED.closed_by,
    closed_at = EXCLUDED.closed_at
  RETURNING * INTO v_closure;

  UPDATE public.fx_sessions
  SET status = 'CLOSED', closed_by = auth.uid(), closed_at = now()
  WHERE id = p_session_id;

  RETURN v_closure;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_close_session(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_close_session(uuid, uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 07. Procesamiento y reversa FIFO de un documento
-- ----------------------------------------------------------------------------

-- Procesa un documento que ya existe pero cuyas lÃ­neas no tienen efecto FIFO
-- (por ejemplo, un documento importado como ST y luego reversado).
CREATE OR REPLACE FUNCTION public.fx_process_document(
  p_store_id uuid,
  p_document_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_doc public.fx_documents;
  v_op record;
  v_acquired timestamptz;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Usuario sin acceso a esta tienda';
  END IF;

  SELECT * INTO v_doc
  FROM public.fx_documents
  WHERE id = p_document_id AND store_id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento no encontrado';
  END IF;
  IF v_doc.status <> 'VALID' THEN
    RAISE EXCEPTION 'El documento no estÃ¡ vÃ¡lido';
  END IF;

  FOR v_op IN
    SELECT * FROM public.fx_operations
    WHERE document_id = p_document_id AND store_id = p_store_id
    ORDER BY line_no
  LOOP
    v_acquired := v_op.business_date::timestamp + (v_op.line_no || ' minutes')::interval;

    IF v_op.operation = 'COMPRA' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.fx_lots
        WHERE source_operation_id = v_op.id AND store_id = p_store_id
      ) THEN
        INSERT INTO public.fx_lots (
          store_id, currency_code, session_id, source_type, source_operation_id,
          acquired_at, original_qty, remaining_qty, unit_cost_clp, note
        ) VALUES (
          p_store_id, v_op.currency_code, v_op.session_id, 'PURCHASE', v_op.id,
          v_acquired, v_op.foreign_amount, v_op.foreign_amount,
          v_op.clp_amount / v_op.foreign_amount, 'Reproceso ' || v_doc.folio
        );

        INSERT INTO public.fx_inventory_movements (
          store_id, session_id, currency_code, movement_type,
          quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
          business_date, note
        ) VALUES (
          p_store_id, v_op.session_id, v_op.currency_code, 'PURCHASE',
          v_op.foreign_amount, v_op.clp_amount / v_op.foreign_amount, 0,
          'OPERATION', v_op.id, v_op.business_date, 'Reproceso compra ' || v_doc.folio
        );

        INSERT INTO public.fx_inventory_movements (
          store_id, session_id, currency_code, movement_type,
          quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
          business_date, note
        ) VALUES (
          p_store_id, v_op.session_id, 'CLP', 'PURCHASE',
          -v_op.clp_amount, 1, -v_op.clp_amount,
          'OPERATION', v_op.id, v_op.business_date, 'Reproceso pago compra ' || v_doc.folio
        );
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM public.fx_lot_consumptions
        WHERE operation_id = v_op.id
          AND store_id = p_store_id
          AND reversed_at IS NULL
      ) THEN
        PERFORM * FROM public.fx_consume_fifo(
          p_store_id, v_op.currency_code, v_op.foreign_amount,
          v_op.id, NULL, v_acquired
        );

        INSERT INTO public.fx_inventory_movements (
          store_id, session_id, currency_code, movement_type,
          quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
          business_date, note
        ) VALUES (
          p_store_id, v_op.session_id, v_op.currency_code, 'SALE',
          -v_op.foreign_amount, v_op.fx_rate, 0,
          'OPERATION', v_op.id, v_op.business_date, 'Reproceso venta ' || v_doc.folio
        );

        INSERT INTO public.fx_inventory_movements (
          store_id, session_id, currency_code, movement_type,
          quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
          business_date, note
        ) VALUES (
          p_store_id, v_op.session_id, 'CLP', 'SALE',
          v_op.clp_amount, 1, v_op.clp_amount,
          'OPERATION', v_op.id, v_op.business_date, 'Reproceso cobro venta ' || v_doc.folio
        );
      END IF;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_process_document(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_process_document(uuid, uuid) TO authenticated;

-- Revierte el efecto FIFO de un documento ya procesado. Para compras exige
-- que el lote estÃ© intacto; si ya fue consumido, bloquea la operaciÃ³n.
CREATE OR REPLACE FUNCTION public.fx_reverse_document_fifo(
  p_store_id uuid,
  p_document_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_doc public.fx_documents;
  v_op record;
  v_lot public.fx_lots;
  v_reversed integer;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Usuario sin acceso a esta tienda';
  END IF;

  SELECT * INTO v_doc
  FROM public.fx_documents
  WHERE id = p_document_id AND store_id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento no encontrado';
  END IF;

  FOR v_op IN
    SELECT * FROM public.fx_operations
    WHERE document_id = p_document_id AND store_id = p_store_id
    ORDER BY line_no
  LOOP
    IF v_op.operation = 'VENTA' THEN
      v_reversed := public.fx_reverse_sale_fifo(p_store_id, v_op.id);

      IF v_reversed > 0 THEN
        INSERT INTO public.fx_inventory_movements (
          store_id, session_id, currency_code, movement_type,
          quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
          business_date, note
        ) VALUES (
          p_store_id, v_op.session_id, v_op.currency_code, 'ADJUSTMENT',
          v_op.foreign_amount, v_op.fx_rate, 0,
          'OPERATION', v_op.id, v_op.business_date, 'Reversa venta ' || v_doc.folio
        );

        INSERT INTO public.fx_inventory_movements (
          store_id, session_id, currency_code, movement_type,
          quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
          business_date, note
        ) VALUES (
          p_store_id, v_op.session_id, 'CLP', 'ADJUSTMENT',
          -v_op.clp_amount, 1, -v_op.clp_amount,
          'OPERATION', v_op.id, v_op.business_date, 'Reversa cobro venta ' || v_doc.folio
        );
      END IF;
    ELSE
      SELECT * INTO v_lot
      FROM public.fx_lots
      WHERE source_operation_id = v_op.id AND store_id = p_store_id
      FOR UPDATE;

      IF FOUND THEN
        IF v_lot.remaining_qty <> v_lot.original_qty THEN
          RAISE EXCEPTION 'No se puede anular la compra %: su lote ya fue consumido', v_doc.folio;
        END IF;

        DELETE FROM public.fx_lot_consumptions
        WHERE lot_id = v_lot.id AND reversed_at IS NOT NULL;

        DELETE FROM public.fx_lots WHERE id = v_lot.id;

        INSERT INTO public.fx_inventory_movements (
          store_id, session_id, currency_code, movement_type,
          quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
          business_date, note
        ) VALUES (
          p_store_id, v_op.session_id, v_op.currency_code, 'ADJUSTMENT',
          -v_op.foreign_amount, v_op.clp_amount / v_op.foreign_amount, 0,
          'OPERATION', v_op.id, v_op.business_date, 'Reversa compra ' || v_doc.folio
        );

        INSERT INTO public.fx_inventory_movements (
          store_id, session_id, currency_code, movement_type,
          quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
          business_date, note
        ) VALUES (
          p_store_id, v_op.session_id, 'CLP', 'ADJUSTMENT',
          v_op.clp_amount, 1, v_op.clp_amount,
          'OPERATION', v_op.id, v_op.business_date, 'Reversa pago compra ' || v_doc.folio
        );
      END IF;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_reverse_document_fifo(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_reverse_document_fifo(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 08. ST: registrar y reversar
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_add_st_folio(
  p_store_id uuid,
  p_document_type text,
  p_folio text,
  p_reason text DEFAULT 'ST',
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_doc record;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Usuario sin acceso a esta tienda';
  END IF;
  IF btrim(p_folio) = '' OR btrim(p_folio) = '0' THEN
    RAISE EXCEPTION 'El folio ST no puede estar vacÃ­o ni ser 0';
  END IF;

  INSERT INTO public.fx_st_folios (
    store_id, document_type, folio, reason, status, registered_by, note
  ) VALUES (
    p_store_id, upper(p_document_type), btrim(p_folio), p_reason, 'ACTIVE', auth.uid(), p_note
  )
  ON CONFLICT (store_id, document_type, folio) WHERE status = 'ACTIVE'
  DO UPDATE SET reason = EXCLUDED.reason, note = EXCLUDED.note
  RETURNING id INTO v_id;

  FOR v_doc IN
    SELECT id FROM public.fx_documents
    WHERE store_id = p_store_id
      AND document_type = upper(p_document_type)
      AND folio = btrim(p_folio)
      AND status = 'VALID'
  LOOP
    UPDATE public.fx_documents
    SET status = 'VOID_ST',
        void_reason = p_reason,
        voided_at = now(),
        voided_by = auth.uid()
    WHERE id = v_doc.id;

    PERFORM public.fx_reverse_document_fifo(p_store_id, v_doc.id);
  END LOOP;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_add_st_folio(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_add_st_folio(uuid, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fx_reverse_st_folio(
  p_store_id uuid,
  p_st_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_st public.fx_st_folios;
  v_doc record;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Usuario sin acceso a esta tienda';
  END IF;

  SELECT * INTO v_st
  FROM public.fx_st_folios
  WHERE id = p_st_id AND store_id = p_store_id AND status = 'ACTIVE'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Folio ST activo no encontrado';
  END IF;

  UPDATE public.fx_st_folios
  SET status = 'REVERSED', reversed_by = auth.uid(), reversed_at = now()
  WHERE id = p_st_id;

  FOR v_doc IN
    SELECT d.id
    FROM public.fx_documents d
    WHERE d.store_id = p_store_id
      AND d.document_type = v_st.document_type
      AND d.folio = v_st.folio
      AND d.status = 'VOID_ST'
      AND NOT EXISTS (
        SELECT 1 FROM public.fx_st_folios s
        WHERE s.store_id = d.store_id
          AND s.document_type = d.document_type
          AND s.folio = d.folio
          AND s.status = 'ACTIVE'
      )
  LOOP
    UPDATE public.fx_documents
    SET status = 'VALID', void_reason = NULL, voided_at = NULL, voided_by = NULL
    WHERE id = v_doc.id;

    PERFORM public.fx_process_document(p_store_id, v_doc.id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_reverse_st_folio(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_reverse_st_folio(uuid, uuid) TO authenticated;

-- ============================================================================
-- Notas:
--   * fx_add_st_folio revierte el FIFO del documento si ya estaba procesado.
--     Si una compra ya fue consumida, bloquea la anulaciÃ³n y exige un ajuste.
--   * fx_reverse_st_folio vuelve a procesar el documento si estaba importado
--     como VOID_ST y por lo tanto no tenÃ­a capas/consumos.
--   * El historial nunca se borra: se agregan movimientos de ajuste y se
--     marcan los consumos como reversados.
-- ============================================================================
