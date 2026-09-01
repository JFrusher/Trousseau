import { MIN_LABEL_PITCH_PX, ticks } from "./ticks";
import { formatClock } from "../../core/time/minutes";
import styles from "./Ruler.module.css";

/** The clock gutter's width. The lane strip starts here. */
export const GUTTER_PX = 68;

interface Props {
  fromMin: number;
  toMin: number;
  pxPerMin: number;
  /** Drawn as a hard line, because everything must be finished by it. */
  curfewMin: number;
  sunsetMin?: number | null;
  /** Minutes something is anchored at: those labels are set bold. */
  anchoredMins: number[];
}

export function Ruler({ fromMin, toMin, pxPerMin, curfewMin, sunsetMin, anchoredMins }: Props) {
  const marks = ticks(fromMin, toMin, pxPerMin, MIN_LABEL_PITCH_PX);
  const at = (min: number) => (min - fromMin) * pxPerMin;
  const anchored = new Set(anchoredMins);

  return (
    <div className={styles.ruler}>
      {marks.map((tick) => (
        <div
          key={tick.min}
          className={tick.major ? styles.major : styles.minor}
          style={{ top: at(tick.min) }}
        >
          {tick.label && (
            <span className={anchored.has(tick.min) ? styles.labelAnchored : styles.label}>
              {tick.label}
            </span>
          )}
        </div>
      ))}

      {sunsetMin != null && sunsetMin > fromMin && sunsetMin < toMin && (
        <div className={styles.sunset} style={{ top: at(sunsetMin) }} title="Sunset">
          <span className={styles.marker}>sunset {formatClock(sunsetMin)}</span>
        </div>
      )}

      {curfewMin > fromMin && curfewMin < toMin && (
        <div className={styles.curfew} style={{ top: at(curfewMin) }} title="Curfew">
          <span className={styles.marker}>curfew {formatClock(curfewMin)}</span>
        </div>
      )}
    </div>
  );
}
