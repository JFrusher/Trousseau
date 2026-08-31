import { selectCover, useStore } from "../state/store";
import styles from "./WarningsList.module.css";

export function WarningsList() {
  const cover = useStore(selectCover);
  const select = useStore((state) => state.select);

  if (cover.warnings.length === 0) {
    return <p className={styles.clear}>Every job has somebody, and nobody is in two places.</p>;
  }

  return (
    <ul className={styles.list}>
      {cover.warnings.map((warning) => (
        <li
          key={`${warning.kind}-${warning.jobIds.join("-")}`}
          className={warning.severity === "conflict" ? styles.conflict : styles.advisory}
        >
          <button
            type="button"
            className={styles.button}
            onClick={() => select(warning.jobIds[0] ?? null)}
          >
            {warning.message}
          </button>
        </li>
      ))}
    </ul>
  );
}
