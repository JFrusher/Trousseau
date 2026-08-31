import { useEffect, useId, useState, type ReactNode } from "react";
import { formatClock, parseClock } from "../core/time/minutes";
import styles from "./controls.module.css";

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{title}</h2>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <input
        className={styles.input}
        value={value}
        placeholder={placeholder ?? ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <Field label={label}>
      <textarea
        className={styles.textarea}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
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
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <Field label={label}>
      <span className={styles.withSuffix}>
        <input
          className={styles.input}
          type="number"
          value={value}
          step={step}
          {...(min === undefined ? {} : { min })}
          {...(max === undefined ? {} : { max })}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isNaN(next)) return;
            if (min !== undefined && next < min) return;
            if (max !== undefined && next > max) return;
            onChange(next);
          }}
        />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </span>
    </Field>
  );
}

/**
 * A clock time, typed the way a person types one. Invalid text is held and
 * marked rather than thrown away mid-keystroke.
 */
export function TimeField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (min: number) => void;
  hint?: string;
}) {
  const [text, setText] = useState(() => formatClock(value));
  const [bad, setBad] = useState(false);
  const id = useId();

  useEffect(() => {
    setText(formatClock(value));
    setBad(false);
  }, [value, id]);

  const commit = () => {
    const parsed = parseClock(text);
    if (parsed === null) {
      setBad(true);
      return;
    }
    setBad(false);
    onChange(parsed);
  };

  return (
    <Field label={label} {...(hint === undefined ? {} : { hint })}>
      <input
        className={bad ? `${styles.input} ${styles.bad}` : styles.input}
        value={text}
        aria-invalid={bad}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      <select
        className={styles.input}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function ColourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <input
        className={styles.colour}
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

export function Button({
  children,
  onClick,
  variant = "normal",
  disabled = false,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: "normal" | "primary" | "quiet";
  disabled?: boolean;
  title?: string;
}) {
  const className = [styles.button, variant === "primary" ? styles.primary : "", variant === "quiet" ? styles.quiet : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
      {...(title === undefined ? {} : { title })}
    >
      {children}
    </button>
  );
}
