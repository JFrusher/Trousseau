"use client";

import { useEffect, useState } from "react";
import { Presentation } from "./render/screen/Presentation";
import { Timeline } from "./render/screen/Timeline";
import { serialise } from "./core/project/file";
import { formatDuration } from "./core/time/minutes";
import { restoreFonts } from "./state/fontLoader";
import { createPersister, restore } from "./state/persist";
import { spanOf } from "./render/screen/ticks";
import { getDoc, selectSchedule, useStore, ZOOM_STEP } from "./state/store";
import { useKeyboard } from "./state/useKeyboard";
import { Announcer } from "./ui/Announcer";
import { Button } from "@/components/ui/fields";
import { ChromeFill } from "@/components/shell/chrome";
import { ToolUndo } from "@/components/shell/ToolUndo";
import { DesktopGate, useIsDesktop } from "./ui/DesktopGate";
import { ExportBar } from "./ui/ExportBar";
import { ProjectButtons } from "./ui/ProjectButtons";
import { Sidebar } from "./ui/Sidebar";
import { WarningsList } from "./ui/WarningsList";
import { write as writeLinkedFile } from "./state/fileSink";
import styles from "./App.module.css";

const persister = createPersister();

export function App() {
  const isDesktop = useIsDesktop();
  const doc = useStore(getDoc);
  const schedule = useStore(selectSchedule);
  const presentation = useStore((state) => state.ui.presentation);
  const notice = useStore((state) => state.notice);
  const setUi = useStore((state) => state.setUi);
  const setNotice = useStore((state) => state.setNotice);
  const zoomBy = useStore((state) => state.zoomBy);
  const fitDay = useStore((state) => state.fitDay);
  useKeyboard();

  // Bring back the last session once, on boot.
  /**
   * Nothing is written until the saved day has been read back.
   *
   * The autosave effect below runs on the first render, when the store still
   * holds the empty document it was created with — and the effect that restores
   * the real one has only just run, so this render's `doc` is still the empty
   * one. Standalone, that was harmless: a second render followed immediately
   * and replaced the pending write before the debounce elapsed, and in any case
   * a write that arrived too early was dropped by a store that had not loaded.
   *
   * Neither of those safety nets exists now. The shared document is ready
   * before the tool mounts, so an early write lands, and it lands on a real
   * wedding — blanking the day and, through the mirror, the couple and venue
   * with it. A restore is a read; writing before it finishes is never right.
   */
  const [restored, setRestored] = useState(false);
  // Booleans out of the store, so nothing is allocated on the way through.
  const canUndo = useStore((state) => state.canUndo());
  const canRedo = useStore((state) => state.canRedo());

  useEffect(() => {
    const { doc: saved, notice: problem } = restore();
    if (saved) {
      useStore.getState().loadDoc(saved);
      void restoreFonts(saved.fonts).then((missing) => {
        if (missing.length > 0) setNotice(`Missing font${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
      });
    }
    if (problem) setNotice(problem);
    setRestored(true);
  }, [setNotice]);

  // Autosave, debounced, and flushed if the window goes away mid-edit.
  // localStorage is the source of truth for this browser; the linked file, when
  // there is one, is a second write so a synced folder always holds the current
  // day. A failure there never loses work, so it is not worth interrupting for.
  useEffect(() => {
    if (!restored) return;
    persister.schedule(doc);
    void writeLinkedFile(serialise(doc));
  }, [doc, restored]);
  useEffect(() => {
    const flush = () => persister.flush();
    window.addEventListener("beforeunload", flush);
    // The listener is not enough on its own. Each tool used to *be* the page,
    // so unmounting only ever happened as the page went away and `beforeunload`
    // had already flushed. They are tabs now: switching to another tool unmounts
    // this one with no unload event, which would drop whatever the debounce was
    // still holding.
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  if (!isDesktop) return <DesktopGate />;
  if (presentation) return <Presentation />;

  const curfew = schedule.slack.toCurfewMin;

  return (
    <div className={styles.app}>
      {/*
        * Cadence's own header used to sit here, under the suite's, with a
        * second wordmark and the couple's names the shell already knows. There
        * is one header now; what was in it that does something goes into it.
        *
        * The curfew reading travels with them. It is the one number in this bar
        * that is not a control — how much of the day is left — and it belongs
        * beside the day rather than buried in a panel.
        */}
      <ChromeFill name="tool-actions" tokens="cadence-tokens">
        {doc.blocks.length > 0 && (
          <span className={curfew < 0 ? styles.over : styles.slack}>
            {curfew < 0
              ? `${formatDuration(-curfew)} past curfew`
              : `${formatDuration(curfew)} before curfew`}
          </span>
        )}
        <span className={styles.zoom}>
          <Button variant="quiet" onClick={() => zoomBy(1 / ZOOM_STEP)} title="Zoom out">
            −
          </Button>
          <Button variant="quiet" onClick={() => zoomBy(ZOOM_STEP)} title="Zoom in">
            +
          </Button>
          <Button
            variant="quiet"
            title="Fit the whole day in view"
            onClick={() => {
              const span = spanOf(schedule.resolved, doc.day.curfewMin);
              const viewport = document.querySelector("[data-timeline]")?.clientHeight ?? 0;
              fitDay(viewport - 40, span.toMin - span.fromMin);
            }}
          >
            Fit day
          </Button>
        </span>
        <Button onClick={() => setUi({ presentation: true })}>Present</Button>
        <ProjectButtons />
      </ChromeFill>
      <ToolUndo
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => useStore.getState().undo()}
        onRedo={() => useStore.getState().redo()}
      />

      {notice && (
        <p className={styles.notice} role="status">
          {notice}
          <button type="button" className={styles.dismiss} onClick={() => setNotice(null)}>
            dismiss
          </button>
        </p>
      )}

      <div className={styles.body}>
        <Sidebar />
        <main className={styles.canvas}>
          <Timeline />
          <div className={styles.foot}>
            <WarningsList />
            <ExportBar />
          </div>
        </main>
      </div>

      <Announcer />
    </div>
  );
}
