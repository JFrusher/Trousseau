import { selectSchedule, useStore } from "../state/store";
import styles from "./WarningsList.module.css";

export function WarningsList() {
  const schedule = useStore(selectSchedule);
  const select = useStore((state) => state.select);

  if (schedule.conflicts.length === 0) {
    return (
      <p className={styles.clear}>
        Nothing collides. {schedule.slack.toCurfewMin >= 0 ? "The day fits." : ""}
      </p>
    );
  }

  return (
    <ul className={styles.list}>
      {schedule.conflicts.map((conflict) => (
        <li
          key={`${conflict.kind}-${conflict.blockIds.join("-")}`}
          className={conflict.severity === "conflict" ? styles.conflict : styles.advisory}
        >
          <button
            type="button"
            className={styles.button}
            onClick={() => select(conflict.blockIds[0] ?? null)}
          >
            {conflict.message}
          </button>
        </li>
      ))}
    </ul>
  );
}
