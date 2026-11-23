import { getAllTargets } from "../converters/main";
import { assetUrl } from "../helpers/assets";
import { BRANDING } from "../helpers/env";
import { getFormatStats } from "../helpers/formatCatalog";
import { resourceLimits } from "../helpers/resourceLimits";
import { FormatLibrary } from "./formatLibrary";
import { FormatPicker } from "./formatPicker";
import { ServiceHall } from "./serviceHall";
import { SymbolIcon } from "./symbol";

export function ConversionWorkspace({
  webroot = "",
  jobId,
  requiresAuth = false,
  loginUrl = `${webroot}/login`,
  registerUrl = "",
}: {
  webroot?: string;
  jobId?: number;
  requiresAuth?: boolean;
  loginUrl?: string;
  registerUrl?: string;
}) {
  const stats = getFormatStats();
  return (
    <main
      id="main-content"
      class="app-container business-page"
      tabindex="-1"
      data-service-workspace
      data-job-id={jobId ?? ""}
      data-requires-auth={requiresAuth ? "true" : "false"}
      data-login-url={loginUrl}
      data-register-url={registerUrl}
      data-max-file-bytes={resourceLimits.maxFileBytes}
      data-max-files={resourceLimits.maxFilesPerJob}
      data-stage="welcome"
    >
      <div class="business-welcome">
        <div>
          <h1>
            欢迎来到<span safe>{BRANDING}</span>
          </h1>
          <p>先选目标格式，再把文件交给鲸鱼娘。办理完成后，点桌上的文件取件。</p>
        </div>
        <button type="button" id="open-business" class="btn-primary">
          <SymbolIcon name="sparkles" size={18} />
          我要办理转换
        </button>
      </div>
      <ServiceHall webroot={webroot} />
      <section
        class="business-order surface"
        aria-labelledby="business-order-title"
        id="business-order"
      >
        <div class="business-order-heading">
          <div>
            <p class="eyebrow">YOUR SERVICE ORDER</p>
            <h2 id="business-order-title">今天要办理什么业务？</h2>
          </div>
          <span id="business-ticket" class="business-ticket">
            等待开单
          </span>
        </div>
        <ol class="business-steps" aria-label="办理流程">
          <li data-business-step="choose" class="is-active">
            <span>1</span>选择格式
          </li>
          <li data-business-step="receive">
            <span>2</span>交给鲸鱼娘
          </li>
          <li data-business-step="work">
            <span>3</span>耐心等一下
          </li>
          <li data-business-step="collect">
            <span>4</span>取走文件
          </li>
        </ol>
        <form method="post" action={`${webroot}/convert`} id="convert-form">
          <input type="hidden" name="file_names" id="file_names" />
          <div id="business-format-panel" class="business-format-panel">
            <div class="business-picker-title">
              <h3>想转换成哪种格式？</h3>
              <span id="format-count">{stats.outputs} 种输出格式</span>
            </div>
            <fieldset id="target-fieldset">
              <legend class="cx-sr-only">选择业务的目标格式</legend>
              <div class="select_container">
                <FormatPicker targets={getAllTargets()} />
              </div>
            </fieldset>
          </div>
          <div class="business-selection" id="business-selection" hidden>
            <span class="business-selected-icon">
              <SymbolIcon name="file" size={21} />
            </span>
            <div>
              <small>本次办理</small>
              <strong id="chosen-format">请选择目标格式</strong>
              <span id="source-summary">选好格式后，鲸鱼娘就会准备接收文件。</span>
            </div>
            <button type="button" id="change-business" class="btn-secondary">
              更换格式
            </button>
          </div>
          <input
            id="file-input"
            class="business-file-input"
            type="file"
            name="file"
            multiple
            hidden
            disabled={requiresAuth}
            aria-label="选择交给DeepSeek的文件"
          />
          <div class="business-receive-note" id="business-receive-note" hidden>
            <SymbolIcon name="upload" size={18} />
            <span>可以点鲸鱼娘的手，也可以拖拽文件到她的工位。<small class="business-upload-limits">每单最多 {resourceLimits.maxFilesPerJob} 个文件，单个最多 {Math.floor(resourceLimits.maxFileBytes / 1024 / 1024)} MiB。</small></span>
            <button type="button" id="fallback-upload" class="btn-secondary" disabled>
              选择文件
            </button>
          </div>
          <div class="cx-file-list-heading" id="file-list-heading" hidden>
            <span id="file-count">已选择 0 个文件</span>
            <button type="button" id="clear-files" class="cx-text-button">
              清空文件
            </button>
          </div>
          <div id="file-list" class="cx-file-list" role="list" aria-label="本次交来的文件" />
          <div id="upload-message" class="cx-notice" role="status" aria-live="polite" hidden />
          <div class="business-job-progress" id="business-job-progress" hidden>
            <span class="business-processing-dot" />
            <span id="job-progress-text">鲸鱼娘正在办理中…</span>
            <button id="reconnect-job" type="button" class="cx-text-button" hidden>
              重新连接
            </button>
          </div>
          <div class="business-actions">
            <button type="submit" id="convert-submit" class="btn-primary" disabled hidden>
              立即开始办理 <SymbolIcon name="arrow" size={17} />
            </button>
            <button type="button" id="add-more-files" class="btn-secondary" hidden>
              继续加文件
            </button>
            <button type="button" id="retry-business" class="btn-secondary" hidden>
              重新办一单
            </button>
            <a href={loginUrl} id="business-login" class="btn-secondary" hidden>
              重新登录
            </a>
          </div>
          <p id="selection-status" class="business-selection-status" aria-live="polite">
            选好目标格式后，点击鲸鱼娘的手上传文件。
          </p>
        </form>
        <section
          id="business-results"
          class="business-results"
          aria-labelledby="business-result-title"
          hidden
        >
          <div class="business-result-heading">
            <h3 id="business-result-title">你的文件已办好</h3>
            <span id="business-result-count" />
          </div>
          <ul id="business-result-list" />
          <div class="business-delivery-actions">
            <button type="button" id="download-again" class="btn-secondary" hidden>
              没找到下载？重新取件
            </button>
            <button type="button" id="business-next" class="btn-primary" hidden>
              再办一单
            </button>
            <a href={`${webroot}/history`} class="business-history-link">
              查看历史单据 <SymbolIcon name="arrow" size={15} />
            </a>
          </div>
          <p class="business-download-hint" id="download-hint">
            点击桌上的文件，或在这里领取。交付后仍可从历史记录再次下载。
          </p>
        </section>
      </section>
      <div class="business-facts">
        <span>
          <SymbolIcon name="grid" size={15} />
          {stats.groups} 类业务
        </span>
        <span>
          <SymbolIcon name="layers" size={15} />
          {stats.formats} 种格式
        </span>
        <span>
          <SymbolIcon name="shield" size={15} />
          文件由当前服务器处理
        </span>
      </div>
      <FormatLibrary webroot={webroot} />
      <details class="business-credits">
        <summary>角色素材与演出说明</summary>
        <p>
          DeepSeek、Claude、GPT
          为非官方同人角色形象，工坊里的角色动作仅用于展示实际文件办理状态，不代表任何厂商的官方客服。转换由当前服务器上的转换工具完成。
        </p>
        <a href={`${webroot}/characters/ATTRIBUTION.md`} target="_blank" rel="noopener noreferrer">
          查看网络图片来源、作者与素材许可
        </a>
      </details>
      <dialog
        id="business-auth-dialog"
        class="business-auth-dialog"
        aria-labelledby="business-auth-title"
        aria-describedby="business-auth-description"
      >
        <button
          type="button"
          id="close-business-auth"
          class="icon-button business-auth-close"
          aria-label="关闭登录提示"
        >
          <SymbolIcon name="x" size={19} />
        </button>
        <img
          class="business-auth-mascot"
          src={assetUrl(webroot, "characters/crop-deepseek-greeting-0.webp")}
          alt=""
          aria-hidden="true"
        />
        <p class="eyebrow">CONTINUE YOUR SERVICE</p>
        <h2 id="business-auth-title">登录后，把文件交给我吧</h2>
        <p id="business-auth-description">工坊可以自由浏览；办理文件转换前，请先登录或创建账号。</p>
        <p id="business-auth-selection" class="business-auth-selection">
          所选目标格式会保留，登录后继续。
        </p>
        <div class="business-auth-actions">
          <a id="business-auth-login" class="btn-primary" href={loginUrl}>
            登录并继续
          </a>
          <a
            id="business-auth-register"
            class="btn-secondary"
            href={registerUrl || loginUrl}
            hidden={!registerUrl}
          >
            注册新账号
          </a>
        </div>
        <button type="button" id="browse-without-login" class="business-auth-browse">
          先逛逛，暂不办理
        </button>
      </dialog>
      <noscript>
        <p class="cx-notice">
          工坊需要 JavaScript 才能接收文件与展示办理状态，请启用后刷新。历史记录中的下载仍可使用。
        </p>
      </noscript>
    </main>
  );
}
