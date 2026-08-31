/**
 * Reads a rendered PDF back, for tests. Nothing in the app imports this — it
 * exists so a test can assert what actually landed on the page rather than
 * what the renderer believes it drew.
 */
export async function textOf(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    // No worker, no standard font data fetch: this runs in Node.
    useWorkerFetch: false,
    useSystemFonts: false,
  });
  const pdf = await task.promise;

  let text = "";
  for (let page = 1; page <= pdf.numPages; page += 1) {
    const content = await (await pdf.getPage(page)).getTextContent();
    text += content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    text += "\n";
  }

  return { text, pages: pdf.numPages };
}
