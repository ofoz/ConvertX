import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { createJob, createUser, jobDirs, request } from "./helpers/app";

function uploadForm(...files: File[]) {
  const form = new FormData();
  for (const file of files) {
    form.append("file", file);
  }
  return form;
}

describe("POST /upload", () => {
  test("requires a session", async () => {
    const response = await request("/upload", {
      method: "POST",
      headers: { accept: "application/json" },
      body: uploadForm(new File(["x"], "a.txt")),
    });

    expect(response.status).toBe(401);
  });

  test("redirects home without a job", async () => {
    const user = await createUser();

    const response = await request("/upload", {
      method: "POST",
      cookies: { auth: user.token },
      body: uploadForm(new File(["x"], "a.txt")),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
  });

  test("refuses to upload into another user's job", async () => {
    const user = await createUser();
    const other = await createUser();
    const otherJob = createJob(other.id);

    const response = await request("/upload", {
      method: "POST",
      cookies: { auth: user.token, jobId: otherJob },
      body: uploadForm(new File(["x"], "a.txt")),
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(existsSync(jobDirs(other.id, otherJob).uploads)).toBe(false);
    expect(existsSync(jobDirs(user.id, otherJob).uploads)).toBe(false);
  });

  test("uses an owner-checked job header instead of a stale cookie", async () => {
    const user = await createUser();
    const selected = createJob(user.id);
    const stale = createJob(user.id);

    const response = await request("/upload", {
      method: "POST",
      cookies: { auth: user.token, jobId: stale },
      headers: { "X-ConvertX-UI": "hall", "X-ConvertX-Job": String(selected) },
      body: uploadForm(new File(["selected"], "selected.txt")),
    });

    expect(response.status).toBe(200);
    expect(await readFile(`${jobDirs(user.id, selected).uploads}selected.txt`, "utf-8")).toBe(
      "selected",
    );
    expect(existsSync(`${jobDirs(user.id, stale).uploads}selected.txt`)).toBe(false);
  });

  test("rejects a foreign job header", async () => {
    const user = await createUser();
    const ownedJob = createJob(user.id);
    const other = await createUser();
    const otherJob = createJob(other.id);
    const response = await request("/upload", {
      method: "POST",
      cookies: { auth: user.token, jobId: ownedJob },
      headers: { "X-ConvertX-UI": "hall", "X-ConvertX-Job": String(otherJob) },
      body: uploadForm(new File(["x"], "a.txt")),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Job not found." });
    expect(existsSync(jobDirs(other.id, otherJob).uploads)).toBe(false);
    expect(existsSync(`${jobDirs(user.id, ownedJob).uploads}a.txt`)).toBe(false);
  });

  test("stores a single file in the job's upload directory", async () => {
    const user = await createUser();
    const job = createJob(user.id);

    const response = await request("/upload", {
      method: "POST",
      cookies: { auth: user.token, jobId: job },
      body: uploadForm(new File(["hello world"], "notes.txt")),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Files uploaded successfully." });
    expect(await readFile(`${jobDirs(user.id, job).uploads}notes.txt`, "utf-8")).toBe(
      "hello world",
    );
  });

  test("stores multiple files at once", async () => {
    const user = await createUser();
    const job = createJob(user.id);

    await request("/upload", {
      method: "POST",
      cookies: { auth: user.token, jobId: job },
      body: uploadForm(new File(["1"], "one.txt"), new File(["2"], "two.txt")),
    });

    expect(readdirSync(jobDirs(user.id, job).uploads).sort()).toEqual(["one.txt", "two.txt"]);
  });

  test("sanitizes file names so uploads cannot escape the job directory", async () => {
    const user = await createUser();
    const job = createJob(user.id);
    const { uploads } = jobDirs(user.id, job);

    await request("/upload", {
      method: "POST",
      cookies: { auth: user.token, jobId: job },
      body: uploadForm(new File(["evil"], "../../../evil.txt")),
    });

    expect(readdirSync(uploads)).toEqual(["......evil.txt"]);
    expect(existsSync(resolve(uploads, "../../../evil.txt"))).toBe(false);
  });

  test("admits the exact total across requests and preserves existing files on an over-budget retry", async () => {
    const user = await createUser();
    const job = createJob(user.id);
    const { uploads } = jobDirs(user.id, job);
    const submit = (...files: File[]) =>
      request("/upload", {
        cookies: { auth: user.token, jobId: job },
        body: uploadForm(...files),
      });
    const half = 512 * 1024;
    const first = new File([new Uint8Array(half).fill(1)], "first.txt");
    const second = new File([new Uint8Array(half)], "second.txt");

    expect((await submit(first)).status).toBe(200);
    expect((await submit(second)).status).toBe(200);
    expect((await submit(first)).status).toBe(200);
    const larger = new File([new Uint8Array(half + 1)], "first.txt");
    expect((await submit(larger)).status).toBe(413);
    expect(await readFile(`${uploads}first.txt`)).toEqual(Buffer.alloc(half, 1));
    expect(readdirSync(uploads).sort()).toEqual(["first.txt", "second.txt"]);

    expect((await submit(new File(["x"], "third.txt"), new File([""], "first.txt"))).status).toBe(
      200,
    );
    expect((await stat(`${uploads}first.txt`)).size).toBe(0);
    expect(await readFile(`${uploads}third.txt`, "utf8")).toBe("x");

    const removed = await request("/delete", {
      cookies: { auth: user.token, jobId: job },
      json: { filename: "second.txt" },
    });
    expect(removed.status).toBe(200);
    expect((await submit(larger)).status).toBe(200);
    expect((await stat(`${uploads}first.txt`)).size).toBe(half + 1);
  });

  test("rejects the whole request when its combined size exceeds the job budget", async () => {
    const user = await createUser();
    const job = createJob(user.id);
    const half = 512 * 1024;
    const response = await request("/upload", {
      cookies: { auth: user.token, jobId: job },
      body: uploadForm(
        new File([new Uint8Array(half)], "a.txt"),
        new File([new Uint8Array(half + 1)], "b.txt"),
      ),
    });

    expect(response.status).toBe(413);
    expect(existsSync(jobDirs(user.id, job).uploads)).toBe(false);
  });

  test("admits only one of two simultaneous uploads that would exceed the job budget together", async () => {
    const user = await createUser();
    const job = createJob(user.id);
    const submit = (name: string) =>
      request("/upload", {
        cookies: { auth: user.token, jobId: job },
        body: uploadForm(new File([new Uint8Array(512 * 1024 + 1)], name)),
      });

    const responses = await Promise.all([submit("a.txt"), submit("b.txt")]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 413]);
    expect(readdirSync(jobDirs(user.id, job).uploads)).toHaveLength(1);
  });

  test("rejects a request without files", async () => {
    const user = await createUser();
    const job = createJob(user.id);

    const response = await request("/upload", {
      method: "POST",
      cookies: { auth: user.token, jobId: job },
      body: new FormData(),
    });

    expect(response.status).toBe(422);
  });
});
