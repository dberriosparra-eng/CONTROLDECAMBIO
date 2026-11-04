import { useEffect, useMemo, useState } from 'react';
import { Plus, UserPlus } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Input,
  SectionTitle,
  Select,
  Spinner,
  SuccessBanner,
} from '../components/ui';
import {
  createCounterparty,
  listAccountBalances,
  listCounterparties,
  listCurrencies,
  registerAccountMovement,
  type AccountBalanceRow,
  type Counterparty,
  type Currency,
  type FxSession,
} from '../lib/db';
import { errorMessage, formatQty } from '../lib/format';

const MOVEMENT_TYPES = [
  ['PRESTAMO_OTORGADO', 'Préstamo otorgado (nos deben)'],
  ['PRESTAMO_RECIBIDO', 'Préstamo recibido (les debemos)'],
  ['COBRO_DEUDA', 'Cobro de deuda'],
  ['PAGO_DEUDA', 'Pago de deuda'],
  ['VENTA_CREDITO', 'Venta a crédito'],
  ['COMPRA_CREDITO', 'Compra a crédito'],
  ['ENTREGA', 'Entrega de divisa'],
  ['RETIRO', 'Retiro de divisa'],
  ['AJUSTE', 'Ajuste de saldo'],
] as const;

type MovementType = (typeof MOVEMENT_TYPES)[number][0];

function movementEffect(type: MovementType, amount: number) {
  switch (type) {
    case 'PRESTAMO_OTORGADO':
      return { side: 'RECEIVABLE' as const, amountDelta: amount, inventoryDelta: -amount };
    case 'PRESTAMO_RECIBIDO':
      return { side: 'PAYABLE' as const, amountDelta: amount, inventoryDelta: amount };
    case 'COBRO_DEUDA':
      return { side: 'RECEIVABLE' as const, amountDelta: -amount, inventoryDelta: amount };
    case 'PAGO_DEUDA':
      return { side: 'PAYABLE' as const, amountDelta: -amount, inventoryDelta: -amount };
    case 'VENTA_CREDITO':
      return { side: 'RECEIVABLE' as const, amountDelta: amount, inventoryDelta: -amount };
    case 'COMPRA_CREDITO':
      return { side: 'PAYABLE' as const, amountDelta: amount, inventoryDelta: amount };
    case 'ENTREGA':
      return { side: 'RECEIVABLE' as const, amountDelta: amount, inventoryDelta: -amount };
    case 'RETIRO':
      return { side: 'PAYABLE' as const, amountDelta: -amount, inventoryDelta: -amount };
    default:
      return { side: 'RECEIVABLE' as const, amountDelta: amount, inventoryDelta: 0 };
  }
}

export default function AccountsView({
  storeId,
  session,
  onChanged,
}: {
  storeId: string;
  session: FxSession;
  onChanged: () => void;
}) {
  const [balances, setBalances] = useState<AccountBalanceRow[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState('TERCERO');

  const [counterpartyId, setCounterpartyId] = useState('');
  const [movementType, setMovementType] = useState<MovementType>('PRESTAMO_OTORGADO');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [amount, setAmount] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [note, setNote] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [balanceRows, counterpartyRows, currencyRows] = await Promise.all([
        listAccountBalances(storeId),
        listCounterparties(storeId),
        listCurrencies(),
      ]);
      setBalances(balanceRows);
      setCounterparties(counterpartyRows);
      setCurrencies(currencyRows);
      if (!counterpartyId && counterpartyRows.length > 0) {
        setCounterpartyId(counterpartyRows[0].id);
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

  const grouped = useMemo(() => {
    const map = new Map<
      string,
      { name: string; rows: AccountBalanceRow[]; net: number }
    >();
    for (const row of balances) {
      const current = map.get(row.counterparty_id) ?? {
        name: row.counterparty_name ?? 'Sin nombre',
        rows: [],
        net: 0,
      };
      current.rows.push(row);
      current.net += row.net;
      map.set(row.counterparty_id, current);
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [balances]);

  const effect = useMemo(() => {
    const numericAmount = Number(amount) || 0;
    return movementEffect(movementType, numericAmount);
  }, [movementType, amount]);

  async function handleCreateCounterparty() {
    if (!newName.trim()) return;
    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await createCounterparty(storeId, newName.trim(), newKind);
      setNewName('');
      setCounterpartyId(created.id);
      setSuccess('Contraparte creada.');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  async function handleMovement() {
    if (!counterpartyId) {
      setError('Selecciona una contraparte.');
      return;
    }
    const numericAmount = Number(amount) || 0;
    if (numericAmount <= 0) {
      setError('Ingresa un monto mayor a 0.');
      return;
    }
    const numericRate = Number(fxRate) || (currencyCode === 'CLP' ? 1 : 0);
    if (numericRate <= 0) {
      setError('Ingresa un tipo de cambio mayor a 0.');
      return;
    }

    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      const currentEffect = movementEffect(movementType, numericAmount);
      await registerAccountMovement({
        storeId,
        sessionId: session.id,
        counterpartyId,
        movementType,
        businessDate: session.business_date,
        note: note.trim(),
        lines: [
          {
            currency_code: currencyCode,
            side: currentEffect.side,
            amount_delta: currentEffect.amountDelta,
            fx_rate: numericRate,
            clp_equivalent: numericAmount * numericRate,
            inventory_delta: currentEffect.inventoryDelta,
            unit_cost_clp: numericRate,
          },
        ],
      });
      setAmount('');
      setFxRate('');
      setNote('');
      setSuccess('Movimiento registrado e inventario actualizado.');
      await load();
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <Spinner label="Cargando cuentas corrientes…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <Card>
          <SectionTitle
            title="Nueva contraparte"
            subtitle="Persona, empresa, proveedor o tercero."
          />
          <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Nombre o razón social"
            />
            <Select value={newKind} onChange={(event) => setNewKind(event.target.value)}>
              <option value="TERCERO">Tercero</option>
              <option value="CLIENTE">Cliente</option>
              <option value="PROVEEDOR">Proveedor</option>
              <option value="EMPRESA">Empresa</option>
            </Select>
            <Button
              variant="secondary"
              onClick={() => void handleCreateCounterparty()}
              disabled={working}
            >
              <UserPlus className="h-4 w-4" /> Crear
            </Button>
          </div>

          <div className="mt-6">
            <SectionTitle
              title="Nuevo movimiento"
              subtitle="Impacta la cuenta corriente y, según el tipo, el inventario/caja."
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
              <Select
                value={movementType}
                onChange={(event) => setMovementType(event.target.value as MovementType)}
              >
                {MOVEMENT_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <div className="grid gap-2 sm:grid-cols-3">
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
                <Input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="Monto"
                />
                <Input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={currencyCode === 'CLP' ? '1' : fxRate}
                  onChange={(event) => setFxRate(event.target.value)}
                  placeholder="Tipo de cambio"
                  disabled={currencyCode === 'CLP'}
                />
              </div>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Nota / referencia"
              />
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
                Efecto: <span className="font-semibold text-slate-200">{effect.side}</span>{' '}
                {formatQty(effect.amountDelta)} · inventario{' '}
                <span className="font-semibold text-slate-200">
                  {formatQty(effect.inventoryDelta)}
                </span>
              </div>
              <Button
                onClick={() => void handleMovement()}
                disabled={working || !counterpartyId}
                className="w-full"
              >
                <Plus className="h-4 w-4" /> Registrar movimiento
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle
            title="Saldos por contraparte y divisa"
            subtitle="Positivo en 'Nos deben' = deudor. Positivo en 'Les debemos' = acreedor."
          />
          {grouped.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Aún no hay movimientos de cuentas corrientes.
            </p>
          ) : (
            <div className="space-y-4">
              {grouped.map(([id, group]) => (
                <div
                  key={id}
                  className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-semibold text-slate-100">{group.name}</p>
                    <Badge tone={group.net >= 0 ? 'green' : 'rose'}>
                      {group.net >= 0 ? 'Deudor neto' : 'Acreedor neto'}
                    </Badge>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-left text-sm">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                          <th className="py-1 font-semibold">Divisa</th>
                          <th className="py-1 text-right font-semibold">Nos deben</th>
                          <th className="py-1 text-right font-semibold">Les debemos</th>
                          <th className="py-1 text-right font-semibold">Neto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => (
                          <tr key={row.currency_code} className="border-t border-white/[0.04]">
                            <td className="py-1.5 font-semibold text-slate-200">
                              {row.currency_code}
                            </td>
                            <td className="py-1.5 text-right text-emerald-300">
                              {formatQty(row.receivable)}
                            </td>
                            <td className="py-1.5 text-right text-rose-300">
                              {formatQty(row.payable)}
                            </td>
                            <td
                              className={`py-1.5 text-right font-semibold ${
                                row.net >= 0 ? 'text-emerald-300' : 'text-rose-300'
                              }`}
                            >
                              {formatQty(row.net)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
