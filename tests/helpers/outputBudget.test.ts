import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createOutputPublisher } from "../../src/helpers/outputBudget";

const root = await mkdtemp(path.join(tmpdir(), "convertx-output-budget-"));
let sequence = 0;
let output: string;
let work: string;
beforeEach(async () => {
  const current = path.join(root, String(sequence++));
  output = path.join(current, "output");
  work = path.join(current, "work");
  await mkdir(output, { recursive: true });
  await mkdir(work);
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
const active = () => true;

describe("retained output admission", () => {
  test("includes sidecars and admits the exact cumulative byte boundary", async () => {
    await writeFile(path.join(output, "existing.csv"), "12");
    await writeFile(path.join(work, "doc.csv"), "123");
    await mkdir(path.join(work, "assets"));
    await writeFile(path.join(work, "assets", "image.bin"), "45678");
    const committed: string[][] = [];
    await createOutputPublisher(output, 10)(work, "doc.csv", active, (names) => {
      committed.push(names);
    });
    expect(committed).toEqual([["doc.csv"]]);
    expect(await readFile(path.join(output, "assets", "image.bin"), "utf8")).toBe("45678");
  });

  test("rejects excess auxiliary bytes before exposing any output", async () => {
    await writeFile(path.join(work, "doc.csv"), "1");
    await mkdir(path.join(work, "assets"));
    await writeFile(path.join(work, "assets", "image.bin"), "2345");
    let committed = false;
    await expect(
      createOutputPublisher(output, 4)(work, "doc.csv", active, () => {
        committed = true;
      }),
    ).rejects.toThrow("Job output exceeds");
    expect(committed).toBe(false);
    expect(await readdir(output)).toEqual([]);
    expect(await readFile(path.join(work, "doc.csv"), "utf8")).toBe("1");
  });

  test("serializes concurrent completions and preserves the accepted result", async () => {
    const otherWork = path.join(path.dirname(work), "other-work");
    await mkdir(otherWork);
    await writeFile(path.join(work, "first.csv"), "123456");
    await writeFile(path.join(otherWork, "second.csv"), "abcdef");
    const publish = createOutputPublisher(output, 10);
    const committed: string[][] = [];
    const results = await Promise.allSettled([
      publish(work, "first.csv", active, (names) => {
        committed.push(names);
      }),
      publish(otherWork, "second.csv", active, (names) => {
        committed.push(names);
      }),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(committed).toEqual([["first.csv"]]);
    expect(await readdir(output)).toEqual(["first.csv"]);
  });

  test("recognizes only owned primary and numbered outputs in numeric order", async () => {
    for (const name of ["doc-10.csv", "doc-2.csv", "doc-1.csv", "doc-a.csv", "other.csv"])
      await writeFile(path.join(work, name), "");
    await writeFile(path.join(output, "doc-3.csv"), "old");
    const names = await createOutputPublisher(output, 100)(work, "doc.csv", active, () => {});
    expect(names).toEqual(["doc-1.csv", "doc-2.csv", "doc-10.csv"]);
    expect(names).not.toContain("doc-3.csv");
  });

  test("rejects success without a primary or numbered output", async () => {
    await writeFile(path.join(work, "other.csv"), "data");
    await expect(
      createOutputPublisher(output, 100)(work, "doc.csv", active, () => {}),
    ).rejects.toThrow("did not produce an output");
    expect(await readdir(output)).toEqual([]);
  });

  test("rejects filename conflicts without replacing an earlier result", async () => {
    await writeFile(path.join(output, "doc.csv"), "original");
    await writeFile(path.join(work, "doc.csv"), "replacement");
    await expect(
      createOutputPublisher(output, 100)(work, "doc.csv", active, () => {}),
    ).rejects.toThrow("already exists");
    expect(await readFile(path.join(output, "doc.csv"), "utf8")).toBe("original");
  });

  test("rolls back its own files if recording fails and releases admission", async () => {
    await writeFile(path.join(output, "prior.csv"), "keep");
    await writeFile(path.join(work, "doc.csv"), "12345");
    const publish = createOutputPublisher(output, 10);
    await expect(
      publish(work, "doc.csv", active, () => {
        throw new Error("DB failure");
      }),
    ).rejects.toThrow("DB failure");
    expect(await readdir(output)).toEqual(["prior.csv"]);
    await writeFile(path.join(work, "doc.csv"), "123456");
    await expect(publish(work, "doc.csv", active, () => {})).resolves.toEqual(["doc.csv"]);
  });

  test("does not publish output for a removed or cancelled job", async () => {
    await writeFile(path.join(work, "doc.csv"), "data");
    let committed = false;
    await expect(
      createOutputPublisher(output, 100)(
        work,
        "doc.csv",
        () => false,
        () => {
          committed = true;
        },
      ),
    ).rejects.toThrow("no longer active");
    expect(committed).toBe(false);
    expect(await readdir(output)).toEqual([]);
  });

  test("rolls back a partial publication if the job disappears between moves", async () => {
    await writeFile(path.join(output, "prior.csv"), "keep");
    await writeFile(path.join(work, "doc-1.csv"), "one");
    await writeFile(path.join(work, "doc-2.csv"), "two");
    let calls = 0;
    await expect(
      createOutputPublisher(output, 100)(
        work,
        "doc.csv",
        () => ++calls === 1,
        () => {},
      ),
    ).rejects.toThrow("no longer active");
    expect(await readdir(output)).toEqual(["prior.csv"]);
  });
});
