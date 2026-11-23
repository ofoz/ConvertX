import fs from "node:fs";
import path from "node:path";

import { Cookie } from "elysia";

import db from "../db/db";
import { validateInputBudget } from "../helpers/conversionBudget";
import { conversionQueue, type Submission } from "../helpers/conversionQueue";
import { MAX_CONVERT_PROCESS } from "../helpers/env";
import { normalizeFiletype, normalizeOutputFiletype } from "../helpers/normalizeFiletype";
import { createOutputPublisher } from "../helpers/outputBudget";
import { resourceLimits } from "../helpers/resourceLimits";
import { convert as convertassimp, properties as propertiesassimp } from "./assimp";
import { convert as convertCalibre, properties as propertiesCalibre } from "./calibre";
import { convert as convertDasel, properties as propertiesDasel } from "./dasel";
import { convert as convertDjvu, properties as propertiesDjvu } from "./djvu";
import { convert as convertDvisvgm, properties as propertiesDvisvgm } from "./dvisvgm";
import { convert as convertFFmpeg, properties as propertiesFFmpeg } from "./ffmpeg";
import {
  convert as convertGraphicsmagick,
  properties as propertiesGraphicsmagick,
} from "./graphicsmagick";
import { convert as convertImagemagick, properties as propertiesImagemagick } from "./imagemagick";
import { convert as convertInkscape, properties as propertiesInkscape } from "./inkscape";
import { convert as convertLibheif, properties as propertiesLibheif } from "./libheif";
import { convert as convertLibjxl, properties as propertiesLibjxl } from "./libjxl";
import { convert as convertLibreOffice, properties as propertiesLibreOffice } from "./libreoffice";
import { convert as convertMarkitdown, properties as propertiesMarkitdown } from "./markitdown";
import { convert as convertMsgconvert, properties as propertiesMsgconvert } from "./msgconvert";
import { convert as convertPandoc, properties as propertiesPandoc } from "./pandoc";
import { convert as convertPdf2docx, properties as propertiesPdf2docx } from "./pdf2docx";
import { convert as convertPdftops, properties as propertiesPdftops } from "./pdftops";
import { convert as convertPotrace, properties as propertiesPotrace } from "./potrace";
import { convert as convertresvg, properties as propertiesresvg } from "./resvg";
import { convert as convertVcf, properties as propertiesVcf } from "./vcf";
import { convert as convertImage, properties as propertiesImage } from "./vips";
import { convert as convertVtracer, properties as propertiesVtracer } from "./vtracer";
import { convert as convertxelatex, properties as propertiesxelatex } from "./xelatex";

// This should probably be reconstructed so that the functions are not imported instead the functions hook into this to make the converters more modular

const properties: Record<
  string,
  {
    properties: {
      from: Record<string, string[]>;
      to: Record<string, string[]>;
      options?: Record<
        string,
        Record<
          string,
          {
            description: string;
            type: string;
            default: number;
          }
        >
      >;
    };
    converter: (
      filePath: string,
      fileType: string,
      convertTo: string,
      targetPath: string,

      options?: unknown,
    ) => unknown;
  }
> = {
  // PDF → Word must reach pdf2docx first. Calibre also claims this pair but
  // reflows the text, and LibreOffice's PDF import flattens each page into text
  // frames without table borders; pdf2docx rebuilds real bordered tables.
  pdf2docx: {
    properties: propertiesPdf2docx,
    converter: convertPdf2docx,
  },
  // Prioritize Inkscape for EMF files as it handles them better than ImageMagick
  inkscape: {
    properties: propertiesInkscape,
    converter: convertInkscape,
  },
  libjxl: {
    properties: propertiesLibjxl,
    converter: convertLibjxl,
  },
  resvg: {
    properties: propertiesresvg,
    converter: convertresvg,
  },
  vips: {
    properties: propertiesImage,
    converter: convertImage,
  },
  libheif: {
    properties: propertiesLibheif,
    converter: convertLibheif,
  },
  xelatex: {
    properties: propertiesxelatex,
    converter: convertxelatex,
  },
  // djvu before calibre so the dedicated ddjvu converter wins for DjVu files
  djvu: {
    properties: propertiesDjvu,
    converter: convertDjvu,
  },
  calibre: {
    properties: propertiesCalibre,
    converter: convertCalibre,
  },
  dasel: {
    properties: propertiesDasel,
    converter: convertDasel,
  },
  libreoffice: {
    properties: propertiesLibreOffice,
    converter: convertLibreOffice,
  },
  pandoc: {
    properties: propertiesPandoc,
    converter: convertPandoc,
  },
  msgconvert: {
    properties: propertiesMsgconvert,
    converter: convertMsgconvert,
  },
  dvisvgm: {
    properties: propertiesDvisvgm,
    converter: convertDvisvgm,
  },
  imagemagick: {
    properties: propertiesImagemagick,
    converter: convertImagemagick,
  },
  graphicsmagick: {
    properties: propertiesGraphicsmagick,
    converter: convertGraphicsmagick,
  },
  assimp: {
    properties: propertiesassimp,
    converter: convertassimp,
  },
  ffmpeg: {
    properties: propertiesFFmpeg,
    converter: convertFFmpeg,
  },
  potrace: {
    properties: propertiesPotrace,
    converter: convertPotrace,
  },
  vtracer: {
    properties: propertiesVtracer,
    converter: convertVtracer,
  },
  vcf: {
    properties: propertiesVcf,
    converter: convertVcf,
  },
  markitDown: {
    properties: propertiesMarkitdown,
    converter: convertMarkitdown,
  },
  pdftops: {
    properties: propertiesPdftops,
    converter: convertPdftops,
  },
};

const commonFormats = new Set([
  // Documents, spreadsheets, and presentations.
  "pdf",
  "doc",
  "docx",
  "odt",
  "rtf",
  "txt",
  "html",
  "markdown",
  "csv",
  "tsv",
  "xls",
  "xlsx",
  "ods",
  "ppt",
  "pptx",
  "odp",
  // Common web, office, and camera image formats.
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "ico",
  "svg",
  "heic",
  "heif",
  "avif",
  // Common audio and video formats.
  "mp3",
  "m4a",
  "aac",
  "wav",
  "flac",
  "ogg",
  "opus",
  "mp4",
  "mov",
  "mkv",
  "webm",
  "avi",
  // Popular ebook, data, contact, and model formats.
  "epub",
  "mobi",
  "azw3",
  "json",
  "yaml",
  "xml",
  "toml",
  "vcf",
  "eml",
  "msg",
  "obj",
  "stl",
  "glb",
  "gltf",
  "fbx",
  "dae",
  "ply",
]);
const commonAudioFormats = new Set(["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"]);
const commonVideoFormats = new Set(["mp4", "mov", "mkv", "webm", "avi"]);
const registryAliases: Record<string, string> = {
  jfif: "jpeg",
  jpg: "jpeg",
  htm: "html",
  md: "markdown",
};

function canonicalRegistryFormat(format: string) {
  const lowercase = format.toLowerCase();
  return registryAliases[lowercase] ?? lowercase;
}

function commonCanonicalFormats(formats: string[]) {
  return [
    ...new Set(formats.map(canonicalRegistryFormat).filter((format) => commonFormats.has(format))),
  ];
}

// Keep converter metadata untouched, but expose an intentionally smaller graph.
// FFmpeg's source registry is a container-level cross product; split it so audio
// sources do not advertise video outputs while videos can still export audio.
const supportedProperties: typeof properties = {};
for (const [name, definition] of Object.entries(properties)) {
  const from: Record<string, string[]> = {};
  const to: Record<string, string[]> = {};
  const categories = new Set([
    ...Object.keys(definition.properties.from),
    ...Object.keys(definition.properties.to),
  ]);

  for (const category of categories) {
    if (name === "ffmpeg" && category === "muxer") continue;
    const inputs = commonCanonicalFormats(definition.properties.from[category] ?? []);
    const outputs = commonCanonicalFormats(definition.properties.to[category] ?? []);
    if (inputs.length && outputs.length) {
      from[category] = inputs;
      to[category] = outputs;
    }
  }

  if (name === "ffmpeg") {
    const rawInputs = definition.properties.from.muxer ?? [];
    const rawOutputs = definition.properties.to.muxer ?? [];
    const audioInputs = commonCanonicalFormats(rawInputs).filter((format) =>
      commonAudioFormats.has(format),
    );
    const videoInputs = commonCanonicalFormats(rawInputs).filter((format) =>
      commonVideoFormats.has(format),
    );
    const audioOutputs = commonCanonicalFormats(rawOutputs).filter((format) =>
      commonAudioFormats.has(format),
    );
    const videoOutputs = commonCanonicalFormats(rawOutputs).filter((format) =>
      commonVideoFormats.has(format),
    );
    if (audioInputs.length && audioOutputs.length) {
      from.audio = audioInputs;
      to.audio = audioOutputs;
    }
    if (videoInputs.length && (videoOutputs.length || audioOutputs.length)) {
      from.video = videoInputs;
      to.video = [...new Set([...videoOutputs, ...audioOutputs])];
    }
  }

  if (Object.keys(from).length) {
    supportedProperties[name] = {
      ...definition,
      properties: { ...definition.properties, from, to },
    };
  }
}

function chunks<T>(arr: T[], size: number): T[][] {
  if (size <= 0) {
    return [arr];
  }
  return Array.from({ length: Math.ceil(arr.length / size) }, (_: T, i: number) =>
    arr.slice(i * size, i * size + size),
  );
}

export function submitConversionBatch(
  fileNames: string[],
  userUploadsDir: string,
  userOutputDir: string,
  convertTo: string,
  converterName: string,
  jobId: Cookie<string | undefined>,
  onAccepted?: () => void,
): Submission {
  const query = db.query(
    "INSERT INTO file_names (job_id, file_name, output_file_name, status) VALUES (?1, ?2, ?3, ?4)",
  );
  const taskJobId = jobId.value;
  const jobIsActive = () =>
    !onAccepted ||
    db.query("SELECT id FROM jobs WHERE id = ? AND status = 'pending'").get(taskJobId ?? "") !==
      null;
  const publishOutput = createOutputPublisher(userOutputDir);
  const tasks = fileNames.map((fileName) => async () => {
    if (!jobIsActive()) return;
    const filePath = `${userUploadsDir}${fileName}`;
    const dot = fileName.lastIndexOf(".");
    const fileType = dot === -1 ? "" : normalizeFiletype(fileName.slice(dot + 1));
    const stem = dot === -1 || dot === fileName.length - 1 ? fileName : fileName.slice(0, dot);
    const newFileName = `${stem}.${normalizeOutputFiletype(convertTo)}`;
    let result: string;
    let workDirectory: string | undefined;
    try {
      // A converter cannot expose unvalidated output or pick up a sibling task's files.
      workDirectory = await fs.promises.mkdtemp(
        path.join(path.dirname(path.resolve(userOutputDir)), ".convertx-work-"),
      );
      const targetPath = path.join(workDirectory, newFileName).replaceAll("\\", "/");
      result = await mainConverter(filePath, fileType, convertTo, targetPath, {}, converterName);
      if (result.startsWith("Done")) {
        await publishOutput(workDirectory, newFileName, jobIsActive, (names) => {
          if (taskJobId) {
            db.transaction(() => {
              for (const name of names) query.run(taskJobId, fileName, name, result);
            })();
          }
        });
        return;
      }
    } catch (error) {
      result = "Failed, check logs";
      console.error("Unable to publish conversion output:", error);
    } finally {
      if (workDirectory) await fs.promises.rm(workDirectory, { recursive: true, force: true });
    }
    if (taskJobId && jobIsActive()) query.run(taskJobId, fileName, newFileName, result);
  });
  const perJobLimit =
    MAX_CONVERT_PROCESS > 0
      ? Math.floor(MAX_CONVERT_PROCESS)
      : resourceLimits.conversionConcurrency;
  return conversionQueue.trySubmitBatch(
    jobId.value ?? crypto.randomUUID(),
    tasks,
    perJobLimit,
    onAccepted,
  );
}

export async function handleConvert(
  fileNames: string[],
  userUploadsDir: string,
  userOutputDir: string,
  convertTo: string,
  converterName: string,
  jobId: Cookie<string | undefined>,
) {
  const submission = submitConversionBatch(
    fileNames,
    userUploadsDir,
    userOutputDir,
    convertTo,
    converterName,
    jobId,
  );
  if (!submission.accepted) throw new Error(`Conversion batch rejected: ${submission.reason}`);
  await submission.done;
}

async function mainConverter(
  inputFilePath: string,
  fileTypeOriginal: string,
  convertTo: string,
  targetPath: string,
  options?: unknown,
  converterName?: string,
) {
  const fileType = normalizeFiletype(fileTypeOriginal);
  if (fileTypeOriginal.trim().toLowerCase() === "unknown") return "File type not supported";

  const supportsPair = (name: string) => {
    const converter = supportedProperties[name];
    if (!converter) return false;
    return Object.keys(converter.properties.from).some(
      (category) =>
        converter.properties.from[category]?.includes(fileType) &&
        converter.properties.to[category]?.includes(convertTo),
    );
  };

  // An explicit choice is honoured as-is; auto-discovery keeps the remaining
  // engines as fallbacks for deployments that lack one of the binaries.
  const candidates = converterName
    ? supportsPair(converterName)
      ? [converterName]
      : []
    : Object.keys(supportedProperties).filter(supportsPair);

  if (!candidates.length) {
    console.log(`No available converter supports converting from ${fileType} to ${convertTo}.`);
    return "File type not supported";
  }

  const budgetFailure = await validateInputBudget(inputFilePath, fileType);
  if (budgetFailure) {
    console.error(
      `Failed to convert ${inputFilePath} from ${fileType} to ${convertTo} using ${candidates[0]}.`,
      budgetFailure.message,
    );
    return "Failed, check logs";
  }

  let lastFailure: { name: string; error: unknown } | undefined;
  for (const name of candidates) {
    const converterFunc = properties[name]?.converter;
    if (!converterFunc) continue;
    try {
      const result = await converterFunc(inputFilePath, fileType, convertTo, targetPath, options);

      console.log(
        `Converted ${inputFilePath} from ${fileType} to ${convertTo} successfully using ${name}.`,
        result,
      );

      return typeof result === "string" ? result : "Done";
    } catch (error) {
      lastFailure = { name, error };
      // A missing executable is an environment gap, not a file problem: let the
      // next engine that advertises this pair try instead of failing the file.
      if (converterName || !isMissingExecutable(error)) break;
      console.warn(`${name} is unavailable, trying the next engine for this conversion.`);
    }
  }

  const { name, error } = lastFailure ?? { name: converterName ?? "unknown", error: undefined };
  console.error(
    `Failed to convert ${inputFilePath} from ${fileType} to ${convertTo} using ${name}.`,
    error,
  );
  return "Failed, check logs";
}

/** Detect the "binary is not installed" shape reported by execFile/spawn. */
function isMissingExecutable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /not found in \$PATH|ENOENT|not recognized as an internal/i.test(message);
}

const possibleTargets: Record<string, Record<string, string[]>> = {};
const allTargets: Record<string, string[]> = {};
const allInputs: Record<string, string[]> = {};

for (const [converterName, definition] of Object.entries(supportedProperties)) {
  const { from, to } = definition.properties;
  for (const category of Object.keys(from)) {
    const inputs = from[category] ?? [];
    const outputs = to[category] ?? [];
    for (const input of inputs) {
      const validOutputs = outputs.filter((output) => {
        if (converterName !== "ffmpeg") return true;
        if (commonAudioFormats.has(input)) return commonAudioFormats.has(output);
        if (commonVideoFormats.has(input))
          return commonVideoFormats.has(output) || commonAudioFormats.has(output);
        return false;
      });
      if (!validOutputs.length) continue;

      possibleTargets[input] ??= {};
      possibleTargets[input][converterName] ??= [];
      for (const output of validOutputs) {
        if (!possibleTargets[input][converterName].includes(output))
          possibleTargets[input][converterName].push(output);
        allTargets[converterName] ??= [];
        if (!allTargets[converterName].includes(output)) allTargets[converterName].push(output);
      }
      allInputs[converterName] ??= [];
      if (!allInputs[converterName].includes(input)) allInputs[converterName].push(input);
    }
  }
}

export const getPossibleTargets = (from: string): Record<string, string[]> => {
  if (from.trim().toLowerCase() === "unknown") return {};
  const fromClean = normalizeFiletype(from);
  return possibleTargets[fromClean] || {};
};

export const getTargetsForConverter = (converter: string): string[] => allTargets[converter] || [];
export const getAllTargets = () => allTargets;
export const getAllInputs = (converter: string) => allInputs[converter] || [];

/**
 * @internal For testing only. Do not use in production.
 * Tests need direct access to cover all branches of converter discovery and chunking logic.
 */
export { chunks, isMissingExecutable, mainConverter };
