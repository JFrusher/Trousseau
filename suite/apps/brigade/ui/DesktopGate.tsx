import { useEffect, useState } from "react";
import styles from "./DesktopGate.module.css";

/** Below this width the timeline is not usable, so it is not offered. */
export const MIN_WIDTH_PX = 1024;

export function useIsDesktop(): boolean {
  const [ok, setOk] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= MIN_WIDTH_PX,
  );
  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${MIN_WIDTH_PX}px)`);
    const update = () => setOk(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return ok;
}

export function DesktopGate() {
  return (
    <div className={styles.gate}>
      <h1 className={styles.title}>Cadence needs a bigger screen</h1>
      <p className={styles.body}>
        A wedding day is twelve hours wide. Reading it on a phone means reading it a minute at a
        time, and the plan you cannot see whole is the plan that goes wrong.
      </p>
      <p className={styles.body}>Open Cadence on a laptop or desktop and it will be here.</p>
    </div>
  );
}
