import type { PointerEvent } from "react";
import type { Conflict } from "../../core/schedule/conflicts";
import type { ResolvedBlock } from "../../core/schedule/resolve";
import { isMoment, type Block } from "../../core/model/types";
import { formatClock, formatDuration } from "../../core/time/minutes";
import { LABEL_PX, type BlockDetail } from "./labelPlacement";
import styles from "./BlockView.module.css";

/** A gap shorter than this is not worth drawing a leader for. */
const GAP_FLOOR_MIN = 10;

interface Props {
  block: Block;
  entry: ResolvedBlock;
  fromMin: number;
  pxPerMin: number;
  selected: boolean;
  conflicts: Conflict[];
  /** How much of itself the box can hold — see labelPlacement. */
  detail: BlockDetail;
  /** Where its name hangs when the box holds nothing. Null: it holds its own. */
  labelTopPx: number | null;
  /** Minutes of air above this block in its lane. */
  gapBeforeMin: number;
  /** Ghosts show where a drag would land. They take no input. */
  ghost?: boolean;
  onSelect?: (id: string) => void;
  onDragStart?: (id: string, clientY: number) => void;
}

export function BlockView({
  block,
  entry,
  fromMin,
  pxPerMin,
  selected,
  conflicts,
  detail,
  labelTopPx,
  gapBeforeMin,
  ghost = false,
  onSelect,
  onDragStart,
}: Props) {
  const top = (entry.startMin - fromMin) * pxPerMin;
  const contentHeight = Math.max(2, (entry.contentEndMin - entry.startMin) * pxPerMin);
  const bufferHeight = Math.max(0, (entry.endMin - entry.contentEndMin) * pxPerMin);

  const severity = conflicts.some((conflict) => conflict.severity === "conflict")
    ? "conflict"
    : conflicts.length > 0
      ? "advisory"
      : null;

  const moment = isMoment(block);

  const className = [
    styles.block,
    moment ? styles.moment : "",
    entry.anchored ? styles.anchored : styles.floating,
    selected ? styles.selected : "",
    ghost ? styles.ghost : "",
    severity === "conflict" ? styles.conflict : "",
    severity === "advisory" ? styles.advisory : "",
  ]
    .filter(Boolean)
    .join(" ");

  const press = (event: PointerEvent) => {
    if (ghost || event.button !== 0) return;
    onSelect?.(block.id);
    onDragStart?.(block.id, event.clientY);
  };

  // A moment has no height to put anything in, so it becomes a rule across the
  // lane with its name on it — the same object, drawn as a line.
  if (moment) {
    return (
      <div className={className} style={{ top }}>
        <button
          type="button"
          className={styles.momentChip}
          aria-pressed={selected}
          tabIndex={ghost ? -1 : 0}
          onClick={() => onSelect?.(block.id)}
          onPointerDown={press}
        >
          <span className={styles.diamond} />
          {block.label}
          <span className={styles.times}>{formatClock(entry.startMin)}</span>
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
    <>
      {gapBeforeMin >= GAP_FLOOR_MIN && (
        <div
          className={styles.gap}
          style={{ top: top - gapBeforeMin * pxPerMin, height: gapBeforeMin * pxPerMin }}
          aria-hidden="true"
        >
          <span className={styles.gapLabel}>+{formatDuration(gapBeforeMin)}</span>
        </div>
      )}

      <div className={className} style={{ top, height: contentHeight + bufferHeight }}>
        <button
          type="button"
          className={styles.body}
          style={{ height: contentHeight }}
          aria-pressed={selected}
          aria-label={`${block.label}, ${formatClock(entry.startMin)}`}
          tabIndex={ghost ? -1 : 0}
          onClick={() => onSelect?.(block.id)}
          onPointerDown={press}
        >
          {detail !== "outside" && (
            <span className={styles.label}>
              {block.label}
              {detail === "compact" && (
                <span className={styles.times}>{formatClock(entry.startMin)}</span>
              )}
            </span>
          )}
          {detail === "full" && (
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
          )}
          {severity && (
            <span className={styles.assistive}>
              {severity === "conflict" ? "Has a clash" : "Has an advisory"}
            </span>
          )}
          {entry.anchored && <span className={styles.assistive}>Anchored to the clock</span>}
        </button>
        {bufferHeight > 0 && (
          <div className={styles.buffer} style={{ height: bufferHeight }} title="Contingency" />
        )}
      </div>

      {detail === "outside" && labelTopPx !== null && (
        <button
          type="button"
          className={styles.hangingLabel}
          style={{ top: labelTopPx, height: LABEL_PX }}
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => onSelect?.(block.id)}
          onPointerDown={press}
        >
          {block.label}
          <span className={styles.times}>{formatClock(entry.startMin)}</span>
        </button>
      )}
    </>
  );
}
