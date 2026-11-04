import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = process.cwd();
const migrations = [
  'supabase/migrations/202611040002_fx_casa_cambio.sql',
  'supabase/migrations/202611040003_fx_rpc.sql',
];

const db = new PGlite();
const userId = '11111111-1111-1111-1111-111111111111';

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

function closeTo(actual, expected, message) {
  const value = Number(actual);
  if (Math.abs(value - expected) > 0.001) {
    throw new Error(`ASSERT: ${message} (esperado ${expected}, recibido ${value})`);
  }
}

async function main() {
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
    AS $$ SELECT '${userId}'::uuid $$;
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    INSERT INTO auth.users(id, email) VALUES ('${userId}', 'test@example.com');
  `);

  for (const migration of migrations) {
    await db.exec(fs.readFileSync(path.join(root, migration), 'utf8'));
  }

  const store = (
    await db.query(`SELECT fx_ensure_store('Caja Test') AS id`)
  ).rows[0].id;
  const session = (
    await db.query(`SELECT id FROM fx_ensure_session($1, '2026-09-01', 'MANUAL')`, [
      store,
    ])
  ).rows[0].id;

  await db.query(`SELECT fx_save_opening($1, $2, $3::jsonb)`, [
    store,
    session,
    JSON.stringify([
      { currency_code: 'CLP', quantity: 1000000, unit_cost_clp: 1 },
      { currency_code: 'USD', quantity: 100, unit_cost_clp: 900 },
    ]),
  ]);

  const batch = (
    await db.query(
      `INSERT INTO fx_import_batches(store_id, session_id, file_name, status, rows_total)
       VALUES ($1, $2, 'Reporte.xlsx', 'PREVIEW', 3) RETURNING id`,
      [store, session],
    )
  ).rows[0].id;

  const documents = [
    {
      document_type: 'BOLETA',
      folio: '1',
      operation: 'COMPRA',
      business_date: '2026-09-01',
      status: 'VALID',
      lines: [
        {
          currency_code: 'USD',
          instrument: 'EFECTIVO',
          foreign_amount: 100,
          fx_rate: 950,
          clp_amount: 95000,
        },
      ],
    },
    {
      document_type: 'BOLETA',
      folio: '2',
      operation: 'VENTA',
      business_date: '2026-09-01',
      status: 'VALID',
      lines: [
        {
          currency_code: 'USD',
          instrument: 'EFECTIVO',
          foreign_amount: 120,
          fx_rate: 980,
          clp_amount: 117600,
        },
      ],
    },
    {
      document_type: 'BOLETA',
      folio: '3',
      operation: 'VENTA',
      business_date: '2026-09-01',
      status: 'VOID_ST',
      lines: [
        {
          currency_code: 'USD',
          instrument: 'EFECTIVO',
          foreign_amount: 10,
          fx_rate: 990,
          clp_amount: 9900,
        },
      ],
    },
  ];

  const importResult = (
    await db.query(`SELECT fx_import_batch($1, $2, $3, $4::jsonb) AS result`, [
      store,
      session,
      batch,
      JSON.stringify(documents),
    ])
  ).rows[0].result;
  assert(importResult.documents === 3, 'importa 3 documentos');
  assert(importResult.void_operations === 1, 'registra 1 operación ST');

  const summary = (
    await db.query(
      `SELECT currency_code, expected_qty, buy_qty, sell_qty, current_fifo_value_clp
       FROM fx_session_currency_summary
       WHERE session_id = $1 ORDER BY currency_code`,
      [session],
    )
  ).rows;

  const usd = summary.find((row) => row.currency_code === 'USD');
  const clp = summary.find((row) => row.currency_code === 'CLP');
  closeTo(usd.expected_qty, 80, 'USD esperado = 80');
  closeTo(usd.buy_qty, 100, 'USD comprado = 100');
  closeTo(usd.sell_qty, 120, 'USD vendido = 120');
  closeTo(usd.current_fifo_value_clp, 76000, 'USD FIFO = 76.000');
  closeTo(clp.expected_qty, 1022600, 'CLP esperado = 1.022.600');

  const margin = (
    await db.query(`SELECT realized_margin_clp FROM fx_session_margin WHERE session_id = $1`, [
      session,
    ])
  ).rows[0].realized_margin_clp;
  closeTo(margin, 8600, 'margen realizado = 8.600');

  const valuation = (
    await db.query(
      `SELECT quantity, value_clp FROM fx_inventory_valuation
       WHERE store_id = $1 AND currency_code = 'USD'`,
      [store],
    )
  ).rows[0];
  closeTo(valuation.quantity, 80, 'inventario USD = 80');
  closeTo(valuation.value_clp, 76000, 'valor inventario USD = 76.000');

  // Anular la venta por ST: debe restaurar las capas y el efectivo.
  const stId = (
    await db.query(`SELECT fx_add_st_folio($1, 'BOLETA', '2', 'ST', 'prueba') AS id`, [
      store,
    ])
  ).rows[0].id;

  const afterSt = (
    await db.query(
      `SELECT currency_code, expected_qty FROM fx_session_currency_summary
       WHERE session_id = $1 ORDER BY currency_code`,
      [session],
    )
  ).rows;
  closeTo(
    afterSt.find((row) => row.currency_code === 'USD').expected_qty,
    200,
    'USD tras ST = 200',
  );
  closeTo(
    afterSt.find((row) => row.currency_code === 'CLP').expected_qty,
    905000,
    'CLP tras ST = 905.000',
  );

  // Reversar el ST: debe volver a consumir FIFO.
  await db.query(`SELECT fx_reverse_st_folio($1, $2)`, [store, stId]);

  const afterReverse = (
    await db.query(
      `SELECT currency_code, expected_qty FROM fx_session_currency_summary
       WHERE session_id = $1 ORDER BY currency_code`,
      [session],
    )
  ).rows;
  closeTo(
    afterReverse.find((row) => row.currency_code === 'USD').expected_qty,
    80,
    'USD tras reversa = 80',
  );
  closeTo(
    afterReverse.find((row) => row.currency_code === 'CLP').expected_qty,
    1022600,
    'CLP tras reversa = 1.022.600',
  );

  // Una compra ya consumida no se puede anular por ST.
  let blocked = false;
  try {
    await db.query(`SELECT fx_add_st_folio($1, 'BOLETA', '1', 'ST', 'prueba')`, [store]);
  } catch {
    blocked = true;
  }
  assert(blocked, 'bloquea ST de una compra ya consumida');

  // Cuenta corriente: préstamo otorgado de 10 USD.
  const counterparty = (
    await db.query(
      `INSERT INTO fx_counterparties(store_id, name, kind)
       VALUES ($1, 'Cliente Test', 'CLIENTE') RETURNING id`,
      [store],
    )
  ).rows[0].id;

  await db.query(
    `SELECT fx_register_account_movement($1, $2, $3, 'PRESTAMO_OTORGADO', '2026-09-01', 'Préstamo', $4::jsonb)`,
    [
      store,
      session,
      counterparty,
      JSON.stringify([
        {
          currency_code: 'USD',
          side: 'RECEIVABLE',
          amount_delta: 10,
          fx_rate: 950,
          clp_equivalent: 9500,
          inventory_delta: -10,
          unit_cost_clp: 950,
        },
      ]),
    ],
  );

  const account = (
    await db.query(
      `SELECT receivable, payable, net FROM fx_account_balances
       WHERE store_id = $1 AND counterparty_id = $2 AND currency_code = 'USD'`,
      [store, counterparty],
    )
  ).rows[0];
  closeTo(account.receivable, 10, 'deudor USD = 10');
  closeTo(account.net, 10, 'neto USD = 10');

  const afterLoan = (
    await db.query(
      `SELECT expected_qty FROM fx_session_currency_summary
       WHERE session_id = $1 AND currency_code = 'USD'`,
      [session],
    )
  ).rows[0].expected_qty;
  closeTo(afterLoan, 70, 'USD tras préstamo = 70');

  // Cierre mayorista: pacto 100 USD @ 960, entrega 40 USD y pago 30.000 CLP.
  const wholesaler = (
    await db.query(
      `INSERT INTO fx_counterparties(store_id, name, kind)
       VALUES ($1, 'Proveedor Mayorista', 'PROVEEDOR') RETURNING id`,
      [store],
    )
  ).rows[0].id;

  const deal = (
    await db.query(
      `SELECT fx_register_wholesale_deal($1, $2, $3, 'COMPRA', 'USD', 100, 960, '2026-09-01', 'Cierre de prueba') AS id`,
      [store, session, wholesaler],
    )
  ).rows[0].id;

  await db.query(
    `SELECT fx_register_wholesale_settlement($1, $2, $3, 'ENTREGA_DIVISA', 40, '2026-09-01', 'Entrega parcial')`,
    [store, deal, session],
  );
  await db.query(
    `SELECT fx_register_wholesale_settlement($1, $2, $3, 'PAGO_CLP', 30000, '2026-09-01', 'Pago parcial')`,
    [store, deal, session],
  );

  const dealStatus = (
    await db.query(`SELECT * FROM fx_wholesale_deals_status WHERE id = $1`, [deal])
  ).rows[0];
  closeTo(dealStatus.delivered_qty, 40, 'entrega mayorista = 40');
  closeTo(dealStatus.paid_clp, 30000, 'pago mayorista = 30.000');
  closeTo(dealStatus.pending_qty, 60, 'pendiente divisa = 60');
  closeTo(dealStatus.pending_clp, 66000, 'pendiente CLP = 66.000');
  assert(dealStatus.status === 'PARCIAL', 'cierre mayorista parcial');

  const wholesaleAccount = (
    await db.query(
      `SELECT currency_code, receivable, payable, net
       FROM fx_account_balances
       WHERE store_id = $1 AND counterparty_id = $2
       ORDER BY currency_code`,
      [store, wholesaler],
    )
  ).rows;
  closeTo(
    wholesaleAccount.find((row) => row.currency_code === 'USD').receivable,
    60,
    'deudor mayorista USD = 60',
  );
  closeTo(
    wholesaleAccount.find((row) => row.currency_code === 'CLP').payable,
    66000,
    'acreedor mayorista CLP = 66.000',
  );

  // Cierre mayorista de venta: 20 USD @ 1.000, entrega total y cobro total.
  const wholesaleClient = (
    await db.query(
      `INSERT INTO fx_counterparties(store_id, name, kind)
       VALUES ($1, 'Cliente Mayorista', 'CLIENTE') RETURNING id`,
      [store],
    )
  ).rows[0].id;

  const saleDeal = (
    await db.query(
      `SELECT fx_register_wholesale_deal($1, $2, $3, 'VENTA', 'USD', 20, 1000, '2026-09-01', 'Venta mayorista') AS id`,
      [store, session, wholesaleClient],
    )
  ).rows[0].id;

  await db.query(
    `SELECT fx_register_wholesale_settlement($1, $2, $3, 'ENTREGA_DIVISA', 20, '2026-09-01', 'Entrega total')`,
    [store, saleDeal, session],
  );
  await db.query(
    `SELECT fx_register_wholesale_settlement($1, $2, $3, 'PAGO_CLP', 20000, '2026-09-01', 'Cobro total')`,
    [store, saleDeal, session],
  );

  const saleDealStatus = (
    await db.query(`SELECT * FROM fx_wholesale_deals_status WHERE id = $1`, [saleDeal])
  ).rows[0];
  assert(saleDealStatus.status === 'CERRADO', 'cierre mayorista de venta cerrado');
  closeTo(saleDealStatus.pending_qty, 0, 'venta mayorista sin pendiente divisa');
  closeTo(saleDealStatus.pending_clp, 0, 'venta mayorista sin pendiente CLP');

  const wholesaleMargin = (
    await db.query(
      `SELECT realized_margin_clp FROM fx_wholesale_margin WHERE deal_id = $1`,
      [saleDeal],
    )
  ).rows[0].realized_margin_clp;
  closeTo(wholesaleMargin, 1000, 'margen mayorista = 1.000');

  const totalMargin = (
    await db.query(
      `SELECT realized_margin_clp FROM fx_session_margin WHERE session_id = $1`,
      [session],
    )
  ).rows[0].realized_margin_clp;
  closeTo(totalMargin, 9600, 'margen total = 9.600');

  const usdMargin = (
    await db.query(
      `SELECT sales_clp, cost_clp, margin_clp
       FROM fx_session_currency_margin
       WHERE session_id = $1 AND currency_code = 'USD'`,
      [session],
    )
  ).rows[0];
  closeTo(usdMargin.sales_clp, 137600, 'ventas USD para margen = 137.600');
  closeTo(usdMargin.cost_clp, 128000, 'costo USD para margen = 128.000');
  closeTo(usdMargin.margin_clp, 9600, 'margen USD = 9.600');

  // Gasto: descuenta caja CLP y resultado.
  await db.query(
    `SELECT fx_register_expense($1, $2, '2026-09-01', 'Arriendo', 'ARRIENDO', 20000, 'prueba')`,
    [store, session],
  );

  // Conteo físico y cierre.
  await db.query(`SELECT fx_save_cash_counts($1, $2, $3::jsonb)`, [
    store,
    session,
    JSON.stringify([
      { currency_code: 'CLP', denomination_value: 20000, quantity: 45 },
      { currency_code: 'CLP', denomination_value: 10000, quantity: 12 },
      { currency_code: 'USD', denomination_value: 50, quantity: 1 },
      { currency_code: 'USD', denomination_value: 20, quantity: 1 },
    ]),
  ]);

  const closure = (
    await db.query(`SELECT * FROM fx_close_session($1, $2, 'Cierre de prueba')`, [
      store,
      session,
    ])
  ).rows[0];
  closeTo(closure.total_cash_clp, 992600, 'caja CLP de cierre');
  closeTo(closure.total_inventory_clp, 85900, 'inventario FIFO de cierre');
  closeTo(closure.total_capital_clp, 1078500, 'capital de cierre');
  closeTo(closure.realized_margin_clp, 9600, 'margen de cierre');
  closeTo(closure.expenses_clp, 20000, 'gastos de cierre');
  closeTo(closure.net_result_clp, -10400, 'resultado de cierre');

  const closedSession = (
    await db.query(`SELECT status FROM fx_sessions WHERE id = $1`, [session])
  ).rows[0].status;
  assert(closedSession === 'CLOSED', 'sesión cerrada');

  console.log('OK flujo completo: apertura, importación, ST, FIFO, cuentas, mayoristas, gastos, conteo y cierre');
  console.log('Resumen de cierre:', {
    cash_clp: Number(closure.total_cash_clp),
    inventory_clp: Number(closure.total_inventory_clp),
    margin_clp: Number(closure.realized_margin_clp),
    expenses_clp: Number(closure.expenses_clp),
    net_result_clp: Number(closure.net_result_clp),
    capital_clp: Number(closure.total_capital_clp),
  });
}

main()
  .catch((error) => {
    console.error('FALLO:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
