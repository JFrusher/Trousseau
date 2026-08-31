import { useMemo } from "react";
import { assigneeNames, type DayBlock, type Job } from "../../core/model/types";
import { formatClock } from "../../core/time/minutes";
import { getDoc, selectCover, useStore } from "../../state/store";
import styles from "./Board.module.css";

/**
 * The day as a column of blocks in clock order, each holding its jobs.
 *
 * Not a Gantt: Cadence already draws the day to scale, and what this view is
 * for is working down a list and putting names against it. Blocks with no jobs
 * stay visible, because an empty block is where the next job goes.
 */
export function Board() {
  const doc = useStore(getDoc);
  const cover = useStore(selectCover);
  const selectedJobId = useStore((state) => state.selectedJobId);
  const filter = useStore((state) => state.filter);
  const select = useStore((state) => state.select);
  const addJob = useStore((state) => state.addJob);

  const blocks = useMemo(
    () => [...(doc.day?.blocks ?? [])].sort((a, b) => a.startMin - b.startMin || a.lane.localeCompare(b.lane)),
    [doc.day],
  );

  const shown = (job: Job): boolean => {
    if (filter.personId !== null && !job.personIds.includes(filter.personId)) return false;
    if (filter.teamId !== null) {
      const members = doc.people
        .filter((person) => person.teamId === filter.teamId)
        .map((person) => person.id);
      const held = job.teamId === filter.teamId || job.personIds.some((id) => members.includes(id));
      if (!held) return false;
    }
    if (filter.unassignedOnly && job.personIds.length > 0) return false;
    return true;
  };

  const filtering =
    filter.personId !== null || filter.teamId !== null || filter.unassignedOnly;

  const orphans = doc.jobs.filter(
    (job) => !blocks.some((block) => block.id === job.blockId) && shown(job),
  );

  if (doc.day === null) {
    return (
      <div className={styles.empty}>
        <h2>No day yet</h2>
        <p>
          Brigade works from the day Cadence exports. Open your day in Cadence, press{" "}
          <em>Export day</em>, and import the file here.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.board}>
      {orphans.length > 0 && (
        <section className={styles.orphans}>
          <h2 className={styles.orphanHead}>
            Work that has lost its place — {orphans.length} job
            {orphans.length === 1 ? "" : "s"}
          </h2>
          <ul className={styles.jobs}>
            {orphans.map((job) => (
              <JobRow key={job.id} job={job} selected={job.id === selectedJobId} onSelect={select} />
            ))}
          </ul>
        </section>
      )}

      {blocks.map((block) => {
        const jobs = doc.jobs.filter((job) => job.blockId === block.id && shown(job));
        const hidden = doc.jobs.filter((job) => job.blockId === block.id).length - jobs.length;

        // With no filter on, an empty block stays: it is where the next job
        // goes. While filtering, it is only noise between the answers.
        if (filtering && jobs.length === 0) return null;

        return (
          <section key={block.id} className={styles.block}>
            <header className={styles.head}>
              <span className={styles.time}>{formatClock(block.startMin)}</span>
              <span className={styles.label}>
                {block.label}
                {block.moment && <span className={styles.moment} title="A moment" />}
              </span>
              <span className={styles.meta}>
                {[block.lane, block.location].filter(Boolean).join(" · ")}
                {block.moment ? "" : ` · to ${formatClock(block.endMin)}`}
              </span>
              <button
                type="button"
                className={styles.add}
                title={`Add a job during ${block.label}`}
                onClick={() => addJob(block.id)}
              >
                + Job
              </button>
            </header>

            {jobs.length === 0 ? (
              <p className={styles.none}>
                {hidden > 0 ? `${hidden} job${hidden === 1 ? "" : "s"} hidden by the filter` : "No jobs"}
              </p>
            ) : (
              <ul className={styles.jobs}>
                {jobs.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    selected={job.id === selectedJobId}
                    onSelect={select}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );

  function JobRow({
    job,
    selected,
    onSelect,
  }: {
    job: Job;
    selected: boolean;
    onSelect: (id: string) => void;
  }) {
    const who = assigneeNames(doc, job);
    const trouble = cover.byJob.get(job.id) ?? [];
    const severity = trouble.some((warning) => warning.severity === "conflict")
      ? styles.conflict
      : trouble.length > 0
        ? styles.advisory
        : "";

    return (
      <li className={[styles.job, selected ? styles.selected : "", severity].filter(Boolean).join(" ")}>
        <button type="button" className={styles.pick} onClick={() => onSelect(job.id)}>
          <span className={styles.jobLabel}>{job.label}</span>
          <span className={who.length > 0 ? styles.who : styles.nobody}>
            {who.length > 0 ? who.join(", ") : "nobody yet"}
          </span>
          {trouble[0] && <span className={styles.warning}>{trouble[0].message}</span>}
        </button>
      </li>
    );
  }
}

export type { DayBlock };
