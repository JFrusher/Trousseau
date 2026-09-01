import type { Metadata } from "next";
import { CadenceApp } from "./CadenceClient";

export const metadata: Metadata = {
  title: "Timeline",
  description: "The run of the day, and what collides.",
};

export default function TimelinePage() {
  return <CadenceApp />;
}
