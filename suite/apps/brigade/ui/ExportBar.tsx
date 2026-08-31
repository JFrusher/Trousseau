import { useState } from "react";
import { blocking } from "../core/jobs/coverage";
import {
  renderAllPersonSheets,
  renderAllTeamSheets,
  renderJobList,
} from "../render/pdf/jobSheets";
import { browserFontSource } from "../render/pdf/fontSource";
import { download } from "../state/projectIO";
import { getDoc, selectCover, useStore } from "../state/store";
import { Button } from "@/components/ui/fields";
import styles from "./ExportBar.module.css";

type Piece = "job-list" | "person-sheets" | "team-sheets";

const LABELS: Record<Piece, string> = {
  "job-list": "Job list",
  "person-sheets": "Sheet per person",
  "team-sheets": "Sheet per team",
};

export function ExportBar() {
  const doc = useStore(getDoc);
  const cover = useStore(selectCover);
  const setNotice = useStore((state) => state.setNotice);
  const [piece, setPiece] = useState<Piece>("job-list");
  const [busy, setBusy] = useState(false);

  const clashes = blocking(cover.warnings);
  const reason =
    doc.jobs.length === 0
      ? "Add a job first."
      : clashes.length > 0
        ? `Fix ${clashes.length} clash${clashes.length === 1 ? "" : "es"} first — a sheet that has somebody in two places is worse than none.`
        : null;

  const make = async () => {
    setBusy(true);
    try {
      const fontSource = browserFontSource();
      const generatedOn = `Made with Brigade, ${new Date().toLocaleDateString()}`;
      const bytes =
        piece === "job-list"
          ? await renderJobList(doc, { fontSource, generatedOn })
          : piece === "person-sheets"
            ? await renderAllPersonSheets(doc, { fontSource, generatedOn })
            : await renderAllTeamSheets(doc, { fontSource, generatedOn });

      const slug = (doc.day?.coupleNames ?? "brigade")
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      download(bytes, `${slug || "brigade"}-${piece}.pdf`);
    } catch (error) {
      setNotice(
        `The PDF could not be made: ${error instanceof Error ? error.message : "unknown problem"}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.bar}>
      <select
        className={styles.select}
        value={piece}
        aria-label="Printed piece"
        onChange={(event) => setPiece(event.target.value as Piece)}
      >
        {Object.entries(LABELS).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>

      <Button
        variant="primary"
        disabled={busy || reason !== null}
        onClick={() => void make()}
        {...(reason === null ? {} : { title: reason })}
      >
        {busy ? "Making the PDF…" : "Download PDF"}
      </Button>

      {reason && <span className={styles.reason}>{reason}</span>}
    </div>
  );
}
