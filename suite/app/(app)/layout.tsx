import { Header } from "@/components/shell/Header";
import { StoreHydrator } from "@/lib/store/StoreHydrator";

/**
 * The planning application: the header, the tools, and the local document.
 *
 * A route group rather than the root layout, so the guest-facing pages under
 * `/seat` genuinely sit outside it. A nested layout would have added to the
 * root's chrome rather than replacing it, and a guest would have been offered a
 * Seating tab that opens whatever wedding happens to be in *their* browser.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    // `--shell-header-h` is read by the header itself and by any tool that wants
    // to fill what is left of the viewport, so the two can never disagree.
    <div className="[--shell-header-h:3.5rem]">
      <StoreHydrator />
      <Header />
      {children}
    </div>
  );
}
