import { useEffect, useMemo, useState } from 'react';
import { Handshake, Plus, ReceiptText } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Input,
  SectionTitle,
  Select,
  Spinner,
  SuccessBanner,
} from '../components/ui';
import {
  createWholesaleDeal,
  listCounterparties,
  listCurrencies,
  listWholesaleDeals,
  listWholesaleSettlements,
  registerWholesaleSettlement,
  type Counterparty,
  type Currency,
  type FxSession,
  type WholesaleDealRow,
  type WholesaleSettlementRow,
} from '../lib/db';
import { errorMessage, formatClp, formatDate, formatQty, formatRate } from '../lib/format';

export default function WholesaleView({
  storeId,
  session,
  onChanged,
}: {
  storeId: string;
  session: FxSession;
  onChanged: () => void;
}) {
  const [deals, setDeals] = useState<WholesaleDealRow[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [selectedDealId, setSelectedDealId] = useState('');
  const [settlements, setSettlements] = useState<WholesaleSettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [counterpartyId, setCounterpartyId] = useState('');
  const [dealType, setDealType] = useState<'COMPRA' | 'VENTA'>('COMPRA');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [agreedQty, setAgreedQty] = useState('');
  const [agreedRate, setAgreedRate] = useState('');
  const [notes, setNotes] = useState('');

  const [settlementType, setSettlementType] =
    useState<'ENTREGA_DIVISA' | 'PAGO_CLP'>('ENTREGA_DIVISA');
  const [settlementAmount, setSettlementAmount] = useState('');
  const [settlementNote, setSettlementNote] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [dealRows, counterpartyRows, currencyRows] = await Promise.all([
        listWholesaleDeals(storeId),
        listCounterparties(storeId),
        listCurrencies(),
      ]);
      setDeals(dealRows);
      setCounterparties(counterpartyRows);
      setCurrencies(currencyRows);
      if (!counterpartyId && counterpartyRows.length > 0) {
        setCounterpartyId(counterpartyRows[0].id);
      }
      if (!selectedDealId) {
        const firstOpen = dealRows.find((deal) => deal.status !== 'CERRADO');
        if (firstOpen) setSelectedDealId(firstOpen.id);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  useEffect(() => {
    if (!selectedDealId) {
      setSettlements([]);
      return;
    }
    let cancelled = false;
    listWholesaleSettlements(selectedDealId)
      .then((rows) => {
        if (!cancelled) setSettlements(rows);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDealId]);

  const selectedDeal = deals.find((deal) => deal.id === selectedDealId) ?? null;
  const agreedClp = useMemo(
    () => (Number(agreedQty) || 0) * (Number(agreedRate) || 0),
    [agreedQty, agreedRate],
  );

  async function handleCreateDeal() {
    if (!counterpartyId) {
      setError('Selecciona una contraparte.');
      return;
    }
    const qty = Number(agreedQty) || 0;
    const rate = Number(agreedRate) || 0;
    if (qty <= 0 || rate <= 0) {
      setError('Cantidad y precio deben ser mayores a 0.');
      return;
    }

    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      const id = await createWholesaleDeal({
        storeId,
        sessionId: session.id,
        counterpartyId,
        dealType,
        currencyCode,
        agreedQty: qty,
        agreedRate: rate,
        businessDate: session.business_date,
        notes: notes.trim(),
      });
      setAgreedQty('');
      setAgreedRate('');
      setNotes('');
      setSelectedDealId(id);
      setSuccess('Cierre mayorista registrado. Queda pendiente de entregas y pagos.');
      await load();
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  async function handleSettlement() {
    if (!selectedDeal) {
      setError('Selecciona un cierre mayorista.');
      return;
    }
    const amount = Number(settlementAmount) || 0;
    if (amount <= 0) {
      setError('Ingresa un monto mayor a 0.');
      return;
    }

    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      await registerWholesaleSettlement({
        storeId,
        dealId: selectedDeal.id,
        sessionId: session.id,
        settlementType,
        amount,
        businessDate: session.business_date,
        note: settlementNote.trim(),
      });
      setSettlementAmount('');
      setSettlementNote('');
      setSuccess('Liquidación registrada. El saldo del cierre se actualizó.');
      await load();
      setSettlements(await listWholesaleSettlements(selectedDeal.id));
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <Spinner label="Cargando cierres mayoristas…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <SectionTitle
            title="Nuevo cierre mayorista"
            subtitle="Precio pactado con el proveedor/cliente. Las entregas y pagos se registran después."
          />
          <div className="space-y-3">
            <Select
              value={counterpartyId}
              onChange={(event) => setCounterpartyId(event.target.value)}
            >
              <option value="">Seleccionar contraparte</option>
              {counterparties.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>

            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                value={dealType}
                onChange={(event) => setDealType(event.target.value as 'COMPRA' | 'VENTA')}
              >
                <option value="COMPRA">Compra de divisa</option>
                <option value="VENTA">Venta de divisa</option>
              </Select>
              <Select
                value={currencyCode}
                onChange={(event) => setCurrencyCode(event.target.value)}
              >
                {currencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code}
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                type="number"
                min="0"
                step="0.000001"
                value={agreedQty}
                onChange={(event) => setAgreedQty(event.target.value)}
                placeholder="Cantidad de divisa"
              />
              <Input
                type="number"
                min="0"
                step="0.000001"
                value={agreedRate}
                onChange={(event) => setAgreedRate(event.target.value)}
                placeholder="Precio pactado (CLP)"
              />
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-slate-400">
              Total pactado: <span className="font-semibold text-white">{formatClp(agreedClp)}</span>
            </div>

            <Input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Nota / referencia del cierre"
            />

            <Button
              onClick={() => void handleCreateDeal()}
              disabled={working}
              className="w-full"
            >
              <Handshake className="h-4 w-4" /> Registrar cierre
            </Button>
          </div>
        </Card>

        <Card>
          <SectionTitle
            title="Liquidar cierre seleccionado"
            subtitle="Entrega de divisa o pago en CLP. Se puede hacer en partes."
          />
          {!selectedDeal ? (
            <EmptyState
              title="Selecciona un cierre"
              description="Elige un cierre de la lista inferior para registrar entregas o pagos."
            />
          ) : (
            <div className="space-y-3">
              <div className="rounded-2xl border border-indigo-400/10 bg-indigo-500/[0.04] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {selectedDeal.counterparty_name} · {selectedDeal.deal_type}
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatQty(selectedDeal.agreed_qty)} {selectedDeal.currency_code} @{' '}
                      {formatRate(selectedDeal.agreed_rate)} ={' '}
                      {formatClp(selectedDeal.agreed_clp)}
                    </p>
                  </div>
                  <Badge
                    tone={
                      selectedDeal.status === 'CERRADO'
                        ? 'green'
                        : selectedDeal.status === 'PARCIAL'
                          ? 'amber'
                          : 'indigo'
                    }
                  >
                    {selectedDeal.status}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl bg-white/[0.03] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">
                      Pendiente divisa
                    </p>
                    <p className="text-sm font-semibold text-amber-300">
                      {formatQty(selectedDeal.pending_qty)} {selectedDeal.currency_code}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/[0.03] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">
                      Pendiente CLP
                    </p>
                    <p className="text-sm font-semibold text-amber-300">
                      {formatClp(selectedDeal.pending_clp)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                <Select
                  value={settlementType}
                  onChange={(event) =>
                    setSettlementType(event.target.value as 'ENTREGA_DIVISA' | 'PAGO_CLP')
                  }
                >
                  <option value="ENTREGA_DIVISA">Entrega de divisa</option>
                  <option value="PAGO_CLP">Pago / cobro en CLP</option>
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={settlementAmount}
                  onChange={(event) => setSettlementAmount(event.target.value)}
                  placeholder={
                    settlementType === 'ENTREGA_DIVISA'
                      ? `Monto en ${selectedDeal.currency_code}`
                      : 'Monto en CLP'
                  }
                />
              </div>
              <Input
                value={settlementNote}
                onChange={(event) => setSettlementNote(event.target.value)}
                placeholder="Nota / número de depósito"
              />
              <Button
                onClick={() => void handleSettlement()}
                disabled={working || selectedDeal.status === 'CERRADO'}
                className="w-full"
              >
                <Plus className="h-4 w-4" /> Registrar liquidación
              </Button>

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Historial del cierre
                </p>
                {settlements.length === 0 ? (
                  <p className="text-sm text-slate-500">Sin liquidaciones todavía.</p>
                ) : (
                  <div className="max-h-44 space-y-1 overflow-y-auto">
                    {settlements.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-lg bg-white/[0.02] px-2.5 py-1.5 text-xs"
                      >
                        <span className="text-slate-400">
                          {formatDate(item.business_date)} ·{' '}
                          {item.settlement_type === 'ENTREGA_DIVISA'
                            ? 'Entrega'
                            : 'Pago CLP'}
                        </span>
                        <span className="font-semibold text-slate-200">
                          {item.settlement_type === 'ENTREGA_DIVISA'
                            ? `${formatQty(item.amount)} ${item.currency_code}`
                            : formatClp(item.clp_amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle
          title="Cierres mayoristas"
          subtitle="Precio pactado, entregas, pagos y saldo pendiente por ambas partes."
          action={<ReceiptText className="h-5 w-5 text-slate-500" />}
        />
        {deals.length === 0 ? (
          <EmptyState
            title="Sin cierres mayoristas"
            description="Registra el primer cierre pactado con un proveedor o cliente."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 font-semibold">Fecha</th>
                  <th className="px-3 py-2 font-semibold">Contraparte</th>
                  <th className="px-3 py-2 font-semibold">Tipo</th>
                  <th className="px-3 py-2 font-semibold">Divisa</th>
                  <th className="px-3 py-2 text-right font-semibold">Pactado</th>
                  <th className="px-3 py-2 text-right font-semibold">Entregado</th>
                  <th className="px-3 py-2 text-right font-semibold">Pagado CLP</th>
                  <th className="px-3 py-2 text-right font-semibold">Pendiente</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                  <th className="px-3 py-2 text-right font-semibold">Acción</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => (
                  <tr key={deal.id} className="border-b border-white/[0.04]">
                    <td className="py-2 pr-3 text-slate-400">
                      {formatDate(deal.business_date)}
                    </td>
                    <td className="px-3 py-2 text-slate-200">{deal.counterparty_name}</td>
                    <td className="px-3 py-2">
                      <Badge tone={deal.deal_type === 'COMPRA' ? 'green' : 'rose'}>
                        {deal.deal_type}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-200">
                      {deal.currency_code}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      {formatQty(deal.agreed_qty)} @ {formatRate(deal.agreed_rate)}
                      <br />
                      <span className="text-xs text-slate-500">
                        {formatClp(deal.agreed_clp)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-emerald-300">
                      {formatQty(deal.delivered_qty)}
                    </td>
                    <td className="px-3 py-2 text-right text-indigo-300">
                      {formatClp(deal.paid_clp)}
                    </td>
                    <td className="px-3 py-2 text-right text-amber-300">
                      {formatQty(deal.pending_qty)} / {formatClp(deal.pending_clp)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        tone={
                          deal.status === 'CERRADO'
                            ? 'green'
                            : deal.status === 'PARCIAL'
                              ? 'amber'
                              : 'indigo'
                        }
                      >
                        {deal.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        onClick={() => setSelectedDealId(deal.id)}
                        disabled={deal.status === 'CERRADO'}
                      >
                        Liquidar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
