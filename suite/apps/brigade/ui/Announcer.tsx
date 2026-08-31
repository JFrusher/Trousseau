import { useEffect, useState } from "react";
import { selectCover, useStore } from "../state/store";
import styles from "./Announcer.module.css";

/**
 * Trouble is colour on screen, which is no use to a screen reader. This says
 * what changed, politely, once the edits settle.
 */
export function Announcer() {
  const warnings = useStore(selectCover).warnings;
  const notice = useStore((state) => state.notice);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      const blocking = warnings.filter((warning) => warning.severity === "conflict");
      if (notice) setMessage(notice);
      else if (blocking.length === 0) setMessage("Nothing is clashing.");
      else setMessage(`${blocking.length} clash${blocking.length === 1 ? "" : "es"}. ${blocking[0]?.message ?? ""}`);
    }, 500);
    return () => clearTimeout(timer);
  }, [warnings, notice]);

  return (
    <div className={styles.announcer} role="status" aria-live="polite">
      {message}
    </div>
  );
}
