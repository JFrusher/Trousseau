import { isMoment } from "../../core/model/types";
import { formatClock } from "../../core/time/minutes";
import { getDoc, selectSchedule, useStore } from "../../state/store";
import { Button, Panel } from "@/components/ui/fields";
import styles from "./BlocksPanel.module.css";

/**
 * The lane name is always an input, never a label that turns into one on a
 * click: no edit mode, no state, and the rename is where a rename should be.
 * A refused rename — an empty name, or one already taken — puts the old name
 * back rather than leaving the field lying about what the lane is called.
 */
function LaneName({ lane }: { lane: string }) {
  const renameLane = useStore((state) => state.renameLane);

  return (
    <input
      key={lane}
      className={styles.laneName}
      defaultValue={lane}
      aria-label={`Lane name: ${lane}`}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.currentTarget.value = lane;
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        renameLane(lane, event.target.value);
        if (getDoc(useStore.getState()).lanes.includes(lane)) event.target.value = lane;
      }}
    />
  );
}

export function BlocksPanel() {
  const doc = useStore(getDoc);
  const schedule = useStore(selectSchedule);
  const selectedId = useStore((state) => state.selectedId);
  const select = useStore((state) => state.select);
  const addBlock = useStore((state) => state.addBlock);
  const deleteBlock = useStore((state) => state.deleteBlock);
  const reorderBlock = useStore((state) => state.reorderBlock);
  const updateBlock = useStore((state) => state.updateBlock);
  const addLane = useStore((state) => state.addLane);
  const deleteLane = useStore((state) => state.deleteLane);

  /** "Lane 4", "Lane 5" — a name to rename, rather than a prompt to fill in. */
  const nextLaneName = () => {
    let n = doc.lanes.length + 1;
    while (doc.lanes.includes(`Lane ${n}`)) n += 1;
    return `Lane ${n}`;
  };

  return (
    <Panel title="Blocks">
      {doc.lanes.map((lane) => {
        const blocks = doc.blocks.filter((block) => block.lane === lane);
        return (
          <div key={lane} className={styles.lane}>
            <div className={styles.laneHead}>
              <LaneName lane={lane} />
              <Button variant="quiet" onClick={() => addBlock(lane)} title={`Add a block to ${lane}`}>
                + Add
              </Button>
              <Button
                variant="quiet"
                onClick={() => addBlock(lane, { label: "New moment", durationMin: 0 })}
                title={`Add a moment to ${lane} — a point on the clock, no length`}
              >
                + Moment
              </Button>
              <button
                type="button"
                className={styles.icon}
                title={`Remove the ${lane} lane`}
                onClick={() => deleteLane(lane)}
              >
                ×
              </button>
            </div>

            {blocks.length === 0 && <p className={styles.empty}>Nothing in this lane yet.</p>}

            <ul className={styles.list}>
              {blocks.map((block) => {
                const entry = schedule.positions.get(block.id);
                const trouble = schedule.byBlock.get(block.id) ?? [];
                return (
                  <li
                    key={block.id}
                    className={[
                      styles.item,
                      selectedId === block.id ? styles.selected : "",
                      trouble.some((c) => c.severity === "conflict") ? styles.conflict : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <button type="button" className={styles.pick} onClick={() => select(block.id)}>
                      <span className={styles.time}>
                        {entry ? formatClock(entry.startMin) : "--:--"}
                      </span>
                      {isMoment(block) && <span className={styles.moment} title="A moment" />}
                      <span className={styles.label}>{block.label}</span>
                      {block.anchorMin !== null && <span className={styles.pin} title="Anchored" />}
                    </button>
                    <span className={styles.actions}>
                      <button
                        type="button"
                        className={styles.icon}
                        title="Move earlier in this lane"
                        onClick={() => reorderBlock(block.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={styles.icon}
                        title="Move later in this lane"
                        onClick={() => reorderBlock(block.id, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className={styles.icon}
                        title="Delete"
                        onClick={() => deleteBlock(block.id)}
                      >
                        ×
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      <div className={styles.bulk}>
        <Button variant="quiet" onClick={() => addLane(nextLaneName())} title="Add a lane">
          + Lane
        </Button>

        <Button
          variant="quiet"
          onClick={() => {
            const everyGuest = doc.blocks.every((block) => block.outputs.includes("order-of-day"));
            for (const block of doc.blocks) {
              updateBlock(block.id, {
                outputs: everyGuest
                  ? block.outputs.filter((output) => output !== "order-of-day")
                  : [...new Set([...block.outputs, "order-of-day" as const])],
              });
            }
          }}
          title="Put every block on the guest order of the day, or take them all off"
        >
          Toggle all on the order of the day
        </Button>
      </div>
    </Panel>
  );
}
