import { formatClock } from "../../core/time/minutes";
import { getDoc, selectSchedule, useStore } from "../../state/store";
import { Field, NumberField, Panel, Row, TextField, TimeField } from "@/components/ui/fields";
import styles from "./DayPanel.module.css";

const OFFSETS = [
  { value: 0, label: "UTC (GMT)" },
  { value: 60, label: "UTC+1 (BST, CET)" },
  { value: 120, label: "UTC+2 (CEST)" },
  { value: -300, label: "UTC-5 (EST)" },
  { value: -240, label: "UTC-4 (EDT)" },
];

export function DayPanel() {
  const doc = useStore(getDoc);
  const setDay = useStore((state) => state.setDay);
  const sun = useStore(selectSchedule).sun;

  return (
    <Panel title="The day">
      <TextField
        label="Couple"
        value={doc.day.coupleNames}
        onChange={(coupleNames) => setDay({ coupleNames })}
        placeholder="Charis & Jacob"
      />
      <TextField
        label="Venue"
        value={doc.day.venueName}
        onChange={(venueName) => setDay({ venueName })}
        placeholder="Oving Jubilee Hall"
      />
      <Field label="Date">
        <input
          className={styles.date}
          type="date"
          value={doc.day.date}
          onChange={(event) => setDay({ date: event.target.value })}
        />
      </Field>

      <TimeField
        label="Curfew"
        value={doc.day.curfewMin}
        onChange={(curfewMin) => setDay({ curfewMin })}
        hint="Everything must be finished by this. Past midnight, type 01:00 +1."
      />

      <Row>
        <NumberField
          label="Latitude"
          value={doc.day.latitude}
          min={-90}
          max={90}
          step={0.0001}
          onChange={(latitude) => setDay({ latitude })}
        />
        <NumberField
          label="Longitude"
          value={doc.day.longitude}
          min={-180}
          max={180}
          step={0.0001}
          onChange={(longitude) => setDay({ longitude })}
        />
      </Row>

      <Field label="Clocks" hint="Entered, not guessed. British Summer Time is UTC+1.">
        <select
          className={styles.date}
          value={doc.day.utcOffsetMin}
          onChange={(event) => setDay({ utcOffsetMin: Number(event.target.value) })}
        >
          {OFFSETS.map((offset) => (
            <option key={offset.value} value={offset.value}>
              {offset.label}
            </option>
          ))}
        </select>
      </Field>

      <p className={styles.sun}>
        {sun?.sunsetMin == null
          ? "The sun does not set at this latitude on this date."
          : `Sunset ${formatClock(sun.sunsetMin)}, golden hour from ${formatClock(sun.goldenHourStartMin ?? sun.sunsetMin)}.`}
      </p>
    </Panel>
  );
}
