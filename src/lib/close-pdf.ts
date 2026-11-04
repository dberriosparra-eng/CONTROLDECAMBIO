import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export type ClosePdfData = {
  storeName: string;
  businessDate: string;
  summary: Array<{
    currency_code: string;
    opening_qty: number;
    opening_clp: number;
    buy_qty: number;
    buy_clp: number;
    sell_qty: number;
    sell_clp: number;
    expected_qty: number;
    current_fifo_value_clp: number;
  }>;
  margins: Array<{
    currency_code: string;
    sales_clp: number;
    cost_clp: number;
    margin_clp: number;
    margin_pct: number;
  }>;
  expenses: Array<{ concept: string; category: string; amount_clp: number }>;
  accounts: Array<{
    counterparty_name?: string;
    currency_code: string;
    receivable: number;
    payable: number;
    net: number;
  }>;
  wholesale: Array<{
    counterparty_name?: string;
    deal_type: string;
    currency_code: string;
    agreed_qty: number;
    agreed_rate: number;
    agreed_clp: number;
    delivered_qty: number;
    paid_clp: number;
    pending_qty: number;
    pending_clp: number;
    status: string;
  }>;
  counts: Array<{
    currency_code: string;
    denomination_value: number;
    quantity: number;
    total: number;
  }>;
  totals: {
    cashClp: number;
    inventoryClp: number;
    capitalClp: number;
    marginClp: number;
    expensesClp: number;
    netResultClp: number;
  };
};

const clp = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

const qty = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 6 });
const rate = new Intl.NumberFormat('es-CL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

function money(value: number) {
  return clp.format(Number(value) || 0);
}

function number(value: number) {
  return qty.format(Number(value) || 0);
}

function rateText(value: number) {
  return rate.format(Number(value) || 0);
}

function dateText(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function generateClosePdf(data: ClosePdfData) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('Cierre diario - Caja Temuco', 14, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Negocio: ${data.storeName}`, 14, y);
  y += 5;
  doc.text(`Fecha: ${dateText(data.businessDate)}`, 14, y);
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [['Resumen', 'Monto']],
    body: [
      ['Caja CLP', money(data.totals.cashClp)],
      ['Inventario FIFO', money(data.totals.inventoryClp)],
      ['Capital total', money(data.totals.capitalClp)],
      ['Margen bruto antes de gastos', money(data.totals.marginClp)],
      ['Gastos', money(data.totals.expensesClp)],
      ['Resultado neto', money(data.totals.netResultClp)],
    ],
    theme: 'grid',
    styles: { fontSize: 9 },
    headStyles: { fillColor: [30, 41, 59] },
    margin: { left: 14, right: 14 },
  });

  autoTable(doc, {
    head: [['Divisa', 'Apertura', 'Compras', 'Ventas', 'Esperado', 'Valor FIFO']],
    body: data.summary.map((row) => [
      row.currency_code,
      number(row.opening_qty),
      number(row.buy_qty),
      number(row.sell_qty),
      number(row.expected_qty),
      money(row.current_fifo_value_clp),
    ]),
    theme: 'striped',
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
    margin: { left: 14, right: 14 },
    didDrawPage: () => {
      y = 16;
    },
  });

  autoTable(doc, {
    head: [['Divisa', 'Ventas CLP', 'Costo FIFO', 'Margen', 'Margen %']],
    body: data.margins.map((row) => [
      row.currency_code,
      money(row.sales_clp),
      money(row.cost_clp),
      money(row.margin_clp),
      `${Number(row.margin_pct || 0).toFixed(2)}%`,
    ]),
    theme: 'grid',
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
    margin: { left: 14, right: 14 },
  });

  autoTable(doc, {
    head: [['Gasto', 'Categoría', 'Monto CLP']],
    body:
      data.expenses.length > 0
        ? data.expenses.map((row) => [row.concept, row.category, money(row.amount_clp)])
        : [['Sin gastos registrados', '', money(0)]],
    theme: 'striped',
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
    margin: { left: 14, right: 14 },
  });

  autoTable(doc, {
    head: [
      ['Contraparte', 'Tipo', 'Divisa', 'Pactado', 'Entregado', 'Pagado', 'Pendiente', 'Estado'],
    ],
    body:
      data.wholesale.length > 0
        ? data.wholesale.map((row) => [
            row.counterparty_name ?? 'Sin nombre',
            row.deal_type,
            row.currency_code,
            `${number(row.agreed_qty)} @ ${rateText(row.agreed_rate)}`,
            number(row.delivered_qty),
            money(row.paid_clp),
            `${number(row.pending_qty)} / ${money(row.pending_clp)}`,
            row.status,
          ])
        : [['Sin cierres mayoristas', '', '', '', '', '', '', '']],
    theme: 'striped',
    styles: { fontSize: 7 },
    headStyles: { fillColor: [30, 41, 59] },
    margin: { left: 14, right: 14 },
  });

  autoTable(doc, {
    head: [['Contraparte', 'Divisa', 'Nos deben', 'Les debemos', 'Neto']],
    body:
      data.accounts.length > 0
        ? data.accounts.map((row) => [
            row.counterparty_name ?? 'Sin nombre',
            row.currency_code,
            number(row.receivable),
            number(row.payable),
            number(row.net),
          ])
        : [['Sin cuentas corrientes', '', '', '', '']],
    theme: 'grid',
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
    margin: { left: 14, right: 14 },
  });

  const countRows = data.counts
    .filter((row) => Number(row.quantity) > 0)
    .map((row) => [
      row.currency_code,
      number(row.denomination_value),
      number(row.quantity),
      money(row.total),
    ]);

  autoTable(doc, {
    head: [['Divisa', 'Denominación', 'Cantidad', 'Total']],
    body:
      countRows.length > 0
        ? countRows
        : [['Sin conteo físico registrado', '', '', '']],
    theme: 'striped',
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
    margin: { left: 14, right: 14 },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
    ?.finalY ?? y;
  let signatureY = Math.min(finalY + 18, doc.internal.pageSize.getHeight() - 30);

  doc.setFontSize(9);
  doc.text('Firma responsable de caja', 14, signatureY);
  doc.text('Firma supervisor / revisión', pageWidth / 2 + 8, signatureY);
  signatureY += 14;
  doc.line(14, signatureY, 80, signatureY);
  doc.line(pageWidth / 2 + 8, signatureY, pageWidth - 14, signatureY);
  signatureY += 5;
  doc.text('Nombre y timbre', 14, signatureY);
  doc.text('Nombre y timbre', pageWidth / 2 + 8, signatureY);

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.text(
      `Caja Temuco - Cierre ${data.businessDate} - Página ${page} de ${pages}`,
      14,
      doc.internal.pageSize.getHeight() - 8,
    );
  }

  doc.save(`cierre-caja-temuco-${data.businessDate}.pdf`);
}
