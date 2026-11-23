import { afterEach, beforeEach, expect, test } from "bun:test";

import { convert, properties } from "../../src/converters/pdf2docx";
import { runCommonTests } from "./helpers/commonTests";
import { captureConsole, createMockExecFile } from "./helpers/converters";

runCommonTests(convert);

let output: ReturnType<typeof captureConsole>;

beforeEach(() => {
  output = captureConsole();
});

afterEach(() => {
  output.restore();
});

test("advertises pdf to docx only", () => {
  expect(properties.from).toEqual({ text: ["pdf"] });
  expect(properties.to).toEqual({ text: ["docx"] });
});

test("invokes pdf2docx convert with input and target path", async () => {
  const { execFile, calls } = createMockExecFile();

  await convert("in/report.pdf", "pdf", "docx", "out/report.docx", undefined, execFile);

  expect(calls).toEqual([
    { cmd: "pdf2docx", args: ["convert", "in/report.pdf", "out/report.docx"] },
  ]);
});

test("prefixes rejections with the converter name", async () => {
  const { execFile } = createMockExecFile({ error: new Error("boom") });

  await expect(
    convert("in/report.pdf", "pdf", "docx", "out/report.docx", undefined, execFile),
  ).rejects.toBe("pdf2docx error: Error: boom");
});

test("logs converter output on success", async () => {
  const { execFile } = createMockExecFile({ stdout: "[INFO] Terminated in 0.14s.", stderr: "" });

  await expect(
    convert("in/report.pdf", "pdf", "docx", "out/report.docx", undefined, execFile),
  ).resolves.toBe("Done");
  expect(output.logs.join("\n")).toContain("Terminated");
});
