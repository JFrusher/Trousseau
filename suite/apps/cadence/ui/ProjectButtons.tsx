import { useRef } from "react";
import { emptyDoc, sampleDoc } from "../core/model/defaults";
import { openProject, saveDay, saveProject } from "../state/projectIO";
import { getDoc, useStore } from "../state/store";
import { LinkedFileButton } from "./LinkedFileButton";
import styles from "./ProjectButtons.module.css";

export function ProjectButtons() {
  const input = useRef<HTMLInputElement>(null);
  const doc = useStore(getDoc);
  const loadDoc = useStore((state) => state.loadDoc);
  const setNotice = useStore((state) => state.setNotice);

  const onChosen = async (file: File | undefined) => {
    if (!file) return;
    const result = await openProject(file);
    if (result.error !== undefined) {
      setNotice(result.error);
      return;
    }
    loadDoc(result.doc);
    setNotice(
      result.missing.length > 0
        ? `Opened. ${result.missing.length} upload${result.missing.length === 1 ? " is" : "s are"} missing on this machine.`
        : null,
    );
  };

  return (
    <div className={styles.row}>
      <button type="button" className={styles.button} onClick={() => saveProject(doc)}>
        Save day
      </button>
      <button type="button" className={styles.button} onClick={() => input.current?.click()}>
        Open day
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => saveDay(doc)}
        title="Export the day with its times worked out, for another tool to read"
      >
        Export day
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => {
          if (doc.blocks.length > 0 && !confirm("Start a new day? The current one will be replaced.")) return;
          loadDoc(emptyDoc());
        }}
      >
        New
      </button>
      <button type="button" className={styles.button} onClick={() => loadDoc(sampleDoc())}>
        Sample day
      </button>
      <LinkedFileButton />
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className={styles.file}
        onChange={(event) => {
          void onChosen(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
