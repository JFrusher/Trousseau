"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { importShareKey, unseal } from "@/lib/sync/crypto";
import { findSeat, type ShareSnapshot, type SharedGuest } from "@/lib/sync/shareSnapshot";
import { getTableGeometry } from "@/lib/seating/geometry";
import { newTable } from "@/lib/model/factories";

/**
 * The guest-facing page.
 *
 * The key is in the URL fragment, which the browser never sends to a server, so
 * the host holding the ciphertext cannot read what it is serving. Everything
 * here happens after that: fetch the bytes, decrypt them locally, answer one
 * question.
 */
export function FindMySeat({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<ShareSnapshot | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let live = true;

    void (async () => {
      // Read before anything else touches the URL. `location.hash` is the only
      // place this key ever exists.
      const key = new URLSearchParams(window.location.hash.slice(1)).get("k");
      if (!key) {
        setProblem("This link is missing the part after the # that unlocks it. Copy the whole link.");
        return;
      }

      try {
        const response = await fetch(`/api/sync/share/${token}`);
        if (!response.ok) {
          setProblem("This link is not live. Ask the couple for a new one.");
          return;
        }
        const sealed = (await response.json()) as { ciphertext: string; iv: string };
        const opened = (await unseal(await importShareKey(key), sealed)) as ShareSnapshot;
        if (live) setSnapshot(opened);
      } catch {
        if (live) setProblem("This link could not be opened. Copy the whole link and try again.");
      }
    })();

    return () => {
      live = false;
    };
  }, [token]);

  const matches = useMemo(
    () => (snapshot ? findSeat(snapshot, query) : []),
    [snapshot, query],
  );

  if (problem) {
    return (
      <main className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="mb-3 text-2xl">Not this link</h1>
        <p className="text-slate">{problem}</p>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="mx-auto max-w-md px-4 py-24 text-center">
        <p className="text-slate">Opening…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:py-20">
      <header className="mb-8 text-center">
        <h1 className="font-display text-3xl text-charcoal sm:text-4xl">
          {snapshot.coupleNames || "The wedding"}
        </h1>
        <p className="mt-2 text-slate">
          {[snapshot.venueName, formatDate(snapshot.date)].filter(Boolean).join(" · ")}
        </p>
      </header>

      <label className="mx-auto flex max-w-sm items-center gap-2 rounded border border-charcoal/15 bg-parchment px-3 py-2.5">
        <Search size={17} className="shrink-0 text-slate" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Your name"
          className="min-w-0 flex-1 bg-transparent"
          aria-label="Your name"
        />
      </label>

      <div className="mx-auto mt-6 max-w-sm">
        {query.trim().length < 2 ? (
          <p className="text-center text-sm text-slate">
            Type a couple of letters of your name.
          </p>
        ) : matches.length === 0 ? (
          <p className="text-center text-sm text-slate">
            Nothing under that name. Try your surname, or the name on the invitation.
          </p>
        ) : (
          <ul className="space-y-2">
            {matches.map((guest) => (
              <Match key={`${guest.name}-${guest.table}`} guest={guest} />
            ))}
          </ul>
        )}
      </div>

      {snapshot.tables ? <RoomPlan snapshot={snapshot} highlight={matches[0] ?? null} /> : null}

      <footer className="mt-16 text-center text-xs text-slate">
        This page holds names and table numbers, and nothing else. It was published{" "}
        {formatDate(snapshot.publishedAt.slice(0, 10))}.
      </footer>
    </main>
  );
}

function Match({ guest }: { guest: SharedGuest }) {
  return (
    <li className="rounded border border-charcoal/10 bg-stone/60 px-4 py-3 text-center">
      <span className="block text-lg text-charcoal">{guest.name}</span>
      {guest.table ? (
        <>
          <span className="mt-1 block font-display text-2xl text-charcoal">{guest.table}</span>
          {guest.seat !== null ? (
            <span className="block text-sm text-slate">Seat {guest.seat}</span>
          ) : null}
        </>
      ) : (
        <span className="mt-1 block text-sm text-slate">
          No table yet — do ask on the day.
        </span>
      )}
    </li>
  );
}

/**
 * The room, when the couple chose to publish it.
 *
 * Tables and their labels; never who is at them. A guest who wants to know
 * where somebody else sits can search for them by name like anybody else.
 */
function RoomPlan({
  snapshot,
  highlight,
}: {
  snapshot: ShareSnapshot;
  highlight: SharedGuest | null;
}) {
  const tables = snapshot.tables ?? [];
  if (tables.length === 0) return null;

  const boxes = tables.map((table) => {
    const geometry = getTableGeometry(newTable({ ...table }), 0.7);
    return { table, geometry };
  });

  const pad = 60;
  const minX = Math.min(...boxes.map((b) => b.table.x - b.geometry.width / 2)) - pad;
  const minY = Math.min(...boxes.map((b) => b.table.y - b.geometry.height / 2)) - pad;
  const maxX = Math.max(...boxes.map((b) => b.table.x + b.geometry.width / 2)) + pad;
  const maxY = Math.max(...boxes.map((b) => b.table.y + b.geometry.height / 2)) + pad;

  return (
    <section className="mt-12">
      <h2 className="mb-3 text-center text-sm tracking-widest text-slate uppercase">The room</h2>
      <svg
        viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
        className="h-auto w-full"
        role="img"
        aria-label="The room, with the tables labelled"
      >
        {boxes.map(({ table, geometry }) => {
          const found = highlight?.table === table.label;
          return (
            <g key={table.id} transform={`translate(${table.x} ${table.y}) rotate(${table.rotation})`}>
              {geometry.shape === "circle" ? (
                <circle
                  r={geometry.radius}
                  fill={found ? "var(--color-gold)" : "var(--color-parchment)"}
                  fillOpacity={found ? 0.25 : 1}
                  stroke="var(--color-charcoal)"
                  strokeOpacity={found ? 1 : 0.35}
                  strokeWidth={found ? 2.5 : 1.25}
                />
              ) : (
                <rect
                  x={-geometry.width / 2}
                  y={-geometry.height / 2}
                  width={geometry.width}
                  height={geometry.height}
                  rx={3}
                  fill={found ? "var(--color-gold)" : "var(--color-parchment)"}
                  fillOpacity={found ? 0.25 : 1}
                  stroke="var(--color-charcoal)"
                  strokeOpacity={found ? 1 : 0.35}
                  strokeWidth={found ? 2.5 : 1.25}
                />
              )}
              <text textAnchor="middle" y={4} fontSize={13} fill="var(--color-charcoal)">
                {table.label}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}
