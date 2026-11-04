-- ============================================================================
-- Caja Temuco · RPC transaccionales
-- ============================================================================
-- Requiere 202611040002_fx_casa_cambio.sql.
-- Estas funciones concentran las operaciones que deben ser atómicas:
-- apertura, importación, cuentas corrientes, conteo y cierre.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 01. Tienda y sesión
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
    RAISE EXCEPTION 'Sesión requerida';
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

CREATE OR REPLACE FUNCTION public.fx_ensure_currency(
  p_code text,
  p_name text,
  p_symbol text DEFAULT '',
  p_decimals integer DEFAULT 2
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_code text := upper(btrim(COALESCE(p_code, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sesión requerida';
  END IF;
  IF v_code !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Código ISO inválido: %', v_code;
  END IF;

  INSERT INTO public.fx_currencies (
    code, name, symbol, decimals, is_base, is_active, sort_order
  ) VALUES (
    v_code,
    COALESCE(NULLIF(btrim(p_name), ''), v_code),
    COALESCE(p_symbol, ''),
    GREATEST(0, LEAST(6, COALESCE(p_decimals, 2))),
    false,
    true,
    1000
  )
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    symbol = EXCLUDED.symbol,
    decimals = EXCLUDED.decimals,
    is_active = true;

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_ensure_currency(text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_ensure_currency(text, text, text, integer) TO authenticated;

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
    RAISE EXCEPTION 'Modo de apertura inválido';
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

  -- Arrastra el cierre anterior como apertura del nuevo día. Las capas FIFO
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
    RAISE EXCEPTION 'Sesión no encontrada';
  END IF;
  IF v_session.status <> 'OPEN' THEN
    RAISE EXCEPTION 'La sesión no está abierta';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fx_operations WHERE session_id = p_session_id) THEN
    RAISE EXCEPTION 'No se puede cambiar la apertura: la sesión ya tiene operaciones';
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
  -- apertura de esta sesión que todavía no hayan sido consumidas.
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
      RAISE EXCEPTION 'Cantidad o costo de apertura inválido para %', v_currency;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.fx_currencies WHERE code = v_currency) THEN
      RAISE EXCEPTION 'Moneda no válida: %', v_currency;
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
      -- primero las compras antiguas, quedan las compras más recientes.
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

-- ----------------------------------------------------------------------------
-- 03. Importación transaccional
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
    RAISE EXCEPTION 'Sesión no encontrada';
  END IF;
  IF v_session.status <> 'OPEN' THEN
    RAISE EXCEPTION 'La sesión no está abierta';
  END IF;

  FOR v_doc IN SELECT value FROM jsonb_array_elements(p_documents)
  LOOP
    v_folio := btrim(COALESCE(v_doc->>'folio', ''));
    v_doc_type := upper(COALESCE(NULLIF(btrim(v_doc->>'document_type'), ''), 'BOLETA'));
    v_operation := upper(COALESCE(v_doc->>'operation', ''));
    v_status := upper(COALESCE(v_doc->>'status', 'VALID'));
    v_business_date := COALESCE((v_doc->>'business_date')::date, v_session.business_date);

    IF v_operation NOT IN ('COMPRA', 'VENTA') THEN
      RAISE EXCEPTION 'Operación de documento inválida: %', v_operation;
    END IF;
    IF v_doc_type NOT IN ('BOLETA', 'FACTURA', 'TICKET', 'OTRO') THEN
      RAISE EXCEPTION 'Tipo de documento inválido: %', v_doc_type;
    END IF;
    IF v_status NOT IN ('VALID', 'VOID_ST', 'VOID_NC', 'VOID_OTHER', 'REVIEW') THEN
      RAISE EXCEPTION 'Estado de documento inválido: %', v_status;
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
        RAISE EXCEPTION 'Línea inválida para el folio %', v_folio;
      END IF;
      IF v_instrument NOT IN ('EFECTIVO', 'TRANSFERENCIA', 'OTRO') THEN
        RAISE EXCEPTION 'Instrumento inválido: %', v_instrument;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.fx_currencies WHERE code = v_currency) THEN
        RAISE EXCEPTION 'Moneda no válida: %', v_currency;
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
    RAISE EXCEPTION 'Tipo de movimiento inválido';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'El movimiento debe tener al menos una línea';
  END IF;

  SELECT * INTO v_session
  FROM public.fx_sessions
  WHERE id = p_session_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión no encontrada';
  END IF;
  IF v_session.status <> 'OPEN' THEN
    RAISE EXCEPTION 'La sesión no está abierta';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.fx_counterparties
    WHERE id = p_counterparty_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Contraparte no válida';
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
      RAISE EXCEPTION 'Lado de cuenta inválido: %', v_side;
    END IF;
    IF v_amount = 0 THEN
      RAISE EXCEPTION 'El monto de la línea no puede ser 0';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.fx_currencies WHERE code = v_currency) THEN
      RAISE EXCEPTION 'Moneda no válida: %', v_currency;
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
-- 05. Conteo físico
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
    RAISE EXCEPTION 'Sesión no encontrada';
  END IF;
  IF v_session.status <> 'OPEN' THEN
    RAISE EXCEPTION 'La sesión no está abierta';
  END IF;

  DELETE FROM public.fx_cash_counts WHERE session_id = p_session_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_counts)
  LOOP
    v_currency := upper(btrim(COALESCE(v_item->>'currency_code', '')));
    v_value := COALESCE((v_item->>'denomination_value')::numeric, 0);
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);

    IF v_value <= 0 OR v_quantity < 0 THEN
      RAISE EXCEPTION 'Denominación o cantidad inválida para %', v_currency;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.fx_currencies WHERE code = v_currency) THEN
      RAISE EXCEPTION 'Moneda no válida: %', v_currency;
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
-- 05.b Mayoristas: cierre pactado y liquidaciones parciales
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_register_wholesale_deal(
  p_store_id uuid,
  p_session_id uuid,
  p_counterparty_id uuid,
  p_deal_type text,
  p_currency_code text,
  p_agreed_qty numeric,
  p_agreed_rate numeric,
  p_business_date date,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_session public.fx_sessions;
  v_deal_id uuid;
  v_movement_id uuid;
  v_agreed_clp numeric;
  v_currency text := upper(btrim(p_currency_code));
  v_type text := upper(btrim(p_deal_type));
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Usuario sin acceso a esta tienda';
  END IF;
  IF v_type NOT IN ('COMPRA', 'VENTA') THEN
    RAISE EXCEPTION 'Tipo de cierre mayorista inválido';
  END IF;
  IF p_agreed_qty IS NULL OR p_agreed_qty <= 0 OR p_agreed_rate IS NULL OR p_agreed_rate <= 0 THEN
    RAISE EXCEPTION 'Cantidad y precio del cierre deben ser mayores a 0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fx_currencies WHERE code = v_currency) THEN
    RAISE EXCEPTION 'Moneda no válida: %', v_currency;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.fx_counterparties
    WHERE id = p_counterparty_id AND store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Contraparte no válida';
  END IF;

  SELECT * INTO v_session
  FROM public.fx_sessions
  WHERE id = p_session_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión no encontrada';
  END IF;
  IF v_session.status <> 'OPEN' THEN
    RAISE EXCEPTION 'La sesión no está abierta';
  END IF;

  v_agreed_clp := ROUND(p_agreed_qty * p_agreed_rate, 2);

  INSERT INTO public.fx_wholesale_deals (
    store_id, session_id, counterparty_id, deal_type, currency_code,
    agreed_qty, agreed_rate, agreed_clp, business_date, status, notes, created_by
  ) VALUES (
    p_store_id, p_session_id, p_counterparty_id, v_type, v_currency,
    p_agreed_qty, p_agreed_rate, v_agreed_clp, p_business_date, 'ABIERTO',
    p_notes, auth.uid()
  ) RETURNING id INTO v_deal_id;

  INSERT INTO public.fx_account_movements (
    store_id, session_id, counterparty_id, movement_type,
    business_date, status, note, created_by
  ) VALUES (
    p_store_id, p_session_id, p_counterparty_id,
    CASE WHEN v_type = 'COMPRA' THEN 'MAYORISTA_COMPRA' ELSE 'MAYORISTA_VENTA' END,
    p_business_date, 'ACTIVE', p_notes, auth.uid()
  ) RETURNING id INTO v_movement_id;

  IF v_type = 'COMPRA' THEN
    INSERT INTO public.fx_account_lines (
      store_id, movement_id, currency_code, side, amount_delta,
      fx_rate, clp_equivalent, note
    ) VALUES (
      p_store_id, v_movement_id, v_currency, 'RECEIVABLE', p_agreed_qty,
      p_agreed_rate, v_agreed_clp, 'Cierre mayorista: entrega pendiente'
    );
    INSERT INTO public.fx_account_lines (
      store_id, movement_id, currency_code, side, amount_delta,
      fx_rate, clp_equivalent, note
    ) VALUES (
      p_store_id, v_movement_id, 'CLP', 'PAYABLE', v_agreed_clp,
      1, v_agreed_clp, 'Cierre mayorista: pago pendiente'
    );
  ELSE
    INSERT INTO public.fx_account_lines (
      store_id, movement_id, currency_code, side, amount_delta,
      fx_rate, clp_equivalent, note
    ) VALUES (
      p_store_id, v_movement_id, v_currency, 'PAYABLE', p_agreed_qty,
      p_agreed_rate, v_agreed_clp, 'Cierre mayorista: entrega pendiente'
    );
    INSERT INTO public.fx_account_lines (
      store_id, movement_id, currency_code, side, amount_delta,
      fx_rate, clp_equivalent, note
    ) VALUES (
      p_store_id, v_movement_id, 'CLP', 'RECEIVABLE', v_agreed_clp,
      1, v_agreed_clp, 'Cierre mayorista: cobro pendiente'
    );
  END IF;

  UPDATE public.fx_wholesale_deals
  SET account_movement_id = v_movement_id
  WHERE id = v_deal_id;

  RETURN v_deal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_register_wholesale_deal(uuid, uuid, uuid, text, text, numeric, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_register_wholesale_deal(uuid, uuid, uuid, text, text, numeric, numeric, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fx_register_wholesale_settlement(
  p_store_id uuid,
  p_deal_id uuid,
  p_session_id uuid,
  p_settlement_type text,
  p_amount numeric,
  p_business_date date,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_deal public.fx_wholesale_deals;
  v_session public.fx_sessions;
  v_settlement_id uuid;
  v_movement_id uuid;
  v_type text := upper(btrim(p_settlement_type));
  v_delivered numeric := 0;
  v_paid numeric := 0;
  v_pending_qty numeric;
  v_pending_clp numeric;
  v_clp numeric;
  v_acquired timestamptz;
BEGIN
  IF NOT public.is_store_member(p_store_id) THEN
    RAISE EXCEPTION 'Usuario sin acceso a esta tienda';
  END IF;
  IF v_type NOT IN ('ENTREGA_DIVISA', 'PAGO_CLP') THEN
    RAISE EXCEPTION 'Tipo de liquidación inválido';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto de la liquidación debe ser mayor a 0';
  END IF;

  SELECT * INTO v_deal
  FROM public.fx_wholesale_deals
  WHERE id = p_deal_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cierre mayorista no encontrado';
  END IF;
  IF v_deal.status IN ('CERRADO', 'ANULADO') THEN
    RAISE EXCEPTION 'El cierre mayorista ya está %', v_deal.status;
  END IF;

  SELECT * INTO v_session
  FROM public.fx_sessions
  WHERE id = p_session_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión no encontrada';
  END IF;
  IF v_session.status <> 'OPEN' THEN
    RAISE EXCEPTION 'La sesión no está abierta';
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN settlement_type = 'ENTREGA_DIVISA' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN settlement_type = 'PAGO_CLP' THEN clp_amount ELSE 0 END), 0)
  INTO v_delivered, v_paid
  FROM public.fx_wholesale_settlements
  WHERE deal_id = p_deal_id;

  v_pending_qty := v_deal.agreed_qty - v_delivered;
  v_pending_clp := v_deal.agreed_clp - v_paid;

  IF v_type = 'ENTREGA_DIVISA' THEN
    IF p_amount > v_pending_qty + 0.000001 THEN
      RAISE EXCEPTION 'La entrega supera lo pendiente (% %)', v_pending_qty, v_deal.currency_code;
    END IF;
    v_clp := ROUND(p_amount * v_deal.agreed_rate, 2);
  ELSE
    IF p_amount > v_pending_clp + 0.01 THEN
      RAISE EXCEPTION 'El pago supera lo pendiente (% CLP)', v_pending_clp;
    END IF;
    v_clp := p_amount;
  END IF;

  INSERT INTO public.fx_wholesale_settlements (
    store_id, deal_id, session_id, settlement_type, currency_code,
    amount, fx_rate, clp_amount, business_date, note, created_by
  ) VALUES (
    p_store_id, p_deal_id, p_session_id, v_type,
    CASE WHEN v_type = 'ENTREGA_DIVISA' THEN v_deal.currency_code ELSE 'CLP' END,
    p_amount,
    CASE WHEN v_type = 'ENTREGA_DIVISA' THEN v_deal.agreed_rate ELSE 1 END,
    v_clp, p_business_date, p_note, auth.uid()
  ) RETURNING id INTO v_settlement_id;

  INSERT INTO public.fx_account_movements (
    store_id, session_id, counterparty_id, movement_type,
    business_date, status, note, created_by
  ) VALUES (
    p_store_id, p_session_id, v_deal.counterparty_id,
    CASE WHEN v_type = 'ENTREGA_DIVISA' THEN 'MAYORISTA_ENTREGA' ELSE 'MAYORISTA_PAGO' END,
    p_business_date, 'ACTIVE', p_note, auth.uid()
  ) RETURNING id INTO v_movement_id;

  UPDATE public.fx_wholesale_settlements
  SET account_movement_id = v_movement_id
  WHERE id = v_settlement_id;

  IF v_type = 'ENTREGA_DIVISA' THEN
    IF v_deal.deal_type = 'COMPRA' THEN
      INSERT INTO public.fx_account_lines (
        store_id, movement_id, currency_code, side, amount_delta,
        fx_rate, clp_equivalent, note
      ) VALUES (
        p_store_id, v_movement_id, v_deal.currency_code, 'RECEIVABLE', -p_amount,
        v_deal.agreed_rate, -v_clp, 'Entrega recibida del proveedor'
      );

      v_acquired := p_business_date::timestamp + interval '12 hours';

      INSERT INTO public.fx_lots (
        store_id, currency_code, session_id, source_type,
        source_account_movement_id, acquired_at,
        original_qty, remaining_qty, unit_cost_clp, note
      ) VALUES (
        p_store_id, v_deal.currency_code, p_session_id, 'WHOLESALE',
        v_movement_id, v_acquired, p_amount, p_amount, v_deal.agreed_rate,
        'Mayorista ' || p_deal_id
      );

      INSERT INTO public.fx_inventory_movements (
        store_id, session_id, currency_code, movement_type,
        quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
        business_date, note
      ) VALUES (
        p_store_id, p_session_id, v_deal.currency_code, 'PURCHASE',
        p_amount, v_deal.agreed_rate, 0, 'WHOLESALE_SETTLEMENT', v_settlement_id,
        p_business_date, p_note
      );
    ELSE
      INSERT INTO public.fx_account_lines (
        store_id, movement_id, currency_code, side, amount_delta,
        fx_rate, clp_equivalent, note
      ) VALUES (
        p_store_id, v_movement_id, v_deal.currency_code, 'PAYABLE', -p_amount,
        v_deal.agreed_rate, -v_clp, 'Entrega realizada al cliente'
      );

      PERFORM * FROM public.fx_consume_fifo(
        p_store_id, v_deal.currency_code, p_amount, NULL, v_movement_id,
        p_business_date::timestamp + interval '12 hours'
      );

      INSERT INTO public.fx_inventory_movements (
        store_id, session_id, currency_code, movement_type,
        quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
        business_date, note
      ) VALUES (
        p_store_id, p_session_id, v_deal.currency_code, 'SALE',
        -p_amount, v_deal.agreed_rate, 0, 'WHOLESALE_SETTLEMENT', v_settlement_id,
        p_business_date, p_note
      );
    END IF;
  ELSE
    IF v_deal.deal_type = 'COMPRA' THEN
      INSERT INTO public.fx_account_lines (
        store_id, movement_id, currency_code, side, amount_delta,
        fx_rate, clp_equivalent, note
      ) VALUES (
        p_store_id, v_movement_id, 'CLP', 'PAYABLE', -p_amount,
        1, -p_amount, 'Pago al proveedor'
      );
    ELSE
      INSERT INTO public.fx_account_lines (
        store_id, movement_id, currency_code, side, amount_delta,
        fx_rate, clp_equivalent, note
      ) VALUES (
        p_store_id, v_movement_id, 'CLP', 'RECEIVABLE', -p_amount,
        1, -p_amount, 'Cobro del cliente'
      );
    END IF;

    INSERT INTO public.fx_inventory_movements (
      store_id, session_id, currency_code, movement_type,
      quantity_delta, unit_cost_clp, clp_delta, reference_type, reference_id,
      business_date, note
    ) VALUES (
      p_store_id, p_session_id, 'CLP',
      CASE WHEN v_deal.deal_type = 'COMPRA' THEN 'PURCHASE' ELSE 'SALE' END,
      CASE WHEN v_deal.deal_type = 'COMPRA' THEN -p_amount ELSE p_amount END,
      1,
      CASE WHEN v_deal.deal_type = 'COMPRA' THEN -p_amount ELSE p_amount END,
      'WHOLESALE_SETTLEMENT', v_settlement_id,
      p_business_date, p_note
    );
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN settlement_type = 'ENTREGA_DIVISA' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN settlement_type = 'PAGO_CLP' THEN clp_amount ELSE 0 END), 0)
  INTO v_delivered, v_paid
  FROM public.fx_wholesale_settlements
  WHERE deal_id = p_deal_id;

  UPDATE public.fx_wholesale_deals
  SET status = CASE
    WHEN v_delivered >= agreed_qty - 0.000001 AND v_paid >= agreed_clp - 0.01 THEN 'CERRADO'
    WHEN v_delivered > 0 OR v_paid > 0 THEN 'PARCIAL'
    ELSE 'ABIERTO'
  END
  WHERE id = p_deal_id;

  RETURN v_settlement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fx_register_wholesale_settlement(uuid, uuid, uuid, text, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fx_register_wholesale_settlement(uuid, uuid, uuid, text, numeric, date, text) TO authenticated;

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
    RAISE EXCEPTION 'Sesión no encontrada';
  END IF;
  IF v_session.status <> 'OPEN' THEN
    RAISE EXCEPTION 'La sesión no está abierta';
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
    RAISE EXCEPTION 'Sesión no encontrada';
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

  v_margin_clp := v_margin_clp + COALESCE((
    SELECT SUM(realized_margin_clp)
    FROM public.fx_wholesale_margin
    WHERE session_id = p_session_id
  ), 0);

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
    'wholesale', COALESCE((
      SELECT jsonb_agg(to_jsonb(w))
      FROM public.fx_wholesale_deals_status w
      WHERE w.store_id = p_store_id AND w.status <> 'ANULADO'
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

-- Procesa un documento que ya existe pero cuyas líneas no tienen efecto FIFO
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
    RAISE EXCEPTION 'El documento no está válido';
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
-- que el lote esté intacto; si ya fue consumido, bloquea la operación.
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
    RAISE EXCEPTION 'El folio ST no puede estar vacío ni ser 0';
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
--     Si una compra ya fue consumida, bloquea la anulación y exige un ajuste.
--   * fx_reverse_st_folio vuelve a procesar el documento si estaba importado
--     como VOID_ST y por lo tanto no tenía capas/consumos.
--   * El historial nunca se borra: se agregan movimientos de ajuste y se
--     marcan los consumos como reversados.
-- ============================================================================
