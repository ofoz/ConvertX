import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { Elysia, t } from "elysia";

import { outputDir } from "..";
import db from "../db/db";
import { Filename, Jobs } from "../db/types";
import { buildDownloadUrl } from "../helpers/buildDownloadUrl";
import { getJobQueueState } from "../helpers/conversionQueue";
import { ALLOW_UNAUTHENTICATED, HTTP_ALLOWED, WEBROOT } from "../helpers/env";
import { userService } from "./user";

const terminalStatuses = new Set(["Done", "Failed, check logs", "File type not supported"]);

// Match the root page: a revoked account cannot create or inspect orders with an
// old, otherwise-valid JWT. Anonymous IDs are valid only in anonymous mode.
function canUseJobs(userId: string) {
  if (db.query("SELECT id FROM users WHERE id = ?").get(userId)) return true;
  const id = Number(userId);
  return ALLOW_UNAUTHENTICATED && Number.isSafeInteger(id) && (id === 0 || id >= 2 ** 24);
}

function hasOutput(outputDirectory: string, filename: string) {
  const target = path.resolve(outputDirectory, filename);
  const relative = path.relative(outputDirectory, target);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative) &&
    existsSync(target) &&
    statSync(target).isFile()
  );
}

export const jobApi = new Elysia()
  .use(userService)
  .post(
    "/api/jobs",
    ({ user, cookie: { jobId, auth }, set }) => {
      if (!canUseJobs(user.id)) {
        auth?.remove();
        set.status = 401;
        return { message: "Unauthorized" };
      }
      const inserted = db
        .query("INSERT INTO jobs (user_id, date_created) VALUES (?, ?) RETURNING id")
        .get(user.id, new Date().toISOString()) as { id: number };
      const id = String(inserted.id);

      jobId.set({
        value: id,
        httpOnly: true,
        secure: !HTTP_ALLOWED,
        maxAge: 60 * 60 * 24,
        sameSite: "strict",
      });
      set.status = 201;
      return { jobId: id };
    },
    { auth: true, cookie: "optionalSession" },
  )
  .get(
    "/api/jobs/:jobId",
    ({ params, user, cookie: { auth }, set, request }) => {
      if (!canUseJobs(user.id)) {
        auth?.remove();
        set.status = 401;
        return { message: "Unauthorized" };
      }
      const job = db
        .query("SELECT * FROM jobs WHERE user_id = ? AND id = ?")
        .as(Jobs)
        .get(user.id, params.jobId);
      if (!job) {
        set.status = 404;
        return { message: "Job not found." };
      }

      const outputDirectory = path.resolve(outputDir, String(user.id), String(job.id));
      const fileRows = db
        .query("SELECT * FROM file_names WHERE job_id = ? ORDER BY id")
        .as(Filename)
        .all(job.id);
      const inputStatuses = new Map<string, string[]>();
      for (const file of fileRows) {
        const statuses = inputStatuses.get(file.file_name) ?? [];
        statuses.push(file.status);
        inputStatuses.set(file.file_name, statuses);
      }
      const completedInputs = [...inputStatuses.values()].filter(
        (statuses) =>
          statuses.length > 0 && statuses.every((status) => terminalStatuses.has(status)),
      ).length;
      const outputExists = new Map<string, boolean>();
      const fileExists = (filename: string) => {
        const cached = outputExists.get(filename);
        if (cached !== undefined) return cached;
        const exists = hasOutput(outputDirectory, filename);
        outputExists.set(filename, exists);
        return exists;
      };
      const files = fileRows.map((file) => {
        const realOutputExists = file.status === "Done" && fileExists(file.output_file_name);
        return {
          id: file.id,
          name: file.output_file_name,
          inputName: file.file_name,
          status: file.status,
          downloadUrl: realOutputExists
            ? buildDownloadUrl(WEBROOT, `${user.id}/${job.id}/`, file.output_file_name)
            : null,
        };
      });
      const archiveReady =
        job.status === "completed" &&
        fileRows.length > 0 &&
        fileRows.every((file) => file.status === "Done" && fileExists(file.output_file_name));
      const queue = getJobQueueState(String(job.id));
      const snapshot = JSON.stringify({
        user: user.id,
        job: [job.id, job.status, job.num_files],
        files: fileRows.map((file) => [
          file.id,
          file.file_name,
          file.output_file_name,
          file.status,
          file.status === "Done" && fileExists(file.output_file_name),
        ]),
        queue,
      });
      const etag = `"${createHash("sha256").update(snapshot).digest("base64url")}"`;
      set.headers["cache-control"] = "private, no-cache";
      set.headers.etag = etag;
      if (request.headers.get("if-none-match") === etag) {
        set.status = 304;
        return;
      }

      return {
        jobId: String(job.id),
        status: job.status,
        totalFiles: job.num_files,
        completedInputs,
        files,
        archiveUrl: archiveReady ? `${WEBROOT}/archive/${job.id}` : null,
        queue,
      };
    },
    { auth: true, params: t.Object({ jobId: t.String() }) },
  );
