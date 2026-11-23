import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { createJob, createUser, db, jobDirs, request, uploadsDir } from "./helpers/app";

async function userWithUploads(...fileNames: string[]) {
  const user = await createUser();
  const job = createJob(user.id);
  const dirs = jobDirs(user.id, job);
  mkdirSync(dirs.uploads, { recursive: true });
  for (const fileName of fileNames) {
    writeFileSync(`${dirs.uploads}${fileName}`, fileName);
  }
  return { user, job, dirs };
}

describe("POST /delete", () => {
  test("requires a session", async () => {
    const response = await request("/delete", {
      headers: { accept: "application/json" },
      json: { filename: "a.txt" },
    });

    expect(response.status).toBe(401);
  });

  test("redirects home without a job", async () => {
    const { user, dirs } = await userWithUploads("a.txt");

    const response = await request("/delete", {
      cookies: { auth: user.token },
      json: { filename: "a.txt" },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(existsSync(`${dirs.uploads}a.txt`)).toBe(true);
  });

  test("refuses to delete from another user's job", async () => {
    const { user } = await userWithUploads();
    const other = await userWithUploads("a.txt");

    const response = await request("/delete", {
      cookies: { auth: user.token, jobId: other.job },
      json: { filename: "a.txt" },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(existsSync(`${other.dirs.uploads}a.txt`)).toBe(true);
  });

  test("uses an owner-checked job header instead of a stale cookie", async () => {
    const { user, job, dirs } = await userWithUploads("selected.txt");
    const stale = createJob(user.id);

    const response = await request("/delete", {
      cookies: { auth: user.token, jobId: stale },
      headers: { "X-ConvertX-UI": "hall", "X-ConvertX-Job": String(job) },
      json: { filename: "selected.txt" },
    });

    expect(response.status).toBe(200);
    expect(existsSync(`${dirs.uploads}selected.txt`)).toBe(false);
  });

  test("rejects a foreign job header", async () => {
    const { user, job: ownedJob } = await userWithUploads();
    const other = await userWithUploads("keep.txt");
    const response = await request("/delete", {
      cookies: { auth: user.token, jobId: ownedJob },
      headers: { "X-ConvertX-UI": "hall", "X-ConvertX-Job": String(other.job) },
      json: { filename: "keep.txt" },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Job not found." });
    expect(existsSync(`${other.dirs.uploads}keep.txt`)).toBe(true);
  });

  test("deletes only the given uploaded file", async () => {
    const { user, job, dirs } = await userWithUploads("a.txt", "b.txt");

    const response = await request("/delete", {
      cookies: { auth: user.token, jobId: job },
      json: { filename: "a.txt" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "File deleted successfully." });
    expect(existsSync(`${dirs.uploads}a.txt`)).toBe(false);
    expect(existsSync(`${dirs.uploads}b.txt`)).toBe(true);
  });

  test.each(["pending", "completed"])("keeps uploaded files once the job is %s", async (status) => {
    const { user, job, dirs } = await userWithUploads("a.txt");
    db.query("UPDATE jobs SET status = ? WHERE id = ?").run(status, job);

    const response = await request("/delete", {
      cookies: { auth: user.token, jobId: job },
      json: { filename: "a.txt" },
    });

    expect(response.status).toBe(409);
    expect(existsSync(`${dirs.uploads}a.txt`)).toBe(true);
  });

  test("sanitizes the file name so files outside the job cannot be deleted", async () => {
    const { user, job } = await userWithUploads();
    const other = await userWithUploads("keep.txt");

    const response = await request("/delete", {
      cookies: { auth: user.token, jobId: job },
      json: { filename: `../../${other.user.id}/${other.job}/keep.txt` },
    });

    // the request passed the session and job checks, so the file name was really used;
    // the sanitized name does not exist, which runs into the bug tracked below
    expect(response.status).not.toBeOneOf([302, 401]);
    expect(existsSync(`${other.dirs.uploads}keep.txt`)).toBe(true);
  });

  test.each(["missing.txt", "../../1/1/keep.txt"])(
    "answers a missing file (%s) without a server error or server paths",
    async (filename) => {
      const { user, job } = await userWithUploads();

      const response = await request("/delete", {
        cookies: { auth: user.token, jobId: job },
        json: { filename },
      });

      expect(response.status).toBeLessThan(500);
      expect(await response.text()).not.toContain(uploadsDir);
    },
  );
});
