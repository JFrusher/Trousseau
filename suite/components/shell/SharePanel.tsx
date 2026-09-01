"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check as CheckIcon,
  Copy,
  Link2,
  LogOut,
  Trash2,
  RefreshCw,
  Unlink,
} from "lucide-react";
import { readGuests, readSeating } from "@/lib/model/slices";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import { newShareKey, seal } from "@/lib/sync/crypto";
import { shareSnapshot } from "@/lib/sync/shareSnapshot";
import {
  createShared,
  currentSession,
  deleteFromServer,
  forget,
  join,
  keepMine,
  membership,
  publishShare,
  sync,
  takeDownShare,
  takeTheirs,
  type Conflict,
} from "@/lib/sync/client";
import { Button, Check, Empty, Panel, TextField } from "@/components/ui/controls";

/**
 * Sharing, in the Data manager.
 *
 * Two separate things, deliberately kept apart on screen because they publish
 * very different amounts:
 *
 *  - Syncing puts the *whole* wedding on a server, encrypted under a passphrase
 *    only the couple know.
 *  - A guest link publishes a reduced snapshot — names and table numbers, and
 *    nothing else — under a key that lives in the link's own fragment.
 */
export function SharePanel({ onProblem }: { onProblem: (message: string | null) => void }) {
  const [known, setKnown] = useState<{ weddingId: string; shareToken: string | null } | null>(null);
  const [signedIn, setSignedIn] = useState(currentSession() !== null);
  const [passphrase, setPassphrase] = useState("");
  const [joinId, setJoinId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [confirmJoin, setConfirmJoin] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [copied, setCopied] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [erasePhrase, setErasePhrase] = useState("");

  const refresh = useCallback(async () => {
    const m = await membership();
    setKnown(m ? { weddingId: m.weddingId, shareToken: m.shareToken } : null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (id: string, work: () => Promise<string>) => {
      setBusy(id);
      onProblem(null);
      setNotice(null);
      try {
        setNotice(await work());
      } catch (cause) {
        onProblem(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [onProblem],
  );

  const describe = (result: Awaited<ReturnType<typeof sync>>): string => {
    const parts: string[] = [];
    if (result.pulled.length > 0) parts.push(`took ${result.pulled.length}`);
    if (result.pushed.length > 0) parts.push(`sent ${result.pushed.length}`);
    if (result.blobsUp > 0) parts.push(`uploaded ${result.blobsUp} file(s)`);
    if (result.blobsDown > 0) parts.push(`fetched ${result.blobsDown} file(s)`);
    if (parts.length === 0) parts.push("already in step");
    return `${parts.join(", ")}.`;
  };

  const doSync = useCallback(
    () =>
      run("sync", async () => {
        const result = await sync();
        setConflicts(result.conflicts);
        await refresh();
        return result.conflicts.length > 0
          ? `${describe(result)} ${result.conflicts.length} changed in both places — nothing was overwritten.`
          : describe(result);
      }),
    [run, refresh],
  );

  const publishGuestLink = useCallback(async () => {
    const { doc } = useTrousseauStore.getState();
    const snapshot = shareSnapshot(readGuests(doc), readSeating(doc), doc.event, { showPlan });

    // A fresh key every publish, carried in the fragment. The server storing the
    // ciphertext never sees it, and neither does anything in a server log.
    const { key, encoded } = await newShareKey();
    const token = await publishShare(await seal(key, snapshot));

    setShareLink(`${window.location.origin}/seat/${token}#k=${encoded}`);
    await refresh();
    return `${snapshot.guests.length} names published. The previous link now shows this plan.`;
  }, [showPlan, refresh]);

  return (
    <>
      <Panel title="Two machines, one wedding">
        {notice ? (
          <p className="mb-2 rounded border border-sage/50 bg-sage/10 px-2 py-1.5 text-xs text-charcoal">
            {notice}
          </p>
        ) : null}

        {signedIn ? (
          <div className="space-y-2">
            <p className="text-xs text-slate">
              Signed in to <span className="text-charcoal">{known?.weddingId}</span>. Everything is
              encrypted here before it leaves — the server holds bytes it cannot read.
            </p>
            <div className="flex gap-2">
              <Button icon={RefreshCw} tone="primary" disabled={busy !== null} onClick={() => void doSync()}>
                {busy === "sync" ? "Syncing…" : "Sync now"}
              </Button>
              <Button
                icon={LogOut}
                onClick={() =>
                  void run("out", async () => {
                    await forget();
                    setSignedIn(false);
                    setConflicts([]);
                    await refresh();
                    return "Signed out. The wedding is still here on this device.";
                  })
                }
              >
                Sign out
              </Button>
            </div>

            {/*
              Erasure, kept behind a typed confirmation rather than a second
              click. Signing out is reversible from the passphrase; this is not
              reversible from anything.
            */}
            {erasing ? (
              <div className="space-y-2 rounded border border-rose/50 bg-rose/10 p-2">
                <p className="text-xs text-charcoal">
                  This removes the wedding from the server for good — every slice, every uploaded
                  font and picture, and the guest link. Anyone holding that link will find nothing
                  there. The copy on this device is untouched.
                </p>
                <TextField
                  label='Type "delete" to confirm'
                  value={erasePhrase}
                  onChange={setErasePhrase}
                  placeholder="delete"
                />
                <div className="flex gap-2">
                  <Button
                    icon={Trash2}
                    tone="danger"
                    disabled={erasePhrase.trim().toLowerCase() !== "delete" || busy !== null}
                    onClick={() =>
                      void run("erase", async () => {
                        await deleteFromServer();
                        setSignedIn(false);
                        setConflicts([]);
                        setShareLink(null);
                        setErasing(false);
                        setErasePhrase("");
                        await refresh();
                        return "Erased from the server. The wedding is still here on this device.";
                      })
                    }
                  >
                    {busy === "erase" ? "Erasing…" : "Erase from server"}
                  </Button>
                  <Button
                    onClick={() => {
                      setErasing(false);
                      setErasePhrase("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="text-xs text-slate underline underline-offset-2 hover:text-charcoal"
                onClick={() => setErasing(true)}
              >
                Erase this wedding from the server
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate">
              Choose a passphrase and the wedding can be opened on another machine. It is never sent
              anywhere and cannot be recovered — write it down.
            </p>
            <TextField
              label="Passphrase"
              type="password"
              value={passphrase}
              onChange={setPassphrase}
              placeholder="four random words"
            />

            <Button
              tone="primary"
              disabled={busy !== null || passphrase.length < 8}
              onClick={() =>
                void run("create", async () => {
                  const session = await createShared(passphrase);
                  setSignedIn(true);
                  setPassphrase("");
                  await refresh();
                  return `Sharing started as ${session.weddingId}. The other machine needs that and the passphrase.`;
                })
              }
            >
              {busy === "create" ? "Starting…" : "Start sharing"}
            </Button>

            <div className="border-t border-charcoal/10 pt-2">
              <TextField
                label="Or open one already shared"
                value={joinId}
                onChange={setJoinId}
                placeholder="wedding id"
              />

              {confirmJoin ? (
                <p className="mt-2 flex gap-1.5 rounded border border-rose/40 bg-rose/10 px-2 py-1.5 text-xs">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-rose" />
                  <span className="text-charcoal">
                    There is already a wedding on this device. Opening the shared one replaces it.
                    Export a backup first if you want to keep it.
                  </span>
                </p>
              ) : null}

              <div className="mt-2">
                <Button
                  tone={confirmJoin ? "danger" : "quiet"}
                  disabled={busy !== null || joinId.trim() === "" || passphrase.length < 8}
                  onClick={() =>
                    void run("join", async () => {
                      const result = await join(joinId.trim(), passphrase, {
                        replaceLocal: confirmJoin,
                      });
                      if (result.needsConfirmation) {
                        setConfirmJoin(true);
                        return "This device already holds a wedding — confirm to replace it.";
                      }
                      setSignedIn(true);
                      setConfirmJoin(false);
                      setPassphrase("");
                      await refresh();
                      return "Opened. This machine now has the shared wedding.";
                    })
                  }
                >
                  {busy === "join" ? "Opening…" : confirmJoin ? "Replace what is here" : "Open it"}
                </Button>
              </div>
            </div>

            <p className="text-xs text-slate">
              Passphrase needs eight characters or more. It is stretched with 600,000 rounds of
              PBKDF2 before it becomes a key, so a short one is still worth guessing — use words.
            </p>
          </div>
        )}
      </Panel>

      {conflicts.length > 0 ? (
        <Panel title={`Changed in both places (${conflicts.length})`}>
          <p className="mb-2 text-xs text-slate">
            These were edited here and on the other machine since the last sync. Nothing has been
            overwritten in either direction — choose which to keep.
          </p>
          <ul className="space-y-1.5">
            {conflicts.map((conflict) => (
              <li
                key={conflict.slice}
                className="rounded border border-rose/40 bg-rose/10 px-2 py-1.5"
              >
                <span className="block text-sm text-charcoal">{label(conflict.slice)}</span>
                <div className="mt-1.5 flex gap-2">
                  <Button
                    disabled={busy !== null}
                    onClick={() =>
                      void run(conflict.slice, async () => {
                        await takeTheirs(conflict);
                        setConflicts((c) => c.filter((x) => x.slice !== conflict.slice));
                        return `Took their ${label(conflict.slice).toLowerCase()}.`;
                      })
                    }
                  >
                    Take theirs
                  </Button>
                  <Button
                    disabled={busy !== null}
                    onClick={() =>
                      void run(conflict.slice, async () => {
                        await keepMine(conflict);
                        setConflicts((c) => c.filter((x) => x.slice !== conflict.slice));
                        return `Kept this machine's ${label(conflict.slice).toLowerCase()}.`;
                      })
                    }
                  >
                    Keep mine
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="A link for the guests">
        {!signedIn ? (
          <Empty>Start sharing above first — a guest link needs somewhere to live.</Empty>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate">
              Names and table numbers only. No email addresses, no phone numbers, no dietary
              requirements, no notes — and nobody who declined. The key that reads it sits in the
              link after the <span className="text-charcoal">#</span>, which browsers never send to
              a server.
            </p>
            <Check
              label="Show the room, not just the search"
              checked={showPlan}
              onChange={setShowPlan}
            />

            <div className="flex flex-wrap gap-2">
              <Button
                icon={Link2}
                tone="primary"
                disabled={busy !== null}
                onClick={() => void run("share", publishGuestLink)}
              >
                {busy === "share"
                  ? "Publishing…"
                  : known?.shareToken
                    ? "Update the link"
                    : "Publish a link"}
              </Button>

              {known?.shareToken ? (
                <Button
                  icon={Unlink}
                  tone="danger"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("down", async () => {
                      await takeDownShare();
                      setShareLink(null);
                      await refresh();
                      return "Link taken down. It no longer opens for anybody.";
                    })
                  }
                >
                  Take it down
                </Button>
              ) : null}
            </div>

            {known?.shareToken && !shareLink ? (
              <p className="flex gap-1.5 text-xs text-slate">
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-gold" />
                A link is live from an earlier session. The key that opens it was only ever in that
                link, so it cannot be shown again — press <em>Update the link</em> to publish the
                current plan to a fresh one, or take it down.
              </p>
            ) : null}

            {shareLink ? (
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={shareLink}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 rounded border border-charcoal/15 bg-stone px-2 py-1.5 text-xs text-charcoal outline-none"
                  />
                  <Button
                    icon={copied ? CheckIcon : Copy}
                    onClick={() => {
                      void navigator.clipboard.writeText(shareLink).then(
                        () => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        },
                        () => onProblem("The link could not be copied. Select it and copy by hand."),
                      );
                    }}
                  />
                </div>
                <p className="flex gap-1.5 text-xs text-slate">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-gold" />
                  Anybody with this link can see the names and tables on it. There is only ever one
                  live link — updating replaces what it shows, so a link you have already given out
                  stays correct.
                </p>
              </div>
            ) : null}
          </div>
        )}
      </Panel>
    </>
  );
}

const LABELS: Record<string, string> = {
  event: "The wedding's details",
  guests: "The guest list",
  seating: "The seating plan",
  timeline: "The run of the day",
  day: "The resolved day",
  crew: "The crew and their jobs",
  stationery: "The stationery design",
};

const label = (slice: string): string => LABELS[slice] ?? slice;
