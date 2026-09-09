import type { Metadata } from "next";
import dynamic from "next/dynamic";

export const metadata: Metadata = {
  title: "Group shots",
  description: "The family and group photo list, built from the guest list and the room.",
};

const EnsembleBoard = dynamic(
  () => import("@/components/ensemble/EnsembleBoard").then((m) => m.EnsembleBoard),
  { ssr: false },
);

export default function GroupShotsPage() {
  return <EnsembleBoard />;
}
