import { unlink } from "node:fs/promises";
import path from "node:path";

import { Elysia, t } from "elysia";
import sanitize from "sanitize-filename";

import { uploadsDir } from "..";
import db from "../db/db";
import { Jobs } from "../db/types";
import { WEBROOT } from "../helpers/env";
import { withUploadLock } from "../helpers/uploadBudget";
import { userService } from "./user";

export const deleteFile = new Elysia().use(userService).post(
  "/delete",
  async ({ body, redirect, set, cookie: { jobId }, request, user }) => {
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

    return withUploadLock(`${user.id}/${existingJob.id}`, async () => {
      const latest = db
        .query("SELECT status FROM jobs WHERE id = ? AND user_id = ?")
        .get(existingJob.id, user.id) as { status: string } | null;
      if (!latest) return reject();
      if (latest.status !== "not started") {
        set.status = 409;
        return { message: "这一单已开始办理，无法移除文件。" };
      }

      const userUploadsDir = path.join(uploadsDir, String(user.id), String(existingJob.id));
      const targetPath = path.join(userUploadsDir, sanitize(body.filename));
      try {
        await unlink(targetPath);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          set.status = 404;
          return { message: "File not found." };
        }
        throw e;
      }

      return { message: "File deleted successfully." };
    });
  },
  { body: t.Object({ filename: t.String() }), auth: true },
);
