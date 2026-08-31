import { useRef } from "react";
import { emptyDoc, sampleDoc } from "../../core/model/defaults";
import { formatClock } from "../../core/time/minutes";
import { openProject, saveProject } from "../../state/projectIO";
import { LinkedFileButton } from "../LinkedFileButton";
import { getDoc, useStore } from "../../state/store";
import { Button, Panel, Row } from "@/components/ui/fields";
import styles from "./DayPanel.module.css";

/**
 * Where the day comes from. Brigade never edits it: the timeline is Cadence's,
 * and the only honest way to change it is to change it there and import again.
 */
export function DayPanel() {
  const dayInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const doc = useStore(getDoc);
  const importDay = useStore((state) => state.importDay);
  const loadDoc = useStore((state) => state.loadDoc);
  const setNotice = useStore((state) => state.setNotice);

  const day = doc.day;

  const onDayChosen = async (file: File | undefined) => {
    if (!file) return;
    importDay(await file.text());
  };

  const onFileChosen = async (file: File | undefined) => {
    if (!file) return;
    const result = await openProject(file);
    if (result.error !== undefined) {
      setNotice(result.error);
      return;
    }
    loadDoc(result.doc);
    setNotice(result.fromFuture ? "That file came from a newer Brigade than this one." : null);
  };

  return (
    <Panel title="The day">
      {day === null ? (
        <p className={styles.none}>
          No day yet. Export one from Cadence — <em>Export day</em> — and import it here.
        </p>
      ) : (
        <dl className={styles.summary}>
          <dt>Day</dt>
          <dd>{day.coupleNames || "No names"}</dd>
          <dt>Venue</dt>
          <dd>{day.venueName || "—"}</dd>
          <dt>Date</dt>
          <dd>{day.date}</dd>
          <dt>Blocks</dt>
          <dd>
            {day.blocks.length}, {formatClock(spanOf(day.blocks).fromMin)} to{" "}
            {formatClock(spanOf(day.blocks).toMin)}
          </dd>
        </dl>
      )}

      <Row>
        <Button variant="primary" onClick={() => dayInput.current?.click()}>
          {day === null ? "Import day" : "Re-import day"}
        </Button>
        <Button onClick={() => saveProject(doc)}>Save</Button>
        <LinkedFileButton />
      </Row>

      <Row>
        <Button variant="quiet" onClick={() => fileInput.current?.click()}>
          Open
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            if (doc.jobs.length > 0 && !confirm("Start again? The work on this day will go.")) return;
            loadDoc(emptyDoc());
          }}
        >
          New
        </Button>
        <Button variant="quiet" onClick={() => loadDoc(sampleDoc())}>
          Sample
        </Button>
      </Row>

      <input
        ref={dayInput}
        type="file"
        accept=".json,application/json"
        className={styles.file}
        onChange={(event) => {
          void onDayChosen(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className={styles.file}
        onChange={(event) => {
          void onFileChosen(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </Panel>
  );
}

function spanOf(blocks: { startMin: number; endMin: number }[]): { fromMin: number; toMin: number } {
  if (blocks.length === 0) return { fromMin: 0, toMin: 0 };
  return {
    fromMin: Math.min(...blocks.map((block) => block.startMin)),
    toMin: Math.max(...blocks.map((block) => block.endMin)),
  };
}
