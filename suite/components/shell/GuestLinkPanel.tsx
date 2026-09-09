"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check as CheckIcon,
  Copy,
  Link2,
  Trash2,
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
  membership,
  publishShare,
  takeDownShare,
  unlockShare,
} from "@/lib/sync/client";
import { Button, Check, Panel, TextField } from "@/components/ui/controls";

/**
 * The guest link, and only the guest link.
 *
 * What is left of the old Sharing panel now that the account-based sync in
 * `useTrousseauStore` has replaced whole-document passphrase sync. This is a
 * different thing on purpose: it publishes a *reduced* snapshot — names and
 * table numbers, nothing else — under its own one-off key that lives in the
 * link's fragment and never reaches a server.
 *
 * It still rides on `lib/sync`'s wedding row for storage and authorisation,
 * which is why a passphrase is still asked for here. Re-pointing it at
 * `account_weddings.id` so it needs no passphrase at all is the follow-up the
 * design doc records; until then, removing this panel is what leaves a
 * published link on the internet with no way to take it down.
 */
export function GuestLinkPanel({ onProblem }: { onProblem: (message: string | null) => void }) {
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const [unlocked, setUnlocked] = useState(currentSession() !== null);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [copied, setCopied] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [erasePhrase, setErasePhrase] = useState("");

  const refresh = useCallback(async () => {
    const known = await membership();
    setEnrolled(known !== null);
    setShareToken(known?.shareToken ?? null);
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

  const publish = useCallback(async () => {
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
    <Panel title="A link for the guests">
      {notice ? (
        <p className="mb-2 rounded border border-sage/50 bg-sage/10 px-2 py-1.5 text-xs text-charcoal">
          {notice}
        </p>
      ) : null}

      <p className="text-xs text-slate">
        Names and table numbers only. No email addresses, no phone numbers, no dietary requirements,
        no notes — and nobody who declined. The key that reads it sits in the link after the{" "}
        <span className="text-charcoal">#</span>, which browsers never send to a server.
      </p>

      {unlocked ? (
        <div className="mt-2 space-y-2">
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
              onClick={() => void run("share", publish)}
            >
              {busy === "share" ? "Publishing…" : shareToken ? "Update the link" : "Publish a link"}
            </Button>

            {shareToken ? (
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

          {shareToken && !shareLink ? (
            <p className="flex gap-1.5 text-xs text-slate">
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-gold" />A link is live from an
              earlier session. The key that opens it was only ever in that link, so it cannot be
              shown again — press <em>Update the link</em> to publish the current plan to a fresh
              one, or take it down.
            </p>
          ) : null}

          {shareLink ? (
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <input
                  readOnly
                  value={shareLink}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded border border-charcoal/15 bg-stone px-2 py-1.5 text-xs text-charcoal"
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

          {/*
            Erasure, kept behind a typed confirmation rather than a second
            click. It removes the wedding from the legacy passphrase server —
            not the copy on this device — so it stays reversible right up to
            the moment "delete" is typed.
          */}
          <div className="border-t border-charcoal/10 pt-2">
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
                        setUnlocked(false);
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
        </div>
      ) : (
        /*
          The passphrase is not asked for again to sync anything — the wedding
          itself now travels with the account. It is what the link's own server
          checks before it will publish or, more to the point, take a published
          link down. Held in memory only, so a reload asks once more.
        */
        <div className="mt-2 space-y-2">
          <TextField
            label={enrolled ? "Passphrase for the guest link" : "Choose a passphrase for the link"}
            type="password"
            value={passphrase}
            onChange={setPassphrase}
            placeholder="four random words"
          />
          <Button
            tone="primary"
            disabled={busy !== null || passphrase.length < 8}
            onClick={() =>
              void run("unlock", async () => {
                if (enrolled) {
                  await unlockShare(passphrase);
                } else {
                  await createShared(passphrase);
                }
                setPassphrase("");
                setUnlocked(true);
                await refresh();
                return "Unlocked. The link can be published, updated or taken down.";
              })
            }
          >
            {busy === "unlock" ? "Unlocking…" : enrolled ? "Unlock" : "Set it up"}
          </Button>
          <p className="text-xs text-slate">
            Eight characters or more. It is never sent anywhere and cannot be recovered, so write it
            down — without it a published link cannot be taken down again.
          </p>
        </div>
      )}
    </Panel>
  );
}
