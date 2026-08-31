import { assigneeNames, blockFor, isOrphan } from "../../core/model/types";
import { formatClock } from "../../core/time/minutes";
import { getDoc, useStore } from "../../state/store";
import { Button, Panel, SelectField, TextArea, TextField } from "@/components/ui/fields";
import styles from "./JobPanel.module.css";

export function JobPanel() {
  const doc = useStore(getDoc);
  const selectedJobId = useStore((state) => state.selectedJobId);
  const updateJob = useStore((state) => state.updateJob);
  const deleteJob = useStore((state) => state.deleteJob);

  const job = doc.jobs.find((entry) => entry.id === selectedJobId);
  if (!job) {
    return (
      <Panel title="Job">
        <p className={styles.none}>Pick a job on the board to edit it.</p>
      </Panel>
    );
  }

  const block = blockFor(doc, job);
  const orphan = isOrphan(doc, job);
  const who = assigneeNames(doc, job);

  return (
    <Panel title="Job">
      <TextField label="Job" value={job.label} onChange={(label) => updateJob(job.id, { label })} />

      <SelectField
        label="During"
        value={job.blockId}
        options={[
          ...(orphan ? [{ value: job.blockId, label: "— block deleted —" }] : []),
          ...(doc.day?.blocks ?? [])
            .slice()
            .sort((a, b) => a.startMin - b.startMin)
            .map((entry) => ({
              value: entry.id,
              label: `${formatClock(entry.startMin)}  ${entry.label}`,
            })),
        ]}
        onChange={(blockId) => updateJob(job.id, { blockId })}
      />

      {orphan ? (
        <p className={styles.trouble}>
          The block this hung off is not in the day any more. Move it to another block, or
          delete it.
        </p>
      ) : (
        <p className={styles.when}>
          {formatClock(block?.startMin ?? 0)}
          {block?.moment ? " · a moment" : ` – ${formatClock(block?.endMin ?? 0)}`}
          {block?.location ? ` · ${block.location}` : ""}
        </p>
      )}

      <p className={who.length > 0 ? styles.who : styles.nobody}>
        {who.length > 0 ? who.join(", ") : "Nobody on it yet"}
      </p>

      <TextArea label="Notes" value={job.notes} onChange={(notes) => updateJob(job.id, { notes })} />

      <Button variant="quiet" onClick={() => deleteJob(job.id)} title="Delete this job">
        Delete job
      </Button>
    </Panel>
  );
}
