import { describe, expect, it } from "vitest";
import { sampleDoc } from "../../core/model/defaults";
import type { Block } from "../../core/model/types";
import { nodeFontSource } from "./nodeFontSource";
import { renderRunSheet } from "./runSheet";
import { textOf } from "./readPdf";

describe("export performance", () => {
  it("renders a 200 block run-sheet inside three seconds", async () => {
    const doc = sampleDoc();
    const blocks: Block[] = Array.from({ length: 200 }, (_, index) => ({
      ...(doc.blocks[index % doc.blocks.length] as Block),
      id: `blk-load-${index}`,
      label: `Block ${index}`,
    }));

    const started = performance.now();
    const bytes = await renderRunSheet({ ...doc, blocks }, { fontSource: nodeFontSource });
    const elapsed = performance.now() - started;

    console.log(`200 block run-sheet: ${Math.round(elapsed)}ms, ${Math.round(bytes.length / 1024)}kB`);
    expect(elapsed).toBeLessThan(3000);

    const { pages } = await textOf(bytes);
    expect(pages).toBeGreaterThan(3);
  });
});
