// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sampleDoc } from "../core/model/defaults";
import { serialise } from "../core/project/file";
import { memoryBackend } from "./blobStore";
import { openProject, referencedKeys, saveProject } from "./projectIO";

/** jsdom has no Blob.text(), so hand openProject something that does. */
function fileOf(text: string): File {
  return { text: async () => text } as unknown as File;
}

describe("openProject", () => {
  it("reads a saved document back", async () => {
    const result = await openProject(fileOf(serialise(sampleDoc())));
    expect(result.error).toBeUndefined();
    expect(result.doc).toEqual(sampleDoc());
    expect(result.missing).toEqual([]);
  });

  it("gives a readable error for a file that is not a project", async () => {
    const result = await openProject(fileOf("Dear all, the wedding is on Saturday."));
    expect(result.error).toMatch(/not valid JSON/);
    expect(result.doc).toBeUndefined();
  });

  it("flags an upload the document expects but this machine does not have", async () => {
    const doc = sampleDoc();
    const travelled = { ...doc, day: { ...doc.day, logoKey: "logo-abc123" } };
    const result = await openProject(fileOf(serialise(travelled)), memoryBackend());
    expect(result.missing).toEqual(["logo-abc123"]);
    expect(result.doc?.day.logoKey).toBe("logo-abc123");
  });
});

describe("referencedKeys", () => {
  it("collects the logo and every font, without duplicates", () => {
    const doc = sampleDoc();
    const withUploads = {
      ...doc,
      day: { ...doc.day, logoKey: "logo-1" },
      fonts: [
        { family: "Ivy", blobKey: "font-1" },
        { family: "Ivy Italic", blobKey: "font-1" },
      ],
    };
    expect(referencedKeys(withUploads)).toEqual(["font-1", "logo-1"]);
    expect(referencedKeys(doc)).toEqual([]);
  });
});

describe("saveProject", () => {
  it("names the download after the couple", () => {
    let downloaded = "";
    const created = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const element = created(tag) as HTMLAnchorElement;
      if (tag === "a") {
        Object.defineProperty(element, "click", {
          value: () => {
            downloaded = element.download;
          },
        });
      }
      return element;
    }) as typeof document.createElement;
    URL.createObjectURL = () => "blob:test";
    URL.revokeObjectURL = () => undefined;

    saveProject(sampleDoc());
    expect(downloaded).toBe("charis-and-jacob.cadence.json");
    document.createElement = created;
  });
});
