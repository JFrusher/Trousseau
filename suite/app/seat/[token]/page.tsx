import type { Metadata } from "next";
import { FindMySeat } from "@/components/share/FindMySeat";

export const metadata: Metadata = {
  title: "Find your seat",
  description: "Look up your table.",
  // A guest link is not for a search index, and the fragment that decrypts it
  // would never reach one anyway.
  robots: { index: false, follow: false },
};

export default async function SeatPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <FindMySeat token={token} />;
}
