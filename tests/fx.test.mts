import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPurchase,
  applySale,
  computeAccountBalances,
  computeCashCount,
  computeCashDifference,
  computeCloseTotals,
  computeDailyFxStats,
  computeExpectedBalances,
  consumeFifo,
  groupReportRows,
  normalizeCurrency,
  normalizeReportRow,
  parseFxDate,
  parseStFolios,
  type FxFifoLot,
} from '../src/lib/domain/fx.ts';

test('normalizeCurrency: tolera NBSP, acentos y alias', () => {
  assert.deepEqual(normalizeCurrency('DÓLAR AUSTRALIANO \u00a0\u00a0'), {
    currency: 'AUD',
    instrument: 'EFECTIVO',
  });
  assert.deepEqual(normalizeCurrency('ARGENTINO T'), {
    currency: 'ARS',
    instrument: 'TRANSFERENCIA',
  });
  assert.deepEqual(normalizeCurrency('peso   argentino'), {
    currency: 'ARS',
    instrument: 'EFECTIVO',
  });
  assert.equal(normalizeCurrency('MONEDA RARA'), null);
});

test('parseFxDate: acepta dd-mm-yyyy, ISO y serial de Excel', () => {
  assert.equal(parseFxDate('01-09-2026'), '2026-09-01');
  assert.equal(parseFxDate('2026-09-01'), '2026-09-01');
  assert.equal(parseFxDate('31-02-2026'), null);
  assert.equal(parseFxDate(46266), '2026-09-01');
});

test('normalizeReportRow: normaliza una fila del reporte', () => {
  const row = normalizeReportRow(
    {
      OPERACION: 'Venta',
      CAJERO: 'asantibanez',
      DOCUMENTO: 'BOLETA',
      FOLIO: 76774,
      MONEDA: 'DOLAR',
      FECHA: '01-09-2026',
      MONTO_EXTRANJERA: 4500,
      TIPO_CAMBIO: 935,
      MONTO_NACIONAL: 4207500,
    },
    2,
  );

  assert.equal(row.operation, 'VENTA');
  assert.equal(row.currency, 'USD');
  assert.equal(row.businessDate, '2026-09-01');
  assert.equal(row.foreignAmount, 4500);
  assert.equal(row.fxRate, 935);
  assert.equal(row.clpAmount, 4207500);
  assert.equal(row.errors.length, 0);
});

test('groupReportRows: un folio multi-moneda es un solo documento', () => {
  const rows = [
    normalizeReportRow(
      {
        OPERACION: 'Compra',
        DOCUMENTO: 'BOLETA',
        FOLIO: 76978,
        MONEDA: 'DOLAR',
        FECHA: '22-09-2026',
        MONTO_EXTRANJERA: 200,
        TIPO_CAMBIO: 942,
        MONTO_NACIONAL: 188400,
      },
      208,
    ),
    normalizeReportRow(
      {
        OPERACION: 'Compra',
        DOCUMENTO: 'BOLETA',
        FOLIO: 76978,
        MONEDA: 'EUROS',
        FECHA: '22-09-2026',
        MONTO_EXTRANJERA: 5,
        TIPO_CAMBIO: 1100,
        MONTO_NACIONAL: 5500,
      },
      210,
    ),
  ];

  const groups = groupReportRows(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 2);
  assert.equal(groups[0].operation, 'COMPRA');
});

test('groupReportRows: folios 0 no se mezclan entre sí', () => {
  const rows = [
    normalizeReportRow(
      {
        OPERACION: 'Compra',
        DOCUMENTO: 'BOLETA',
        FOLIO: 0,
        MONEDA: 'DOLAR',
        FECHA: '02-11-2026',
        MONTO_EXTRANJERA: 300,
        TIPO_CAMBIO: 985,
        MONTO_NACIONAL: 295500,
      },
      1070,
    ),
    normalizeReportRow(
      {
        OPERACION: 'Compra',
        DOCUMENTO: 'BOLETA',
        FOLIO: 0,
        MONEDA: 'DOLAR',
        FECHA: '02-11-2026',
        MONTO_EXTRANJERA: 300,
        TIPO_CAMBIO: 985,
        MONTO_NACIONAL: 295500,
      },
      1071,
    ),
  ];

  assert.equal(groupReportRows(rows).length, 2);
});

test('computeDailyFxStats: excluye ST y pondera por volumen', () => {
  const stats = computeDailyFxStats([
    {
      documentStatus: 'VALID',
      businessDate: '2026-09-01',
      currency: 'USD',
      operation: 'COMPRA',
      foreignAmount: 100,
      clpAmount: 90000,
    },
    {
      documentStatus: 'VALID',
      businessDate: '2026-09-01',
      currency: 'USD',
      operation: 'COMPRA',
      foreignAmount: 50,
      clpAmount: 47500,
    },
    {
      documentStatus: 'VOID_ST',
      businessDate: '2026-09-01',
      currency: 'USD',
      operation: 'COMPRA',
      foreignAmount: 999,
      clpAmount: 999000,
    },
    {
      documentStatus: 'VALID',
      businessDate: '2026-09-01',
      currency: 'USD',
      operation: 'VENTA',
      foreignAmount: 120,
      clpAmount: 117600,
    },
  ]);

  assert.equal(stats.length, 1);
  assert.equal(stats[0].buyQty, 150);
  assert.equal(stats[0].buyClp, 137500);
  assert.equal(stats[0].avgBuyRate, 137500 / 150);
  assert.equal(stats[0].sellQty, 120);
  assert.equal(stats[0].avgSellRate, 980);
});

test('consumeFifo: consume primero las capas más antiguas', () => {
  const lots: FxFifoLot[] = [
    {
      id: 'lot-2',
      currency: 'USD',
      acquiredAt: '2026-09-02T00:00:00Z',
      sequence: 2,
      originalQty: 50,
      remainingQty: 50,
      unitCostClp: 950,
    },
    {
      id: 'lot-1',
      currency: 'USD',
      acquiredAt: '2026-09-01T00:00:00Z',
      sequence: 1,
      originalQty: 100,
      remainingQty: 100,
      unitCostClp: 900,
    },
  ];

  const result = consumeFifo(lots, 'USD', 120);
  assert.equal(result.shortfall, 0);
  assert.equal(result.consumptions.length, 2);
  assert.equal(result.consumptions[0].lotId, 'lot-1');
  assert.equal(result.consumptions[0].quantity, 100);
  assert.equal(result.consumptions[0].totalCostClp, 90000);
  assert.equal(result.consumptions[1].lotId, 'lot-2');
  assert.equal(result.consumptions[1].quantity, 20);
  assert.equal(result.totalCostClp, 109000);
  assert.equal(result.lots.find((lot) => lot.id === 'lot-2')?.remainingQty, 30);
});

test('consumeFifo: informa faltante sin mutar el arreglo original', () => {
  const lots: FxFifoLot[] = [
    {
      id: 'lot-1',
      currency: 'USD',
      acquiredAt: '2026-09-01T00:00:00Z',
      sequence: 1,
      originalQty: 100,
      remainingQty: 100,
      unitCostClp: 900,
    },
  ];

  const result = consumeFifo(lots, 'USD', 150);
  assert.equal(result.shortfall, 50);
  assert.equal(result.totalCostClp, 90000);
  assert.equal(lots[0].remainingQty, 100);
});

test('applyPurchase + applySale: calcula margen realizado FIFO', () => {
  const opening = applyPurchase([], {
    id: 'open',
    currency: 'USD',
    acquiredAt: '2026-09-01T00:00:00Z',
    quantity: 100,
    clpAmount: 90000,
  });

  const purchase = applyPurchase(opening.lots, {
    id: 'buy',
    currency: 'USD',
    acquiredAt: '2026-09-02T00:00:00Z',
    quantity: 50,
    clpAmount: 47500,
  });

  const sale = applySale(purchase.lots, {
    currency: 'USD',
    quantity: 120,
    clpAmount: 117600,
  });

  assert.equal(sale.totalCostClp, 109000);
  assert.equal(sale.marginClp, 8600);
  assert.equal(sale.shortfall, 0);
});

test('computeAccountBalances: separa deudores y acreedores', () => {
  const balances = computeAccountBalances([
    {
      counterpartyId: 'p1',
      currency: 'USD',
      side: 'RECEIVABLE',
      amountDelta: 100,
    },
    {
      counterpartyId: 'p1',
      currency: 'USD',
      side: 'RECEIVABLE',
      amountDelta: -40,
    },
    {
      counterpartyId: 'p1',
      currency: 'USD',
      side: 'PAYABLE',
      amountDelta: 10,
    },
  ]);

  assert.equal(balances.length, 1);
  assert.equal(balances[0].receivable, 60);
  assert.equal(balances[0].payable, 10);
  assert.equal(balances[0].net, 50);
});

test('computeExpectedBalances: apertura + movimientos', () => {
  const balances = computeExpectedBalances(
    { CLP: 1000000, USD: 1000 },
    [
      { currency: 'CLP', quantityDelta: -900000 },
      { currency: 'USD', quantityDelta: 1000 },
      { currency: 'USD', quantityDelta: -250 },
    ],
  );

  assert.equal(balances.CLP, 100000);
  assert.equal(balances.USD, 1750);
});

test('cuadratura: total contado y diferencia', () => {
  const counted = computeCashCount([
    { value: 20000, quantity: 2 },
    { value: 10000, quantity: 1 },
    { value: 1000, quantity: 3 },
  ]);
  assert.equal(counted, 53000);
  assert.equal(computeCashDifference(50000, counted), 3000);
});

test('parseStFolios: acepta rangos y deduplica', () => {
  assert.deepEqual(parseStFolios('76876, 76991-76993\n76876'), [
    '76876',
    '76991',
    '76992',
    '76993',
  ]);
  assert.deepEqual(parseStFolios('0, abc, 123'), ['123']);
});

test('computeCloseTotals: capital y resultado', () => {
  const totals = computeCloseTotals({
    cashClp: 1000000,
    inventoryValueClp: 2500000,
    realizedMarginClp: 50000,
    fxResultClp: -5000,
    expensesClp: 20000,
  });

  assert.equal(totals.totalCapitalClp, 3500000);
  assert.equal(totals.netResultClp, 25000);
});
