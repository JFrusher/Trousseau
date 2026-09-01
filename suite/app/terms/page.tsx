import type { Metadata } from "next";
import { PolicyPage } from "../legal";
import { TERMS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms",
  description: "Free software, given as it is, that mostly runs on your own machine.",
  alternates: { canonical: "/terms" },
};

export default function Terms() {
  return <PolicyPage policy={TERMS} />;
}
