import type { Metadata } from "next";
import { BrigadeApp } from "./BrigadeClient";

export const metadata: Metadata = {
  title: "Delegation · Trousseau",
  description: "The jobs of the day, and the hands doing them.",
};

export default function DelegationPage() {
  return <BrigadeApp />;
}
