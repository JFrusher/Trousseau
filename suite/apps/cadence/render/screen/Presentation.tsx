import { useEffect, useRef } from "react";
import { formatClock } from "../../core/time/minutes";
import { getDoc, selectSchedule, useStore } from "../../state/store";
import { Timeline } from "./Timeline";
import styles from "./Presentation.module.css";

/**
 * The day at a size that reads across a room. Read-only on purpose — this is
 * for walking a couple through the plan, not editing in front of them.
 */
export function Presentation() {
  const doc = useStore(getDoc);
  const schedule = useStore(selectSchedule);
  const setUi = useStore((state) => state.setUi);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current;
    element?.requestFullscreen?.().catch(() => {
      // Fullscreen refused. The overlay still covers the window.
    });

    const exit = () => setUi({ presentation: false });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") exit();
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) exit();
    };

    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (document.fullscreenElement) void document.exitFullscreen?.();
    };
  }, [setUi]);

  return (
    <div className={styles.stage} ref={container}>
      <header className={styles.head}>
        <h1 className={styles.title}>{doc.day.coupleNames || "The day"}</h1>
        <p className={styles.meta}>
          {doc.day.venueName}
          {doc.day.venueName && " · "}
          {doc.day.date} · carriages by {formatClock(doc.day.curfewMin)}
          {schedule.sun?.sunsetMin != null && ` · sunset ${formatClock(schedule.sun.sunsetMin)}`}
        </p>
      </header>
      <div className={styles.canvas}>
        <Timeline readOnly />
      </div>
      <p className={styles.exit}>Escape to return</p>
    </div>
  );
}
