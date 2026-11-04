import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { todayIso } from '../lib/format';

export type PeriodPreset = 'SEMANA' | 'MES' | 'ANIO' | 'PERSONALIZADO';

function iso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function periodRange(preset: PeriodPreset, from?: string, to?: string) {
  const now = new Date();
  const today = todayIso();

  if (preset === 'SEMANA') {
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const start = new Date(now);
    start.setDate(now.getDate() - diff);
    return { from: iso(start), to: today };
  }
  if (preset === 'MES') {
    return {
      from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: today,
    };
  }
  if (preset === 'ANIO') {
    return { from: iso(new Date(now.getFullYear(), 0, 1)), to: today };
  }
  return { from: from || today, to: to || today };
}

export default function PeriodFilter({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const [preset, setPreset] = useState<PeriodPreset>('MES');

  function applyPreset(next: PeriodPreset) {
    setPreset(next);
    const range = periodRange(next, from, to);
    onChange(range.from, range.to);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <CalendarRange className="h-4 w-4 text-slate-500" />
      <div className="flex rounded-xl border border-white/10 bg-slate-950/50 p-1">
        {(
          [
            ['SEMANA', 'Semana'],
            ['MES', 'Mes'],
            ['ANIO', 'Año'],
            ['PERSONALIZADO', 'Personalizado'],
          ] as Array<[PeriodPreset, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => applyPreset(value)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              preset === value
                ? 'bg-white/[0.08] text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {preset === 'PERSONALIZADO' && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={from}
            onChange={(event) => {
              onChange(event.target.value, to);
            }}
            className="rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-400/60"
          />
          <span className="text-xs text-slate-500">a</span>
          <input
            type="date"
            value={to}
            onChange={(event) => {
              onChange(from, event.target.value);
            }}
            className="rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-400/60"
          />
        </div>
      )}
    </div>
  );
}
