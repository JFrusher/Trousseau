import { CrewPanel } from "./panels/CrewPanel";
import { DayPanel } from "./panels/DayPanel";
import { JobPanel } from "./panels/JobPanel";
import styles from "./Sidebar.module.css";

export function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <DayPanel />
      <JobPanel />
      <CrewPanel />
    </aside>
  );
}
