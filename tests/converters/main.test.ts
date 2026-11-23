import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Cookie } from "elysia";

import { captureConsole } from "./helpers/converters";

if (!process.env.CONVERTX_TEST_ROOT) {
  // Without tests/preload.ts the db module would open ./data/mydb.sqlite and these tests
  // would write their rows into it.
  throw new Error("Converter tests must run via `bun test` so that tests/preload.ts is loaded.");
}

// dynamic imports ensure that the guard above runs before the db module is loaded
const { default: db } = await import("../../src/db/db");
const {
  chunks,
  getAllInputs,
  getAllTargets,
  getPossibleTargets,
  getTargetsForConverter,
  handleConvert,
  isMissingExecutable,
  mainConverter,
} = await import("../../src/converters/main");

const testRoot = mkdtempSync(join(tmpdir(), "convertx-main-test-"));

// Every row written by these tests uses this prefix, so cleanup never touches other rows.
const JOB_PREFIX = "main-test-";

type FileRow = { file_name: string; output_file_name: string; status: string };

function jobCookie(name?: string): Cookie<string | undefined> {
  return { value: name === undefined ? undefined : `${JOB_PREFIX}${name}` } as Cookie<
    string | undefined
  >;
}

function rowsFor(name: string, orderBy: "id" | "file_name" = "id"): FileRow[] {
  return db
    .query(
      `SELECT file_name, output_file_name, status FROM file_names WHERE job_id = ? ORDER BY ${orderBy}`,
    )
    .all(`${JOB_PREFIX}${name}`) as FileRow[];
}

const vcard = (fullName: string) => `BEGIN:VCARD\nFN:${fullName}\nEND:VCARD\n`;

let caseCounter = 0;
let uploadsDir: string;
let outputDir: string;
let output: ReturnType<typeof captureConsole>;

beforeEach(() => {
  // handleConvert concatenates dir and file name, so both need a trailing slash
  const caseDir = join(testRoot, `case-${caseCounter++}`);
  uploadsDir = `${join(caseDir, "uploads")}/`;
  outputDir = `${join(caseDir, "output")}/`;
  mkdirSync(uploadsDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  output = captureConsole();
});

afterEach(() => {
  output.restore();
  db.query("DELETE FROM file_names WHERE job_id LIKE ?").run(`${JOB_PREFIX}%`);
});

// removes the temp directory with the uploads and outputs after all tests finish
afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("converter registry", () => {
  test("getPossibleTargets lists the targets of every converter for an input type", () => {
    expect(getPossibleTargets("vcf")).toEqual({ vcf: ["csv"] });
  });

  test("getPossibleTargets normalizes the input type", () => {
    expect(getPossibleTargets("VCF")).toEqual({ vcf: ["csv"] });
    expect(Object.keys(getPossibleTargets("jpeg")).length).toBeGreaterThan(0);
    expect(getPossibleTargets("JPG")).toEqual(getPossibleTargets("jpeg"));
    expect(getPossibleTargets("htm")).toEqual(getPossibleTargets("html"));
  });

  test("getPossibleTargets returns an empty object for unknown or rare input types", () => {
    expect(getPossibleTargets("xyz123")).toEqual({});
    expect(getPossibleTargets("exr")).toEqual({});
    expect(getPossibleTargets("jxl")).toEqual({});
    expect(getPossibleTargets("unknown")).toEqual({});
  });

  test("getAllTargets only exposes engines with curated common-format conversions", () => {
    expect(Object.keys(getAllTargets()).sort()).toEqual([
      "assimp",
      "calibre",
      "dasel",
      "dvisvgm",
      "ffmpeg",
      "graphicsmagick",
      "imagemagick",
      "inkscape",
      "libheif",
      "libreoffice",
      "markitDown",
      "msgconvert",
      "pandoc",
      "pdf2docx",
      "potrace",
      "resvg",
      "vcf",
      "vips",
      "vtracer",
    ]);
  });

  test("getAllTargets and getAllInputs are derived from the curated graph", () => {
    const allTargets = getAllTargets();
    expect(allTargets.vcf).toEqual(["csv"]);
    expect(allTargets.libjxl).toBeUndefined();
    expect(getAllInputs("vcf")).toEqual(["vcf"]);
    expect(getAllInputs("libjxl")).toEqual([]);
    expect(getTargetsForConverter("libreoffice")).toContain("docx");
  });

  test("registers a table-preserving engine for PDF to Word", () => {
    // LibreOffice's PDF import flattens a page into text frames and drops table
    // borders, and Calibre reflows the text, so pdf2docx has to win auto-discovery.
    expect(getPossibleTargets("pdf").pdf2docx).toEqual(["docx"]);
    expect(getAllInputs("pdf2docx")).toEqual(["pdf"]);
    const order = Object.keys(getPossibleTargets("pdf"));
    expect(order.indexOf("pdf2docx")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("pdf2docx")).toBeLessThan(order.indexOf("calibre"));
    expect(order.indexOf("pdf2docx")).toBeLessThan(order.indexOf("libreoffice"));
  });

  test("keeps common formats, aliases, one-way paths, and hides rare or internal formats", () => {
    expect(getPossibleTargets("JPG")).toEqual(getPossibleTargets("jpeg"));
    expect(getPossibleTargets("vcf").vcf).toEqual(["csv"]);
    expect(getPossibleTargets("msg").msgconvert).toEqual(["eml"]);
    expect(getPossibleTargets("png").ffmpeg).toBeUndefined();
    expect(getPossibleTargets("mp3").ffmpeg).not.toContain("mp4");
    expect(getPossibleTargets("mp4").ffmpeg).toContain("mp3");
    expect(getPossibleTargets("exr")).toEqual({});
    expect(getPossibleTargets("jxl")).toEqual({});
    expect(getPossibleTargets("emf")).toEqual({});
    expect(getTargetsForConverter("ffmpeg")).not.toContain("wav-3cx");
    expect(getTargetsForConverter("ffmpeg")).not.toContain("h264.mp4");
    expect(getTargetsForConverter("assimp")).not.toContain("glb2");
    expect(getTargetsForConverter("assimp")).not.toContain("stlb");
  });

  test("does not leak outputs between LibreOffice categories", () => {
    expect(getPossibleTargets("docx").libreoffice).not.toContain("xlsx");
    expect(getPossibleTargets("xlsx").libreoffice).not.toContain("docx");
  });
});

describe("missing converter binaries", () => {
  test("recognises the errors that mean an engine is not installed", () => {
    expect(isMissingExecutable(Object.assign(new Error("spawn failed"), { code: "ENOENT" }))).toBe(
      true,
    );
    expect(isMissingExecutable(new Error('Executable not found in $PATH: "pdf2docx"'))).toBe(true);
    expect(
      isMissingExecutable(new Error("'soffice' is not recognized as an internal command")),
    ).toBe(true);
  });

  test("treats real conversion errors as failures instead of missing engines", () => {
    expect(isMissingExecutable(new Error("Conversion failed: damaged input"))).toBe(false);
    expect(isMissingExecutable(new Error("Command failed with code 1"))).toBe(false);
    expect(isMissingExecutable(undefined)).toBe(false);
  });
});

describe("chunks", () => {
  test("chunks with size 0 returns entire array as single chunk", () => {
    expect(chunks([1, 2, 3, 4, 5], 0)).toEqual([[1, 2, 3, 4, 5]]);
  });

  test("chunks with negative size returns entire array as single chunk", () => {
    expect(chunks(["a", "b", "c"], -1)).toEqual([["a", "b", "c"]]);
  });

  test("chunks with size larger than array returns single chunk", () => {
    expect(chunks([1, 2], 10)).toEqual([[1, 2]]);
  });

  test("chunks with exact division returns equal-sized chunks", () => {
    expect(chunks([1, 2, 3, 4, 5, 6], 2)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  test("chunks puts the remainder into a smaller last chunk", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("chunks of an empty array is empty", () => {
    expect(chunks([], 3)).toEqual([]);
  });
});

describe("mainConverter", () => {
  test("returns 'File type not supported' for unsupported combination", async () => {
    expect(await mainConverter("test.xyz", "xyz", "abc", "out.abc")).toBe(
      "File type not supported",
    );
    expect(output.logs).toContain("No available converter supports converting from xyz to abc.");
  });

  test("returns 'File type not supported' for an unknown converter name", async () => {
    const inputPath = `${uploadsDir}contact.vcf`;
    await writeFile(inputPath, vcard("Jane Roe"));

    expect(
      await mainConverter(inputPath, "vcf", "csv", `${outputDir}contact.csv`, {}, "doesnotexist"),
    ).toBe("File type not supported");
  });

  test("auto-discovers converter when not specified", async () => {
    const inputPath = `${uploadsDir}test.vcf`;
    const outPath = `${outputDir}test.csv`;
    await writeFile(inputPath, vcard("Discover Test"));

    expect(await mainConverter(inputPath, "vcf", "csv", outPath)).toBe("Done");
    expect(await readFile(outPath, "utf-8")).toContain("Discover Test");
  });

  test("normalizes the input type before discovering a converter", async () => {
    const inputPath = `${uploadsDir}test.VCF`;
    const outPath = `${outputDir}test.csv`;
    await writeFile(inputPath, vcard("Upper Case"));

    expect(await mainConverter(inputPath, "VCF", "csv", outPath)).toBe("Done");
  });

  test("returns 'Failed, check logs' when converter throws", async () => {
    expect(
      await mainConverter(`${uploadsDir}missing.vcf`, "vcf", "csv", "out.csv", undefined, "vcf"),
    ).toBe("Failed, check logs");
    expect(output.errors.join("\n")).toContain("using vcf");
  });

  test.each([
    ["msgconvert", "mail.msg", "msg", "eml"],
    ["calibre", "news.epub", "epub", "azw3"],
  ])(
    "returns 'Failed, check logs' when %s refuses the conversion",
    async (converterName, fileName, fileType, convertTo) => {
      expect(
        await mainConverter(
          `${uploadsDir}${fileName}`,
          fileType,
          convertTo,
          `${outputDir}out.${convertTo}`,
          {},
          converterName,
        ),
      ).toBe("Failed, check logs");
      expect(output.errors.join("\n")).toContain(`using ${converterName}`);
    },
  );

  test("logs the name of the auto-discovered converter", async () => {
    const inputPath = `${uploadsDir}named.vcf`;
    await writeFile(inputPath, vcard("Named"));

    await mainConverter(inputPath, "vcf", "csv", `${outputDir}named.csv`);

    expect(output.logs.join("\n")).toContain("successfully using vcf");
  });

  test("rejects non-curated paths and converter-target cross-product mismatches", async () => {
    expect(await mainConverter("input.exr", "exr", "png", "out.png", {}, "vips")).toBe(
      "File type not supported",
    );
    expect(await mainConverter("input.png", "png", "mp4", "out.mp4", {}, "ffmpeg")).toBe(
      "File type not supported",
    );
    expect(await mainConverter("input.mp3", "mp3", "mp4", "out.mp4", {}, "ffmpeg")).toBe(
      "File type not supported",
    );
  });

  test("rejects unknown extensions rather than treating them as default audio", async () => {
    expect(await mainConverter("input.xyz", "xyz", "mp3", "out.mp3", {}, "ffmpeg")).toBe(
      "File type not supported",
    );
    expect(await mainConverter("input.bin", "unknown", "mp3", "out.mp3", {}, "ffmpeg")).toBe(
      "File type not supported",
    );
  });

  test("auto-discovery prefers the first registered converter", async () => {
    await mainConverter(`${uploadsDir}missing.svg`, "svg", "png", `${outputDir}missing.png`);

    expect(output.errors.join("\n")).toContain("using inkscape");
  });
});

describe("handleConvert", () => {
  test("converts every file and records one row per file", async () => {
    const files = ["a.vcf", "b.vcf", "c.vcf"];
    for (const fileName of files) {
      await writeFile(`${uploadsDir}${fileName}`, vcard(`Contact ${fileName}`));
    }

    await handleConvert(files, uploadsDir, outputDir, "csv", "vcf", jobCookie("rows"));

    expect(rowsFor("rows", "file_name")).toEqual([
      { file_name: "a.vcf", output_file_name: "a.csv", status: "Done" },
      { file_name: "b.vcf", output_file_name: "b.csv", status: "Done" },
      { file_name: "c.vcf", output_file_name: "c.csv", status: "Done" },
    ]);
    for (const fileName of files) {
      const csv = await readFile(`${outputDir}${fileName.replace(".vcf", ".csv")}`, "utf-8");
      expect(csv).toBe(`Full Name\n"Contact ${fileName}"`);
    }
  });

  test("converts but does not record rows when the job id cookie has no value", async () => {
    // without a job id there is no job_id to look for, so look for the file name instead
    const fileName = `${JOB_PREFIX}no-job.vcf`;
    await writeFile(`${uploadsDir}${fileName}`, vcard("No Job"));

    await handleConvert([fileName], uploadsDir, outputDir, "csv", "vcf", jobCookie());

    expect(db.query("SELECT * FROM file_names WHERE file_name = ?").all(fileName)).toEqual([]);
    expect(await readFile(`${outputDir}${JOB_PREFIX}no-job.csv`, "utf-8")).toContain("No Job");
  });

  test("replaces only the last occurrence of the extension", async () => {
    await writeFile(`${uploadsDir}vcf.backup.vcf`, vcard("Backup"));

    await handleConvert(["vcf.backup.vcf"], uploadsDir, outputDir, "csv", "vcf", jobCookie("ext"));

    expect(rowsFor("ext")).toEqual([
      { file_name: "vcf.backup.vcf", output_file_name: "vcf.backup.csv", status: "Done" },
    ]);
    expect(await readFile(`${outputDir}vcf.backup.csv`, "utf-8")).toContain("Backup");
  });

  test("keeps the base name of files with an upper-case extension", async () => {
    await writeFile(`${uploadsDir}CONTACT.VCF`, vcard("Upper"));

    await handleConvert(["CONTACT.VCF"], uploadsDir, outputDir, "csv", "vcf", jobCookie("upper"));

    expect(rowsFor("upper")).toEqual([
      { file_name: "CONTACT.VCF", output_file_name: "CONTACT.csv", status: "Done" },
    ]);
  });

  test("does not convert files without a recognized extension", async () => {
    await writeFile(`${uploadsDir}noextfile`, vcard("No Ext"));

    await handleConvert(["noextfile"], uploadsDir, outputDir, "csv", "vcf", jobCookie("noext"));

    expect(rowsFor("noext")).toEqual([
      {
        file_name: "noextfile",
        output_file_name: "noextfile.csv",
        status: "File type not supported",
      },
    ]);
    expect(await Bun.file(`${outputDir}noextfile.csv`).exists()).toBe(false);
  });

  test("resolves and records the status when no converter supports the conversion", async () => {
    await writeFile(`${uploadsDir}dummy.xyz123`, "dummy content");

    await expect(
      handleConvert(["dummy.xyz123"], uploadsDir, outputDir, "pdf", "xyz123", jobCookie("none")),
    ).resolves.toBeUndefined();

    expect(rowsFor("none")).toEqual([
      {
        file_name: "dummy.xyz123",
        output_file_name: "dummy.pdf",
        status: "File type not supported",
      },
    ]);
  });

  test("records a failure when the output directory disappears", async () => {
    await writeFile(`${uploadsDir}contact.vcf`, vcard("Lost"));
    const missingDir = `${join(testRoot, "does-not-exist")}/`;
    await handleConvert(["contact.vcf"], uploadsDir, missingDir, "csv", "vcf", jobCookie("lost"));
    expect(rowsFor("lost")).toEqual([
      { file_name: "contact.vcf", output_file_name: "contact.csv", status: "Failed, check logs" },
    ]);
  });

  test.each([
    ["jpeg", "photo.jpg"],
    ["markdown_strict", "photo.md"],
    ["glb2", "photo.glb"],
    ["stlb", "photo.stl"],
  ])("names the output for target %s with its canonical extension", async (convertTo, expected) => {
    // the conversion itself is unsupported, but the output name is still derived and recorded
    await handleConvert(["photo.JPG"], uploadsDir, outputDir, convertTo, "none", jobCookie("name"));

    expect(rowsFor("name")).toEqual([
      { file_name: "photo.JPG", output_file_name: expected, status: "File type not supported" },
    ]);
  });

  test("does not adopt pre-existing numbered files from the shared output directory", async () => {
    // Only files created in this input's private work directory belong to its result.
    for (const fileName of [
      "doc-1.csv",
      "doc-2.csv",
      "doc-10.csv",
      // none of these belong to doc.csv
      "doc-.csv",
      "doc-a.csv",
      "doc-1.txt",
      "mydoc-1.csv",
      "other-1.csv",
    ]) {
      await writeFile(`${outputDir}${fileName}`, "");
    }
    await writeFile(`${uploadsDir}doc.vcf`, vcard("Pages"));

    await handleConvert(["doc.vcf"], uploadsDir, outputDir, "csv", "vcf", jobCookie("pages"));

    expect(rowsFor("pages").map((row) => row.output_file_name)).toEqual(["doc.csv"]);
  });

  test("retains only outputs within the cumulative budget and cleans private work directories", async () => {
    const name = "X".repeat(600 * 1024);
    await writeFile(`${uploadsDir}first.vcf`, vcard(name));
    await writeFile(`${uploadsDir}second.vcf`, vcard(name));
    await handleConvert(
      ["first.vcf", "second.vcf"],
      uploadsDir,
      outputDir,
      "csv",
      "vcf",
      jobCookie("quota"),
    );
    const rows = rowsFor("quota");
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.status === "Done")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "Failed, check logs")).toHaveLength(1);
    const retained = await readdir(outputDir);
    expect(retained).toEqual([rows.find((row) => row.status === "Done")!.output_file_name]);
    expect(
      (await readdir(join(outputDir, ".."))).filter((entry) => entry.startsWith(".convertx-work-")),
    ).toEqual([]);
  });

  test("preserves existing output on a filename collision and records the new input as failed", async () => {
    await writeFile(`${uploadsDir}contact.vcf`, vcard("Replacement"));
    await writeFile(`${outputDir}contact.csv`, "original result");
    await handleConvert(
      ["contact.vcf"],
      uploadsDir,
      outputDir,
      "csv",
      "vcf",
      jobCookie("collision"),
    );
    expect(rowsFor("collision")[0]?.status).toBe("Failed, check logs");
    expect(await readFile(`${outputDir}contact.csv`, "utf8")).toBe("original result");
  });
});
