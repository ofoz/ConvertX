import { type ChildProcess, execFile, spawn, type SpawnOptions } from "node:child_process";
import path from "node:path";

import { resourceLimits } from "./resourceLimits";

type Callback = (error: Error | null, stdout: string, stderr: string) => void;
type Options = Pick<SpawnOptions, "cwd" | "env"> & { timeout?: number; maxBuffer?: number };

/** Snapshot descendants before terminating them; a converter wrapper may have exited already. */
function terminateWindowsDescendants(pid: number): Promise<void> {
  const command = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const script = `$ErrorActionPreference = 'Stop'; $root = ${pid}; $all = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId); $ids = [System.Collections.Generic.List[int]]::new(); $seen = @{}; $seen[[string]$root] = $true; $ids.Add($root); for ($i = 0; $i -lt $ids.Count; $i++) { $parent = $ids[$i]; foreach ($item in $all) { $id = [int]$item.ProcessId; if ([int]$item.ParentProcessId -eq $parent -and -not $seen.ContainsKey([string]$id)) { $seen[[string]$id] = $true; $ids.Add($id) } } }; $ids.Reverse(); foreach ($id in $ids) { if ($id -ne $root) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } }`;
  return new Promise((resolve, reject) => {
    execFile(
      command,
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 10000, maxBuffer: 65536 },
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

/** Terminate the owned process tree without matching unrelated processes by name. */
function terminateOwnedProcess(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) return Promise.resolve();
  if (process.platform === "win32") {
    return terminateWindowsDescendants(pid).then(
      () => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      },
      (error: unknown) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`Unable to terminate the conversion process tree: ${String(error)}`);
        }
        return new Promise<void>((resolve, reject) => {
          const command = path.join(
            process.env.SystemRoot || "C:\\Windows",
            "System32",
            "taskkill.exe",
          );
          execFile(
            command,
            ["/PID", String(pid), "/T", "/F"],
            { windowsHide: true, timeout: 10000, maxBuffer: 65536 },
            (killError) => {
              if (!killError || child.exitCode !== null || child.signalCode !== null) {
                resolve();
                return;
              }
              child.kill("SIGKILL");
              reject(
                new Error(`Unable to terminate the conversion process tree: ${killError.message}`),
              );
            },
          );
        });
      },
    );
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      child.kill("SIGKILL");
      return Promise.reject(error);
    }
  }
  return Promise.resolve();
}

export function boundedExecFile(command: string, args: string[], callback: Callback): ChildProcess;
export function boundedExecFile(
  command: string,
  args: string[],
  options: Options,
  callback: Callback,
): ChildProcess;
export function boundedExecFile(
  command: string,
  args: string[],
  optionsOrCallback: Options | Callback,
  suppliedCallback?: Callback,
): ChildProcess {
  const options = typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
  const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : suppliedCallback!;
  const timeout = options.timeout ?? resourceLimits.conversionTimeoutMs;
  const maxBuffer = options.maxBuffer ?? 1024 * 1024;
  const child = spawn(command, args, {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: "pipe",
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let failure: Error | undefined;
  let termination: Promise<void> | undefined;
  const stop = (error: Error) => {
    if (failure) return;
    failure = error;
    termination = terminateOwnedProcess(child)
      .catch((error: unknown) => {
        failure = new Error(`${failure?.message} ${String(error)}`);
      })
      .then(() => {
        // An inherited pipe can stay open even after the tracked worker exits.
        child.stdout.destroy();
        child.stderr.destroy();
      });
  };
  const timer = setTimeout(
    () => stop(new Error(`${command} timed out after ${timeout} ms.`)),
    timeout,
  );
  timer.unref();
  const collect = (stream: NodeJS.ReadableStream, chunks: Buffer[]) => {
    let size = 0;
    stream.on("data", (chunk: Buffer) => {
      if (failure) return;
      size += chunk.byteLength;
      if (size > maxBuffer) stop(new Error(`${command} exceeded its output buffer limit.`));
      else chunks.push(chunk);
    });
  };
  collect(child.stdout, stdout);
  collect(child.stderr, stderr);
  child.stdin.on("error", () => {}); // The child may exit before its input pipe closes.
  child.once("error", (error) => {
    failure ??= error;
  });
  child.once("close", (code, signal) => {
    clearTimeout(timer);
    // The slot is released only after the child has closed and the kill command has returned.
    const finish = () =>
      callback(
        failure ??
          (code === 0 ? null : new Error(`${command} exited with ${signal ?? `code ${code}`}.`)),
        Buffer.concat(stdout).toString("utf8"),
        Buffer.concat(stderr).toString("utf8"),
      );
    if (termination) void termination.then(finish);
    else finish();
  });
  return child;
}

export function runBounded(
  command: string,
  args: string[],
  options: Options = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = boundedExecFile(command, args, options, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}${stderr ? `: ${stderr.slice(0, 1000)}` : ""}`));
      else resolve(stdout);
    });
    child.stdin?.end();
  });
}
