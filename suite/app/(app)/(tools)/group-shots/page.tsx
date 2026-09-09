import type { Metadata } from "next";
import { EnsembleClient } from "./EnsembleClient";

export const metadata: Metadata = {
  title: "Group shots",
  description: "The family and group photo list, built from the guest list and the room.",
};

export default function GroupShotsPage() {
  return <EnsembleClient />;
}
