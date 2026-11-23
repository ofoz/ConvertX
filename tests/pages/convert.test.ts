import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { open, readFile, writeFile } from "node:fs/promises";

import { conversionQueue } from "../../src/helpers/conversionQueue";
import { resourceLimits } from "../../src/helpers/resourceLimits";
import { createJob, createUser, db, jobDirs, request, waitFor } from "./helpers/app";

type JobRow = { status: string; num_files: number };
type FileRow = { file_name: string; output_file_name: string; status: string };

function jobRow(jobId: number) {
  return db.query("SELECT status, num_files FROM jobs WHERE id = ?").get(jobId) as JobRow;
}

function fileRows(jobId: number) {
  return db
    .query(
      "SELECT file_name, output_file_name, status FROM file_names WHERE job_id = ? ORDER BY file_name",
    )
    .all(jobId) as FileRow[];
}

async function userWithJob() {
  const user = await createUser();
  const job = createJob(user.id);
  return { user, job, dirs: jobDirs(user.id, job) };
}

function convertRequest(
  cookies: { auth: string; jobId?: number },
  form: { convert_to: string; file_names: string },
  headers: Record<string, string> = {},
) {
  return request("/convert", { cookies, form, headers });
}

describe("POST /convert resource budgets", () => {
  const headers = { "X-ConvertX-UI": "hall", accept: "application/json" };
  const formFor = (names: string[]) => ({
    convert_to: "csv,vcf",
    file_names: JSON.stringify(names),
  });

  test("returns 413 for a batch above the file count limit", async () => {
    const { user, job } = await userWithJob();
    const form = formFor(
      Array.from({ length: resourceLimits.maxFilesPerJob + 1 }, (_, index) => `${index}.vcf`),
    );
    const response = await convertRequest({ auth: user.token, jobId: job }, form, headers);
    expect(response.status).toBe(413);
    expect(jobRow(job).status).toBe("not started");
    expect(conversionQueue.getJobQueueState(String(job))).toBeNull();
  });

  test("returns 413 for oversized input already stored on disk", async () => {
    const { user, job, dirs } = await userWithJob();
    mkdirSync(dirs.uploads, { recursive: true });
    const file = await open(`${dirs.uploads}oversize.vcf`, "w");
    try {
      await file.truncate(resourceLimits.maxFileBytes + 1);
      const response = await convertRequest(
        { auth: user.token, jobId: job },
        formFor(["oversize.vcf"]),
        headers,
      );
      expect(response.status).toBe(413);
      expect(jobRow(job).status).toBe("not started");
    } finally {
      await file.truncate(0);
      await file.close();
    }
  });

  test("rejects stored inputs above the combined job budget before claiming the job", async () => {
    const { user, job, dirs } = await userWithJob();
    mkdirSync(dirs.uploads, { recursive: true });
    await Promise.all([
      writeFile(`${dirs.uploads}a.vcf`, Buffer.alloc(512 * 1024)),
      writeFile(`${dirs.uploads}b.vcf`, Buffer.alloc(512 * 1024 + 1)),
    ]);

    const response = await convertRequest(
      { auth: user.token, jobId: job },
      formFor(["a.vcf", "b.vcf"]),
      headers,
    );
    expect(response.status).toBe(413);
    expect((await response.json()).message).toContain("文件总大小");
    expect(jobRow(job)).toEqual({ status: "not started", num_files: 0 });
    expect(fileRows(job)).toEqual([]);
    expect(conversionQueue.getJobQueueState(String(job))).toBeNull();
  });

  test("rejects a converter-wide target when the uploaded input format has no curated path", async () => {
    const { user, job, dirs } = await userWithJob();
    mkdirSync(dirs.uploads, { recursive: true });
    await writeFile(`${dirs.uploads}photo.png`, "placeholder");

    const response = await convertRequest(
      { auth: user.token, jobId: job },
      { convert_to: "pdf,pandoc", file_names: '["photo.png"]' },
      headers,
    );

    expect(response.status).toBe(400);
    expect(jobRow(job).status).toBe("not started");
    expect(fileRows(job)).toEqual([]);
    expect(conversionQueue.getJobQueueState(String(job))).toBeNull();
  });

  test("rejects unknown extensions before claiming a conversion job", async () => {
    const { user, job, dirs } = await userWithJob();
    mkdirSync(dirs.uploads, { recursive: true });
    await writeFile(`${dirs.uploads}payload.unknown`, "placeholder");

    const response = await convertRequest(
      { auth: user.token, jobId: job },
      { convert_to: "mp3,ffmpeg", file_names: '["payload.unknown"]' },
      headers,
    );

    expect(response.status).toBe(400);
    expect(jobRow(job).status).toBe("not started");
    expect(fileRows(job)).toEqual([]);
  });

  test("returns 429 without touching the job and accepts a retry after the queue drains", async () => {
    const { user, job, dirs } = await userWithJob();
    mkdirSync(dirs.uploads, { recursive: true });
    await writeFile(`${dirs.uploads}sample.vcf`, "BEGIN:VCARD\nFN:Retry\nEND:VCARD\n");
    const submit = () =>
      convertRequest({ auth: user.token, jobId: job }, formFor(["sample.vcf"]), headers);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = Array.from(
      { length: resourceLimits.conversionConcurrency + resourceLimits.maxQueuedFiles },
      () => () => gate,
    );
    const blocking = conversionQueue.trySubmitBatch("convert-route-test-fill", work);
    if (!blocking.accepted) throw new Error("Expected an empty queue before test");
    try {
      const response = await submit();
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("5");
      expect(jobRow(job).status).toBe("not started");
      expect(fileRows(job)).toEqual([]);
    } finally {
      release();
      await blocking.done;
    }
    expect((await submit()).status).toBe(202);
    await waitFor(() => jobRow(job).status === "completed");
    expect(fileRows(job)[0]?.status).toBe("Done");
  });

  test("serializes claiming a job with an in-flight replacement of its input", async () => {
    const { user, job, dirs } = await userWithJob();
    mkdirSync(dirs.uploads, { recursive: true });
    const card = (name: string) => `BEGIN:VCARD\nFN:${name}\nEND:VCARD\n`;
    await writeFile(`${dirs.uploads}race.vcf`, card("Old"));
    const form = new FormData();
    form.append("file", new File([card("New")], "race.vcf"));
    const cookies = { auth: user.token, jobId: job };
    const [uploaded, converted] = await Promise.all([
      request("/upload", { cookies, body: form }),
      convertRequest(cookies, formFor(["race.vcf"]), headers),
    ]);
    expect(converted.status).toBe(202);
    expect([200, 409]).toContain(uploaded.status);
    await waitFor(() => jobRow(job).status === "completed");
    expect(await readFile(`${dirs.output}race.csv`, "utf-8")).toBe(
      `Full Name\n"${uploaded.status === 200 ? "New" : "Old"}"`,
    );
    const lateUpload = new FormData();
    lateUpload.append("file", new File([card("Late")], "race.vcf"));
    expect((await request("/upload", { cookies, body: lateUpload })).status).toBe(409);
  });

  test("admits only one simultaneous submission and records success and failure", async () => {
    const { user, job, dirs } = await userWithJob();
    mkdirSync(dirs.uploads, { recursive: true });
    await writeFile(`${dirs.uploads}ok.vcf`, "BEGIN:VCARD\nFN:Test Contact\nEND:VCARD\n");
    const submit = () =>
      convertRequest({ auth: user.token, jobId: job }, formFor(["ok.vcf", "missing.vcf"]), headers);
    const responses = await Promise.all([submit(), submit()]);
    expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);
    await waitFor(() => jobRow(job).status === "completed");
    expect(fileRows(job).map(({ status }) => status)).toEqual(["Failed, check logs", "Done"]);
    expect((await submit()).status).toBe(409);
  });
});

describe("POST /convert", () => {
  test("requires a session", async () => {
    const response = await request("/convert", {
      headers: { accept: "application/json" },
      form: { convert_to: "csv,vcf", file_names: "[]" },
    });

    expect(response.status).toBe(401);
  });

  test("redirects home without a job", async () => {
    const { user } = await userWithJob();

    const response = await convertRequest(
      { auth: user.token },
      { convert_to: "csv,vcf", file_names: '["a.vcf"]' },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
  });

  test("refuses to convert another user's job", async () => {
    const { user } = await userWithJob();
    const other = await userWithJob();

    const response = await convertRequest(
      { auth: user.token, jobId: other.job },
      { convert_to: "csv,vcf", file_names: '["a.vcf"]' },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(jobRow(other.job).status).toBe("not started");
  });

  test.each([
    ["no converter is given", "csv"],
    ["the target contains a path separator", "a/b,vcf"],
    ["the target contains a backslash", "a\\b,vcf"],
    ["the target points to a parent directory", "..,vcf"],
  ])("redirects home without converting when %s", async (_, convertTo) => {
    const { user, job } = await userWithJob();

    const response = await convertRequest(
      { auth: user.token, jobId: job },
      { convert_to: convertTo, file_names: '["a.vcf"]' },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(jobRow(job).status).toBe("not started");
  });

  test("redirects home without converting when no files are given", async () => {
    const { user, job } = await userWithJob();

    const response = await convertRequest(
      { auth: user.token, jobId: job },
      { convert_to: "csv,vcf", file_names: "[]" },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(jobRow(job).status).toBe("not started");
  });

  test("honors an owner-checked hall job header and returns 202 JSON", async () => {
    const { user, job, dirs } = await userWithJob();
    mkdirSync(dirs.uploads, { recursive: true });
    await writeFile(`${dirs.uploads}hall.vcf`, "BEGIN:VCARD\nFN:Hall\nEND:VCARD\n");
    const other = await userWithJob();

    const response = await convertRequest(
      { auth: user.token, jobId: other.job },
      { convert_to: "csv,vcf", file_names: '["hall.vcf"]' },
      { "X-ConvertX-UI": "hall", "X-ConvertX-Job": String(job), accept: "application/json" },
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ jobId: String(job), url: `/results/${job}` });
    expect(jobRow(other.job).status).toBe("not started");
    await waitFor(() => jobRow(job).status === "completed");
  });

  test("rejects a foreign job header with JSON and leaves its job unchanged", async () => {
    const { user, job: ownedJob } = await userWithJob();
    const other = await userWithJob();

    const response = await convertRequest(
      { auth: user.token, jobId: ownedJob },
      { convert_to: "csv,vcf", file_names: '["hall.vcf"]' },
      { "X-ConvertX-UI": "hall", "X-ConvertX-Job": String(other.job), accept: "application/json" },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Job not found." });
    expect(jobRow(other.job).status).toBe("not started");
  });

  test("converts the uploaded files in the background and shows the results", async () => {
    const { user, job, dirs } = await userWithJob();
    mkdirSync(dirs.uploads, { recursive: true });
    await writeFile(`${dirs.uploads}a.vcf`, "BEGIN:VCARD\nFN:Alice\nEND:VCARD\n");
    await writeFile(`${dirs.uploads}b.vcf`, "BEGIN:VCARD\nFN:Bob\nEND:VCARD\n");

    const response = await convertRequest(
      { auth: user.token, jobId: job },
      { convert_to: "csv,vcf", file_names: '["a.vcf","b.vcf"]' },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`/results/${job}`);
    expect(jobRow(job).num_files).toBe(2);

    await waitFor(() => jobRow(job).status === "completed");
    expect(fileRows(job)).toEqual([
      { file_name: "a.vcf", output_file_name: "a.csv", status: "Done" },
      { file_name: "b.vcf", output_file_name: "b.csv", status: "Done" },
    ]);
    expect(await readFile(`${dirs.output}a.csv`, "utf-8")).toBe('Full Name\n"Alice"');
  });

  test("normalizes the target type before converting", async () => {
    const { user, job } = await userWithJob();

    await convertRequest(
      { auth: user.token, jobId: job },
      { convert_to: "JPG,vips", file_names: '["photo.png"]' },
    );

    await waitFor(() => jobRow(job).status === "completed");
    // jpg is normalized to jpeg, whose files get the .jpg extension
    expect(fileRows(job)).toEqual([
      { file_name: "photo.png", output_file_name: "photo.jpg", status: "Failed, check logs" },
    ]);
  });

  test("sanitizes file names so conversions cannot read outside the job directory", async () => {
    const { user, job } = await userWithJob();

    await convertRequest(
      { auth: user.token, jobId: job },
      { convert_to: "csv,vcf", file_names: '["../../secret.vcf"]' },
    );

    await waitFor(() => jobRow(job).status === "completed");
    expect(fileRows(job)).toEqual([
      {
        file_name: "....secret.vcf",
        output_file_name: "....secret.csv",
        status: "Failed, check logs",
      },
    ]);
  });

  test.each([
    ["is not JSON", "not json"],
    ["is a JSON string", '"a.vcf"'],
  ])("redirects home when file_names %s", async (_, fileNames) => {
    const { user, job } = await userWithJob();

    const response = await convertRequest(
      { auth: user.token, jobId: job },
      { convert_to: "csv,vcf", file_names: fileNames },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
  });
});
