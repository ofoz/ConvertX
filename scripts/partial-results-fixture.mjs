import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";

import { build, file, serve } from "bun";

const publicFile = (name) => file(new URL(`../public/${name}`, import.meta.url));

async function loadWorkspace() {
  const { outputs } = await build({
    entrypoints: [fileURLToPath(new URL("../src/components/workspace.tsx", import.meta.url))],
    target: "bun",
    plugins: [
      {
        name: "fixture-format-metadata",
        setup(build) {
          // Only replace metadata, not the DOM or client. The real registry imports the DB.
          build.onResolve({ filter: /^\.\.\/converters\/main$/ }, () => ({
            path: "format-metadata",
            namespace: "fixture",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            loader: "js",
            contents: `
              export const getAllInputs = (engine) => engine === "pandoc" ? ["markdown"] : [];
              export const getAllTargets = () => ({ pandoc: ["txt"] });
            `,
          }));
        },
      },
    ],
  });
  const bundle = Buffer.from(await outputs[0].arrayBuffer()).toString("base64");
  const { ConversionWorkspace } = await import(`data:text/javascript;base64,${bundle}`);
  return ConversionWorkspace;
}

export async function startPartialResultsFixture() {
  const workspace = await loadWorkspace();
  const stylesheet = publicFile("generated.css");
  const css = (await stylesheet.exists()) ? '<link rel="stylesheet" href="/generated.css">' : "";
  const jobs = new Map();
  const created = [];
  const unexpected = [];

  function addJob(id, totalFiles, initialDone) {
    const files = Array.from({ length: totalFiles }, (_, index) => {
      const fileId = index + 1;
      const name = `part ${fileId}.txt`;
      return {
        id: fileId,
        name,
        inputName: `part ${fileId}.md`,
        status: "Done",
        downloadUrl: `/download/1/${id}/${encodeURIComponent(name)}`,
      };
    });
    const job = {
      id,
      files,
      polls: [],
      downloads: [],
      failNextHead: false,
      headGate: null,
      publish(done, status = "pending") {
        this.etag = `"fixture-${id}-${done}-${status}"`;
        this.snapshot = {
          jobId: id,
          status,
          totalFiles,
          completedInputs: done,
          files: files.slice(0, done),
          archiveUrl: status === "completed" ? `/archive/${id}` : null,
          queue: { queued: 0, running: totalFiles - done },
        };
      },
    };
    job.publish(initialDone);
    jobs.set(id, job);
    return job;
  }

  const server = serve({
    hostname: "127.0.0.1",
    port: 0,
    // The visibility scenario holds a download HEAD open across a 15 s background poll.
    idleTimeout: 35,
    error(error) {
      return new Response(`Fixture error: ${error.message}`, { status: 500 });
    },
    async fetch(request) {
      const { pathname } = new URL(request.url);
      const { method } = request;
      const pageMatch = /^\/workshop\/(\d+)$/.exec(pathname);
      if (method === "GET" && pageMatch && jobs.has(pageMatch[1])) {
        // The order is restored through sessionStorage, just as it is on a normal revisit.
        return new Response(
          `<!doctype html><html lang="zh-CN"><head>
          <meta charset="utf-8"><meta name="webroot" content="">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>ConvertX partial results fixture</title>${css}
          </head><body>${workspace({ jobId: Number(pageMatch[1]) })}
          <script src="/script.js" defer></script></body></html>`,
          {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          },
        );
      }
      if (method === "GET" && pathname === "/script.js") {
        return new Response(publicFile("script.js"), {
          headers: { "Content-Type": "text/javascript; charset=utf-8" },
        });
      }
      if (method === "GET" && pathname === "/generated.css" && css) {
        return new Response(stylesheet, { headers: { "Content-Type": "text/css; charset=utf-8" } });
      }
      if (method === "GET" && /^\/characters\/(?:[\w-]+\/)*[\w-]+\.webp$/.test(pathname)) {
        const image = publicFile(pathname.slice(1));
        return (await image.exists()) ? new Response(image) : new Response(null, { status: 404 });
      }
      if (method === "GET" && pathname === "/favicon.ico")
        return new Response(null, { status: 204 });
      if (method === "POST" && pathname === "/api/jobs") {
        const jobId = String(900 + created.length + 1);
        created.push(jobId);
        return Response.json({ jobId }, { status: 201 });
      }
      const jobId = /^\/api\/jobs\/(\d+)$/.exec(pathname)?.[1];
      const job = jobs.get(jobId);
      if (method === "GET" && job && request.headers.get("X-ConvertX-Job") === jobId) {
        const headers = { ETag: job.etag, "Cache-Control": "private, no-cache" };
        const status = request.headers.get("If-None-Match") === job.etag ? 304 : 200;
        job.polls.push(status);
        return status === 304
          ? new Response(null, { status, headers })
          : Response.json(job.snapshot, { headers });
      }
      const downloadJobId = /^\/download\/1\/(\d+)\//.exec(pathname)?.[1];
      const downloadJob = jobs.get(downloadJobId);
      const file = downloadJob?.snapshot.files.find((file) => file.downloadUrl === pathname);
      if (
        file &&
        (method === "GET" ||
          (request.headers.get("X-ConvertX-Job") === downloadJobId && method === "HEAD"))
      ) {
        downloadJob.downloads.push({ method, id: file.id });
        if (method === "HEAD") {
          if (downloadJob.failNextHead) {
            downloadJob.failNextHead = false;
            return new Response(null, { status: 503 });
          }
          const gate = downloadJob.headGate;
          downloadJob.headGate = null;
          if (gate) await gate;
        }
        const body = downloadContents(file);
        return new Response(method === "HEAD" ? null : body, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${file.name}"`,
            "Content-Length": String(Buffer.byteLength(body)),
            "Cache-Control": "no-store",
          },
        });
      }
      unexpected.push(`${method} ${pathname}`);
      return new Response("Unexpected fixture request", { status: 404 });
    },
  });

  return { origin: server.url.origin, addJob, created, unexpected, close: () => server.stop(true) };
}

export function downloadContents(file) {
  return `ConvertX fixture output: ${file.name}\n`;
}

export async function checkFixture(fixture) {
  const job = fixture.addJob("41", 2, 1);
  const page = await fetch(`${fixture.origin}/workshop/${job.id}`);
  const html = await page.text();
  assert.equal(page.status, 200, page.ok ? "" : html);
  for (const required of ['id="service-hall"', 'id="business-result-list"', 'src="/script.js"']) {
    assert.ok(html.includes(required), `Rendered workspace includes ${required}`);
  }
  const script = await fetch(`${fixture.origin}/script.js`);
  assert.equal(await script.text(), await publicFile("script.js").text());
  const pollUrl = `${fixture.origin}/api/jobs/${job.id}`;
  const headers = { "X-ConvertX-Job": job.id };
  const pending = await fetch(pollUrl, { headers });
  assert.equal((await pending.json()).status, "pending");
  headers["If-None-Match"] = pending.headers.get("etag");
  assert.equal((await fetch(pollUrl, { headers })).status, 304);
  job.publish(2, "completed");
  const completed = await (await fetch(pollUrl, { headers })).json();
  const file = completed.files[1];
  assert.equal(completed.status, "completed");
  const url = `${fixture.origin}${file.downloadUrl}`;
  const head = await fetch(url, { method: "HEAD", headers });
  assert.match(head.headers.get("content-disposition"), /^attachment;/);
  assert.equal(await (await fetch(url)).text(), downloadContents(file));
  assert.deepEqual(fixture.unexpected, []);
}
