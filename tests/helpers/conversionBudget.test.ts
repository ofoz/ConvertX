import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkImageMetadata, validateInputBudget } from "../../src/helpers/conversionBudget";
import { resourceLimits } from "../../src/helpers/resourceLimits";

const directory = await mkdtemp(path.join(tmpdir(), "convertx-budget-"));
afterAll(() => rm(directory, { recursive: true, force: true }));

async function fixture(name: string, contents: string | Buffer = "fixture") {
  const file = path.join(directory, name);
  await writeFile(file, contents);
  return file;
}

test("accepts bounded PDF pages and rejects malformed or over-budget page counts", async () => {
  const file = await fixture("test.pdf");
  expect(
    await validateInputBudget(file, "pdf", async (tool, args, options) => {
      expect(tool).toBe("pdfinfo");
      expect(args).toEqual([file]);
      expect(options?.timeout).toBe(resourceLimits.metadataTimeoutMs);
      expect(options?.maxBuffer).toBe(128 * 1024);
      return `Producer: test\r\nPages: ${resourceLimits.maxPdfPages}\r\n`;
    }),
  ).toBeUndefined();
  expect(
    (await validateInputBudget(file, "pdf", async () => `Pages: ${resourceLimits.maxPdfPages + 1}`))
      ?.code,
  ).toBe("pdf-too-many-pages");
  expect((await validateInputBudget(file, "pdf", async () => "Unrecognized output"))?.code).toBe(
    "metadata-failed",
  );
  expect(
    (
      await validateInputBudget(file, "pdf", async () => {
        throw new Error("timed out");
      })
    )?.message,
  ).toContain("timed out");
});

test("checks later image frames, canvas dimensions and cumulative pixels", () => {
  expect(checkImageMetadata("100 100 200 200 2\n100 100 200 200 2\n")).toBeUndefined();
  expect(checkImageMetadata(`1 1 1 1 2\n1 1 ${resourceLimits.maxImagePixels + 1} 1 2`)?.code).toBe(
    "image-too-large",
  );
  const frames = Math.floor(resourceLimits.maxImageFramePixels / resourceLimits.maxImagePixels) + 1;
  if (frames < 1000) {
    expect(
      checkImageMetadata(
        Array.from(
          { length: frames },
          () => `${resourceLimits.maxImagePixels} 1 0 0 ${frames}`,
        ).join("\n"),
      )?.code,
    ).toBe("image-too-large");
  }
  expect(() => checkImageMetadata("100 100 100 100 2")).toThrow("all frames");
  expect(() => checkImageMetadata("")).toThrow("valid frame dimensions");
});

test("ordinary text inputs need no external metadata tool", async () => {
  expect(
    await validateInputBudget(await fixture("test.vcf"), "vcf", async () => {
      throw new Error("unexpected metadata invocation");
    }),
  ).toBeUndefined();
});

test("checks APNG metadata even when the extension is PNG", async () => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (kind: string, data: Buffer) => {
    const buffer = Buffer.alloc(data.length + 12);
    buffer.writeUInt32BE(data.length);
    buffer.write(kind, 4);
    data.copy(buffer, 8);
    return buffer;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(6000);
  header.writeUInt32BE(6000, 4);
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(Math.floor(resourceLimits.maxImageFramePixels / 36_000_000) + 1);
  const file = await fixture(
    "canvas.png",
    Buffer.concat([
      signature,
      chunk("IHDR", header),
      chunk("acTL", animation),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
  expect((await validateInputBudget(file, "png"))?.code).toBe("image-too-large");
});
