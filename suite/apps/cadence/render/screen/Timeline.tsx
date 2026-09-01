import { useEffect, useMemo, useRef } from "react";
import { blocksById } from "../../core/schedule/resolve";
import { isMoment } from "../../core/model/types";
import { getDoc, selectSchedule, useStore, ZOOM_STEP } from "../../state/store";
import { BlockView } from "./BlockView";
import { blockDetail, LABEL_PX, placeLabels, type LabelBox } from "./labelPlacement";
import { GUTTER_PX, Ruler } from "./Ruler";
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
  const zoomBy = useStore((state) => state.zoomBy);
  const { drag, start } = useDragBlock(pxPerMin);
  const scroller = useRef<HTMLDivElement>(null);

  const blocks = useMemo(() => blocksById(doc), [doc]);
  const { fromMin, toMin } = useMemo(
    () => spanOf(schedule.resolved, doc.day.curfewMin),
    [schedule.resolved, doc.day.curfewMin],
  );

  const ghosts = useMemo(() => {
    if (!preview) return null;
    const moved = new Set(preview.movedIds);
    return preview.after.filter((entry) => moved.has(entry.id));
  }, [preview]);

  // While editing, an empty lane still shows: a lane you just added and cannot
  // see is a lane you cannot drop anything into. Presentation keeps it clean.
  const lanes = useMemo(
    () =>
      readOnly ? doc.lanes.filter((lane) => doc.blocks.some((block) => block.lane === lane)) : doc.lanes,
    [doc, readOnly],
  );
  const height = (toMin - fromMin) * pxPerMin;

  // Every anchored minute, so the ruler can set those labels bold.
  const anchoredMins = useMemo(
    () => schedule.resolved.filter((entry) => entry.anchored).map((entry) => entry.startMin),
    [schedule.resolved],
  );

  // Where each lane's short blocks hang their names, and the gap above each block.
  const laneLayout = useMemo(() => {
    const out = new Map<
      string,
      { labels: Map<string, number>; gaps: Map<string, number> }
    >();
    for (const lane of lanes) {
      const entries = schedule.resolved
        .filter((entry) => entry.lane === lane)
        .sort((a, b) => a.startMin - b.startMin);

      const boxes: LabelBox[] = entries
        .filter((entry) => !isMoment(blocks.get(entry.id) ?? { durationMin: 1 }))
        .map((entry) => ({
          id: entry.id,
          topPx: (entry.startMin - fromMin) * pxPerMin,
          heightPx: (entry.contentEndMin - entry.startMin) * pxPerMin,
        }));

      const labelled = new Set(
        boxes.filter((box) => blockDetail(box.heightPx) === "outside").map((box) => box.id),
      );

      const gaps = new Map<string, number>();
      let previousEnd: number | null = null;
      for (const entry of entries) {
        if (previousEnd !== null) gaps.set(entry.id, entry.startMin - previousEnd);
        previousEnd = Math.max(previousEnd ?? entry.endMin, entry.endMin);
      }

      out.set(lane, { labels: placeLabels(boxes, labelled, LABEL_PX, height), gaps });
    }
    return out;
  }, [lanes, schedule.resolved, blocks, fromMin, pxPerMin, height]);

  // Keep the selected block in view when the selection moves by keyboard.
  useEffect(() => {
    if (!selectedId || !scroller.current) return;
    const entry = schedule.positions.get(selectedId);
    if (!entry) return;
    const y = (entry.startMin - fromMin) * pxPerMin;
    const view = scroller.current;
    if (y < view.scrollTop || y > view.scrollTop + view.clientHeight - 80) {
      view.scrollTo({ top: Math.max(0, y - 120), behavior: "smooth" });
    }
  }, [selectedId, schedule.positions, fromMin, pxPerMin]);

  // React's onWheel is passive, so preventDefault there cannot stop the
  // browser's own Ctrl+wheel page zoom. Bind by hand with { passive: false }.
  useEffect(() => {
    const view = scroller.current;
    if (!view) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    };
    view.addEventListener("wheel", onWheel, { passive: false });
    return () => view.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  return (
    <div className={styles.timeline} data-timeline="" ref={scroller}>
      <div className={styles.head} style={{ paddingLeft: GUTTER_PX }}>
        {lanes.map((lane) => (
          <div key={lane} className={styles.laneName}>
            {lane}
          </div>
        ))}
      </div>

      <div className={styles.body} style={{ height }}>
        <Ruler
          fromMin={fromMin}
          toMin={toMin}
          pxPerMin={pxPerMin}
          curfewMin={doc.day.curfewMin}
          sunsetMin={schedule.sun?.sunsetMin ?? null}
          anchoredMins={anchoredMins}
        />

        <div className={styles.lanes} style={{ marginLeft: GUTTER_PX }}>
          {lanes.map((lane) => {
            const layout = laneLayout.get(lane);
            return (
              <div key={lane} className={styles.lane}>
                {schedule.resolved
                  .filter((entry) => entry.lane === lane)
                  .map((entry) => {
                    const block = blocks.get(entry.id);
                    if (!block) return null;
                    const heightPx = (entry.contentEndMin - entry.startMin) * pxPerMin;
                    return (
                      <BlockView
                        key={entry.id}
                        block={block}
                        entry={entry}
                        fromMin={fromMin}
                        pxPerMin={pxPerMin}
                        detail={blockDetail(heightPx)}
                        labelTopPx={layout?.labels.get(entry.id) ?? null}
                        gapBeforeMin={layout?.gaps.get(entry.id) ?? 0}
                        selected={!readOnly && selectedId === entry.id}
                        conflicts={schedule.byBlock.get(entry.id) ?? []}
                        {...(readOnly ? {} : { onSelect: select, onDragStart: start })}
                      />
                    );
                  })}

                {ghosts
                  ?.filter((entry) => entry.lane === lane)
                  .map((entry) => {
                    const block = blocks.get(entry.id);
                    if (!block) return null;
                    const heightPx = (entry.contentEndMin - entry.startMin) * pxPerMin;
                    return (
                      <BlockView
                        key={`ghost-${entry.id}`}
                        block={block}
                        entry={entry}
                        fromMin={fromMin}
                        pxPerMin={pxPerMin}
                        detail={blockDetail(heightPx)}
                        labelTopPx={null}
                        gapBeforeMin={0}
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
            );
          })}
        </div>
      </div>

      {drag && (
        <p className={styles.hint} role="status">
          Release to keep this. Escape puts it back.
        </p>
      )}
    </div>
  );
}
