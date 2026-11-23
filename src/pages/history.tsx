import { Elysia, t } from "elysia";

import { BaseHtml } from "../components/base";
import { Header } from "../components/header";
import { SymbolIcon } from "../components/symbol";
import db from "../db/db";
import { Filename, Jobs } from "../db/types";
import { ALLOW_UNAUTHENTICATED, BRANDING, HIDE_HISTORY, TIMEZONE, WEBROOT } from "../helpers/env";
import { resourceLimits } from "../helpers/resourceLimits";
import { userService } from "./user";

function jobStatus(status: string) {
  if (status === "completed") return "已完成";
  if (status === "failed") return "转换失败";
  if (status === "pending") return "处理中";
  return status === "not started" ? "未开始" : "状态未知";
}

function fileStatus(status: string) {
  if (status === "Done") return "成功";
  if (status === "File type not supported") return "不支持此文件类型";
  if (status === "Failed, check logs") return "转换失败";
  return "处理中";
}

function parsePage(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

const HISTORY_PAGE_SIZE = resourceLimits.historyPageSize;

function pageHref(page: number) {
  return `${WEBROOT}/history?page=${page}`;
}

export const history = new Elysia().use(userService).get(
  "/history",
  async ({ redirect, user, query }) => {
    if (HIDE_HISTORY) {
      return redirect(`${WEBROOT}/`, 302);
    }

    if (!user) {
      return redirect(`${WEBROOT}/login`, 302);
    }

    const page = parsePage(query.page);
    const totalRow = db
      .query("SELECT COUNT(*) AS count FROM jobs WHERE user_id = ? AND num_files > 0")
      .get(user.id) as { count: number };
    const total = totalRow.count;
    const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * HISTORY_PAGE_SIZE;
    const pageNumbers = [...new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages])]
      .filter((pageNumber) => pageNumber >= 1 && pageNumber <= totalPages)
      .sort((left, right) => left - right);
    const userJobs = db
      .query(
        "SELECT * FROM jobs WHERE user_id = ? AND num_files > 0 ORDER BY id DESC LIMIT ? OFFSET ?",
      )
      .as(Jobs)
      .all(user.id, HISTORY_PAGE_SIZE, offset);
    const filesByJob = new Map<number, Filename[]>();
    if (userJobs.length > 0) {
      const placeholders = userJobs.map(() => "?").join(",");
      const files = db
        .query(`SELECT * FROM file_names WHERE job_id IN (${placeholders}) ORDER BY id`)
        .as(Filename)
        .all(...userJobs.map((job) => job.id));
      for (const file of files) {
        const list = filesByJob.get(file.job_id) ?? [];
        list.push(file);
        filesByJob.set(file.job_id, list);
      }
    }
    for (const job of userJobs) {
      job.files_detailed = filesByJob.get(job.id) ?? [];
      job.finished_files = job.files_detailed.length;
    }

    return (
      <BaseHtml webroot={WEBROOT} title={`${BRANDING} | 转换历史`}>
        <>
          <Header
            webroot={WEBROOT}
            branding={BRANDING}
            allowUnauthenticated={ALLOW_UNAUTHENTICATED}
            hideHistory={HIDE_HISTORY}
            loggedIn
            active="history"
          />
          <main class="app-container sx-page" id="main-content" tabindex="-1">
            <div class="page-heading sx-page-heading">
              <span class="eyebrow">任务中心</span>
              <h1>转换历史</h1>
              <p class="muted">查看任务进度、文件结果，或清理不再需要的记录。</p>
            </div>
            {userJobs.length === 0 ? (
              <section class="surface empty-state sx-empty-history">
                <span class="sx-empty-mark">
                  <SymbolIcon name="history" size={25} />
                </span>
                <h2>这里还没有转换记录</h2>
                <p class="muted">开始一次转换后，任务和文件都会保存在这里。</p>
                <a href={`${WEBROOT}/`} class="btn-primary">
                  前往转换台 <SymbolIcon name="arrow" size={16} />
                </a>
              </section>
            ) : (
              <section class="surface sx-history-panel" aria-labelledby="sx-history-title">
                <div class="sx-panel-head sx-history-head">
                  <div>
                    <h2 id="sx-history-title">任务列表</h2>
                    <p class="muted">共 {userJobs.length} 个任务，按最近创建排序</p>
                  </div>
                  <div id="delete-selected-container" class="sx-selection-actions">
                    <span id="selected-count" class="muted" aria-live="polite">
                      已选择 0 项
                    </span>
                    <button
                      id="delete-selected-btn"
                      type="button"
                      class="sx-danger btn-secondary"
                      disabled
                    >
                      <SymbolIcon name="trash" size={16} /> <span>删除所选任务</span>
                    </button>
                  </div>
                </div>
                <div class="sx-table-wrap">
                  <table class="sx-table sx-history-table">
                    <thead>
                      <tr>
                        <th scope="col" class="sx-check-cell">
                          <input type="checkbox" id="select-all" aria-label="选择全部任务" />
                        </th>
                        <th scope="col">文件</th>
                        <th scope="col">创建时间</th>
                        <th scope="col">状态</th>
                        <th scope="col">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userJobs.map((job) => {
                        const firstFile = job.files_detailed[0];
                        const date = new Date(job.date_created).toLocaleString("zh-CN", {
                          timeZone: TIMEZONE,
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        });
                        const done = job.status === "completed";
                        const failed = job.status === "failed";
                        return (
                          <tr id={`job-row-${job.id}`}>
                            <td class="sx-check-cell">
                              <input
                                type="checkbox"
                                data-checkbox-type="job"
                                data-job-id={job.id}
                                aria-label={`选择任务 ${job.id}`}
                              />
                            </td>
                            <td>
                              <details class="sx-history-details">
                                <summary>
                                  <span class="sx-file-icon">
                                    <SymbolIcon name="file" size={17} />
                                  </span>
                                  <span
                                    class="sx-history-file-name"
                                    title={firstFile?.file_name}
                                    safe
                                  >
                                    {firstFile?.file_name ?? "文件信息处理中"}
                                  </span>
                                  <span class="badge sx-file-count">{job.num_files} 个文件</span>
                                  <span class="sx-details-label">
                                    文件清单 <SymbolIcon name="chevron" size={14} />
                                  </span>
                                </summary>
                                <div class="sx-detail-list" id={`details-${job.id}`}>
                                  {job.files_detailed.map((file: Filename) => (
                                    <div class="sx-detail-row">
                                      <span class="sx-detail-name" title={file.file_name} safe>
                                        {file.file_name}
                                      </span>
                                      <SymbolIcon name="arrow" size={15} />
                                      <span
                                        class="sx-detail-name"
                                        title={file.output_file_name}
                                        safe
                                      >
                                        {file.output_file_name}
                                      </span>
                                      <span
                                        class={`
                                          badge
                                          ${
                                            file.status === "Done"
                                              ? "sx-badge-success"
                                              : `sx-badge-warning`
                                          }
                                        `}
                                        title={fileStatus(file.status)}
                                      >
                                        {fileStatus(file.status)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            </td>
                            <td class="sx-date-cell">
                              <time datetime={job.date_created} safe>
                                {date}
                              </time>
                            </td>
                            <td>
                              <span
                                class={`
                                  badge
                                  ${
                                    done
                                      ? "sx-badge-success"
                                      : failed
                                        ? `sx-badge-warning`
                                        : `sx-badge-pending`
                                  }
                                `}
                                title={jobStatus(job.status)}
                              >
                                <span class="sx-status-dot" />
                                {jobStatus(job.status)}
                              </span>
                            </td>
                            <td>
                              <div class="sx-actions sx-history-actions">
                                <a
                                  href={`${WEBROOT}/results/${job.id}`}
                                  class="sx-text-action"
                                  aria-label={`查看任务 ${job.id} 结果`}
                                >
                                  <SymbolIcon name="arrow" size={16} /> 查看
                                </a>
                                <form
                                  action={`${WEBROOT}/delete/${job.id}`}
                                  method="POST"
                                  data-confirm-delete
                                >
                                  <button
                                    type="submit"
                                    class="sx-icon-danger"
                                    aria-label={`删除任务 ${job.id}`}
                                    title="删除任务"
                                  >
                                    <SymbolIcon name="trash" size={17} />
                                  </button>
                                </form>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {total > 0 ? (
              <nav class="sx-history-pagination" aria-label="转换历史分页">
                <span class="sx-history-page-summary">
                  第 {currentPage} / {totalPages} 页，共 {total} 个任务
                </span>
                <div class="sx-history-page-links">
                  {currentPage > 1 ? (
                    <a class="sx-text-action" href={pageHref(currentPage - 1)} rel="prev">
                      <SymbolIcon name="arrow" size={15} /> 上一页
                    </a>
                  ) : (
                    <span class="sx-text-action is-disabled" aria-disabled="true">
                      上一页
                    </span>
                  )}
                  {pageNumbers.map((pageNumber, index) => (
                    <>
                      {index > 0 && pageNumber - pageNumbers[index - 1]! > 1 ? (
                        <span class="sx-history-page-gap" aria-hidden="true">
                          …
                        </span>
                      ) : null}
                      {pageNumber === currentPage ? (
                        <span class="sx-history-page is-current" aria-current="page">
                          {pageNumber}
                        </span>
                      ) : (
                        <a class="sx-history-page" href={pageHref(pageNumber)}>
                          {pageNumber}
                        </a>
                      )}
                    </>
                  ))}
                  {currentPage < totalPages ? (
                    <a class="sx-text-action" href={pageHref(currentPage + 1)} rel="next">
                      下一页 <SymbolIcon name="arrow" size={15} />
                    </a>
                  ) : (
                    <span class="sx-text-action is-disabled" aria-disabled="true">
                      下一页
                    </span>
                  )}
                </div>
              </nav>
            ) : null}
          </main>
          <script>
            {`
              (() => {
                const checkboxes = Array.from(document.querySelectorAll('[data-checkbox-type="job"]'));
                const selectAll = document.getElementById('select-all');
                const deleteButton = document.getElementById('delete-selected-btn');
                const selectedCount = document.getElementById('selected-count');
                const main = document.getElementById('main-content');
                const webroot = document.querySelector("meta[name='webroot']")?.content ?? '';

                const updateSelection = () => {
                  const selected = checkboxes.filter((checkbox) => checkbox.checked);
                  if (selectedCount) selectedCount.textContent = '已选择 ' + selected.length + ' 项';
                  if (deleteButton) deleteButton.disabled = selected.length === 0;
                  if (selectAll) {
                    selectAll.checked = checkboxes.length > 0 && selected.length === checkboxes.length;
                    selectAll.indeterminate = selected.length > 0 && selected.length < checkboxes.length;
                  }
                };

                selectAll?.addEventListener('change', () => {
                  checkboxes.forEach((checkbox) => { checkbox.checked = selectAll.checked; });
                  updateSelection();
                });
                checkboxes.forEach((checkbox) => checkbox.addEventListener('change', updateSelection));

                main?.addEventListener('submit', (event) => {
                  const form = event.target.closest('form[data-confirm-delete]');
                  if (form && !window.confirm('确定删除此转换任务及其文件吗？此操作无法撤销。')) event.preventDefault();
                });

                deleteButton?.addEventListener('click', async () => {
                  const jobIds = checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.dataset.jobId);
                  if (jobIds.length === 0 || !window.confirm('确定删除选中的 ' + jobIds.length + ' 个任务吗？此操作无法撤销。')) return;
                  deleteButton.disabled = true;
                  deleteButton.setAttribute('aria-busy', 'true');
                  const label = deleteButton.querySelector('span');
                  if (label) label.textContent = '正在删除…';
                  try {
                    const response = await fetch(webroot + '/delete-multiple', {
                      method: 'POST',
                      credentials: 'same-origin',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ jobIds }),
                    });
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    const result = await response.json();
                    if (result.deleted > 0) {
                      window.alert('已删除 ' + result.deleted + ' 个任务。' + (result.failed > 0 ? '有 ' + result.failed + ' 个任务未能删除。' : ''));
                      window.location.reload();
                    } else {
                      window.alert('暂时无法删除任务，请稍后重试。');
                      deleteButton.disabled = false;
                    }
                  } catch (error) {
                    console.warn('Unable to delete selected jobs', error);
                    window.alert('删除请求失败，请检查网络后重试。');
                    deleteButton.disabled = false;
                  } finally {
                    deleteButton.removeAttribute('aria-busy');
                    if (label) label.textContent = '删除所选任务';
                  }
                });
                updateSelection();
              })();
            `}
          </script>
        </>
      </BaseHtml>
    );
  },
  { auth: true, query: t.Object({ page: t.Optional(t.String()) }) },
);
