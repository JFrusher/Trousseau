"use client";

import { useEffect } from "react";

/**
 * The last resort: an error in the root layout itself.
 *
 * This replaces the whole document, so it renders its own `html` and `body` and
 * cannot use the app's fonts, tokens or stylesheet — none of them are loaded by
 * the time it is needed. Hence the inline styles, which are the one place in
 * this codebase they are the right answer rather than a shortcut.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    console.error("[Trousseau] fatal", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          textAlign: "center",
          backgroundColor: "#fdfbf7",
          color: "#44403c",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div style={{ maxWidth: "32rem" }}>
          <h1 style={{ margin: 0, fontSize: "1.75rem", color: "#1c1917" }}>
            Trousseau could not start
          </h1>
          <p style={{ marginTop: "1rem", lineHeight: 1.6 }}>
            Your wedding is still saved in this browser. Nothing has been lost, and nothing has
            been sent anywhere.
          </p>
          <p style={{ marginTop: "1.5rem" }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                minHeight: "2.75rem",
                padding: "0.625rem 1.25rem",
                border: "1px solid #1c1917",
                borderRadius: "0.25rem",
                background: "transparent",
                color: "#1c1917",
                font: "inherit",
                cursor: "pointer",
              }}
            >
              Reload the page
            </button>
          </p>
          {error.digest ? (
            <p style={{ marginTop: "1.5rem", fontSize: "0.75rem" }}>Reference: {error.digest}</p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
