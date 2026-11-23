import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { Elysia } from "elysia";
import sanitize from "sanitize-filename";

import { outputDir } from "..";
import db from "../db/db";
import { WEBROOT } from "../helpers/env";
import { resourceLimits } from "../helpers/resourceLimits";
import {
  ArchiveError,
  regularFileStat,
  snapshotArchiveEntries,
  streamPaxTar,
} from "../helpers/streamArchive";
import { userService } from "./user";

type ArchiveMetadata = {
  version: 1;
  key: string;
  userId: string;
  jobId: string;
  fingerprint: string;
  size: number;
};

const archiveBuilds = new Map<string, Promise<ArchiveMetadata>>();
const maxArchiveCacheBytes = Math.min(2 * 1024 * 1024 * 1024, resourceLimits.maxArchiveBytes * 2);
const maxArchiveCacheEntries = 8;
let activeArchiveBuild: string | undefined;
let cacheInitialization: Promise<void> | undefined;

function archiveKey(userId: string, jobId: string) {
  return createHash("sha256").update(`${userId}/${jobId}`, "utf8").digest("hex");
}

function archiveName(jobId: string) {
  return `converted_files_${jobId}.tar`;
}

function contentDisposition(filename: string) {
  const fallback = filename.replace(/[^\x20-\x7E]|["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function within(parent: string, target: string) {
  const relative = path.relative(parent, target);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function assertNoSymlinkPathComponents(absolutePath: string) {
  const resolved = path.resolve(absolutePath);
  const parsed = path.parse(resolved);
  let cursor = parsed.root;
  const parts = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const part of parts) {
    cursor = path.join(cursor, part);
    let info;
    try {
      info = await lstat(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw new ArchiveError("The output path contains a symbolic link.", 400, "unsafe");
    }
  }
}

function archivePaths(userId: string, jobId: string) {
  if (!/^\d+$/.test(userId) || !/^\d+$/.test(jobId)) {
    throw new ArchiveError("A valid job is required.", 404, "empty");
  }
  const outputBase = path.resolve(outputDir);
  const userOutput = path.resolve(outputBase, userId);
  const outputRoot = path.resolve(userOutput, jobId);
  if (!within(outputBase, userOutput) || !within(userOutput, outputRoot)) {
    throw new ArchiveError("A valid job is required.", 404, "empty");
  }
  const cacheRoot = path.resolve(outputBase, ".archive-cache");
  if (!within(outputBase, cacheRoot)) {
    throw new ArchiveError("The archive cache path is invalid.", 500, "failed");
  }
  return { outputBase, userOutput, outputRoot, cacheRoot };
}

async function ensureCacheDirectory(cacheRoot: string) {
  if (!cacheInitialization) {
    cacheInitialization = (async () => {
      await mkdir(cacheRoot, { recursive: true });
      await assertNoSymlinkPathComponents(cacheRoot);
      const info = await lstat(cacheRoot);
      if (!info.isDirectory())
        throw new ArchiveError("The archive cache is unavailable.", 500, "failed");
      const stalePattern = /^archive-[a-f0-9]{64}\.tmp-[0-9a-f-]{36}\.(?:tar|json)$/;
      for (const name of await readdir(cacheRoot)) {
        if (!stalePattern.test(name)) continue;
        const stale = path.resolve(cacheRoot, name);
        if (path.dirname(stale) === path.resolve(cacheRoot) && (await regularFileStat(stale))) {
          await unlink(stale).catch(() => undefined);
        }
      }
    })().catch((error) => {
      cacheInitialization = undefined;
      throw error;
    });
  }
  await cacheInitialization;
}

function cacheFilePaths(cacheRoot: string, key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid internal archive cache key.");
  const archivePath = path.resolve(cacheRoot, `${key}.tar`);
  const metadataPath = path.resolve(cacheRoot, `${key}.json`);
  if (!within(cacheRoot, archivePath) || !within(cacheRoot, metadataPath)) {
    throw new Error("Archive cache path escaped its root.");
  }
  return { archivePath, metadataPath };
}

async function removeCacheFiles(cacheRoot: string, key: string) {
  const { archivePath, metadataPath } = cacheFilePaths(cacheRoot, key);
  await Promise.all([
    unlink(archivePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    }),
    unlink(metadataPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    }),
  ]);
}

async function readValidCache(
  cacheRoot: string,
  userId: string,
  jobId: string,
  key: string,
  fingerprint: string,
  touch: boolean,
): Promise<ArchiveMetadata | undefined> {
  const { archivePath, metadataPath } = cacheFilePaths(cacheRoot, key);
  try {
    const [metadataText, archiveInfo, metadataInfo] = await Promise.all([
      readFile(metadataPath, "utf8"),
      regularFileStat(archivePath),
      regularFileStat(metadataPath),
    ]);
    if (!archiveInfo || !metadataInfo) {
      await removeCacheFiles(cacheRoot, key);
      return;
    }
    const metadata = JSON.parse(metadataText) as ArchiveMetadata;
    if (
      metadata.version !== 1 ||
      metadata.key !== key ||
      metadata.userId !== userId ||
      metadata.jobId !== jobId ||
      metadata.fingerprint !== fingerprint ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size <= 0 ||
      BigInt(metadata.size) !== archiveInfo.size
    ) {
      await removeCacheFiles(cacheRoot, key);
      return;
    }
    if (touch) {
      const now = new Date();
      await utimes(metadataPath, now, now);
    }
    return metadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await removeCacheFiles(cacheRoot, key);
      return;
    }
    if (error instanceof SyntaxError) {
      await removeCacheFiles(cacheRoot, key);
      return;
    }
    throw error;
  }
}

async function listCacheEntries(cacheRoot: string) {
  const entries: Array<{ key: string; size: number; accessed: number }> = [];
  for (const name of await readdir(cacheRoot)) {
    const match = /^([a-f0-9]{64})\.json$/.exec(name);
    if (!match) continue;
    const key = match[1]!;
    const { archivePath, metadataPath } = cacheFilePaths(cacheRoot, key);
    try {
      const [metadataText, archiveInfo, metadataInfo] = await Promise.all([
        readFile(metadataPath, "utf8"),
        regularFileStat(archivePath),
        regularFileStat(metadataPath),
      ]);
      const metadata = JSON.parse(metadataText) as ArchiveMetadata;
      if (
        !archiveInfo ||
        !metadataInfo ||
        metadata.version !== 1 ||
        metadata.key !== key ||
        !Number.isSafeInteger(metadata.size) ||
        BigInt(metadata.size) !== archiveInfo.size
      ) {
        await removeCacheFiles(cacheRoot, key);
        continue;
      }
      entries.push({ key, size: metadata.size, accessed: Number(metadataInfo.mtimeMs) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
        await removeCacheFiles(cacheRoot, key);
        continue;
      }
      throw error;
    }
  }
  return entries;
}

async function makeRoom(cacheRoot: string, incomingSize: number, preserveKey: string) {
  if (incomingSize > maxArchiveCacheBytes) {
    throw new ArchiveError(
      "The archive exceeds the available cache budget. Download files individually instead.",
      413,
      "too-large",
    );
  }
  const entries = await listCacheEntries(cacheRoot);
  let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  let count = entries.length;
  const candidates = entries
    .filter((entry) => entry.key !== preserveKey)
    .sort((a, b) => a.accessed - b.accessed);
  while (count + 1 > maxArchiveCacheEntries || totalBytes + incomingSize > maxArchiveCacheBytes) {
    const next = candidates.shift();
    if (!next) {
      throw new ArchiveError("Archive cache is busy. Please retry shortly.", 503, "busy");
    }
    await removeCacheFiles(cacheRoot, next.key);
    totalBytes -= next.size;
    count--;
  }
}

async function buildArchive(userId: string, jobId: string): Promise<ArchiveMetadata> {
  const { outputRoot, cacheRoot } = archivePaths(userId, jobId);
  await assertNoSymlinkPathComponents(outputRoot);
  await ensureCacheDirectory(cacheRoot);
  const key = archiveKey(userId, jobId);
  const inProgress = archiveBuilds.get(key);
  if (inProgress) return inProgress;
  if (activeArchiveBuild) {
    throw new ArchiveError("Another archive is being prepared. Please retry shortly.", 503, "busy");
  }

  const promise = (async () => {
    activeArchiveBuild = key;
    const controller = new AbortController();
    const deadline = Date.now() + resourceLimits.archiveTimeoutMs;
    const timeout = setTimeout(
      () =>
        controller.abort(
          new ArchiveError("Archive preparation timed out. Please retry.", 503, "timeout"),
        ),
      resourceLimits.archiveTimeoutMs,
    );
    const excluded = new Set([archiveName(jobId)]);
    const { archivePath, metadataPath } = cacheFilePaths(cacheRoot, key);
    const tempArchivePath = path.resolve(cacheRoot, `archive-${key}.tmp-${randomUUID()}.tar`);
    const tempMetadataPath = path.resolve(cacheRoot, `archive-${key}.tmp-${randomUUID()}.json`);
    if (!within(cacheRoot, tempArchivePath) || !within(cacheRoot, tempMetadataPath)) {
      clearTimeout(timeout);
      activeArchiveBuild = undefined;
      throw new ArchiveError("The temporary archive path is invalid.", 500, "failed");
    }
    try {
      const initial = await snapshotArchiveEntries(
        outputRoot,
        excluded,
        resourceLimits.maxArchiveBytes,
        controller.signal,
      );
      const existing = await readValidCache(
        cacheRoot,
        userId,
        jobId,
        key,
        initial.fingerprint,
        true,
      );
      if (existing) return existing;
      const remainingMs = Math.max(1, deadline - Date.now());
      const size = await streamPaxTar(
        outputRoot,
        initial.entries,
        tempArchivePath,
        resourceLimits.maxArchiveBytes,
        remainingMs,
        controller.signal,
      );
      const finalSnapshot = await snapshotArchiveEntries(
        outputRoot,
        excluded,
        resourceLimits.maxArchiveBytes,
        controller.signal,
      );
      if (finalSnapshot.fingerprint !== initial.fingerprint) {
        throw new ArchiveError(
          "Output files changed while the archive was prepared. Please retry.",
          409,
          "changed",
        );
      }
      await makeRoom(cacheRoot, size, key);
      await rename(tempArchivePath, archivePath);
      const metadata: ArchiveMetadata = {
        version: 1,
        key,
        userId,
        jobId,
        fingerprint: initial.fingerprint,
        size,
      };
      await writeFile(tempMetadataPath, JSON.stringify(metadata), { flag: "wx", mode: 0o600 });
      await rename(tempMetadataPath, metadataPath);
      return metadata;
    } catch (error) {
      await unlink(tempArchivePath).catch(() => undefined);
      await unlink(tempMetadataPath).catch(() => undefined);
      if (await regularFileStat(archivePath)) await unlink(archivePath).catch(() => undefined);
      if (controller.signal.aborted) {
        throw controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new ArchiveError("Archive preparation timed out. Please retry.", 503, "timeout");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      activeArchiveBuild = undefined;
    }
  })().finally(() => archiveBuilds.delete(key));
  archiveBuilds.set(key, promise);
  return promise;
}

async function getCachedArchive(
  userId: string,
  jobId: string,
  touch: boolean,
): Promise<{ metadata: ArchiveMetadata; archivePath: string } | undefined> {
  const { outputRoot, cacheRoot } = archivePaths(userId, jobId);
  await assertNoSymlinkPathComponents(outputRoot);
  await ensureCacheDirectory(cacheRoot);
  const current = await snapshotArchiveEntries(
    outputRoot,
    new Set([archiveName(jobId)]),
    resourceLimits.maxArchiveBytes,
  );
  const key = archiveKey(userId, jobId);
  const metadata = await readValidCache(
    cacheRoot,
    userId,
    jobId,
    key,
    current.fingerprint,
    touch,
  );
  if (!metadata) return;
  return { metadata, archivePath: cacheFilePaths(cacheRoot, key).archivePath };
}

async function getArchive(
  userId: string,
  jobId: string,
): Promise<{ metadata: ArchiveMetadata; archivePath: string }> {
  const key = archiveKey(userId, jobId);
  const cached = await getCachedArchive(userId, jobId, true);
  if (cached) return cached;
  const built = await buildArchive(userId, jobId);
  return {
    metadata: built,
    archivePath: cacheFilePaths(archivePaths(userId, jobId).cacheRoot, key).archivePath,
  };
}

function setArchiveHeaders(set: { headers: object }, filename: string, size: number) {
  const headers = set.headers as Record<string, string | number>;
  headers["content-type"] = "application/x-tar";
  headers["content-disposition"] = contentDisposition(filename);
  headers["content-length"] = String(size);
  headers["x-content-type-options"] = "nosniff";
  headers["cache-control"] = "private, no-store";
}

function responseHeaders(source: object) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" || typeof value === "number") headers.set(key, String(value));
  }
  return headers;
}

function archiveErrorResponse(error: unknown): { status: number; message: string } {
  if (error instanceof ArchiveError) return { status: error.status, message: error.message };
  console.error("Failed to prepare a streamed archive:", error);
  return {
    status: 500,
    message: "Unable to prepare the archive. Please retry or download files individually.",
  };
}

export const download = new Elysia()
  .use(userService)
  .get(
    "/download/:userId/:jobId/:fileName",
    async ({ params, redirect, set, user }) => {
      const job = db
        .query("SELECT id FROM jobs WHERE user_id = ? AND id = ?")
        .get(user.id, params.jobId);
      if (!job) return redirect(`${WEBROOT}/results`, 302);
      const jobId = params.jobId;
      const fileName = sanitize(params.fileName);
      const filePath = path.resolve(outputDir, user.id, jobId, fileName);
      const root = path.resolve(outputDir, user.id, jobId);
      if (!within(root, filePath)) {
        set.status = 404;
        return { message: "Converted file not found." };
      }
      let info;
      try {
        await assertNoSymlinkPathComponents(filePath);
        info = await regularFileStat(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") info = undefined;
        else throw error;
      }
      if (!info) {
        set.status = 404;
        return { message: "Converted file not found." };
      }
      const file = Bun.file(filePath);
      set.headers["content-disposition"] = contentDisposition(fileName);
      set.headers["content-length"] = info.size.toString();
      set.headers["x-content-type-options"] = "nosniff";
      return file;
    },
    { auth: true },
  )
  .head(
    "/download/:userId/:jobId/:fileName",
    async ({ params, user, set }) => {
      const job = db
        .query("SELECT id FROM jobs WHERE user_id = ? AND id = ?")
        .get(user.id, params.jobId);
      if (!job) {
        set.status = 404;
        return;
      }
      const fileName = sanitize(params.fileName);
      const root = path.resolve(outputDir, user.id, params.jobId);
      const filePath = path.resolve(root, fileName);
      if (!within(root, filePath)) {
        set.status = 404;
        return;
      }
      let info;
      try {
        await assertNoSymlinkPathComponents(filePath);
        info = await regularFileStat(filePath);
      } catch (error) {
        if (error instanceof ArchiveError) info = undefined;
        else throw error;
      }
      if (!info) {
        set.status = 404;
        return;
      }
      const file = Bun.file(filePath);
      set.headers["content-type"] = file.type || "application/octet-stream";
      set.headers["content-disposition"] = contentDisposition(fileName);
      set.headers["content-length"] = info.size.toString();
      set.headers["x-content-type-options"] = "nosniff";
      return new Response(null, { headers: responseHeaders(set.headers) });
    },
    { auth: true },
  )
  .post(
    "/archive/:jobId/prepare",
    async ({ params, user, set }) => {
      if (!/^\d+$/.test(params.jobId)) {
        set.status = 404;
        return { message: "Job not found." };
      }
      const job = db
        .query("SELECT id FROM jobs WHERE user_id = ? AND id = ?")
        .get(user.id, params.jobId) as { id: number } | null;
      if (!job) {
        set.status = 404;
        return { message: "Job not found." };
      }
      try {
        const jobId = String(job.id);
        const { metadata } = await getArchive(user.id, jobId);
        return {
          url: `${WEBROOT}/archive/${jobId}`,
          name: archiveName(jobId),
          size: metadata.size,
        };
      } catch (error) {
        const failure = archiveErrorResponse(error);
        set.status = failure.status;
        return { message: failure.message };
      }
    },
    { auth: true },
  )
  .head(
    "/archive/:jobId",
    async ({ params, user, set }) => {
      if (!/^\d+$/.test(params.jobId)) {
        set.status = 404;
        return;
      }
      const job = db
        .query("SELECT id FROM jobs WHERE user_id = ? AND id = ?")
        .get(user.id, params.jobId) as { id: number } | null;
      if (!job) {
        set.status = 404;
        return;
      }
      try {
        const jobId = String(job.id);
        const cached = await getCachedArchive(user.id, jobId, false);
        if (!cached) {
          set.status = 409;
          set.headers["cache-control"] = "no-store";
          return;
        }
        await setArchiveHeaders(set, archiveName(jobId), cached.metadata.size);
        return new Response(null, { headers: responseHeaders(set.headers) });
      } catch (error) {
        const failure = archiveErrorResponse(error);
        set.status = failure.status;
        return { message: failure.message };
      }
    },
    { auth: true },
  )
  .get(
    "/archive/:jobId",
    async ({ params, user, redirect, set, request }) => {
      if (!/^\d+$/.test(params.jobId)) return redirect(`${WEBROOT}/results`, 302);
      const job = db
        .query("SELECT id FROM jobs WHERE user_id = ? AND id = ?")
        .get(user.id, params.jobId) as { id: number } | null;
      if (!job) return redirect(`${WEBROOT}/results`, 302);
      try {
        const jobId = String(job.id);
        if (request.method === "HEAD") {
          const cached = await getCachedArchive(user.id, jobId, false);
          if (!cached) {
            set.status = 409;
            set.headers["cache-control"] = "no-store";
            return;
          }
          await setArchiveHeaders(set, archiveName(jobId), cached.metadata.size);
          return Bun.file(cached.archivePath);
        }
        const { metadata, archivePath } = await getArchive(user.id, jobId);
        await setArchiveHeaders(set, archiveName(jobId), metadata.size);
        return Bun.file(archivePath);
      } catch (error) {
        const failure = archiveErrorResponse(error);
        set.status = failure.status;
        return { message: failure.message };
      }
    },
    { auth: true },
  );
