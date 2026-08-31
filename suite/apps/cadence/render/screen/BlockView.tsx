import type { Conflict } from "../../core/schedule/conflicts";
import type { ResolvedBlock } from "../../core/schedule/resolve";
import { isMoment, type Block } from "../../core/model/types";
import { formatClock, formatDuration } from "../../core/time/minutes";
import styles from "./BlockView.module.css";

interface Props {
  block: Block;
  entry: ResolvedBlock;
  fromMin: number;
  pxPerMin: number;
  selected: boolean;
  conflicts: Conflict[];
  /** Ghosts show where a drag would land. They take no input. */
  ghost?: boolean;
  onSelect?: (id: string) => void;
  onDragStart?: (id: string, clientX: number) => void;
}

export function BlockView({
  block,
  entry,
  fromMin,
  pxPerMin,
  selected,
  conflicts,
  ghost = false,
  onSelect,
  onDragStart,
}: Props) {
  const left = (entry.startMin - fromMin) * pxPerMin;
  const contentWidth = Math.max(2, (entry.contentEndMin - entry.startMin) * pxPerMin);
  const bufferWidth = Math.max(0, (entry.endMin - entry.contentEndMin) * pxPerMin);

  const severity = conflicts.some((conflict) => conflict.severity === "conflict")
    ? "conflict"
    : conflicts.length > 0
      ? "advisory"
      : null;

  const moment = isMoment(block);

  const className = [
    styles.block,
    moment ? styles.moment : "",
    selected ? styles.selected : "",
    ghost ? styles.ghost : "",
    severity === "conflict" ? styles.conflict : "",
    severity === "advisory" ? styles.advisory : "",
  ]
    .filter(Boolean)
    .join(" ");

  // A moment has no width to put anything in, so it becomes a mark on the
  // clock with its name beside it — the same object, drawn as a point.
  if (moment) {
    return (
      <div className={className} style={{ left }}>
        <button
          type="button"
          className={styles.marker}
          aria-pressed={selected}
          tabIndex={ghost ? -1 : 0}
          onClick={() => onSelect?.(block.id)}
          onPointerDown={(event) => {
            if (ghost || event.button !== 0) return;
            onSelect?.(block.id);
            onDragStart?.(block.id, event.clientX);
          }}
        >
          <span className={styles.diamond} />
          <span className={styles.markerLabel}>
            {entry.anchored && <span className={styles.pin} aria-label="Anchored" />}
            {block.label}
            <span className={styles.times}>{formatClock(entry.startMin)}</span>
          </span>
          {severity && (
            <span className={styles.assistive}>
              {severity === "conflict" ? "Has a clash" : "Has an advisory"}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className={className} style={{ left, width: contentWidth + bufferWidth }}>
      <button
        type="button"
        className={styles.body}
        style={{ width: contentWidth }}
        aria-pressed={selected}
        tabIndex={ghost ? -1 : 0}
        onClick={() => onSelect?.(block.id)}
        onPointerDown={(event) => {
          if (ghost || event.button !== 0) return;
          onSelect?.(block.id);
          onDragStart?.(block.id, event.clientX);
        }}
      >
        <span className={styles.label}>
          {entry.anchored && <span className={styles.pin} aria-label="Anchored" />}
          {block.label}
        </span>
        {severity && (
          <span className={styles.assistive}>
            {severity === "conflict" ? "Has a clash" : "Has an advisory"}
          </span>
        )}
        <span className={styles.times}>
          {formatClock(entry.startMin)} ·{" "}
          {formatDuration(entry.contentEndMin - entry.startMin)}
          {entry.squeezedMin > 0 && (
            <span className={styles.squeezed} title={`Squeezed by ${entry.squeezedMin} min`}>
              {" "}
              ↤{formatDuration(entry.squeezedMin)}
            </span>
          )}
        </span>
      </button>
      {bufferWidth > 0 && (
        <div className={styles.buffer} style={{ width: bufferWidth }} title="Contingency" />
      )}
    </div>
  );
}
