"use client";

import { useEffect, useState } from "react";
import { Board } from "./render/screen/Board";
import { createPersister, restore } from "./state/persist";
import { getDoc, useStore } from "./state/store";
import { Announcer } from "./ui/Announcer";
import { Button } from "@/components/ui/fields";
import { ChromeFill } from "@/components/shell/chrome";
import { ToolUndo } from "@/components/shell/ToolUndo";
import { DesktopGate, useIsDesktop } from "./ui/DesktopGate";
import { ExportBar } from "./ui/ExportBar";
import { Sidebar } from "./ui/Sidebar";
import { WarningsList } from "./ui/WarningsList";
import { serialise } from "./core/project/file";
import { write as writeLinkedFile } from "./state/fileSink";
import styles from "./App.module.css";

const persister = createPersister();

export function App() {
  const isDesktop = useIsDesktop();
  const doc = useStore(getDoc);
  const notice = useStore((state) => state.notice);
  const filter = useStore((state) => state.filter);
  const setFilter = useStore((state) => state.setFilter);
  const setNotice = useStore((state) => state.setNotice);

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
  const canUndo = useStore((state) => state.canUndo());
  const canRedo = useStore((state) => state.canRedo());

  useEffect(() => {
    const { doc: saved, notice: problem } = restore();
    if (saved) useStore.getState().loadDoc(saved);
    if (problem) setNotice(problem);
    setRestored(true);
  }, [setNotice]);

  // Autosave, debounced, and flushed if the window goes away mid-edit.
  // localStorage is the source of truth for this browser; the linked file, when
  // there is one, is a second write so a synced folder always holds the current
  // crew. A failure there never loses work, so it is not worth interrupting for.
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

  const unassigned = doc.jobs.filter((job) => job.personIds.length === 0).length;

  return (
    <div className={styles.app}>
      {/*
        * Brigade's own header used to sit here, under the suite's, repeating a
        * wordmark and the couple's names the shell already knows. There is one
        * header now; the coverage reading and the filter go into it, because
        * how many jobs still have nobody on them is the thing you keep glancing
        * at while you work.
        */}
      <ChromeFill name="tool-actions" tokens="brigade-tokens">
        {/* Nothing to report leaves nothing behind, rather than an empty
            styled span sitting in the header as a stray mark. */}
        {doc.jobs.length > 0 && (
          <span className={unassigned > 0 ? styles.over : styles.slack}>
            {unassigned > 0
              ? `${unassigned} of ${doc.jobs.length} jobs have nobody`
              : `${doc.jobs.length} jobs, all covered`}
          </span>
        )}
        <Button
          variant={filter.unassignedOnly ? "primary" : "quiet"}
          onClick={() => setFilter({ unassignedOnly: !filter.unassignedOnly })}
          title="Show only the jobs nobody is named on"
        >
          Unassigned only
        </Button>
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
          <Board />
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
