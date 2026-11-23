import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";

export type ArchiveEntry = {
  relativePath: string;
  absolutePath: string;
  size: number;
  mtimeNs: string;
  dev: string;
  ino: string;
  ctimeNs: string;
};

export class ArchiveError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: "empty" | "unsafe" | "too-large" | "timeout" | "changed" | "busy" | "failed",
  ) {
    super(message);
    this.name = "ArchiveError";
  }
}

export function validateArchiveRelativePath(value: string) {
  if (
    !value ||
    value.startsWith("/") ||
    /^[a-zA-Z]:/.test(value) ||
    value.includes(":") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new ArchiveError("An output file has an unsafe archive path.", 400, "unsafe");
  }
}

export async function snapshotArchiveEntries(
  outputRoot: string,
  excludedNames: ReadonlySet<string>,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{ entries: ArchiveEntry[]; fingerprint: string; totalInputBytes: number }> {
  const throwIfAborted = () => {
    if (signal?.aborted) throw signal.reason;
  };
  throwIfAborted();
  const root = path.resolve(outputRoot);
  let rootStat;
  try {
    rootStat = await lstat(root, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ArchiveError("No converted files are available to archive.", 404, "empty");
    }
    throw error;
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new ArchiveError("The output directory is not a safe regular directory.", 400, "unsafe");
  }

  const entries: ArchiveEntry[] = [];
  let totalInputBytes = 0;
  const walk = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
    throwIfAborted();
    const children = await readdir(absoluteDirectory, { withFileTypes: true });
    throwIfAborted();
    children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const child of children) {
      throwIfAborted();
      if (!relativeDirectory && excludedNames.has(child.name)) continue;
      if (
        child.name === "" ||
        child.name === "." ||
        child.name === ".." ||
        child.name.includes("/") ||
        child.name.includes("\\") ||
        child.name.includes("\0")
      ) {
        throw new ArchiveError("An output file has an unsafe name.", 400, "unsafe");
      }
      const absolutePath = path.resolve(absoluteDirectory, child.name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
      validateArchiveRelativePath(relativePath);
      const parent = path.relative(root, absolutePath);
      if (
        !parent ||
        parent === ".." ||
        parent.startsWith(`..${path.sep}`) ||
        path.isAbsolute(parent)
      ) {
        throw new ArchiveError("An output file is outside its job directory.", 400, "unsafe");
      }
      const info = await lstat(absolutePath, { bigint: true });
      if (info.isSymbolicLink()) {
        throw new ArchiveError(
          "Symbolic links cannot be included in a download archive.",
          400,
          "unsafe",
        );
      }
      if (info.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!info.isFile() || info.size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ArchiveError("An output is not a supported regular file.", 400, "unsafe");
      }
      const size = Number(info.size);
      totalInputBytes += size;
      if (totalInputBytes > maxBytes) {
        throw new ArchiveError(
          "The combined files exceed the archive size limit. Download files individually instead.",
          413,
          "too-large",
        );
      }
      entries.push({
        relativePath,
        absolutePath,
        size,
        mtimeNs: info.mtimeNs.toString(),
        dev: info.dev.toString(),
        ino: info.ino.toString(),
        ctimeNs: info.ctimeNs.toString(),
      });
    }
  };
  await walk(root, "");
  entries.sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
  );
  if (!entries.length) {
    throw new ArchiveError("No converted files are available to archive.", 404, "empty");
  }
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(entry.relativePath, "utf8");
    hash.update("\0");
    hash.update(String(entry.size));
    hash.update("\0");
    hash.update(entry.mtimeNs);
    hash.update("\0");
    hash.update(entry.dev);
    hash.update("\0");
    hash.update(entry.ino);
    hash.update("\0");
    hash.update(entry.ctimeNs);
    hash.update("\n");
  }
  return { entries, fingerprint: hash.digest("hex"), totalInputBytes };
}

function octal(value: number, width: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid tar header number.");
  const text = value.toString(8);
  if (text.length > width - 1)
    throw new ArchiveError("An archive entry is too large for TAR.", 413, "too-large");
  return `${"0".repeat(width - 1 - text.length)}${text}\0`;
}

function copyField(target: Buffer, offset: number, width: number, value: string) {
  const data = Buffer.from(value, "utf8");
  if (data.length > width) throw new Error("Invalid TAR header field.");
  data.copy(target, offset);
}

function splitUstarPath(filePath: string) {
  const bytes = Buffer.from(filePath, "utf8");
  if (bytes.length <= 100 && !/[^\x20-\x7e]/u.test(filePath)) return { name: filePath, prefix: "" };
  for (
    let index = filePath.lastIndexOf("/");
    index > 0;
    index = filePath.lastIndexOf("/", index - 1)
  ) {
    const prefix = filePath.slice(0, index);
    const name = filePath.slice(index + 1);
    if (
      Buffer.byteLength(prefix, "utf8") <= 155 &&
      Buffer.byteLength(name, "utf8") <= 100 &&
      !/[^\x20-\x7e]/u.test(filePath)
    ) {
      return { name, prefix };
    }
  }
  return undefined;
}

function header(
  name: string,
  size: number,
  type: string,
  prefix = "",
  mtime = Math.floor(Date.now() / 1000),
) {
  const result = Buffer.alloc(512);
  copyField(result, 0, 100, name);
  copyField(result, 100, 8, octal(0o644, 8));
  copyField(result, 108, 8, octal(0, 8));
  copyField(result, 116, 8, octal(0, 8));
  copyField(result, 124, 12, octal(size, 12));
  copyField(result, 136, 12, octal(mtime, 12));
  result.fill(0x20, 148, 156);
  result[156] = type.charCodeAt(0);
  copyField(result, 257, 6, "ustar\0");
  copyField(result, 263, 2, "00");
  copyField(result, 265, 32, "root");
  copyField(result, 297, 32, "root");
  copyField(result, 345, 155, prefix);
  const checksum = result.reduce((sum, value) => sum + value, 0);
  copyField(result, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return result;
}

function paxRecord(key: string, value: string) {
  const suffix = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(suffix, "utf8") + 1;
  while (true) {
    const record = `${length}${suffix}`;
    const actual = Buffer.byteLength(record, "utf8");
    if (actual === length) return Buffer.from(record, "utf8");
    length = actual;
  }
}

function paddedLength(size: number) {
  return size + ((512 - (size % 512)) % 512);
}

export async function streamPaxTar(
  outputRoot: string,
  entries: ArchiveEntry[],
  destination: string,
  maxBytes: number,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<number> {
  const absoluteRoot = path.resolve(outputRoot);
  const absoluteDestination = path.resolve(destination);
  const controller = new AbortController();
  const parentAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) parentAbort();
  else parentSignal?.addEventListener("abort", parentAbort, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new ArchiveError("Archive preparation timed out. Please retry.", 503, "timeout"),
      ),
    timeoutMs,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let position = 0;
  const write = async (buffer: Buffer) => {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (position + buffer.length > maxBytes) {
      throw new ArchiveError(
        "The archive exceeds the size limit. Download files individually instead.",
        413,
        "too-large",
      );
    }
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle!.write(buffer, offset, buffer.length - offset, position + offset);
      if (!result.bytesWritten) throw new Error("The archive file could not make write progress.");
      offset += result.bytesWritten;
    }
    position += buffer.length;
  };
  const writePadded = async (buffer: Buffer) => {
    await write(buffer);
    const padding = paddedLength(buffer.length) - buffer.length;
    if (padding) await write(Buffer.alloc(padding));
  };

  try {
    handle = await open(absoluteDestination, "wx", 0o600);
    for (let index = 0; index < entries.length; index++) {
      if (controller.signal.aborted) throw controller.signal.reason;
      const entry = entries[index]!;
      validateArchiveRelativePath(entry.relativePath);
      const absolutePath = path.resolve(absoluteRoot, ...entry.relativePath.split("/"));
      const relativeCheck = path.relative(absoluteRoot, absolutePath);
      if (
        absolutePath !== entry.absolutePath ||
        !relativeCheck ||
        relativeCheck === ".." ||
        relativeCheck.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeCheck)
      ) {
        throw new ArchiveError("An output path changed during archive preparation.", 400, "unsafe");
      }
      const expected = await lstat(absolutePath, { bigint: true });
      if (
        expected.isSymbolicLink() ||
        !expected.isFile() ||
        expected.size !== BigInt(entry.size) ||
        expected.mtimeNs.toString() !== entry.mtimeNs ||
        expected.dev.toString() !== entry.dev ||
        expected.ino.toString() !== entry.ino ||
        expected.ctimeNs.toString() !== entry.ctimeNs
      ) {
        throw new ArchiveError(
          "An output file changed during archive preparation. Please retry.",
          409,
          "changed",
        );
      }

      const ustar = splitUstarPath(entry.relativePath);
      if (!ustar) {
        const pax = paxRecord("path", entry.relativePath);
        await write(header(`PaxHeaders/${index}`, pax.length, "x"));
        await writePadded(pax);
      }
      const member = ustar ?? { name: `file-${index}`, prefix: "" };
      await write(
        header(member.name, entry.size, "0", member.prefix, Number(expected.mtimeMs / 1000n)),
      );

      const noFollow = constants.O_NOFOLLOW ?? 0;
      const input = await open(absolutePath, constants.O_RDONLY | noFollow);
      let actualBytes = 0;
      try {
        const opened = await input.stat({ bigint: true });
        if (
          !opened.isFile() ||
          opened.size !== BigInt(entry.size) ||
          opened.mtimeNs.toString() !== entry.mtimeNs ||
          opened.dev.toString() !== entry.dev ||
          opened.ino.toString() !== entry.ino ||
          opened.ctimeNs.toString() !== entry.ctimeNs
        ) {
          throw new ArchiveError(
            "An output file changed during archive preparation. Please retry.",
            409,
            "changed",
          );
        }
        const stream = input.createReadStream({
          autoClose: false,
          signal: controller.signal,
          highWaterMark: 64 * 1024,
        });
        for await (const chunk of stream) {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          actualBytes += data.length;
          if (actualBytes > entry.size) {
            throw new ArchiveError(
              "An output file changed during archive preparation. Please retry.",
              409,
              "changed",
            );
          }
          await write(data);
        }
        if (actualBytes !== entry.size) {
          throw new ArchiveError(
            "An output file changed during archive preparation. Please retry.",
            409,
            "changed",
          );
        }
        if (position % 512) await write(Buffer.alloc((512 - (position % 512)) % 512));
      } finally {
        await input.close();
      }
    }
    await write(Buffer.alloc(1024));
    await handle.sync();
    const size = position;
    await handle.close();
    handle = undefined;
    return size;
  } catch (error) {
    if (controller.signal.aborted) {
      throw controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new ArchiveError("Archive preparation timed out. Please retry.", 503, "timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", parentAbort);
    if (handle) await handle.close().catch(() => undefined);
  }
}

export async function regularFileStat(filePath: string) {
  try {
    const result = await lstat(filePath, { bigint: true });
    if (result.isSymbolicLink() || !result.isFile()) return undefined;
    return result;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}
