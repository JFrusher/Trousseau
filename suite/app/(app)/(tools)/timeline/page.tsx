import type { Metadata } from "next";
import { TimelineBoard } from "@/components/timeline/TimelineBoard";

export const metadata: Metadata = {
  title: "Timeline · Trousseau",
  description: "The run of the day, and what collides.",
};

export default function TimelinePage() {
  return <TimelineBoard />;
}
