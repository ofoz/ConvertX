import { mkdir, stat } from "node:fs/promises";

import { Elysia, t } from "elysia";
import sanitize from "sanitize-filename";

import { outputDir, uploadsDir } from "..";
import {
  getPossibleTargets,
  getTargetsForConverter,
  submitConversionBatch,
} from "../converters/main";
import db from "../db/db";
import { Jobs } from "../db/types";
import { WEBROOT } from "../helpers/env";
import { normalizeFiletype } from "../helpers/normalizeFiletype";
import { resourceLimits } from "../helpers/resourceLimits";
import { checkJobUploadBytes, UploadBudgetError, withUploadLock } from "../helpers/uploadBudget";
import { userService } from "./user";

export const convert = new Elysia().use(userService).post(
  "/convert",
  async ({ body, redirect, jwt, cookie: { auth, jobId }, request, set }) => {
    const hallRequest = request.headers.get("X-ConvertX-UI") === "hall";
    const requestedJobId = request.headers.get("X-ConvertX-Job");
    const selectedJobId = requestedJobId ?? jobId?.value;
    const reject = (message: string, status = 400) => {
      if (hallRequest || [409, 413, 429].includes(status)) {
        set.status = status;
        return { message };
      }
      return redirect(`${WEBROOT}/`, 302);
    };

    if (!auth?.value) {
      if (hallRequest) {
        set.status = 401;
        return { message: "Unauthorized" };
      }
      return redirect(`${WEBROOT}/login`, 302);
    }

    const user = await jwt.verify(auth.value);
    if (!user) {
      if (hallRequest) {
        set.status = 401;
        return { message: "Unauthorized" };
      }
      return redirect(`${WEBROOT}/login`, 302);
    }

    if (!selectedJobId || !/^\d+$/.test(selectedJobId)) {
      return reject("A valid job is required.", 404);
    }

    const existingJob = db
      .query("SELECT * FROM jobs WHERE id = ? AND user_id = ?")
      .as(Jobs)
      .get(selectedJobId, user.id);

    if (!existingJob) {
      return reject("Job not found.", 404);
    }

    const conversionJobId = { value: String(existingJob.id) } as typeof jobId;
    const userUploadsDir = `${uploadsDir}${user.id}/${existingJob.id}/`;
    const userOutputDir = `${outputDir}${user.id}/${existingJob.id}/`;

    const convertTo = normalizeFiletype(body.convert_to.split(",")[0] ?? "");
    const converterName = body.convert_to.split(",")[1];

    if (
      !converterName ||
      convertTo.includes("/") ||
      convertTo.includes("\\") ||
      convertTo.includes("..") ||
      !getTargetsForConverter(converterName)?.includes(convertTo)
    ) {
      return reject("Unsupported conversion target.");
    }

    let fileNames: string[];
    try {
      fileNames = JSON.parse(body.file_names) as string[];
    } catch {
      return reject("Invalid file list.");
    }

    if (!Array.isArray(fileNames) || fileNames.length === 0) {
      return reject("At least one file is required.");
    }

    if (!fileNames.every((name) => typeof name === "string")) {
      return reject("Invalid file list.");
    }

    if (fileNames.length > resourceLimits.maxFilesPerJob) {
      return reject(`每单最多转换 ${resourceLimits.maxFilesPerJob} 个文件。`, 413);
    }
    fileNames = fileNames.map((name) => sanitize(name));
    const unsupportedInput = fileNames.find((name) => {
      const dot = name.lastIndexOf(".");
      const fileType = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
      return !getPossibleTargets(fileType)[converterName]?.includes(convertTo);
    });
    if (unsupportedInput)
      return reject(`不支持将“${unsupportedInput}”转换为 ${convertTo.toUpperCase()}。`);

    const identities = fileNames.map((name) =>
      process.platform === "win32" ? name.toLowerCase() : name,
    );
    if (fileNames.some((name) => !name) || new Set(identities).size !== fileNames.length) {
      return reject("文件名无效或重复，请重新选择文件。");
    }
    return withUploadLock(`${user.id}/${existingJob.id}`, async () => {
      const getCurrentJob = () =>
        db
          .query("SELECT status FROM jobs WHERE id = ? AND user_id = ?")
          .get(existingJob.id, user.id) as { status: string } | null;
      const current = getCurrentJob();
      if (!current) return reject("Job not found.", 404);
      if (current.status !== "not started")
        return reject("该任务已提交，请新建任务后再转换。", 409);

      try {
        let bytes = 0;
        for (const name of fileNames) {
          const size = await stat(`${userUploadsDir}${name}`).then(
            (file) => (file.isFile() ? file.size : 0),
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return 0; // The worker records a missing input as failed.
              throw error;
            },
          );
          if (size > resourceLimits.maxFileBytes)
            return reject(`文件超过 ${resourceLimits.maxFileBytes / 1048576} MiB 上限。`, 413);
          bytes += size;
          checkJobUploadBytes(bytes);
        }
        await mkdir(userOutputDir, { recursive: true });
      } catch (error) {
        if (error instanceof UploadBudgetError) return reject(error.message, error.status);
        console.error("Failed to prepare conversion:", error);
        return reject("Failed to prepare the conversion.", 500);
      }

      // Re-read after filesystem awaits. No async gap separates admission from the DB claim.
      const latest = getCurrentJob();
      if (!latest) return reject("Job not found.", 404);
      if (latest.status !== "not started") return reject("该任务已提交，请新建任务后再转换。", 409);
      const submission = submitConversionBatch(
        fileNames,
        userUploadsDir,
        userOutputDir,
        convertTo,
        converterName,
        conversionJobId,
        () => {
          db.query("UPDATE jobs SET num_files = ?, status = 'pending' WHERE id = ?").run(
            fileNames.length,
            existingJob.id,
          );
        },
      );
      if (!submission.accepted) {
        if (submission.reason === "duplicate")
          return reject("该任务已提交，请新建任务后再转换。", 409);
        set.headers["Retry-After"] = "5";
        return reject("转换队列已满，请稍后重试。", 429);
      }
      const finish = () => {
        db.transaction(() => {
          if (
            !db.query("SELECT id FROM jobs WHERE id = ? AND status = 'pending'").get(existingJob.id)
          )
            return;
          const known = db
            .query("SELECT DISTINCT file_name FROM file_names WHERE job_id = ?")
            .all(existingJob.id) as { file_name: string }[];
          const recorded = new Set(known.map((file) => file.file_name));
          const insert = db.query(
            "INSERT INTO file_names (job_id, file_name, output_file_name, status) VALUES (?, ?, ?, 'Failed, check logs')",
          );
          for (const name of fileNames)
            if (!recorded.has(name)) insert.run(existingJob.id, name, name);
          db.query("UPDATE jobs SET status = 'completed' WHERE id = ? AND status = 'pending'").run(
            existingJob.id,
          );
        })();
      };
      void submission.done
        .catch((error) => console.error("Conversion task failed:", error))
        .then(finish)
        .catch((error) => {
          console.error("Failed to finalize conversion:", error);
          try {
            db.query(
              "UPDATE jobs SET status = 'completed' WHERE id = ? AND status = 'pending'",
            ).run(existingJob.id);
          } catch (fallbackError) {
            console.error("Could not update conversion state:", fallbackError);
          }
        });

      if (hallRequest) {
        set.status = 202;
        return { jobId: String(existingJob.id), url: `${WEBROOT}/results/${existingJob.id}` };
      }

      return redirect(`${WEBROOT}/results/${existingJob.id}`, 302);
    });
  },
  {
    body: t.Object({
      convert_to: t.String(),
      file_names: t.String(),
    }),
    auth: true,
  },
);
