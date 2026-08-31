import { useRef } from "react";
import { BUNDLED_FONTS } from "../../assets/fonts";
import { addFont } from "../../state/fontLoader";
import { getDoc, useStore } from "../../state/store";
import { Button, Panel } from "@/components/ui/fields";
import styles from "./FontsPanel.module.css";

export function FontsPanel() {
  const doc = useStore(getDoc);
  const replaceDoc = useStore((state) => state.replaceDoc);
  const setNotice = useStore((state) => state.setNotice);
  const input = useRef<HTMLInputElement>(null);

  const onChosen = async (file: File | undefined) => {
    if (!file) return;
    const result = await addFont(file);
    if (result.error !== undefined) {
      setNotice(result.error);
      return;
    }
    if (doc.fonts.some((font) => font.blobKey === result.font.blobKey)) {
      setNotice(`${result.font.family} is already here.`);
      return;
    }
    replaceDoc({ ...doc, fonts: [...doc.fonts, result.font] });
    setNotice(`${result.font.family} added.`);
  };

  return (
    <Panel title="Fonts">
      <ul className={styles.list}>
        {BUNDLED_FONTS.map((font) => (
          <li key={font.family} className={styles.item}>
            {font.family}
            <span className={styles.source}>bundled</span>
          </li>
        ))}
        {doc.fonts.map((font) => (
          <li key={font.blobKey} className={styles.item}>
            {font.family}
            <button
              type="button"
              className={styles.remove}
              onClick={() =>
                replaceDoc({
                  ...doc,
                  fonts: doc.fonts.filter((entry) => entry.blobKey !== font.blobKey),
                })
              }
            >
              remove
            </button>
          </li>
        ))}
      </ul>

      <Button onClick={() => input.current?.click()}>Add a font file</Button>
      <p className={styles.note}>
        Your fonts stay on this machine. They are embedded into the PDFs you make and sent nowhere.
      </p>
      <input
        ref={input}
        type="file"
        accept=".ttf,.otf,.woff2,font/ttf,font/otf,font/woff2"
        className={styles.file}
        onChange={(event) => {
          void onChosen(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </Panel>
  );
}
