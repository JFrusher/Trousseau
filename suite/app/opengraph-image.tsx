import { ImageResponse } from "next/og";

export const alt = "Trousseau — seating, stationery, timeline and crew for one wedding";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The link preview.
 *
 * Type on the app's own parchment, and nothing else — no screenshot. A preview
 * of this application would be a preview of somebody's guest list, and the
 * image is generated at build time from whatever wedding the builder happened
 * to have. Deliberately says nothing about anyone.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fdfbf7",
          color: "#1c1917",
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ fontSize: 96, letterSpacing: "-0.02em" }}>Trousseau</div>
        <div style={{ marginTop: 24, fontSize: 34, color: "#44403c" }}>
          One wedding. Four tools. One document.
        </div>
        <div style={{ marginTop: 48, fontSize: 24, color: "#849e86" }}>
          Yours, on your own device.
        </div>
      </div>
    ),
    size,
  );
}
