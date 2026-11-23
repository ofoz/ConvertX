import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { boundedExecFile, runBounded } from "../../src/helpers/boundedExec";

test("returns the output of a normally exiting process and reports spawn errors", async () => {
  expect(await runBounded(process.execPath, ["-e", "console.log('ok')"], { timeout: 5000 })).toBe(
    "ok\n",
  );
  await expect(
    runBounded("convertx-test-nonexistent-command-98234", [], { timeout: 5000 }),
  ).rejects.toThrow();
});

test("terminates a process that exceeds its output budget", async () => {
  const program = "console.log('x'.repeat(32768)); setInterval(() => {}, 1000)";
  await expect(
    runBounded(process.execPath, ["-e", program], { maxBuffer: 64, timeout: 5000 }),
  ).rejects.toThrow("output buffer limit");
});

test("waits for timeout to terminate an owned worker and its active descendant", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "convertx-owned-process-"));
  const tickFile = path.join(dir, "worker-ticks");
  const worker =
    "const {appendFileSync}=require('node:fs'); const file=process.argv[1]; appendFileSync(file,'x'); setInterval(()=>appendFileSync(file,'x'),25);";
  const parent =
    "const {spawn}=require('node:child_process'); const p=spawn(process.execPath,['-e',process.argv[1],process.argv[2]],{stdio:'ignore'}); setInterval(()=>{},1000);";
  try {
    const closed = await new Promise<{ error: Error | null; exited: boolean }>((resolve) => {
      const child = boundedExecFile(
        process.execPath,
        ["-e", parent, worker, tickFile],
        { timeout: 1800 },
        (error) => {
          resolve({ error, exited: child.exitCode !== null || child.signalCode !== null });
        },
      );
      child.stdin?.end();
    });
    expect(closed.error?.message).toContain("timed out");
    expect(closed.exited).toBe(true);
    const ticks = await readFile(tickFile, "utf8");
    expect(ticks.length).toBeGreaterThan(1);
    await Bun.sleep(150);
    expect(await readFile(tickFile, "utf8")).toBe(ticks);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 8000);

if (process.platform === "win32" && Bun.which("node")) {
  const nodeExecutable = Bun.which("node")!;
  test("terminates a Windows descendant when the tracked parent has already exited", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "convertx-exited-parent-"));
    const tickFile = path.join(dir, "worker-ticks");
    const stopFile = path.join(dir, "worker-stop");
    const worker = `
      const { appendFileSync, existsSync } = require("node:fs");
      const tickFile = ${JSON.stringify(tickFile)};
      const stopFile = ${JSON.stringify(stopFile)};
      appendFileSync(tickFile, "x");
      const timer = setInterval(() => {
        if (existsSync(stopFile)) {
          clearInterval(timer);
          process.exit(0);
        }
        appendFileSync(tickFile, "x");
      }, 25);
    `;
    const parent = `
      const { spawn } = require("node:child_process");
      const { existsSync } = require("node:fs");
      const worker = spawn(${JSON.stringify(nodeExecutable)}, ["-e", ${JSON.stringify(worker)}], { stdio: "inherit", detached: true });
      worker.unref();
      const timer = setInterval(() => {
        if (existsSync(${JSON.stringify(tickFile)})) {
          clearInterval(timer);
          process.exit(0);
        }
      }, 10);
    `;
    try {
      const result = await new Promise<{ error: Error | null; parentExited: boolean }>(
        (resolve) => {
          const child = boundedExecFile(
            nodeExecutable,
            ["-e", parent],
            { timeout: 1000 },
            (error) =>
              resolve({
                error,
                parentExited: child.exitCode !== null || child.signalCode !== null,
              }),
          );
          child.stdin?.end();
        },
      );
      expect(result.parentExited).toBe(true);
      const ticks = await readFile(tickFile, "utf8");
      expect(ticks.length).toBeGreaterThan(1);
      await Bun.sleep(150);
      const laterTicks = await readFile(tickFile, "utf8");
      expect(laterTicks).toBe(ticks);
    } finally {
      await writeFile(stopFile, "stop");
      await Bun.sleep(100);
      await rm(dir, { recursive: true, force: true });
    }
  }, 8000);
}
