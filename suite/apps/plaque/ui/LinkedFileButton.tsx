import { useEffect, useState } from "react";
import { connect, disconnect, isSupported, linkedName, needsReauthorising, reauthorise, reconnect } from "../state/fileSink";
import styles from "./ProjectButtons.module.css";

/**
 * Links the project to one file on disk, so every autosave lands there as well as
 * in this browser. Point it at a folder that syncs — OneDrive, Dropbox — and
 * the other machine, and Trousseau's bundler, always see the current project
 * without anyone remembering to export it.
 *
 * Chromium only. Elsewhere this renders nothing and Save day still works.
 */
export function LinkedFileButton() {
  const [name, setName] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    void (async () => {
      const reattached = await reconnect();
      if (reattached) setName(reattached);
      else setStale(await needsReauthorising());
    })();
  }, []);

  if (!isSupported()) return null;

  if (name !== null) {
    return (
      <button
        type="button"
        className={styles.button}
        title={`Autosaving to ${name}. Click to stop.`}
        onClick={() => void disconnect().then(() => setName(null))}
      >
        ● {name}
      </button>
    );
  }

  // The browser remembers the file but has let the permission lapse, which it
  // will only renew from a click.
  if (stale) {
    return (
      <button
        type="button"
        className={styles.button}
        title="Reconnect to the file you linked earlier"
        onClick={() =>
          void reauthorise().then((n) => {
            if (n) {
              setName(n);
              setStale(false);
            }
          })
        }
      >
        Reconnect file
      </button>
    );
  }

  return (
    <button
      type="button"
      className={styles.button}
      title="Autosave this day to a file on disk, as well as to this browser"
      onClick={() => void connect().then((n) => n && setName(n))}
    >
      Link to file
    </button>
  );
}

/** Exposed for the autosave effect, which needs to know whether to bother. */
export const linkedFileName = linkedName;
