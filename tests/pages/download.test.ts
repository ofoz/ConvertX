import { describe, expect, test } from "bun:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { validateArchiveRelativePath } from "../../src/helpers/streamArchive";
import { createJob, createUser, jobDirs, request } from "./helpers/app";

async function userWithOutputs(files: Record<string, string | Uint8Array>) {
  const user = await createUser();
  const job = createJob(user.id);
  const dirs = jobDirs(user.id, job);
  mkdirSync(dirs.output, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dirs.output, ...name.split("/"));
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
  return { user, job, dirs };
}

async function tarFiles(response: Response) {
  const archive = Buffer.from(await response.arrayBuffer());
  const result = new Map<string, Uint8Array>();
  let offset = 0;
  let paxPath: string | undefined;
  const field = (header: Buffer, start: number, length: number) => {
    const end = header.indexOf(0, start);
    return header.toString("utf8", start, end < 0 ? start + length : Math.min(end, start + length));
  };
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const name = field(header, 0, 100);
    const prefix = field(header, 345, 155);
    const sizeText = header.toString("ascii", 124, 136).replace(/\0.*$/s, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const type = String.fromCharCode(header[156] || 0);
    const bodyStart = offset + 512;
    if (type === "x") {
      const pax = archive.subarray(bodyStart, bodyStart + size);
      let cursor = 0;
      while (cursor < pax.length) {
        const space = pax.indexOf(0x20, cursor);
        assert.notEqual(space, -1);
        const recordLength = Number(pax.toString("ascii", cursor, space));
        assert.ok(recordLength > space - cursor && cursor + recordLength <= pax.length);
        const record = pax.toString("utf8", space + 1, cursor + recordLength - 1);
        if (record.startsWith("path=")) paxPath = record.slice(5);
        cursor += recordLength;
      }
    } else if (type === "0" || type === "\0") {
      const archivePath = paxPath ?? (prefix ? `${prefix}/${name}` : name);
      result.set(archivePath, new Uint8Array(archive.subarray(bodyStart, bodyStart + size)));
      paxPath = undefined;
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return result;
}

async function tarEntries(response: Response) {
  return [...(await tarFiles(response)).keys()].sort();
}

describe("GET /download/:userId/:jobId/:fileName", () => {
  test("redirects to the login page without a session", async () => {
    const { user, job } = await userWithOutputs({ "a.csv": "a" });

    const response = await request(`/download/${user.id}/${job}/a.csv`, {
      headers: { accept: "text/html" },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  test("serves a converted file", async () => {
    const { user, job } = await userWithOutputs({ "a.csv": "converted" });

    const response = await request(`/download/${user.id}/${job}/a.csv`, {
      cookies: { auth: user.token },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toStartWith("text/csv");
    expect(await response.text()).toBe("converted");
  });

  test("serves Chinese filenames with RFC 5987 attachment headers and supports HEAD", async () => {
    const { user, job } = await userWithOutputs({ "报告 一 #1.csv": "converted contents" });
    const url = `/download/${user.id}/${job}/报告%20一%20%231.csv`;
    const head = await request(url, { method: "HEAD", cookies: { auth: user.token } });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("18");
    expect(head.headers.get("content-disposition")).toContain('filename="');
    expect(head.headers.get("content-disposition")).toContain("filename*=UTF-8''");
    expect(head.headers.get("content-disposition")).toContain("%E6%8A%A5%E5%91%8A");
    expect(head.body).toBeNull();
    const get = await request(url, { cookies: { auth: user.token } });
    expect(await get.text()).toBe("converted contents");
  });

  test("returns a bodyless 404 for HEAD on a missing output", async () => {
    const { user, job } = await userWithOutputs({});
    const response = await request(`/download/${user.id}/${job}/missing.txt`, {
      method: "HEAD",
      cookies: { auth: user.token },
    });
    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
  });

  test("serves file names with encoded spaces and hashes", async () => {
    const { user, job } = await userWithOutputs({ "my file #1.csv": "spaced" });

    const response = await request(`/download/${user.id}/${job}/my%20file%20%231.csv`, {
      cookies: { auth: user.token },
    });

    expect(await response.text()).toBe("spaced");
  });

  test("answers 404 for a file that does not exist", async () => {
    const { user, job } = await userWithOutputs({});

    const response = await request(`/download/${user.id}/${job}/missing.csv`, {
      cookies: { auth: user.token },
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Converted file not found." });
  });

  test("refuses files of another user's job", async () => {
    const user = await createUser();
    const other = await userWithOutputs({ "secret.csv": "secret" });

    const response = await request(`/download/${other.user.id}/${other.job}/secret.csv`, {
      cookies: { auth: user.token },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/results");
  });

  test("ignores the user id in the URL and only serves the caller's own files", async () => {
    const { user, job } = await userWithOutputs({ "a.csv": "mine" });
    const other = await createUser();
    mkdirSync(jobDirs(other.id, job).output, { recursive: true });
    writeFileSync(`${jobDirs(other.id, job).output}a.csv`, "theirs");

    const response = await request(`/download/${other.id}/${job}/a.csv`, {
      cookies: { auth: user.token },
    });

    expect(await response.text()).toBe("mine");
  });

  test("sanitizes the file name so files outside the job cannot be read", async () => {
    const { user, job } = await userWithOutputs({});
    const other = await userWithOutputs({ "secret.csv": "secret" });

    const traversal = encodeURIComponent(`../../${other.user.id}/${other.job}/secret.csv`);
    const response = await request(`/download/${user.id}/${job}/${traversal}`, {
      cookies: { auth: user.token },
    });

    expect(response.status).toBe(404);
  });

  test("serves file names containing a percent sign", async () => {
    const { user, job } = await userWithOutputs({ "100%.csv": "percent" });

    const response = await request(`/download/${user.id}/${job}/100%25.csv`, {
      cookies: { auth: user.token },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("percent");
  });
});

describe("POST /archive/:jobId/prepare", () => {
  test("prepares a stream-built archive and returns a native download URL", async () => {
    const sampleFiles: Record<string, string> = {
      "-leading name #.txt": "flag-like filenames are plain archive entries",
      "报告和 空格 #1.txt": "Unicode filename content",
    };
    const newlineName = "nested/子目录/带\n换行.txt";
    if (process.platform !== "win32") sampleFiles[newlineName] = "newline path content";
    const { user, job, dirs } = await userWithOutputs(sampleFiles);
    const before = await request(`/archive/${job}`, {
      method: "HEAD",
      cookies: { auth: user.token },
    });
    expect(before.status).toBe(409);

    const prepared = await request(`/archive/${job}/prepare`, {
      method: "POST",
      cookies: { auth: user.token },
    });
    expect(prepared.status).toBe(200);
    const body = await prepared.json();
    expect(body).toMatchObject({ url: `/archive/${job}`, name: `converted_files_${job}.tar` });
    expect(typeof body.size).toBe("number");

    const head = await request(body.url, { method: "HEAD", cookies: { auth: user.token } });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(body.size));
    expect(head.headers.get("content-disposition")).toContain('filename="converted_files_');
    expect(head.body).toBeNull();

    const response = await request(body.url, { cookies: { auth: user.token } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(body.size));
    const files = await tarFiles(response);
    const expectedNames = ["-leading name #.txt", "报告和 空格 #1.txt"];
    if (process.platform !== "win32") expectedNames.push(newlineName);
    expect([...files.keys()].sort()).toEqual(expectedNames.sort());
    if (process.platform !== "win32") {
      expect(Buffer.from(files.get(newlineName) ?? []).toString()).toBe("newline path content");
    }
    expect(readFileSync(path.join(dirs.output, "-leading name #.txt"), "utf8")).toContain(
      "flag-like",
    );
  });

  test("requires authentication and validates job ownership", async () => {
    const { user, job } = await userWithOutputs({ "a.csv": "a" });
    const unauthenticated = await request(`/archive/${job}/prepare`, { method: "POST" });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("location")).toBeNull();
    expect(await unauthenticated.json()).toEqual({
      success: false,
      message: "Unauthorized",
    });
    const other = await createUser();
    const forbidden = await request(`/archive/${job}/prepare`, {
      method: "POST",
      cookies: { auth: other.token },
    });
    expect(forbidden.status).toBe(404);
    expect(await forbidden.json()).toEqual({ message: "Job not found." });
    expect(user.id).not.toBe(other.id);
  });

  test("reuses a valid archive cache and rebuilds it after output content changes", async () => {
    const { user, job, dirs } = await userWithOutputs({ "result.txt": "first version" });
    const prepared1 = await request(`/archive/${job}/prepare`, {
      method: "POST",
      cookies: { auth: user.token },
    });
    const first = await prepared1.json();
    const cachedArchive = path.join(
      path.dirname(path.dirname(dirs.output)),
      ".archive-cache",
      `${createHash("sha256").update(`${user.id}/${job}`).digest("hex")}.tar`,
    );
    const firstStat = statSync(cachedArchive);
    const prepared2 = await request(`/archive/${job}/prepare`, {
      method: "POST",
      cookies: { auth: user.token },
    });
    expect(await prepared2.json()).toEqual(first);
    expect(statSync(cachedArchive).mtimeMs).toBe(firstStat.mtimeMs);

    const replacement = "a longer replacement version".repeat(40);
    writeFileSync(path.join(dirs.output, "result.txt"), replacement);
    const prepared3 = await request(`/archive/${job}/prepare`, {
      method: "POST",
      cookies: { auth: user.token },
    });
    expect(prepared3.status).toBe(200);
    const third = await prepared3.json();
    expect(third.size).not.toBe(first.size);
    const parsed = await tarFiles(
      await request(`/archive/${job}`, { cookies: { auth: user.token } }),
    );
    expect(Buffer.from(parsed.get("result.txt") ?? []).toString()).toBe(replacement);
  });

  test("rejects empty output and excludes symbolic links", async () => {
    const empty = await userWithOutputs({});
    const response = await request(`/archive/${empty.job}/prepare`, {
      method: "POST",
      cookies: { auth: empty.user.token },
    });
    expect(response.status).toBe(404);

    const unsafe = await userWithOutputs({ "safe.txt": "safe" });
    const outside = path.join(path.dirname(unsafe.dirs.output), "outside-secret.txt");
    writeFileSync(outside, "secret");
    try {
      symlinkSync(outside, path.join(unsafe.dirs.output, "link.txt"), "file");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES" || code === "ENOTSUP") return;
      throw error;
    }
    const rejected = await request(`/archive/${unsafe.job}/prepare`, {
      method: "POST",
      cookies: { auth: unsafe.user.token },
    });
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).message).toContain("Symbolic links");
  });
});

describe("streamed archive path validation", () => {
  test.each([
    "",
    "../secret",
    "nested/../../secret",
    "/absolute",
    "C:/drive",
    "nested\\\\escape",
    "a//b",
    "a/./b",
    "a/../b",
    "nul\\0name",
  ])("rejects unsafe relative paths: %s", (value) => {
    expect(() => validateArchiveRelativePath(value)).toThrow();
  });
});

describe("GET /archive/:jobId", () => {
  test("redirects to the login page without a session", async () => {
    const { job } = await userWithOutputs({ "a.csv": "a" });

    const response = await request(`/archive/${job}`, { headers: { accept: "text/html" } });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  test("packs all converted files of the job into a tar archive", async () => {
    const { user, job } = await userWithOutputs({ "a.csv": "a", "b.csv": "b" });

    const response = await request(`/archive/${job}`, { cookies: { auth: user.token } });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-tar");
    expect(await tarEntries(response)).toEqual(["a.csv", "b.csv"]);
  });

  test("preserves binary file contents", async () => {
    const { user, job } = await userWithOutputs({ "image.png": new Uint8Array([0, 1, 2, 255]) });

    const response = await request(`/archive/${job}`, { cookies: { auth: user.token } });
    const files = await tarFiles(response);
    expect(files.get("image.png")).toEqual(new Uint8Array([0, 1, 2, 255]));
  });

  test("does not include earlier archives in a new archive", async () => {
    const { user, job } = await userWithOutputs({ "a.csv": "a" });

    await request(`/archive/${job}`, { cookies: { auth: user.token } });
    const response = await request(`/archive/${job}`, { cookies: { auth: user.token } });

    expect(await tarEntries(response)).toEqual(["a.csv"]);
  });

  test("refuses another user's job", async () => {
    const user = await createUser();
    const other = await userWithOutputs({ "secret.csv": "secret" });

    const response = await request(`/archive/${other.job}`, { cookies: { auth: user.token } });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/results");
  });
});
