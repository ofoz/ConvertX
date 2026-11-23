import { rm } from "node:fs/promises";

import { html } from "@elysiajs/html";
import { staticPlugin } from "@elysiajs/static";
import { Elysia } from "elysia";

import db from "./db/db";
import { Jobs } from "./db/types";
import { AUTO_DELETE_EVERY_N_HOURS, WEBROOT } from "./helpers/env";
import "./helpers/printVersions";
import { scheduleDelayed, ScheduledTask } from "./helpers/scheduleDelayed";
import { resourceLimits } from "./helpers/resourceLimits";
import { recoverInterruptedJobs } from "./helpers/recoverInterruptedJobs";
import { getJobQueueState } from "./helpers/conversionQueue";
import { chooseConverter } from "./pages/chooseConverter";
import { convert } from "./pages/convert";
import { credits } from "./pages/credits";
import { deleteFile } from "./pages/deleteFile";
import { deleteJob } from "./pages/deleteJob";
import { download } from "./pages/download";
import { healthcheck } from "./pages/healthcheck";
import { history } from "./pages/history";
import { jobApi } from "./pages/jobApi";
import { listConverters } from "./pages/listConverters";
import { results } from "./pages/results";
import { root } from "./pages/root";
import { upload } from "./pages/upload";
import { user } from "./pages/user";

export const uploadsDir = "./data/uploads/";
export const outputDir = "./data/output/";

// Fix for Elysia issue with Bun, (see https://github.com/oven-sh/bun/issues/12161)
process.getBuiltinModule = require;

const interruptedJobs = recoverInterruptedJobs(db);
if (interruptedJobs) console.warn(`${interruptedJobs} interrupted conversion order(s) finalized; missing files require retry.`);

const app = new Elysia({
  serve: {
    maxRequestBodySize: resourceLimits.maxRequestBytes,
  },
  prefix: WEBROOT,
})
  .use(html())
  .use(user)
  .use(root)
  .use(upload)
  .use(jobApi)
  .use(history)
  .use(convert)
  .use(download)
  .use(deleteJob)
  .use(results)
  .use(deleteFile)
  .use(listConverters)
  .use(chooseConverter)
  .use(healthcheck)
  .use(credits)
  // Register static routes before the server accepts its first request.
  .use(
    await staticPlugin({
      assets: "public",
      prefix: "",
      alwaysStatic: true,
      ignorePatterns: [".DS_Store", ".git", ".env", /^[/\\]characters[/\\]ATTRIBUTION\.md$/],
      maxAge: process.env.NODE_ENV === "production" ? 86400 : 0,
    }),
  )
  .onError(({ error, code, request }) => {
    if (code === "NOT_FOUND") {
      console.warn(`404: ${request.method} ${new URL(request.url).pathname}`);
      return;
    }
    console.error(error);
  });

if (process.env.NODE_ENV !== "production") {
  await import("./helpers/tailwind").then(async ({ generateTailwind }) => {
    const result = await generateTailwind();

    app.get("/generated.css", ({ set }) => {
      set.headers["content-type"] = "text/css";
      return result;
    });
  });
}

app.listen(process.env.PORT || 3000);

console.log(`🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}${WEBROOT}`);

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const autoDeleteIntervalMs = AUTO_DELETE_EVERY_N_HOURS * MILLISECONDS_PER_HOUR;
let clearJobsTimer: ScheduledTask;

const clearJobs = async () => {
  try {
    const jobs = db.query("SELECT * FROM jobs WHERE date_created < ?").as(Jobs).all(new Date(Date.now() - autoDeleteIntervalMs).toISOString());
    for (const job of jobs) {
      if (getJobQueueState(String(job.id))) continue;
      try {
        await Promise.all([
          rm(`${outputDir}${job.user_id}/${job.id}`, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }),
          rm(`${uploadsDir}${job.user_id}/${job.id}`, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }),
        ]);
        db.query("DELETE FROM jobs WHERE id = ?").run(job.id);
      } catch (error) { console.warn(`Could not clean order ${job.id}:`, error); }
    }
  } catch (error) { console.warn("Automatic cleanup failed:", error); }
  finally { if (!isShuttingDown) clearJobsTimer = scheduleDelayed(autoDeleteIntervalMs, () => { void clearJobs(); }); }
};

if (AUTO_DELETE_EVERY_N_HOURS > 0) setTimeout(() => { void clearJobs(); }, 0);

let isShuttingDown = false;
const handleShutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (clearJobsTimer) {
    clearJobsTimer.cancel();
  }
  try {
    await app.stop(true);
    db.close();
    process.exit(0);
  } catch (error) {
    console.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
};

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);
