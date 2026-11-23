const MIB = 1024 * 1024;

function positiveInteger(
  value: string | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  if (value === undefined || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

/** Central budgets for the single-process deployment. All limits are configurable at startup. */
export function readResourceLimits(env: Record<string, string | undefined> = process.env) {
  const maxFileMiB = positiveInteger(env.MAX_FILE_SIZE_MB, 256, 1024 * 1024);
  return {
    conversionConcurrency: positiveInteger(env.GLOBAL_CONVERT_CONCURRENCY, 2, 64),
    maxQueuedFiles: positiveInteger(env.MAX_QUEUED_FILES, 64, 10000),
    maxFilesPerJob: positiveInteger(env.MAX_FILES_PER_JOB, 20, 1000),
    maxFileBytes: maxFileMiB * MIB,
    maxJobUploadBytes: positiveInteger(env.MAX_JOB_UPLOAD_SIZE_MB, 1024, 1024 * 1024) * MIB,
    maxJobOutputBytes: positiveInteger(env.MAX_JOB_OUTPUT_SIZE_MB, 1024, 1024 * 1024) * MIB,
    maxRequestBytes: positiveInteger(env.MAX_REQUEST_SIZE_MB, maxFileMiB + 16, 1024 * 1024) * MIB,
    maxImagePixels: positiveInteger(env.MAX_IMAGE_PIXELS, 40000000),
    maxImageFramePixels: positiveInteger(env.MAX_IMAGE_FRAME_PIXELS, 200000000),
    maxPdfPages: positiveInteger(env.MAX_PDF_PAGES, 200, 100000),
    conversionTimeoutMs: positiveInteger(env.CONVERT_TIMEOUT_SECONDS, 600, 86400) * 1000,
    metadataTimeoutMs: positiveInteger(env.METADATA_TIMEOUT_SECONDS, 10, 300) * 1000,
    ffmpegThreads: positiveInteger(env.FFMPEG_THREADS, 2, 64),
    magickMemoryBytes: positiveInteger(env.MAGICK_MEMORY_MB, 256, 1024 * 1024) * MIB,
    magickDiskBytes: positiveInteger(env.MAGICK_DISK_MB, 1024, 1024 * 1024) * MIB,
    maxArchiveBytes: positiveInteger(env.MAX_ARCHIVE_SIZE_MB, 1024, 1024 * 1024) * MIB,
    archiveTimeoutMs: positiveInteger(env.ARCHIVE_TIMEOUT_SECONDS, 300, 86400) * 1000,
    historyPageSize: positiveInteger(env.HISTORY_PAGE_SIZE, 20, 100),
  };
}

export const resourceLimits = Object.freeze(readResourceLimits());
