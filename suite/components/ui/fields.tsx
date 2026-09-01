/**
 * The labelled fields Cadence and Brigade build their side panels from.
 *
 * The two shipped byte-identical copies of this file and its stylesheet — one
 * was made by copying the other, and both then stayed still. Holding it once
 * means a change to how a number field behaves reaches both tools, which is
 * what anyone looking at them would already assume.
 *
 * Plaque has a set of its own that is genuinely different: different names,
 * different components, a `SubGroup` and a `Hint` these two have no use for.
 * Merging it would mean renaming through its nine panels to buy a consistency
 * the shared tokens already deliver, so it keeps its own.
 *
 * The clock helpers come from Cadence, which owns the day: it is the tool that
 * publishes the resolved times everything else reads, so it is the one that
 * should decide what "17:30" means. Brigade held an identical copy.
 *
 * These read the token names the three sibling tools share, so they render
 * correctly only inside one of those scopes.
 */

import { useEffect, useId, useState, type ReactNode } from "react";
import { formatClock, parseClock } from "@/apps/cadence/core/time/minutes";
import styles from "./fields.module.css";

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
  suggestions,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /**
   * Offered, not enforced. A free-text field with a list of likely answers is
   * still free text — the church down the road is a real location even though
   * nobody has drawn it on the floor plan.
   */
  suggestions?: string[];
}) {
  const listId = useId();
  return (
    <Field label={label}>
      <input
        className={styles.input}
        value={value}
        placeholder={placeholder ?? ""}
        list={suggestions && suggestions.length > 0 ? listId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {suggestions && suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
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

/**
 * What a typed number should commit to, or null to put the old one back.
 * Empty and out-of-range text is held rather than committed — clearing a box on
 * the way to a new figure must not land a 0.
 */
export function commitNumber(
  text: string,
  min?: number,
  max?: number,
): number | null {
  if (text.trim() === "") return null;
  const next = Number(text);
  if (Number.isNaN(next)) return null;
  if (min !== undefined && next < min) return null;
  if (max !== undefined && next > max) return null;
  return next;
}

/**
 * A number, typed the way a person types one: the box is theirs until they
 * leave it or press Enter. Half-typed text — an emptied box on the way to a new
 * figure — is held, never committed, so clearing "30" cannot land a 0 that
 * turns the block into a moment before the new number is in.
 */
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
  const [text, setText] = useState(() => String(value));
  const id = useId();

  useEffect(() => {
    setText(String(value));
  }, [value, id]);

  const commit = () => {
    const next = commitNumber(text, min, max);
    if (next === null) {
      setText(String(value));
      return;
    }
    if (next !== value) onChange(next);
  };

  return (
    <Field label={label}>
      <span className={styles.withSuffix}>
        <input
          className={styles.input}
          type="number"
          value={text}
          step={step}
          {...(min === undefined ? {} : { min })}
          {...(max === undefined ? {} : { max })}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
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
