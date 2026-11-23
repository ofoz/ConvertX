import { open, stat } from "node:fs/promises";
import path from "node:path";

import { runBounded } from "./boundedExec";
import { resourceLimits } from "./resourceLimits";

export type BudgetFailure = {
  code: "file-too-large" | "image-too-large" | "pdf-too-many-pages" | "metadata-failed";
  message: string;
};

const imageTypes = new Set([
  "apng",
  "avci",
  "avcs",
  "avif",
  "bmp",
  "bmp2",
  "bmp3",
  "dcm",
  "dds",
  "dib",
  "dng",
  "exr",
  "fits",
  "gif",
  "heic",
  "heics",
  "heif",
  "heifs",
  "hif",
  "ico",
  "icns",
  "j2c",
  "j2k",
  "jp2",
  "jpeg",
  "jpf",
  "jpm",
  "jpx",
  "jxl",
  "miff",
  "mng",
  "ora",
  "pam",
  "pbm",
  "pcx",
  "pfm",
  "pgm",
  "pgx",
  "png",
  "png8",
  "png24",
  "png32",
  "pnm",
  "ppm",
  "psb",
  "psd",
  "qoi",
  "sgi",
  "tga",
  "tif",
  "tiff",
  "webp",
  "xcf",
  "xpm",
  "xwd",
]);

export function magickCacheArgs() {
  return [
    "-limit",
    "memory",
    `${resourceLimits.magickMemoryBytes / 1048576}MiB`,
    "-limit",
    "map",
    `${resourceLimits.magickMemoryBytes / 1048576}MiB`,
    "-limit",
    "disk",
    `${resourceLimits.magickDiskBytes / 1048576}MiB`,
  ];
}

/** Check each frame and its canvas, since animation delegates may coalesce partial frames. */
export function checkImageMetadata(output: string): BudgetFailure | undefined {
  const rows = output.trim().split(/\r?\n/);
  let total = 0;
  for (const line of rows) {
    const match = /^(\d+) (\d+) (\d+) (\d+) (\d+)$/.exec(line.trim());
    if (!match) throw new Error("Image metadata did not include valid frame dimensions.");
    const [width, height, canvasWidth, canvasHeight, frames] = match.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
      number,
    ];
    if (!width || !height || frames !== rows.length)
      throw new Error("Image metadata did not enumerate all frames.");
    const pixels = Math.max(width, canvasWidth) * Math.max(height, canvasHeight);
    if (pixels > resourceLimits.maxImagePixels)
      return {
        code: "image-too-large",
        message: `Image frame exceeds ${resourceLimits.maxImagePixels} pixels.`,
      };
    total += pixels;
    if (total > resourceLimits.maxImageFramePixels)
      return {
        code: "image-too-large",
        message: `Image exceeds ${resourceLimits.maxImageFramePixels} total frame pixels.`,
      };
  }
}

const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// ImageMagick's PNG decoder can report only the fallback image in an APNG.
// Read the actual canvas and animation count without decoding pixel data.
async function inspectPng(filePath: string, fileSize: number): Promise<BudgetFailure | undefined> {
  const file = await open(filePath, "r");
  try {
    const header = Buffer.alloc(33);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (
      bytesRead !== header.length ||
      !header.subarray(0, 8).equals(pngMagic) ||
      header.readUInt32BE(8) !== 13 ||
      header.toString("ascii", 12, 16) !== "IHDR"
    ) {
      throw new Error("Invalid PNG header.");
    }
    const width = header.readUInt32BE(16);
    const height = header.readUInt32BE(20);
    if (!width || !height) throw new Error("Invalid PNG dimensions.");
    const pixels = width * height;
    if (pixels > resourceLimits.maxImagePixels)
      return {
        code: "image-too-large",
        message: `Image frame exceeds ${resourceLimits.maxImagePixels} pixels.`,
      };
    // The complete geometry fields of an fcTL chunk end at byte 28.
    const chunk = Buffer.alloc(28);
    const started = performance.now();
    let frames = 0;
    let frameControls = 0;
    let sawData = false;
    let ended = false;
    for (let offset = 33, count = 0; offset + 12 <= fileSize;) {
      if (++count > 32768 || performance.now() - started > resourceLimits.metadataTimeoutMs)
        throw new Error("PNG metadata scan exceeded its limit.");
      const { bytesRead: n } = await file.read(
        chunk,
        0,
        Math.min(chunk.length, fileSize - offset),
        offset,
      );
      if (n < 8) throw new Error("Truncated PNG chunk.");
      const length = chunk.readUInt32BE(0);
      const type = chunk.toString("ascii", 4, 8);
      offset += length + 12;
      if (offset > fileSize) throw new Error("Truncated PNG chunk.");
      if (type === "acTL") {
        if (frames || sawData || length !== 8 || n < 16)
          throw new Error("Invalid APNG animation control.");
        frames = chunk.readUInt32BE(8);
        if (!frames) throw new Error("Invalid APNG frame count.");
        if (pixels * frames > resourceLimits.maxImageFramePixels)
          return {
            code: "image-too-large",
            message: `Image exceeds ${resourceLimits.maxImageFramePixels} total frame pixels.`,
          };
      } else if (type === "fcTL") {
        if (!frames || ++frameControls > frames) throw new Error("Invalid APNG frame count.");
        if (length !== 26 || n < 28) throw new Error("Invalid APNG frame control.");
        const frameWidth = chunk.readUInt32BE(12);
        const frameHeight = chunk.readUInt32BE(16);
        const frameX = chunk.readUInt32BE(20);
        const frameY = chunk.readUInt32BE(24);
        if (
          !frameWidth ||
          !frameHeight ||
          frameWidth + frameX > width ||
          frameHeight + frameY > height
        ) {
          throw new Error("APNG frame extends beyond the declared canvas.");
        }
      } else if (type === "IDAT") sawData = true;
      else if (type === "IEND") {
        ended = true;
        break;
      }
    }
    if (!sawData || !ended || frames !== frameControls)
      throw new Error("Incomplete PNG/APNG metadata.");
    if (pixels > resourceLimits.maxImageFramePixels)
      return {
        code: "image-too-large",
        message: `Image exceeds ${resourceLimits.maxImageFramePixels} total frame pixels.`,
      };
  } finally {
    await file.close();
  }
}

export async function validateInputBudget(
  filePath: string,
  fileType: string,
  inspect = runBounded,
): Promise<BudgetFailure | undefined> {
  const absolutePath = path.resolve(filePath);
  let fileStat;
  try {
    fileStat = await stat(absolutePath);
  } catch {
    return { code: "metadata-failed", message: "Input file not found." };
  }
  if (!fileStat.isFile()) return { code: "metadata-failed", message: "Input path is not a file." };
  if (fileStat.size > resourceLimits.maxFileBytes)
    return {
      code: "file-too-large",
      message: `Input file exceeds the ${resourceLimits.maxFileBytes / 1048576} MiB limit.`,
    };

  const type = fileType.toLowerCase();
  const options = { timeout: resourceLimits.metadataTimeoutMs, maxBuffer: 128 * 1024 };
  try {
    if (type === "pdf") {
      const output = await inspect("pdfinfo", [absolutePath], options);
      const pages = Number(output.match(/^Pages:[ \t]+(\d+)[ \t]*\r?$/m)?.[1]);
      if (!Number.isSafeInteger(pages) || pages < 1)
        throw new Error("Missing or invalid PDF page count.");
      if (pages > resourceLimits.maxPdfPages)
        return {
          code: "pdf-too-many-pages",
          message: `PDF exceeds the ${resourceLimits.maxPdfPages}-page limit.`,
        };
    } else if (type === "png" || type === "apng") {
      return await inspectPng(absolutePath, fileStat.size);
    } else if (imageTypes.has(type)) {
      const output = await inspect(
        "magick",
        ["identify", ...magickCacheArgs(), "-ping", "-format", "%w %h %W %H %n\n", absolutePath],
        options,
      );
      return checkImageMetadata(output);
    }
  } catch (error) {
    return {
      code: "metadata-failed",
      message: `Unable to inspect ${type} metadata: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
