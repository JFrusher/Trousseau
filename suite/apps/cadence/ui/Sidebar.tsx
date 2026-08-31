import { BlocksPanel } from "./panels/BlocksPanel";
import { DayPanel } from "./panels/DayPanel";
import { FontsPanel } from "./panels/FontsPanel";
import { InspectorPanel } from "./panels/InspectorPanel";
import { StylePanel } from "./panels/StylePanel";
import { TagsPanel } from "./panels/TagsPanel";
import styles from "./Sidebar.module.css";

export function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <DayPanel />
      <BlocksPanel />
      <InspectorPanel />
      <TagsPanel />
      <StylePanel />
      <FontsPanel />
    </aside>
  );
}
