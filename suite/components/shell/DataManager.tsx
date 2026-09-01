"use client";

import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Download, FileUp, Upload, X } from "lucide-react";
import { migrate, serialise, suggestedFilename } from "@jfrusher/trousseau";
import { flushPersist, useTrousseauStore } from "@/lib/store/useTrousseauStore";
import { readGuests } from "@/lib/model/slices";
import { useWriters } from "@/lib/model/useSuite";
import { reconcileLoadedDocument } from "@/lib/seating/normalise";
import { SharePanel } from "./SharePanel";
import { parseCsv, type CsvTable } from "@/lib/data/csv";
import { download, readTextFile } from "@/lib/data/file";
import {
  guessMapping,
  MAPPABLE_FIELDS,
  rowsToGuests,
  type FieldMapping,
} from "@/lib/data/guestImport";

/**
 * Everything that moves data in or out of the machine, in one place.
 *
 * There is no server to hold a backup, so the export button is the only copy
 * the user will ever have — it is the first thing in here, it takes one press,
 * and it writes the whole document rather than a slice.
 */
export function DataManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-charcoal/40 p-4 sm:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Data manager"
            className="w-full max-w-2xl rounded-lg border border-charcoal/10 bg-parchment shadow-2xl"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={(event) => event.stopPropagation()}
          >
            <Body onClose={onClose} />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const status = useTrousseauStore((s) => s.status);
  const error = useTrousseauStore((s) => s.error);
  const savedAt = useTrousseauStore((s) => s.savedAt);
  const replaceDocument = useTrousseauStore((s) => s.replaceDocument);
  const guestCount = useTrousseauStore((s) => Object.keys(s.doc.guests).length);
  const event = useTrousseauStore((s) => s.doc.event);
  const { setEvent, setGuests } = useWriters();

  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState<{ table: CsvTable; mapping: FieldMapping } | null>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  const exportJson = useCallback(async () => {
    setProblem(null);
    try {
      // Flushed first: a backup taken while a write is still pending would be
      // the version before whatever the user just did.
      await flushPersist();
      const raw = useTrousseauStore.getState().raw;
      const doc = migrate(raw);
      download(suggestedFilename(doc), serialise(doc));
      setNotice("Backup written to your downloads.");
    } catch (cause) {
      setProblem(
        `That could not be exported: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }, []);

  const importJson = useCallback(
    async (file: File) => {
      setProblem(null);
      setNotice(null);
      try {
        const parsed: unknown = JSON.parse(await readTextFile(file));
        // Through the contract's own reader, so a file it would refuse never
        // reaches the store — and so a restore cannot be a silent downgrade.
        migrate(parsed);
        replaceDocument(parsed);
        // A restored file may record a seat on the table and not on the guest.
        reconcileLoadedDocument();
        setNotice(`Restored from ${file.name}.`);
      } catch (cause) {
        setProblem(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [replaceDocument],
  );

  const stageCsv = useCallback(async (file: File) => {
    setProblem(null);
    setNotice(null);
    try {
      const table = parseCsv(await readTextFile(file));
      if (table.rows.length === 0) {
        setProblem(`${file.name} has a header row and nothing under it.`);
        return;
      }
      setPending({ table, mapping: guessMapping(table.headers) });
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const commitCsv = useCallback(() => {
    if (!pending) return;
    const existing = readGuests(useTrousseauStore.getState().doc);
    const result = rowsToGuests(pending.table, pending.mapping, existing);
    setGuests(result.guests);
    const added = Object.keys(result.guests).length - Object.keys(existing).length;
    setPending(null);
    setNotice(
      `${added} new, ${pending.table.rows.length - result.skipped - added} updated` +
        (result.skipped > 0 ? `, ${result.skipped} skipped with no name.` : "."),
    );
  }, [pending, setGuests]);

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl">Your data</h2>
          <p className="mt-1 text-sm text-slate">
            {guestCount} {guestCount === 1 ? "guest" : "guests"} on this device
            {savedAt ? `, saved ${new Date(savedAt).toLocaleTimeString()}` : ""}.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-slate transition hover:bg-stone hover:text-charcoal"
        >
          <X size={20} />
        </button>
      </header>

      {status === "error" ? (
        <Banner tone="alarm">
          {error} Nothing has been written over it — export a backup below and restore a good copy.
        </Banner>
      ) : null}
      {problem ? <Banner tone="alarm">{problem}</Banner> : null}
      {notice ? <Banner tone="calm">{notice}</Banner> : null}

      <Section title="The wedding">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Names"
            value={event.coupleNames}
            placeholder="Charis & Jacob"
            onChange={(coupleNames) => setEvent({ coupleNames })}
          />
          <Field
            label="Date"
            type="date"
            value={event.date}
            onChange={(date) => setEvent({ date })}
          />
          <Field
            label="Venue"
            value={event.venueName}
            placeholder="The barn"
            onChange={(venueName) => setEvent({ venueName })}
          />
        </div>
      </Section>

      <Section title="Backup">
        <p className="mb-3 text-sm text-slate">
          One file holding the whole wedding — guests, seating, the day, the crew and the
          stationery. It never leaves this machine unless you send it somewhere.
        </p>
        <div className="flex flex-wrap gap-2">
          <Action onClick={() => void exportJson()} icon={Download} primary>
            Export backup
          </Action>
          <Action onClick={() => jsonInput.current?.click()} icon={Upload}>
            Restore from file
          </Action>
          <input
            ref={jsonInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importJson(file);
            }}
          />
        </div>
      </Section>

      <Section title="Sharing">
        <SharePanel onProblem={setProblem} />
      </Section>

      <Section title="Guest list">
        {pending ? (
          <CsvMapping
            table={pending.table}
            mapping={pending.mapping}
            onChange={(mapping) => setPending({ table: pending.table, mapping })}
            onCancel={() => setPending(null)}
            onCommit={commitCsv}
          />
        ) : (
          <>
            <p className="mb-3 text-sm text-slate">
              A CSV from wherever the replies arrived. Columns are guessed and yours to correct.
              People already on the list are matched by name and updated, never duplicated — and
              a re-import never unseats anybody.
            </p>
            <Action onClick={() => csvInput.current?.click()} icon={FileUp}>
              Upload CSV
            </Action>
            <input
              ref={csvInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void stageCsv(file);
              }}
            />
          </>
        )}
      </Section>
    </div>
  );
}

function CsvMapping({
  table,
  mapping,
  onChange,
  onCancel,
  onCommit,
}: {
  table: CsvTable;
  mapping: FieldMapping;
  onChange: (next: FieldMapping) => void;
  onCancel: () => void;
  onCommit: () => void;
}) {
  const named = table.rows.length;
  return (
    <div>
      <p className="mb-3 text-sm text-slate">
        {named} {named === 1 ? "row" : "rows"} read. Point each field at the right column — leave
        one blank and it is simply not imported.
      </p>
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        {MAPPABLE_FIELDS.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <span className="w-24 shrink-0 text-slate">{label}</span>
            <select
              value={mapping[key] ?? ""}
              onChange={(e) => onChange({ ...mapping, [key]: e.target.value || null })}
              className="min-w-0 flex-1 rounded border border-charcoal/15 bg-parchment px-2 py-1 text-charcoal"
            >
              <option value="">—</option>
              {table.headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Action onClick={onCommit} icon={FileUp} primary>
          Import {named} {named === 1 ? "row" : "rows"}
        </Action>
        <Action onClick={onCancel}>Cancel</Action>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 border-t border-charcoal/10 pt-5">
      <h3 className="mb-3 text-sm font-bold tracking-widest text-slate uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Banner({ tone, children }: { tone: "alarm" | "calm"; children: React.ReactNode }) {
  return (
    <p
      className={`mb-4 flex gap-2 rounded border px-3 py-2 text-sm ${
        tone === "alarm"
          ? "border-rose/50 bg-rose/10 text-charcoal"
          : "border-sage/50 bg-sage/10 text-charcoal"
      }`}
    >
      {tone === "alarm" ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : null}
      <span>{children}</span>
    </p>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-charcoal/15 bg-parchment px-2 py-1.5 text-charcoal focus:border-gold"
      />
    </label>
  );
}

function Action({
  onClick,
  icon: Icon,
  primary,
  children,
}: {
  onClick: () => void;
  icon?: React.ComponentType<{ size?: number }>;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm transition ${
        primary
          ? "border-gold bg-gold/15 text-charcoal hover:bg-gold/25"
          : "border-charcoal/15 text-slate hover:border-charcoal/30 hover:text-charcoal"
      }`}
    >
      {Icon ? <Icon size={16} /> : null}
      {children}
    </button>
  );
}
