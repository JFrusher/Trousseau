import { useState } from "react";
import { allTags } from "../../core/model/tags";
import { formatClock, parseClock } from "../../core/time/minutes";
import { getDoc, useStore } from "../../state/store";
import { Button, Panel, TextArea, TextField } from "@/components/ui/fields";
import styles from "./TagsPanel.module.css";

export function TagsPanel() {
  const doc = useStore(getDoc);
  const setTagDetail = useStore((state) => state.setTagDetail);
  const removeTagDetail = useStore((state) => state.removeTagDetail);
  const [open, setOpen] = useState<string | null>(null);

  const summaries = allTags(doc);
  const used = summaries.filter((summary) => !summary.orphan);
  const orphans = summaries.filter((summary) => summary.orphan);

  const editor = (tag: string) => {
    const detail = doc.tagDetails.find((entry) => entry.tag === tag) ?? { tag };
    return (
      <div className={styles.detail}>
        <TextField
          label="Name"
          value={detail.displayName ?? ""}
          placeholder={tag}
          onChange={(displayName) => setTagDetail({ ...detail, displayName })}
        />
        <TextField
          label="Phone"
          value={detail.phone ?? ""}
          onChange={(phone) => setTagDetail({ ...detail, phone })}
        />
        <TextField
          label="Arrives"
          value={detail.arrivalMin == null ? "" : formatClock(detail.arrivalMin)}
          placeholder="09:00"
          onChange={(value) =>
            setTagDetail({ ...detail, arrivalMin: value.trim() === "" ? null : parseClock(value) })
          }
        />
        <TextArea
          label="Notes"
          rows={2}
          value={detail.notes ?? ""}
          onChange={(notes) => setTagDetail({ ...detail, notes })}
        />
      </div>
    );
  };

  return (
    <Panel title="Tags">
      {used.length === 0 && <p className={styles.empty}>Tag a block and it will appear here.</p>}

      <ul className={styles.list}>
        {used.map((summary) => (
          <li key={summary.tag}>
            <button
              type="button"
              className={styles.row}
              onClick={() => setOpen(open === summary.tag ? null : summary.tag)}
              aria-expanded={open === summary.tag}
            >
              <span className={styles.name}>{summary.detail?.displayName || summary.tag}</span>
              <span className={styles.count}>{summary.count}</span>
            </button>
            {open === summary.tag && editor(summary.tag)}
          </li>
        ))}
      </ul>

      {orphans.length > 0 && (
        <div className={styles.orphans}>
          <h3 className={styles.orphanTitle}>No longer on any block</h3>
          <ul className={styles.list}>
            {orphans.map((summary) => (
              <li key={summary.tag} className={styles.orphanRow}>
                <span className={styles.name}>{summary.detail?.displayName || summary.tag}</span>
                <Button variant="quiet" onClick={() => removeTagDetail(summary.tag)}>
                  Forget
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
