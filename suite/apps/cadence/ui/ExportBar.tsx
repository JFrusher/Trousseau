import { useState } from "react";
import type { OutputId } from "../core/model/types";
import { blockingConflicts } from "../core/schedule/conflicts";
import { renderAllCallSheets } from "../render/pdf/callSheet";
import { renderContactSheet } from "../render/pdf/contactSheet";
import { browserFontSource } from "../render/pdf/fontSource";
import { renderOrderOfDay } from "../render/pdf/orderOfDay";
import { renderRunSheet } from "../render/pdf/runSheet";
import { renderTimeline } from "../render/pdf/timeline";
import { getBlob } from "../state/blobStore";
import { getDoc, selectSchedule, useStore } from "../state/store";
import { Button } from "@/components/ui/fields";
import styles from "./ExportBar.module.css";

const FILENAMES: Record<OutputId, string> = {
  "run-sheet": "run-sheet",
  "call-sheet": "call-sheets",
  "order-of-day": "order-of-the-day",
  "contact-sheet": "contact-sheet",
};

export function ExportBar() {
  const doc = useStore(getDoc);
  const schedule = useStore(selectSchedule);
  const output = useStore((state) => state.ui.sheetOutput);
  const setUi = useStore((state) => state.setUi);
  const setNotice = useStore((state) => state.setNotice);
  const [busy, setBusy] = useState(false);

  const blocking = blockingConflicts(schedule.conflicts);
  const empty = doc.blocks.length === 0;
  const reason = empty
    ? "Add a block to the day first."
    : blocking.length > 0
      ? `Fix ${blocking.length} clash${blocking.length === 1 ? "" : "es"} first — a printed sheet that contradicts itself is worse than none.`
      : null;

  const download = async (piece: OutputId | "timeline") => {
    setBusy(true);
    try {
      const uploaded = new Map<string, Uint8Array>();
      for (const font of doc.fonts) {
        const blob = await getBlob(font.blobKey).catch(() => null);
        if (blob) uploaded.set(font.family, new Uint8Array(await blob.arrayBuffer()));
      }

      const fontSource = browserFontSource(uploaded);
      const generatedOn = `Made with Cadence, ${new Date().toLocaleDateString()}`;
      const bytes =
        piece === "timeline"
          ? await renderTimeline(doc, { fontSource, generatedOn })
          : piece === "run-sheet"
            ? await renderRunSheet(doc, { fontSource, generatedOn })
            : piece === "call-sheet"
              ? await renderAllCallSheets(doc, { fontSource, generatedOn })
              : piece === "order-of-day"
                ? await renderOrderOfDay(doc, { fontSource })
                : await renderContactSheet(doc, { fontSource, generatedOn });

      const slug = (doc.day.coupleNames || "cadence")
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slug}-${piece === "timeline" ? "timeline" : FILENAMES[piece]}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice(`The PDF could not be made: ${error instanceof Error ? error.message : "unknown problem"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.bar}>
      <select
        className={styles.select}
        value={output}
        aria-label="Printed piece"
        onChange={(event) => setUi({ sheetOutput: event.target.value as OutputId })}
      >
        {doc.outputs.map((spec) => (
          <option key={spec.id} value={spec.id}>
            {spec.label}
          </option>
        ))}
      </select>

      <Button
        variant="primary"
        disabled={busy || reason !== null}
        onClick={() => void download(output)}
        {...(reason === null ? {} : { title: reason })}
      >
        {busy ? "Making the PDF…" : "Download PDF"}
      </Button>

      <Button
        disabled={busy || reason !== null}
        onClick={() => void download("timeline")}
        title={reason ?? "The whole day on one page, lane by lane."}
      >
        Download timeline
      </Button>

      {reason && <span className={styles.reason}>{reason}</span>}
    </div>
  );
}
