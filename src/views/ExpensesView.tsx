import { useEffect, useMemo, useState } from 'react';
import { Plus, Receipt } from 'lucide-react';
import {
  Button,
  Card,
  ErrorBanner,
  Input,
  SectionTitle,
  Select,
  Spinner,
  SuccessBanner,
} from '../components/ui';
import PeriodFilter, { periodRange } from '../components/PeriodFilter';
import {
  createExpenseCategory,
  listExpenseCategories,
  listExpensesRange,
  registerExpense,
  type ExpenseCategory,
  type ExpenseRow,
  type FxSession,
} from '../lib/db';
import { errorMessage, formatClp, formatDate } from '../lib/format';

const DEFAULT_CATEGORIES = [
  'OPERACIONAL',
  'SUELDOS',
  'ARRIENDO',
  'SERVICIOS',
  'TRANSPORTE',
  'MANTENCIÓN',
  'OTROS',
];

export default function ExpensesView({
  storeId,
  session,
  onChanged,
}: {
  storeId: string;
  session: FxSession;
  onChanged: () => void;
}) {
  const initial = periodRange('MES');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [concept, setConcept] = useState('');
  const [category, setCategory] = useState('OPERACIONAL');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [expenseRows, categoryRows] = await Promise.all([
        listExpensesRange(storeId, from, to),
        listExpenseCategories(storeId),
      ]);

      let nextCategories = categoryRows;
      if (nextCategories.length === 0) {
        for (const name of DEFAULT_CATEGORIES) {
          await createExpenseCategory(storeId, name);
        }
        nextCategories = await listExpenseCategories(storeId);
      }

      setExpenses(expenseRows);
      setCategories(nextCategories);
      if (
        nextCategories.length > 0 &&
        !nextCategories.some((item) => item.name === category)
      ) {
        setCategory(nextCategories[0].name);
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
  }, [storeId, from, to]);

  const total = useMemo(
    () => expenses.reduce((sum, row) => sum + Number(row.amount_clp || 0), 0),
    [expenses],
  );

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of expenses) {
      map.set(row.category, (map.get(row.category) ?? 0) + Number(row.amount_clp || 0));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  async function handleAddCategory() {
    if (!newCategory.trim()) return;
    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      await createExpenseCategory(storeId, newCategory.trim());
      setNewCategory('');
      setCategories(await listExpenseCategories(storeId));
      setSuccess('Categoría agregada.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  async function handleSubmit() {
    if (!concept.trim()) {
      setError('Ingresa un concepto.');
      return;
    }
    const numericAmount = Number(amount) || 0;
    if (numericAmount <= 0) {
      setError('Ingresa un monto mayor a 0.');
      return;
    }

    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      await registerExpense({
        storeId,
        sessionId: session.id,
        businessDate: session.business_date,
        concept: concept.trim(),
        category,
        amountClp: numericAmount,
        note: note.trim(),
      });
      setConcept('');
      setAmount('');
      setNote('');
      setSuccess('Gasto registrado y descontado de la caja CLP.');
      await load();
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <Spinner label="Cargando gastos…" />;

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <Card>
        <SectionTitle
          title="Cuadro de gastos"
          subtitle={`Total del período: ${formatClp(total)}`}
          action={
            <PeriodFilter
              from={from}
              to={to}
              onChange={(nextFrom, nextTo) => {
                setFrom(nextFrom);
                setTo(nextTo);
              }}
            />
          }
        />
        {byCategory.length === 0 ? (
          <p className="py-4 text-sm text-slate-500">Sin gastos en el período.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {byCategory.map(([categoryName, categoryTotal]) => (
              <div
                key={categoryName}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2"
              >
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  {categoryName}
                </p>
                <p className="mt-1 text-lg font-bold text-white">
                  {formatClp(categoryTotal)}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <SectionTitle
            title="Registrar gasto"
            subtitle="Se descuenta de la caja CLP y se resta del resultado del día."
          />
          <div className="space-y-3">
            <Input
              value={concept}
              onChange={(event) => setConcept(event.target.value)}
              placeholder="Concepto (ej: arriendo, insumos, transporte)"
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={category} onChange={(event) => setCategory(event.target.value)}>
                {categories.map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </Select>
              <Input
                type="number"
                min="0"
                step="1"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="Monto CLP"
              />
            </div>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Nota / número de documento (opcional)"
            />

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Nueva categoría
              </p>
              <div className="flex gap-2">
                <Input
                  value={newCategory}
                  onChange={(event) => setNewCategory(event.target.value)}
                  placeholder="Ej: Aseo, comisiones, cafetería"
                />
                <Button
                  variant="secondary"
                  onClick={() => void handleAddCategory()}
                  disabled={working || !newCategory.trim()}
                >
                  Agregar
                </Button>
              </div>
            </div>

            <Button
              onClick={() => void handleSubmit()}
              disabled={working}
              className="w-full"
            >
              <Plus className="h-4 w-4" /> {working ? 'Guardando…' : 'Agregar gasto'}
            </Button>
          </div>
        </Card>

        <Card>
          <SectionTitle
            title="Detalle de gastos"
            subtitle={`Período ${formatDate(from)} — ${formatDate(to)}`}
            action={<Receipt className="h-5 w-5 text-slate-500" />}
          />
          {expenses.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No hay gastos registrados en esta jornada.
            </p>
          ) : (
            <div className="space-y-2">
              {expenses.map((expense) => (
                <div
                  key={expense.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-200">{expense.concept}</p>
                    <p className="text-[11px] text-slate-500">
                      {expense.category} · {formatDate(expense.business_date)}
                      {expense.note ? ` · ${expense.note}` : ''}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-rose-300">
                    {formatClp(expense.amount_clp)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
