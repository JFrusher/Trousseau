"use client";

import type { ComponentType, ReactNode } from "react";

/**
 * The controls every panel is built from.
 *
 * Here because the same border, focus ring and spacing were being retyped into
 * every inspector, and a class string copied fifteen times is fifteen places
 * for the focus colour to drift.
 */

const FIELD =
  "w-full rounded border border-charcoal/15 bg-parchment px-2 py-1.5 text-sm text-charcoal outline-none focus:border-gold";

export function Panel({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-t border-charcoal/10 py-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs tracking-widest text-slate uppercase">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      {label ? <span className="mb-1 block text-xs text-slate">{label}</span> : null}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD}
      />
    </label>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      {label ? <span className="mb-1 block text-xs text-slate">{label}</span> : null}
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={FIELD} />
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label?: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      {label ? <span className="mb-1 block text-xs text-slate">{label}</span> : null}
      <div className="relative">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            // An empty box is mid-edit, not zero. Committing 0 on the way to
            // "12" makes every field fight the person typing into it.
            if (e.target.value === "") return;
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
          className={FIELD}
        />
        {suffix ? (
          <span className="pointer-events-none absolute top-1.5 right-2 text-xs text-slate">
            {suffix}
          </span>
        ) : null}
      </div>
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label?: string;
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <label className="block">
      {label ? <span className="mb-1 block text-xs text-slate">{label}</span> : null}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className={FIELD}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--color-gold)]"
      />
      {label}
    </label>
  );
}

export function Button({
  onClick,
  icon: Icon,
  tone = "quiet",
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  icon?: ComponentType<{ size?: number }>;
  tone?: "quiet" | "primary" | "danger";
  disabled?: boolean;
  title?: string;
  children?: ReactNode;
}) {
  const tones = {
    quiet: "border-charcoal/15 text-slate hover:border-gold hover:text-charcoal",
    primary: "border-gold bg-gold/15 text-charcoal hover:bg-gold/25",
    danger: "border-charcoal/15 text-slate hover:border-rose hover:text-rose",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-1.5 text-sm transition disabled:pointer-events-none disabled:opacity-40 ${tones[tone]}`}
    >
      {Icon ? <Icon size={14} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  onClick,
  icon: Icon,
  label,
  tone = "quiet",
}: {
  onClick: () => void;
  icon: ComponentType<{ size?: number }>;
  label: string;
  tone?: "quiet" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`shrink-0 rounded p-1 text-slate transition ${
        tone === "danger" ? "hover:text-rose" : "hover:bg-stone hover:text-charcoal"
      }`}
    >
      <Icon size={14} />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded border px-2 py-1 text-xs transition ${
            value === o.value
              ? "border-gold bg-gold/15 text-charcoal"
              : "border-charcoal/15 text-slate hover:border-charcoal/30"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate">{children}</p>;
}
