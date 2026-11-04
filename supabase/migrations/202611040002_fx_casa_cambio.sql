-- ============================================================================
-- Caja Temuco · Módulo de casa de cambio/divisas
-- ============================================================================
-- Migración de referencia para el módulo "Divisas".
--
-- IMPORTANTE:
--   * NO está aplicada en el Supabase remoto.
--   * Requiere las tablas public.stores y public.store_members y la función
--     public.is_store_member(uuid) del esquema maestro.
--   * Está diseñada para PostgreSQL 15+ / Supabase.
--   * Los importes CLP usan numeric(20,2); las cantidades, numeric(24,6);
--     los tipos de cambio, numeric(20,8).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 00. Base multi-tenant mínima
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
-- 01. Configuración: monedas, alias y denominaciones
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
  ('USD', 'Dólar estadounidense', 'US$', 2, false, 10),
  ('ARS', 'Peso argentino', 'AR$', 2, false, 20),
  ('BRL', 'Real brasileño', 'R$', 2, false, 30),
  ('EUR', 'Euro', '€', 2, false, 40),
  ('NZD', 'Dólar neozelandés', 'NZ$', 2, false, 50),
  ('AUD', 'Dólar australiano', 'A$', 2, false, 60),
  ('CAD', 'Dólar canadiense', 'C$', 2, false, 70),
  ('COP', 'Peso colombiano', 'COL$', 2, false, 80),
  ('PEN', 'Sol peruano', 'S/', 2, false, 90),
  ('GBP', 'Libra esterlina', '£', 2, false, 100),
  ('BOB', 'Boliviano', 'Bs', 2, false, 110),
  ('UYU', 'Peso uruguayo', '$U', 2, false, 120),
  ('MXN', 'Peso mexicano', 'MX$', 2, false, 130),
  ('CHF', 'Franco suizo', 'CHF', 2, false, 140),
  ('PYG', 'Guaraní paraguayo', '₲', 0, false, 150)
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
  ('DÓLAR', 'USD', 'EFECTIVO'),
  ('DOLAR USA', 'USD', 'EFECTIVO'),
  ('DÓLAR USA', 'USD', 'EFECTIVO'),
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
  ('DÓLAR AUSTRALIANO', 'AUD', 'EFECTIVO'),
  ('AUD', 'AUD', 'EFECTIVO'),
  ('DOLAR NEOZELANDES', 'NZD', 'EFECTIVO'),
  ('DÓLAR NEOZELANDÉS', 'NZD', 'EFECTIVO'),
  ('NZD', 'NZD', 'EFECTIVO'),
  ('DOLAR CANADIENSE', 'CAD', 'EFECTIVO'),
  ('DÓLAR CANADIENSE', 'CAD', 'EFECTIVO'),
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
  ('GUARANÍ', 'PYG', 'EFECTIVO'),
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

-- Denominaciones base. Son editables desde Configuración; se siembran las más
-- usadas para que la cuadratura funcione desde el primer día.
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
-- 03. Importación de reportes
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
-- capas FIFO (préstamo recibido) o consumos (préstamo otorgado).
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
-- 08. Conteo físico, cierre y gastos
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
-- 09. Vistas de cálculo
-- ----------------------------------------------------------------------------

-- Única fuente válida para compras/ventas: excluye cualquier documento anulado.
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

-- Saldo esperado por sesión: apertura + movimientos de esa sesión.
-- No sumar movimientos de todas las sesiones: cada apertura ya reinicia el día.
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

-- Valorización FIFO actual de las divisas (sin CLP; el CLP se toma del saldo
-- esperado de la sesión). Las capas persisten entre sesiones.
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
-- 10. Función FIFO
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
-- Después de aplicar:
--   1. Sembrar la apertura con capas FIFO (no solo cantidades).
--   2. Implementar el parser de Excel y el commit transaccional.
--   3. Reemplazar los cálculos de la planilla por las vistas y funciones.
--   4. Probar la migración con Reporte.xlsx y CAJA TEMUCO V5.xlsx.
-- ============================================================================
