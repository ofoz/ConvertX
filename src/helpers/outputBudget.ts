import { lstat, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { resourceLimits } from "./resourceLimits";

/** Count auxiliary files too, without following converter-created links. */
async function directoryBytes(directory: string): Promise<number> {
  let bytes = 0;
  const pending = [directory];
  let entriesSeen = 0;
  while (pending.length) {
    const current = pending.pop()!;
    for (const name of await readdir(current)) {
      if (++entriesSeen > 10000) throw new Error("Conversion output contains too many files.");
      const entry = path.join(current, name);
      const info = await lstat(entry);
      if (info.isSymbolicLink()) throw new Error("Conversion output contains a symbolic link.");
      if (info.isDirectory()) pending.push(entry);
      else if (info.isFile()) bytes += info.size;
      else throw new Error("Conversion output is not a regular file.");
      if (!Number.isSafeInteger(bytes)) throw new Error("Conversion output size is invalid.");
    }
  }
  return bytes;
}

/**
 * Serialize admission and publication for a batch. Work directories must be outside the
 * downloadable job directory. This caps retained output, not a worker's peak temporary disk use;
 * deployments needing a hard disk cap require a volume quota.
 */
export function createOutputPublisher(
  outputDirectory: string,
  maxBytes = resourceLimits.maxJobOutputBytes,
) {
  let previous = Promise.resolve();
  return (
    workDirectory: string,
    outputName: string,
    isActive: () => boolean,
    commit: (names: string[]) => void,
  ): Promise<string[]> => {
    const publish = previous.then(async () => {
      const root = await lstat(outputDirectory);
      if (!root.isDirectory() || root.isSymbolicLink())
        throw new Error("Conversion output directory is unavailable.");
      const entries = await readdir(workDirectory);
      const parsed = path.parse(outputName);
      const names: string[] = [];
      for (const name of entries) {
        const numbered =
          name.startsWith(`${parsed.name}-`) &&
          name.endsWith(parsed.ext) &&
          /^\d+$/.test(name.slice(parsed.name.length + 1, -parsed.ext.length));
        if (name !== outputName && !numbered) continue;
        if (!(await lstat(path.join(workDirectory, name))).isFile())
          throw new Error("Conversion did not produce a regular output file.");
        names.push(name);
      }
      if (!names.length) throw new Error("Conversion did not produce an output file.");
      const used = await directoryBytes(outputDirectory);
      const incoming = await directoryBytes(workDirectory);
      if (incoming > maxBytes - used)
        throw new Error(`Job output exceeds the ${maxBytes / 1048576} MiB limit.`);
      // Check every top-level name, including sidecars, before publishing anything.
      for (const name of entries) {
        const exists = await lstat(path.join(outputDirectory, name)).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        );
        if (exists) throw new Error(`Conversion output already exists: ${name}`);
      }
      const moved: string[] = [];
      try {
        for (const name of entries) {
          if (!isActive()) throw new Error("The conversion job is no longer active.");
          await rename(path.join(workDirectory, name), path.join(outputDirectory, name));
          moved.push(name);
        }
        if (!isActive()) throw new Error("The conversion job is no longer active.");
        names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        commit(names);
        return names;
      } catch (error) {
        for (const name of moved)
          await rm(path.join(outputDirectory, name), { recursive: true, force: true });
        throw error;
      }
    });
    previous = publish.then(
      () => undefined,
      () => undefined,
    );
    return publish;
  };
}
