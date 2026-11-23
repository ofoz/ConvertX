import { lstat, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { Elysia, t } from "elysia";

import db from "../db/db";
import { Jobs } from "../db/types";
import { WEBROOT } from "../helpers/env";
import { checkUploadBudget, UploadBudgetError, withUploadLock } from "../helpers/uploadBudget";
import { uploadsDir } from "../index";
import { userService } from "./user";

export const upload = new Elysia().use(userService).post(
  "/upload",
  async ({ body, redirect, user, cookie: { jobId }, request, set }) => {
    const requestedJobId = request.headers.get("X-ConvertX-Job");
    const selectedJobId = requestedJobId ?? jobId?.value;
    const hallRequest = request.headers.get("X-ConvertX-UI") === "hall";
    const reject = () => {
      if (hallRequest) {
        set.status = 404;
        return { message: "Job not found." };
      }
      return redirect(`${WEBROOT}/`, 302);
    };

    if (!selectedJobId || !/^\d+$/.test(selectedJobId)) return reject();

    const existingJob = await db
      .query("SELECT * FROM jobs WHERE id = ? AND user_id = ?")
      .as(Jobs)
      .get(selectedJobId, user.id);

    if (!existingJob) return reject();

    const userUploadsDir = `${uploadsDir}${user.id}/${existingJob.id}/`;

    try {
      await withUploadLock(`${user.id}/${existingJob.id}`, async () => {
        const latest = db
          .query("SELECT status FROM jobs WHERE id = ? AND user_id = ?")
          .get(existingJob.id, user.id) as { status: string } | null;
        if (!latest) throw new UploadBudgetError("Job not found.", 404);
        if (latest.status !== "not started") {
          throw new UploadBudgetError("这一单已开始办理，请另开一单上传文件。", 409);
        }
        const files = Array.isArray(body.file) ? body.file : [body.file];
        const entries = await readdir(userUploadsDir, { withFileTypes: true }).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return [];
            throw error;
          },
        );
        const existingFiles = await Promise.all(
          entries
            .filter((entry) => entry.isFile())
            .map(async ({ name }) => ({
              name,
              size: (await lstat(path.join(userUploadsDir, name))).size,
            })),
        );
        const uploads = checkUploadBudget(files, existingFiles);
        await mkdir(userUploadsDir, { recursive: true });
        const staging = await mkdtemp(path.join(userUploadsDir, ".upload-"));
        try {
          const temporaryFile = path.join(staging, "upload");
          for (const { file, name } of uploads) {
            await Bun.write(temporaryFile, file);
            await rename(temporaryFile, path.join(userUploadsDir, name));
          }
        } finally {
          await rm(staging, { recursive: true, force: true });
        }
      });
    } catch (error) {
      if (!(error instanceof UploadBudgetError)) throw error;
      set.status = error.status;
      return { message: error.message };
    }

    return {
      message: "Files uploaded successfully.",
    };
  },
  { body: t.Object({ file: t.Files() }), auth: true },
);
