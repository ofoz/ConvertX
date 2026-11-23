import sanitize from "sanitize-filename";

import { resourceLimits } from "./resourceLimits";

export class UploadBudgetError extends Error {
  constructor(
    message: string,
    public status = 413,
  ) {
    super(message);
  }
}

type SizedFile = { name: string; size: number };
const fileIdentity = (name: string) => (process.platform === "win32" ? name.toLowerCase() : name);

export function checkJobUploadBytes(bytes: number, maxBytes = resourceLimits.maxJobUploadBytes) {
  if (bytes > maxBytes) {
    throw new UploadBudgetError(`每单的文件总大小不能超过 ${maxBytes / 1048576} MiB，请分批办理。`);
  }
}

export function checkUploadBudget<T extends SizedFile>(
  files: ReadonlyArray<T>,
  existingFiles: ReadonlyArray<SizedFile>,
  limits: Pick<
    typeof resourceLimits,
    "maxFileBytes" | "maxFilesPerJob" | "maxJobUploadBytes"
  > = resourceLimits,
) {
  const sizes = new Map(existingFiles.map(({ name, size }) => [fileIdentity(name), size]));
  const incoming = new Set<string>();
  const uploads = files.map((file) => {
    const name = sanitize(file.name);
    if (!name || name === "." || name === "..") {
      throw new UploadBudgetError("文件名无效，请重命名后再交文件。", 400);
    }
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > limits.maxFileBytes) {
      throw new UploadBudgetError(`单个文件不能超过 ${limits.maxFileBytes / 1048576} MiB。`);
    }
    const key = fileIdentity(name);
    if (incoming.has(key)) {
      throw new UploadBudgetError("文件名清理后存在重名，请分开上传或重命名。", 409);
    }
    incoming.add(key);
    const delta = file.size - (sizes.get(key) ?? 0);
    sizes.set(key, file.size);
    return { file, name, delta };
  });
  if (sizes.size > limits.maxFilesPerJob) {
    throw new UploadBudgetError(`每单最多接收 ${limits.maxFilesPerJob} 个文件，请分批办理。`);
  }
  const finalBytes = [...sizes.values()].reduce((total, size) => total + size, 0);
  checkJobUploadBytes(finalBytes, limits.maxJobUploadBytes);

  // Commit shrinking replacements first so a partial write failure cannot strand a job over quota.
  return uploads.sort((a, b) => a.delta - b.delta);
}

const uploadLocks = new Map<string, Promise<void>>();

/** Keep upload inspection, file changes and conversion admission serialized for one job. */
export async function withUploadLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = uploadLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  uploadLocks.set(key, current);
  try {
    await previous;
    return await operation();
  } finally {
    release();
    if (uploadLocks.get(key) === current) uploadLocks.delete(key);
  }
}
