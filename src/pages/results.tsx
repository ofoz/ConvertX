import { createHash } from "node:crypto";

import { Elysia } from "elysia";

import { BaseHtml } from "../components/base";
import { Header } from "../components/header";
import { SymbolIcon } from "../components/symbol";
import db from "../db/db";
import { Filename, Jobs } from "../db/types";
import { assetUrl } from "../helpers/assets";
import { buildDownloadUrl } from "../helpers/buildDownloadUrl";
import { ALLOW_UNAUTHENTICATED, BRANDING, HIDE_HISTORY, WEBROOT } from "../helpers/env";
import { userService } from "./user";

function summarizeConversion(job: Jobs, files: Filename[]) {
  // A single input, such as a PDF, may generate several output rows.
  const jobCompleted = job.status === "completed";
  const inputs = new Map<string, { done: boolean; failed: boolean }>();
  let outputs = 0;
  for (const file of files) {
    const success = file.status === "Done";
    const knownFailure = ["Failed, check logs", "File type not supported"].includes(file.status);
    const outcome = inputs.get(file.file_name) ?? { done: false, failed: false };
    outcome.done ||= success || knownFailure || jobCompleted;
    outcome.failed ||= knownFailure || (jobCompleted && !success);
    inputs.set(file.file_name, outcome);
    if (success) outputs++;
  }

  const completed = jobCompleted;
  const succeeded = [...inputs.values()].filter((input) => input.done && !input.failed).length;
  const failed = [...inputs.values()].filter((input) => input.failed).length;
  const processed = [...inputs.values()].filter((input) => input.done).length;
  const state = !completed ? "running" : outputs === 0 ? "failed" : failed ? "partial" : "success";
  return { completed, processed, succeeded, failed, outputs, state };
}

const resultMessages = {
  running: { title: "正在转换", note: "页面会自动更新。已生成的文件可以立即预览或下载。" },
  success: { title: "转换完成", note: "文件已准备好，可以预览或下载。" },
  partial: { title: "部分文件转换失败", note: "你仍可下载转换成功的文件。失败原因见下方列表。" },
  failed: { title: "转换失败", note: "此次任务没有可下载的文件。请检查源文件或尝试其他目标格式。" },
} as const;

function fileStatus(status: string) {
  if (status === "Done") return "成功";
  if (status === "File type not supported") return "不支持此文件类型";
  if (status === "Failed, check logs") return "转换失败，请查看日志";
  return "状态未知";
}

function ResultsArticle({
  job,
  files,
  outputPath,
}: {
  job: Jobs;
  files: Filename[];
  outputPath: string;
}) {
  const { completed, processed, succeeded, failed, outputs, state } = summarizeConversion(
    job,
    files,
  );
  const message = resultMessages[state as keyof typeof resultMessages];
  const progress = completed ? job.num_files : Math.min(processed, job.num_files);
  const progressLabel = `${progress} / ${job.num_files} 个源文件`;
  const announcement = `${message.title}。${progressLabel}，成功 ${succeeded}，失败 ${failed}。`;
  const signalClass =
    state === "running"
      ? "sx-signal--running"
      : state === "success"
        ? "sx-signal--success"
        : state === "partial"
          ? "sx-signal--partial"
          : "sx-signal--failed";
  const symbol = state === "success" ? "check" : state === "running" ? "layers" : "x";
  return (
    <article
      id="sx-results"
      class="sx-result-stack"
      data-progress-url={`${WEBROOT}/progress/${job.id}`}
      data-state={state}
      data-announcement={announcement}
    >
      <section class="surface sx-result-summary" aria-labelledby="sx-result-title">
        <div class="sx-result-intro">
          <span
            class={`
              sx-signal
              ${signalClass}
            `}
          >
            <SymbolIcon name={symbol} size={22} />
          </span>
          <div>
            <h2 id="sx-result-title">{message.title}</h2>
            <p class="muted">{message.note}</p>
          </div>
          {completed ? (
            <a href={`${WEBROOT}/`} class="sx-restart btn-primary">
              再转换一批 <SymbolIcon name="arrow" size={16} />
            </a>
          ) : null}
        </div>
        <div class="sx-result-progress" aria-busy={completed ? undefined : "true"}>
          <div>
            <span>{completed ? "已处理" : "处理进度"}</span>
            <span safe>{progressLabel}</span>
          </div>
          <progress max={Math.max(job.num_files, 1)} value={progress} aria-label="源文件处理进度" />
        </div>
        <dl class="sx-result-counts">
          <div>
            <dt>成功</dt>
            <dd class="sx-ink-success">{succeeded}</dd>
          </div>
          <div>
            <dt>失败</dt>
            <dd class={failed ? "sx-ink-warning" : ""}>{failed}</dd>
          </div>
          <div>
            <dt>可下载文件</dt>
            <dd>{outputs}</dd>
          </div>
        </dl>
      </section>

      <section class="surface sx-files" aria-labelledby="sx-file-title">
        <div class="sx-panel-head">
          <h2 id="sx-file-title">文件结果</h2>
          {completed ? (
            <div class="sx-actions">
              {outputs > 0 ? (
                <button type="button" class="btn-secondary" data-download-all>
                  <SymbolIcon name="download" size={16} /> <span>批量下载</span>
                </button>
              ) : null}
              {state === "success" ? (
                <a
                  href={`${WEBROOT}/archive/${job.id}`}
                  download={`converted_files_${job.id}.tar`}
                  class="btn-secondary"
                >
                  下载 TAR 压缩包
                </a>
              ) : null}
              <form action={`${WEBROOT}/delete/${job.id}`} method="POST" data-confirm-delete>
                <button type="submit" class="sx-danger btn-secondary">
                  <SymbolIcon name="trash" size={16} /> 删除任务
                </button>
              </form>
            </div>
          ) : null}
        </div>
        {files.length === 0 ? (
          <div class="sx-no-files muted">
            {completed ? "没有生成任何文件。" : "正在等待首个文件结果…"}
          </div>
        ) : (
          <table class="sx-table sx-result-table">
            <thead>
              <tr>
                <th scope="col">文件名</th>
                <th scope="col">状态</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => {
                const canDownload = file.status === "Done";
                const name = canDownload
                  ? file.output_file_name
                  : file.file_name || file.output_file_name;
                const url = canDownload
                  ? buildDownloadUrl(WEBROOT, outputPath, file.output_file_name)
                  : "";
                return (
                  <tr>
                    <td>
                      <div class="sx-file-label">
                        <span class="sx-file-icon">
                          <SymbolIcon name="file" size={17} />
                        </span>
                        <span class="sx-file-name" title={name} safe>
                          {name}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span
                        class={`
                          badge
                          ${canDownload ? "sx-badge-success" : "sx-badge-warning"}
                        `}
                        title={fileStatus(file.status)}
                      >
                        {fileStatus(file.status)}
                      </span>
                    </td>
                    <td>
                      {canDownload ? (
                        <div class="sx-actions">
                          <a
                            class="sx-text-action"
                            href={url}
                            data-focus-key={`preview-${file.id}`}
                            data-preview-link
                          >
                            预览
                          </a>
                          <a
                            class="sx-text-action"
                            href={url}
                            download={file.output_file_name}
                            data-focus-key={`download-${file.id}`}
                            data-preview-link
                          >
                            <SymbolIcon name="download" size={16} /> 下载
                          </a>
                        </div>
                      ) : (
                        <span class="muted sx-unavailable">无法下载</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </article>
  );
}

export const results = new Elysia()
  .use(userService)
  .get(
    "/results/:jobId",
    async ({ params, set, cookie: { job_id }, user }) => {
      if (job_id?.value) {
        // Clear the job_id cookie since we are viewing the results
        job_id.remove();
      }

      const job = db
        .query("SELECT * FROM jobs WHERE user_id = ? AND id = ?")
        .as(Jobs)
        .get(user.id, params.jobId);

      if (!job) {
        set.status = 404;
        return {
          message: "Job not found.",
        };
      }

      const outputPath = `${user.id}/${params.jobId}/`;

      const files = db
        .query("SELECT * FROM file_names WHERE job_id = ?")
        .as(Filename)
        .all(params.jobId);

      return (
        <BaseHtml webroot={WEBROOT} title={`${BRANDING} | 转换结果`}>
          <>
            <Header
              webroot={WEBROOT}
              allowUnauthenticated={ALLOW_UNAUTHENTICATED}
              hideHistory={HIDE_HISTORY}
              loggedIn
              branding={BRANDING}
              active="convert"
            />
            <main class="app-container sx-page" id="main-content" tabindex="-1">
              <div class="page-heading sx-page-heading">
                <a class="sx-back" href={`${WEBROOT}/`}>
                  ‹ 返回转换台
                </a>
                <h1>转换结果</h1>
                <p class="muted">任务 #{job.id}</p>
              </div>
              <p id="sx-results-status" class="sr-only" role="status" aria-atomic="true" />
              <div id="sx-poll-notice" class="sx-notice" hidden>
                <p id="sx-poll-message" role="status" />
                <button id="sx-poll-retry" type="button" class="btn-secondary">
                  立即重试
                </button>
                <a id="sx-poll-login" href={`${WEBROOT}/login`} class="btn-secondary" hidden>
                  重新登录
                </a>
              </div>
              <ResultsArticle job={job} files={files} outputPath={outputPath} />
            </main>
            <script src={assetUrl(WEBROOT, "results.js")} defer />
          </>
        </BaseHtml>
      );
    },
    { auth: true },
  )
  .post(
    "/progress/:jobId",
    async ({ set, params, cookie: { job_id }, user, request }) => {
      if (job_id?.value) {
        // Clear the job_id cookie since we are viewing the results
        job_id.remove();
      }

      const job = db
        .query("SELECT * FROM jobs WHERE user_id = ? AND id = ?")
        .as(Jobs)
        .get(user.id, params.jobId);

      if (!job) {
        set.status = 404;
        return {
          message: "Job not found.",
        };
      }

      const outputPath = `${user.id}/${params.jobId}/`;

      const files = db
        .query("SELECT * FROM file_names WHERE job_id = ?")
        .as(Filename)
        .all(params.jobId);

      const snapshot = JSON.stringify({
        user: user.id,
        job: [job.id, job.status, job.num_files],
        files: files.map((file) => [file.id, file.file_name, file.output_file_name, file.status]),
      });
      const etag = `"${createHash("sha256").update(snapshot).digest("base64url")}"`;
      set.headers["cache-control"] = "private, no-cache";
      set.headers.etag = etag;
      if (request.headers.get("if-none-match") === etag) {
        set.status = 304;
        return;
      }
      return <ResultsArticle job={job} files={files} outputPath={outputPath} />;
    },
    { auth: true },
  );
