import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { classNames } from '../lib/format';

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={classNames(
        'rounded-2xl border border-white/[0.07] bg-slate-900/60 p-5 shadow-xl shadow-slate-950/20 backdrop-blur',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'default' | 'positive' | 'negative' | 'warning';
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-300'
      : tone === 'negative'
        ? 'text-rose-300'
        : tone === 'warning'
          ? 'text-amber-300'
          : 'text-white';

  return (
    <Card className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className={classNames('mt-2 text-2xl font-bold tracking-tight', toneClass)}>
        {value}
      </p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </Card>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
};

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  const variantClass = {
    primary:
      'bg-indigo-500 text-white hover:bg-indigo-400 disabled:bg-indigo-500/40',
    secondary:
      'border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] disabled:opacity-40',
    ghost: 'text-slate-300 hover:bg-white/[0.06] disabled:opacity-40',
    danger: 'bg-rose-500/90 text-white hover:bg-rose-400 disabled:opacity-40',
  }[variant];

  return (
    <button
      className={classNames(
        'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed',
        variantClass,
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={classNames(
        'w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-slate-600 focus:border-indigo-400/60',
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      className={classNames(
        'w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-indigo-400/60',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Badge({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: 'slate' | 'green' | 'amber' | 'rose' | 'indigo';
}) {
  const toneClass = {
    slate: 'bg-slate-500/10 text-slate-300 ring-slate-400/20',
    green: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20',
    amber: 'bg-amber-500/10 text-amber-300 ring-amber-400/20',
    rose: 'bg-rose-500/10 text-rose-300 ring-rose-400/20',
    indigo: 'bg-indigo-500/10 text-indigo-300 ring-indigo-400/20',
  }[tone];

  return (
    <span
      className={classNames(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        toneClass,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center">
      <p className="text-sm font-semibold text-slate-200">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-8 text-sm text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-indigo-400" />
      {label}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
      {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
      {message}
    </div>
  );
}
