import { ticks } from "./ticks";
import styles from "./Ruler.module.css";

interface Props {
  fromMin: number;
  toMin: number;
  pxPerMin: number;
  /** Drawn as a hard line, because everything must be finished by it. */
  curfewMin: number;
  sunsetMin?: number | null;
}

export function Ruler({ fromMin, toMin, pxPerMin, curfewMin, sunsetMin }: Props) {
  const marks = ticks(fromMin, toMin, pxPerMin);
  const at = (min: number) => (min - fromMin) * pxPerMin;

  return (
    <div className={styles.ruler} style={{ width: (toMin - fromMin) * pxPerMin }}>
      {marks.map((tick) => (
        <div
          key={tick.min}
          className={tick.major ? styles.major : styles.minor}
          style={{ left: at(tick.min) }}
        >
          {tick.label && <span className={styles.label}>{tick.label}</span>}
        </div>
      ))}

      {sunsetMin != null && sunsetMin > fromMin && sunsetMin < toMin && (
        <div className={styles.sunset} style={{ left: at(sunsetMin) }} title="Sunset">
          <span className={styles.marker}>sunset</span>
        </div>
      )}

      {curfewMin > fromMin && curfewMin < toMin && (
        <div className={styles.curfew} style={{ left: at(curfewMin) }} title="Curfew">
          <span className={styles.marker}>curfew</span>
        </div>
      )}
    </div>
  );
}
