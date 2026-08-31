import { useEffect, useState } from "react";
import { selectSchedule, useStore } from "../state/store";
import styles from "./Announcer.module.css";

/**
 * Conflicts are colour on screen, which is no use to a screen reader. This
 * says what changed, politely, once the edits settle.
 */
export function Announcer() {
  const conflicts = useStore(selectSchedule).conflicts;
  const notice = useStore((state) => state.notice);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      const blocking = conflicts.filter((conflict) => conflict.severity === "conflict");
      if (notice) setMessage(notice);
      else if (blocking.length === 0) setMessage("No clashes.");
      else setMessage(`${blocking.length} clash${blocking.length === 1 ? "" : "es"}. ${blocking[0]?.message ?? ""}`);
    }, 500);
    return () => clearTimeout(timer);
  }, [conflicts, notice]);

  return (
    <div className={styles.announcer} role="status" aria-live="polite">
      {message}
    </div>
  );
}
