import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { recoverInterruptedJobs } from "../../src/helpers/recoverInterruptedJobs";
import { readResourceLimits } from "../../src/helpers/resourceLimits";
import { checkUploadBudget, withUploadLock } from "../../src/helpers/uploadBudget";

describe("resource configuration", () => {
  test("uses bounded single-process defaults", () => {
    const limits = readResourceLimits({});
    expect(limits.conversionConcurrency).toBe(2);
    expect(limits.maxQueuedFiles).toBe(64);
    expect(limits.maxFilesPerJob).toBe(20);
    expect(limits.maxFileBytes).toBe(256 * 1024 * 1024);
    expect(limits.maxJobUploadBytes).toBe(1024 * 1024 * 1024);
    expect(limits.maxJobOutputBytes).toBe(1024 * 1024 * 1024);
    expect(limits.maxRequestBytes).toBeGreaterThan(limits.maxFileBytes);
    expect(limits.conversionTimeoutMs).toBe(600000);
    expect(limits.maxPdfPages).toBe(200);
    expect(limits.historyPageSize).toBe(20);
  });
  test("rejects unbounded, negative and malformed settings", () => {
    for (const value of [
      "0",
      "-1",
      "NaN",
      "Infinity",
      "2.2",
      "2workers",
      "999999999999999999999",
    ]) {
      expect(readResourceLimits({ GLOBAL_CONVERT_CONCURRENCY: value }).conversionConcurrency).toBe(
        2,
      );
    }
    expect(readResourceLimits({ HISTORY_PAGE_SIZE: "101" }).historyPageSize).toBe(20);
    expect(
      readResourceLimits({
        FFMPEG_THREADS: "4",
        MAX_FILE_SIZE_MB: "64",
        MAX_FILES_PER_JOB: "5",
        MAX_JOB_UPLOAD_SIZE_MB: "32",
        MAX_JOB_OUTPUT_SIZE_MB: "128",
      }),
    ).toMatchObject({
      ffmpegThreads: 4,
      maxFileBytes: 64 * 1024 * 1024,
      maxFilesPerJob: 5,
      maxJobUploadBytes: 32 * 1024 * 1024,
      maxJobOutputBytes: 128 * 1024 * 1024,
    });
    expect(
      readResourceLimits({ MAX_JOB_UPLOAD_SIZE_MB: "0", MAX_JOB_OUTPUT_SIZE_MB: "1.5" }),
    ).toMatchObject({
      maxJobUploadBytes: 1024 * 1024 * 1024,
      maxJobOutputBytes: 1024 * 1024 * 1024,
    });
  });
});

describe("upload admission", () => {
  const limits = { maxFileBytes: 10, maxFilesPerJob: 2, maxJobUploadBytes: 12 };
  test("rejects excessive bytes or cumulative file count before writing", () => {
    const existing = [
      { name: "one.txt", size: 5 },
      { name: "two.txt", size: 6 },
    ];
    expect(() => checkUploadBudget([{ name: "large.txt", size: 11 }], [], limits)).toThrow(
      "单个文件",
    );
    expect(() => checkUploadBudget([{ name: "third.txt", size: 1 }], existing, limits)).toThrow(
      "每单最多",
    );
    expect(
      checkUploadBudget([{ name: "one.txt", size: 6 }], existing, limits).map(({ name }) => name),
    ).toEqual(["one.txt"]);
    expect(() => checkUploadBudget([{ name: "one.txt", size: 7 }], existing, limits)).toThrow(
      "文件总大小",
    );
    expect(() =>
      checkUploadBudget(
        [
          { name: "a?.txt", size: 1 },
          { name: "a*.txt", size: 1 },
        ],
        [],
        limits,
      ),
    ).toThrow("重名");
  });
  test("plans shrinking replacements before writes that consume their freed space", () => {
    const files = [
      { name: "two.txt", size: 8 },
      { name: "one.txt", size: 4 },
    ];
    const existing = [{ name: "one.txt", size: 10 }];
    expect(checkUploadBudget(files, existing, limits).map(({ name }) => name)).toEqual([
      "one.txt",
      "two.txt",
    ]);
  });
  test("serializes count and write steps without blocking a different order", async () => {
    const names: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withUploadLock("upload-budget-test", async () => {
      await held;
      names.push("one");
    });
    const second = withUploadLock("upload-budget-test", async () => {
      expect(names).toEqual(["one"]);
      names.push("two");
    });
    await withUploadLock("another-order", async () => {
      expect(names).toEqual([]);
    });
    release();
    await Promise.all([first, second]);
    expect(names).toEqual(["one", "two"]);
    await expect(
      withUploadLock("upload-budget-test", async () => {
        throw new Error("disk failure");
      }),
    ).rejects.toThrow("disk failure");
    await withUploadLock("upload-budget-test", async () => {
      names.push("after-error");
    });
    expect(names.at(-1)).toBe("after-error");
  });
});

test("a restart finalizes interrupted work without inventing successful output", () => {
  const db = new Database(":memory:");
  try {
    db.exec(
      "CREATE TABLE jobs(id INTEGER PRIMARY KEY,status TEXT,num_files INTEGER); CREATE TABLE file_names(id INTEGER PRIMARY KEY,job_id INTEGER,file_name TEXT,output_file_name TEXT,status TEXT)",
    );
    db.query("INSERT INTO jobs VALUES (1,'pending',3),(2,'completed',1),(3,'not started',0)").run();
    db.query(
      "INSERT INTO file_names(job_id,file_name,output_file_name,status) VALUES (1,'source.pdf','source-1.png','Done'),(1,'source.pdf','source-2.png','Done')",
    ).run();
    expect(recoverInterruptedJobs(db)).toBe(1);
    expect(db.query("SELECT status FROM jobs WHERE id=1").get()).toEqual({ status: "completed" });
    expect(db.query("SELECT COUNT(*) AS count FROM file_names WHERE status='Done'").get()).toEqual({
      count: 2,
    });
    expect(
      db.query("SELECT COUNT(*) AS count FROM file_names WHERE status='Failed, check logs'").get(),
    ).toEqual({ count: 2 });
    expect(db.query("SELECT status FROM jobs WHERE id=3").get()).toEqual({ status: "not started" });
    expect(recoverInterruptedJobs(db)).toBe(0);
  } finally {
    db.close();
  }
});
