import { useMemo } from "react";
import { isMoment, OUTPUT_IDS, type OutputId } from "../../core/model/types";
import { formatClock, formatDuration } from "../../core/time/minutes";
import { getDoc, selectSchedule, useStore } from "../../state/store";
import {
  Button,
  CheckField,
  NumberField,
  Panel,
  Row,
  SelectField,
  TextArea,
  TextField,
  TimeField,
} from "@/components/ui/fields";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import { roomPlaces } from "../../state/roomPlaces";
import styles from "./InspectorPanel.module.css";

export function InspectorPanel() {
  const doc = useStore(getDoc);
  // Subscribed to the shared wedding: draw a new space in the room and it turns
  // up here without a reload. Recomputed from the raw slice on each change,
  // which is cheap and avoids holding a second copy that could go stale.
  // The slice's own reference is what changes when the room changes, so this
  // subscribes to that and derives from it — no new array handed back on every
  // render, which under `useSyncExternalStore` is an update loop rather than
  // merely a wasted one.
  const seating = useTrousseauStore((state) => state.raw["seating"]);
  const places = useMemo(() => roomPlaces(seating), [seating]);
  const schedule = useStore(selectSchedule);
  const selectedId = useStore((state) => state.selectedId);
  const updateBlock = useStore((state) => state.updateBlock);
  const toggleAnchor = useStore((state) => state.toggleAnchor);

  const block = doc.blocks.find((entry) => entry.id === selectedId);
  if (!block) {
    return (
      <Panel title="Block">
        <p className={styles.none}>Pick a block on the timeline to edit it.</p>
      </Panel>
    );
  }

  const entry = schedule.positions.get(block.id);
  const headroom = schedule.slack.byBlock.get(block.id);
  const moment = isMoment(block);

  return (
    <Panel title="Block">
      <TextField label="Label" value={block.label} onChange={(label) => updateBlock(block.id, { label })} />

      <CheckField
        label="A moment, not a stretch"
        checked={moment}
        onChange={(on) =>
          // Off again lands on the default block length: the typed one is gone,
          // and guessing at it is worse than a number the user can see and fix.
          updateBlock(block.id, on ? { durationMin: 0, squeezeToMin: null } : { durationMin: 30 })
        }
      />

      <Row>
        {!moment && (
          <NumberField
            label="Duration"
            value={block.durationMin}
            min={0}
            step={5}
            suffix="min"
            onChange={(durationMin) => updateBlock(block.id, { durationMin })}
          />
        )}
        <NumberField
          label="Contingency"
          value={block.bufferMin}
          min={0}
          step={5}
          suffix="min"
          onChange={(bufferMin) => updateBlock(block.id, { bufferMin })}
        />
      </Row>

      {!moment && (
      <CheckField
        label="Can be squeezed"
        checked={block.squeezeToMin !== null && block.squeezeToMin !== undefined}
        onChange={(on) =>
          updateBlock(block.id, {
            squeezeToMin: on ? Math.max(5, Math.round(block.durationMin / 2 / 5) * 5) : null,
          })
        }
      />
      )}
      {!moment && block.squeezeToMin !== null && block.squeezeToMin !== undefined && (
        <NumberField
          label="Shortest it may run"
          value={block.squeezeToMin}
          min={0}
          max={block.durationMin}
          step={5}
          suffix="min"
          onChange={(squeezeToMin) => updateBlock(block.id, { squeezeToMin })}
        />
      )}

      <div className={styles.anchor}>
        <Button
          variant={block.anchorMin === null ? "normal" : "primary"}
          onClick={() => toggleAnchor(block.id)}
          title={
            block.anchorMin === null
              ? "Pin this block to the clock, where it already sits"
              : "Let this block float after the one before it"
          }
        >
          {block.anchorMin === null ? "Anchor to the clock" : "Anchored"}
        </Button>
        <span className={styles.resolved}>
          {!entry ? "" : moment ? formatClock(entry.startMin) : `${formatClock(entry.startMin)} – ${formatClock(entry.endMin)}`}
        </span>
      </div>

      {block.anchorMin === null ? (
        <NumberField
          label="Gap after the block before"
          value={block.gapMin}
          min={0}
          step={5}
          suffix="min"
          onChange={(gapMin) => updateBlock(block.id, { gapMin })}
        />
      ) : (
        <TimeField
          label="Anchored at"
          value={block.anchorMin}
          onChange={(anchorMin) => updateBlock(block.id, { anchorMin })}
        />
      )}

      <SelectField
        label="Lane"
        value={block.lane}
        options={doc.lanes.map((lane) => ({ value: lane, label: lane }))}
        onChange={(lane) => updateBlock(block.id, { lane })}
      />

      {/*
        * Offered from the room next door, so "Orangery" on the run sheet is the
        * same Orangery on the floor plan. Still free text: not everywhere the
        * day happens is somewhere anyone has drawn.
        */}
      <TextField
        label="Location"
        value={block.location}
        suggestions={places}
        onChange={(location) => updateBlock(block.id, { location })}
      />

      <TextField
        label="Tags"
        value={block.tags.join(", ")}
        placeholder="photographer, band"
        onChange={(value) =>
          updateBlock(block.id, {
            tags: value
              .split(",")
              .map((tag) => tag.trim().toLowerCase())
              .filter(Boolean),
          })
        }
      />

      <TextArea label="Notes" value={block.notes} onChange={(notes) => updateBlock(block.id, { notes })} />

      <fieldset className={styles.outputs}>
        <legend className={styles.legend}>Appears on</legend>
        {OUTPUT_IDS.filter((id) => id !== "contact-sheet").map((id: OutputId) => (
          <CheckField
            key={id}
            label={doc.outputs.find((output) => output.id === id)?.label ?? id}
            checked={block.outputs.includes(id)}
            onChange={(on) =>
              updateBlock(block.id, {
                outputs: on
                  ? [...new Set([...block.outputs, id])]
                  : block.outputs.filter((output) => output !== id),
              })
            }
          />
        ))}
      </fieldset>

      {entry && entry.squeezedMin > 0 && (
        <p className={styles.tight}>
          Squeezed by {formatDuration(entry.squeezedMin)} to make what is anchored after it. It
          runs {formatDuration(entry.contentEndMin - entry.startMin)}, not{" "}
          {formatDuration(block.durationMin)}.
        </p>
      )}

      {headroom != null && (
        <p className={headroom < 0 ? styles.tight : styles.slack}>
          {headroom < 0
            ? `Over the next anchor by ${formatDuration(-headroom)}.`
            : `${formatDuration(headroom)} spare before the next anchor.`}
        </p>
      )}
    </Panel>
  );
}
