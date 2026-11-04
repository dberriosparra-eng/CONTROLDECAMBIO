-- ===========================================================================
-- Caja Temuco - parche: monedas del mundo y seguridad de vistas
-- Ejecutar una vez en el SQL Editor de Supabase.
-- ===========================================================================

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
    RAISE EXCEPTION 'Sesion requerida';
  END IF;
  IF v_code !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Codigo ISO invalido: %', v_code;
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

CREATE OR REPLACE VIEW public.fx_session_currency_summary
WITH (security_invoker = true)
AS
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
  CASE
    WHEN COALESCE(o.quantity, 0) + COALESCE(m.quantity_delta, 0) > 0
    THEN COALESCE(v.value_clp, 0)
    ELSE 0
  END AS current_fifo_value_clp
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

ALTER VIEW public.fx_valid_operations SET (security_invoker = true);
ALTER VIEW public.fx_daily_currency_stats SET (security_invoker = true);
ALTER VIEW public.fx_session_inventory_balance SET (security_invoker = true);
ALTER VIEW public.fx_inventory_valuation SET (security_invoker = true);
ALTER VIEW public.fx_wholesale_margin SET (security_invoker = true);
ALTER VIEW public.fx_session_margin SET (security_invoker = true);
ALTER VIEW public.fx_account_balances SET (security_invoker = true);
ALTER VIEW public.fx_wholesale_deals_status SET (security_invoker = true);
ALTER VIEW public.fx_session_currency_summary SET (security_invoker = true);

NOTIFY pgrst, 'reload schema';
