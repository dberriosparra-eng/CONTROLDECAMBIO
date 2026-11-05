-- ===========================================================================
-- Caja Temuco - parche de cierre, gastos y apertura automatica
-- Ejecutar una vez en el SQL Editor de Supabase.
-- ===========================================================================

-- 1. Funciones de apertura con costo automatico y arrastre del cierre anterior
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
  v_previous public.fx_sessions;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Usuario sin acceso a esta tienda';
  END IF;
  IF p_opening_mode NOT IN ('PREVIOUS_CLOSE', 'MANUAL', 'IMPORT') THEN
    RAISE EXCEPTION 'Modo de apertura invalido';
  END IF;

  SELECT * INTO v_session
  FROM public.fx_sessions
  WHERE store_id = p_store_id AND business_date = p_business_date;

  IF FOUND THEN
    RETURN v_session;
  END IF;

  SELECT * INTO v_previous
  FROM public.fx_sessions
  WHERE store_id = p_store_id AND business_date < p_business_date
  ORDER BY business_date DESC
  LIMIT 1;

  INSERT INTO public.fx_sessions (store_id, business_date, opening_mode, opened_by)
  VALUES (p_store_id, p_business_date, p_opening_mode, auth.uid())
  RETURNING * INTO v_session;

  -- Arrastra el cierre anterior como apertura del nuevo dia. Las capas FIFO
  -- son globales y no se duplican; solo se copia el saldo esperado.
  IF v_previous.id IS NOT NULL THEN
    INSERT INTO public.fx_opening_balances (
      store_id, session_id, currency_code, quantity,
      unit_cost_clp, clp_value, source
    )
    SELECT
      p_store_id,
      v_session.id,
      s.currency_code,
      s.expected_qty,
      CASE
        WHEN s.currency_code = 'CLP' THEN 1
        WHEN s.expected_qty > 0 THEN s.current_fifo_value_clp / s.expected_qty
        ELSE 0
      END,
      CASE
        WHEN s.currency_code = 'CLP' THEN s.expected_qty
        ELSE s.current_fifo_value_clp
      END,
      'PREVIOUS_CLOSE'
    FROM public.fx_session_currency_summary s
    WHERE s.session_id = v_previous.id
      AND s.expected_qty <> 0
    ON CONFLICT (session_id, currency_code) DO NOTHING;
  END IF;

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_ensure_session(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_ensure_session(uuid, date, text) TO authenticated;

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
  v_existing_value numeric;
  v_last_cost numeric;
  v_add_qty numeric;
  v_add_cost numeric;
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
    RAISE EXCEPTION 'Sesion no encontrada';
  END IF;
  IF v_session.status <> 'OPEN' THEN
    RAISE EXCEPTION 'La sesion no esta abierta';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fx_operations WHERE session_id = p_session_id) THEN
    RAISE EXCEPTION 'No se puede cambiar la apertura: la sesion ya tiene operaciones';
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
  -- apertura de esta sesion que todavia no hayan sido consumidas.
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
      RAISE EXCEPTION 'Cantidad o costo de apertura invalido para %', v_currency;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.fx_currencies WHERE code = v_currency) THEN
      RAISE EXCEPTION 'Moneda no valida: %', v_currency;
    END IF;

    IF v_currency = 'CLP' THEN
      v_cost := 1;
      v_clp := ROUND(v_qty, 2);
    ELSE
      -- Ajustar las capas FIFO para que el remanente coincida con la cantidad.
      SELECT
        COALESCE(SUM(remaining_qty), 0),
        COALESCE(SUM(remaining_qty * unit_cost_clp), 0)
      INTO v_existing_qty, v_existing_value
      FROM public.fx_lots
      WHERE store_id = p_store_id
        AND currency_code = v_currency
        AND remaining_qty > 0;

      IF v_qty > v_existing_qty + 0.000001 THEN
        SELECT unit_cost_clp INTO v_last_cost
        FROM public.fx_lots
        WHERE store_id = p_store_id
          AND currency_code = v_currency
          AND remaining_qty > 0
        ORDER BY acquired_at DESC, lot_seq DESC
        LIMIT 1;

        v_add_qty := v_qty - v_existing_qty;
        v_add_cost := CASE
          WHEN v_existing_qty > 0 THEN COALESCE(v_last_cost, v_cost)
          ELSE v_cost
        END;

        INSERT INTO public.fx_lots (
          store_id, currency_code, session_id, source_type,
          acquired_at, original_qty, remaining_qty, unit_cost_clp, note
        ) VALUES (
          p_store_id, v_currency, p_session_id,
          CASE WHEN v_existing_qty = 0 THEN 'OPENING' ELSE 'ADJUSTMENT' END,
          v_session.business_date::timestamp, v_add_qty, v_add_qty,
          v_add_cost, 'Apertura'
        );
      ELSIF v_qty < v_existing_qty - 0.000001 THEN
        PERFORM * FROM public.fx_consume_fifo(
          p_store_id, v_currency, v_existing_qty - v_qty, NULL, NULL,
          v_session.business_date::timestamp
        );
      END IF;

      -- El costo del saldo inicial sale del remanente FIFO: como se consumen
      -- primero las compras antiguas, quedan las compras mas recientes.
      SELECT
        COALESCE(SUM(remaining_qty), 0),
        COALESCE(SUM(remaining_qty * unit_cost_clp), 0)
      INTO v_existing_qty, v_existing_value
      FROM public.fx_lots
      WHERE store_id = p_store_id
        AND currency_code = v_currency
        AND remaining_qty > 0;

      v_cost := CASE
        WHEN v_existing_qty > 0 THEN v_existing_value / v_existing_qty
        ELSE 0
      END;
      v_clp := ROUND(v_existing_value, 2);
    END IF;

    INSERT INTO public.fx_opening_balances (
      store_id, session_id, currency_code, quantity, unit_cost_clp, clp_value, source
    ) VALUES (
      p_store_id, p_session_id, v_currency, v_qty, v_cost, v_clp, 'MANUAL'
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_save_opening(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_save_opening(uuid, uuid, jsonb) TO authenticated;

-- 2. Categorias de gastos personalizables
CREATE TABLE IF NOT EXISTS public.fx_expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS fx_expense_categories_store_name_idx
  ON public.fx_expense_categories (store_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS fx_expense_categories_store_idx
  ON public.fx_expense_categories (store_id, lower(name));

ALTER TABLE public.fx_expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fx_expense_categories_member_access ON public.fx_expense_categories;
CREATE POLICY fx_expense_categories_member_access ON public.fx_expense_categories
  FOR ALL TO authenticated
  USING (public.is_store_member(store_id))
  WITH CHECK (public.is_store_member(store_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fx_expense_categories TO authenticated;

-- 3. Rentabilidad por divisa antes de gastos
CREATE OR REPLACE VIEW public.fx_session_currency_margin
WITH (security_invoker = true)
AS
WITH regular AS (
  SELECT
    o.store_id,
    o.session_id,
    o.currency_code,
    SUM(o.clp_amount) AS sales_clp,
    SUM(COALESCE(c.cost, 0)) AS cost_clp,
    SUM(o.clp_amount - COALESCE(c.cost, 0)) AS margin_clp
  FROM public.fx_valid_operations o
  LEFT JOIN (
    SELECT operation_id, SUM(total_cost_clp) AS cost
    FROM public.fx_lot_consumptions
    WHERE reversed_at IS NULL
    GROUP BY operation_id
  ) c ON c.operation_id = o.id
  WHERE o.operation = 'VENTA'
  GROUP BY o.store_id, o.session_id, o.currency_code
),
wholesale AS (
  SELECT
    d.store_id,
    d.session_id,
    d.currency_code,
    SUM(s.clp_amount) AS sales_clp,
    SUM(COALESCE(c.cost, 0)) AS cost_clp,
    SUM(s.clp_amount - COALESCE(c.cost, 0)) AS margin_clp
  FROM public.fx_wholesale_deals d
  JOIN public.fx_wholesale_settlements s
    ON s.deal_id = d.id
   AND s.settlement_type = 'ENTREGA_DIVISA'
   AND d.deal_type = 'VENTA'
  LEFT JOIN (
    SELECT account_movement_id, SUM(total_cost_clp) AS cost
    FROM public.fx_lot_consumptions
    WHERE reversed_at IS NULL AND account_movement_id IS NOT NULL
    GROUP BY account_movement_id
  ) c ON c.account_movement_id = s.account_movement_id
  GROUP BY d.store_id, d.session_id, d.currency_code
)
SELECT
  store_id,
  session_id,
  currency_code,
  SUM(sales_clp) AS sales_clp,
  SUM(cost_clp) AS cost_clp,
  SUM(margin_clp) AS margin_clp,
  CASE
    WHEN SUM(sales_clp) > 0 THEN SUM(margin_clp) / SUM(sales_clp) * 100
    ELSE 0
  END AS margin_pct
FROM (
  SELECT * FROM regular
  UNION ALL
  SELECT * FROM wholesale
) margins
GROUP BY store_id, session_id, currency_code;

GRANT SELECT ON public.fx_session_currency_margin TO authenticated;

NOTIFY pgrst, 'reload schema';
