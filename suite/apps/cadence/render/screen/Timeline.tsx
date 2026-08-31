import { useEffect, useMemo, useRef } from "react";
import { blocksById } from "../../core/schedule/resolve";
import { getDoc, selectSchedule, useStore } from "../../state/store";
import { BlockView } from "./BlockView";
import { Ruler } from "./Ruler";
import { spanOf } from "./ticks";
import { useDragBlock } from "./useDragBlock";
import styles from "./Timeline.module.css";

interface Props {
  /** Presentation mode drops selection, dragging and the lane gutter's controls. */
  readOnly?: boolean;
}

export function Timeline({ readOnly = false }: Props) {
  const doc = useStore(getDoc);
  const schedule = useStore(selectSchedule);
  const preview = useStore((state) => state.preview);
  const selectedId = useStore((state) => state.selectedId);
  const select = useStore((state) => state.select);
  const pxPerMin = useStore((state) => state.ui.pxPerMin);
  const { drag, start } = useDragBlock(pxPerMin);
  const scroller = useRef<HTMLDivElement>(null);

  const blocks = useMemo(() => blocksById(doc), [doc]);
  const { fromMin, toMin } = useMemo(
    () => spanOf(schedule.resolved, doc.day.curfewMin),
    [schedule.resolved, doc.day.curfewMin],
  );

  // Ghosts come from the live preview, which never touches the document.
  const ghosts = useMemo(() => {
    if (!preview) return null;
    const moved = new Set(preview.movedIds);
    return preview.after.filter((entry) => moved.has(entry.id));
  }, [preview]);

  // While editing, an empty lane still shows: a lane you just added and cannot
  // see is a lane you cannot drop anything into. Presentation keeps it clean.
  const lanes = readOnly
    ? doc.lanes.filter((lane) => doc.blocks.some((block) => block.lane === lane))
    : doc.lanes;
  const width = (toMin - fromMin) * pxPerMin;

  // Keep the selected block in view when the selection moves by keyboard.
  useEffect(() => {
    if (!selectedId || !scroller.current) return;
    const entry = schedule.positions.get(selectedId);
    if (!entry) return;
    const x = (entry.startMin - fromMin) * pxPerMin;
    const view = scroller.current;
    if (x < view.scrollLeft || x > view.scrollLeft + view.clientWidth - 120) {
      view.scrollTo({ left: Math.max(0, x - 160), behavior: "smooth" });
    }
  }, [selectedId, schedule.positions, fromMin, pxPerMin]);

  return (
    <div className={styles.timeline}>
      <div className={styles.gutter}>
        <div className={styles.gutterHead} />
        {lanes.map((lane) => (
          <div key={lane} className={styles.laneName}>
            {lane}
          </div>
        ))}
      </div>

      <div className={styles.scroller} ref={scroller}>
        <Ruler
          fromMin={fromMin}
          toMin={toMin}
          pxPerMin={pxPerMin}
          curfewMin={doc.day.curfewMin}
          sunsetMin={schedule.sun?.sunsetMin ?? null}
        />

        {lanes.map((lane) => (
          <div key={lane} className={styles.lane} style={{ width }}>
            {schedule.resolved
              .filter((entry) => entry.lane === lane)
              .map((entry) => {
                const block = blocks.get(entry.id);
                if (!block) return null;
                return (
                  <BlockView
                    key={entry.id}
                    block={block}
                    entry={entry}
                    fromMin={fromMin}
                    pxPerMin={pxPerMin}
                    selected={!readOnly && selectedId === entry.id}
                    conflicts={schedule.byBlock.get(entry.id) ?? []}
                    {...(readOnly
                      ? {}
                      : { onSelect: select, onDragStart: start })}
                  />
                );
              })}

            {ghosts
              ?.filter((entry) => entry.lane === lane)
              .map((entry) => {
                const block = blocks.get(entry.id);
                if (!block) return null;
                return (
                  <BlockView
                    key={`ghost-${entry.id}`}
                    block={block}
                    entry={entry}
                    fromMin={fromMin}
                    pxPerMin={pxPerMin}
                    selected={false}
                    conflicts={
                      preview?.newConflicts.filter((conflict) =>
                        conflict.blockIds.includes(entry.id),
                      ) ?? []
                    }
                    ghost
                  />
                );
              })}
          </div>
        ))}

        {drag && (
          <p className={styles.hint} role="status">
            Release to keep this. Escape puts it back.
          </p>
        )}
      </div>
    </div>
  );
}
