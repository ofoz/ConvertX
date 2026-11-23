import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";

import {
  app,
  createJob,
  createUser,
  db,
  jobDirs,
  request,
  resetEnv,
  setCookie,
  setEnv,
} from "./helpers/app";

afterEach(() => resetEnv());

describe("POST /api/jobs", () => {
  test("requires an authenticated session", async () => {
    const response = await request("/api/jobs", {
      method: "POST",
      headers: { accept: "application/json" },
    });
    expect(response.status).toBe(401);
  });

  test("creates an owner job and sets the root-compatible HttpOnly cookie", async () => {
    const user = await createUser();
    const response = await request("/api/jobs", { method: "POST", cookies: { auth: user.token } });

    expect(response.status).toBe(201);
    const { jobId } = (await response.json()) as { jobId: string };
    expect(Number(jobId)).toBeGreaterThan(0);
    expect(db.query("SELECT user_id, status FROM jobs WHERE id = ?").get(jobId)).toEqual({
      user_id: user.id,
      status: "not started",
    });
    expect(setCookie(response, "jobId")).toContain("HttpOnly");
    expect(setCookie(response, "jobId")).toContain("Secure");
    expect(setCookie(response, "jobId")).toContain("SameSite=Strict");
  });

  test("omits Secure when HTTP is explicitly allowed", async () => {
    setEnv({ HTTP_ALLOWED: true });
    const user = await createUser();
    const response = await request("/api/jobs", { method: "POST", cookies: { auth: user.token } });
    expect(response.status).toBe(201);
    expect(setCookie(response, "jobId")).not.toContain("Secure");
  });
});

describe("GET /api/jobs/:jobId", () => {
  test("requires authentication and conceals jobs owned by another user", async () => {
    const owner = await createUser();
    const other = await createUser();
    const job = createJob(owner.id, { numFiles: 1 });

    expect((await request(`/api/jobs/${job}`)).status).toBe(401);
    const response = await request(`/api/jobs/${job}`, { cookies: { auth: other.token } });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Job not found." });
  });

  test("counts unique completed inputs and exposes only existing successful outputs", async () => {
    setEnv({ WEBROOT: "/convertx" });
    const user = await createUser();
    const job = createJob(user.id, {
      numFiles: 3,
      status: "completed",
      files: [
        { file_name: "book.pdf", output_file_name: "page-1.png", status: "Done" },
        { file_name: "book.pdf", output_file_name: "page-2.png", status: "Done" },
        { file_name: "broken.pdf", output_file_name: "broken.png", status: "Failed, check logs" },
        { file_name: "missing.pdf", output_file_name: "missing.png", status: "Done" },
      ],
    });
    const output = jobDirs(user.id, job).output;
    mkdirSync(output, { recursive: true });
    writeFileSync(`${output}page-1.png`, "one");
    writeFileSync(`${output}page-2.png`, "two");

    const response = await request(`/api/jobs/${job}`, { cookies: { auth: user.token } });
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      jobId: string;
      status: string;
      totalFiles: number;
      completedInputs: number;
      files: Array<{ name: string; inputName: string; status: string; downloadUrl: string | null }>;
      archiveUrl: string | null;
    };
    expect(data).toMatchObject({
      jobId: String(job),
      status: "completed",
      totalFiles: 3,
      completedInputs: 3,
      archiveUrl: null,
    });
    expect(data.files).toEqual([
      {
        id: expect.any(Number),
        name: "page-1.png",
        inputName: "book.pdf",
        status: "Done",
        downloadUrl: `/convertx/download/${user.id}/${job}/page-1.png`,
      },
      {
        id: expect.any(Number),
        name: "page-2.png",
        inputName: "book.pdf",
        status: "Done",
        downloadUrl: `/convertx/download/${user.id}/${job}/page-2.png`,
      },
      {
        id: expect.any(Number),
        name: "broken.png",
        inputName: "broken.pdf",
        status: "Failed, check logs",
        downloadUrl: null,
      },
      {
        id: expect.any(Number),
        name: "missing.png",
        inputName: "missing.pdf",
        status: "Done",
        downloadUrl: null,
      },
    ]);
    expect(JSON.stringify(data)).not.toContain(output);
  });

  test("returns a private ETag and 304 only after owner authorization", async () => {
    const owner = await createUser();
    const other = await createUser();
    const job = createJob(owner.id, { numFiles: 1, status: "pending" });
    const initial = await request(`/api/jobs/${job}`, { cookies: { auth: owner.token } });
    const etag = initial.headers.get("etag");
    expect(initial.status).toBe(200);
    expect(etag).toBeTruthy();
    expect(initial.headers.get("cache-control")).toBe("private, no-cache");
    const notModified = await request(`/api/jobs/${job}`, {
      cookies: { auth: owner.token },
      headers: { "if-none-match": etag! },
    });
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
    expect(notModified.headers.get("etag")).toBe(etag);
    const unauthenticated = await request(`/api/jobs/${job}`, {
      headers: { "if-none-match": etag! },
    });
    expect(unauthenticated.status).toBe(401);
    const foreign = await request(`/api/jobs/${job}`, {
      cookies: { auth: other.token },
      headers: { "if-none-match": etag! },
    });
    expect(foreign.status).toBe(404);
  });

  test("invalidates the ETag when output availability changes", async () => {
    const user = await createUser();
    const job = createJob(user.id, {
      numFiles: 1,
      status: "completed",
      files: [{ file_name: "image.svg", output_file_name: "image.png", status: "Done" }],
    });
    const first = await request(`/api/jobs/${job}`, { cookies: { auth: user.token } });
    const firstTag = first.headers.get("etag");
    expect(((await first.json()) as { files: Array<{ downloadUrl: string | null }> }).files[0]?.downloadUrl).toBeNull();
    const output = jobDirs(user.id, job).output;
    mkdirSync(output, { recursive: true });
    writeFileSync(`${output}image.png`, "png");
    const second = await request(`/api/jobs/${job}`, {
      cookies: { auth: user.token },
      headers: { "if-none-match": firstTag! },
    });
    expect(second.status).toBe(200);
    expect(second.headers.get("etag")).not.toBe(firstTag);
    expect(((await second.json()) as { files: Array<{ downloadUrl: string | null }> }).files[0]?.downloadUrl).toContain("image.png");
  });

  test("reports a pending task before any files complete", async () => {
    const user = await createUser();
    const job = createJob(user.id, { numFiles: 2, status: "pending" });
    const response = await request(`/api/jobs/${job}`, { cookies: { auth: user.token } });
    const data = (await response.json()) as {
      status: string;
      totalFiles: number;
      completedInputs: number;
      files: unknown[];
      archiveUrl: string | null;
    };
    expect(data).toEqual({
      jobId: String(job),
      status: "pending",
      totalFiles: 2,
      completedInputs: 0,
      files: [],
      archiveUrl: null,
      queue: null,
    });
  });

  test("offers an archive only for a fully successful task with real outputs", async () => {
    setEnv({ WEBROOT: "/convertx" });
    const user = await createUser();
    const job = createJob(user.id, {
      numFiles: 1,
      status: "completed",
      files: [{ file_name: "notes.txt", output_file_name: "notes.pdf", status: "Done" }],
    });
    const output = jobDirs(user.id, job).output;
    mkdirSync(output, { recursive: true });
    writeFileSync(`${output}notes.pdf`, "pdf");

    const response = await request(`/api/jobs/${job}`, { cookies: { auth: user.token } });
    expect(response.status).toBe(200);
    const data = (await response.json()) as { archiveUrl: string | null };
    expect(data.archiveUrl).toBe(`/convertx/archive/${job}`);
  });

  test("returns null download and archive links while outputs are missing", async () => {
    const user = await createUser();
    const job = createJob(user.id, {
      numFiles: 1,
      status: "completed",
      files: [{ file_name: "no-file.vcf", output_file_name: "no-file.csv", status: "Done" }],
    });
    const response = await request(`/api/jobs/${job}`, { cookies: { auth: user.token } });
    const data = (await response.json()) as {
      completedInputs: number;
      files: Array<{ downloadUrl: unknown }>;
      archiveUrl: string | null;
    };
    expect(data.completedInputs).toBe(1);
    expect(data.files[0]?.downloadUrl).toBeNull();
    expect(data.archiveUrl).toBeNull();
  });
});

describe("job API account lifecycle", () => {
  test("rejects revoked accounts even when their JWT signature is valid", async () => {
    const user = await createUser();
    const job = createJob(user.id);
    db.query("DELETE FROM users WHERE id = ?").run(user.id);
    const response = await request("/api/jobs", { method: "POST", cookies: { auth: user.token } });
    expect(response.status).toBe(401);
    expect(setCookie(response, "auth")).toContain("Max-Age=0");
    expect(db.query("SELECT COUNT(*) AS count FROM jobs WHERE user_id = ?").get(user.id)).toEqual({
      count: 1,
    });
    const inspection = await request(`/api/jobs/${job}`, { cookies: { auth: user.token } });
    expect(inspection.status).toBe(401);
    expect(await inspection.json()).toEqual({ message: "Unauthorized" });
  });

  test.each([0, 2 ** 24 + 1])(
    "allows anonymous ID %s only while anonymous mode is enabled",
    async (id) => {
      const token = await app.decorator.jwt.sign({ id: String(id) });
      const denied = await request("/api/jobs", { method: "POST", cookies: { auth: token } });
      expect(denied.status).toBe(401);
      setEnv({ ALLOW_UNAUTHENTICATED: true });
      const created = await request("/api/jobs", { method: "POST", cookies: { auth: token } });
      expect(created.status).toBe(201);
      const { jobId } = (await created.json()) as { jobId: string };
      expect((await request(`/api/jobs/${jobId}`, { cookies: { auth: token } })).status).toBe(200);
      setEnv({ ALLOW_UNAUTHENTICATED: false });
      expect((await request(`/api/jobs/${jobId}`, { cookies: { auth: token } })).status).toBe(401);
    },
  );
});
