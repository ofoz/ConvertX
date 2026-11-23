(() => {
  const webroot = document.querySelector("meta[name='webroot']")?.content ?? "";
  const results = document.getElementById("sx-results");
  const main = document.querySelector("main");
  const notice = document.getElementById("sx-poll-notice");
  const noticeMessage = document.getElementById("sx-poll-message");
  const retryButton = document.getElementById("sx-poll-retry");
  const loginLink = document.getElementById("sx-poll-login");
  const liveStatus = document.getElementById("sx-results-status");
  if (!results || !main) return;

  let currentResults = results;
  let timer;
  let isPolling = false;
  let retryDelay = 1000;
  let unchangedDelay = 1000;
  let stoppedForAuth = false;
  let etag;

  function showNotice(message, { auth = false } = {}) {
    if (!notice || !noticeMessage) return;
    noticeMessage.textContent = message;
    notice.hidden = false;
    if (retryButton) retryButton.hidden = auth;
    if (loginLink) loginLink.hidden = !auth;
  }

  function hideNotice() {
    if (notice) notice.hidden = true;
  }

  function stopTimer() {
    window.clearTimeout(timer);
    timer = undefined;
  }

  function schedule(delay = 1000) {
    stopTimer();
    if (currentResults.dataset.state !== "running" || stoppedForAuth || document.hidden) return;
    timer = window.setTimeout(poll, delay);
  }

  async function poll() {
    if (isPolling || stoppedForAuth || currentResults.dataset.state !== "running") return;
    isPolling = true;
    currentResults.setAttribute("aria-busy", "true");
    try {
      const progressUrl = currentResults.dataset.progressUrl;
      if (!progressUrl || !progressUrl.startsWith(`${webroot}/progress/`)) {
        throw new Error("进度地址无效");
      }
      const headers = { Accept: "text/html" };
      if (etag) headers["If-None-Match"] = etag;
      const response = await fetch(progressUrl, {
        method: "POST",
        credentials: "same-origin",
        headers,
      });
      if (
        response.status === 401 ||
        response.status === 403 ||
        (response.redirected && new URL(response.url).pathname.endsWith("/login"))
      ) {
        stoppedForAuth = true;
        showNotice("登录状态已失效。请重新登录后查看任务进度。", { auth: true });
        return;
      }
      if (response.status === 304) {
        retryDelay = 1000;
        schedule(unchangedDelay);
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const nextEtag = response.headers.get("etag");
      const html = await response.text();
      const documentFromResponse = new DOMParser().parseFromString(html, "text/html");
      const nextResults = documentFromResponse.getElementById("sx-results");
      if (!nextResults) throw new Error("响应中未找到任务结果");

      const focused = document.activeElement?.getAttribute?.("data-focus-key");
      const changed = !etag || !nextEtag || nextEtag !== etag;
      etag = nextEtag || etag;
      const replacement = document.importNode(nextResults, true);
      currentResults.replaceWith(replacement);
      currentResults = replacement;
      hideNotice();
      retryDelay = 1000;
      unchangedDelay = changed ? 1000 : Math.min(8000, unchangedDelay * 2);
      if (liveStatus)
        liveStatus.textContent = currentResults.dataset.announcement ?? "任务进度已更新。";
      if (focused) main.querySelector(`[data-focus-key="${CSS.escape(focused)}"]`)?.focus();
    } catch (error) {
      console.warn("Unable to refresh conversion progress", error);
      retryDelay = Math.min(Math.max(retryDelay * 2, 2000), 30000);
      showNotice("暂时无法获取最新进度。任务仍会保留，可稍后重试。", { auth: false });
    } finally {
      isPolling = false;
      currentResults.removeAttribute("aria-busy");
      schedule(Math.max(retryDelay, unchangedDelay));
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopTimer();
      return;
    }
    if (currentResults.dataset.state === "running" && !stoppedForAuth) {
      unchangedDelay = 1000;
      schedule(0);
    }
  });

  window.downloadAll = function () {
    const links = Array.from(document.querySelectorAll("#sx-results tbody a[download]"));
    links.forEach((link, index) => {
      window.setTimeout(() => {
        link.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
        );
      }, index * 300);
    });
  };

  main.addEventListener("click", (event) => {
    const button = event.target.closest("[data-download-all]");
    if (button) window.downloadAll();
    if (event.target.closest("#sx-poll-retry")) {
      stoppedForAuth = false;
      retryDelay = 1000;
      hideNotice();
      schedule(0);
    }
  });

  main.addEventListener("submit", (event) => {
    const form = event.target.closest("form[data-confirm-delete]");
    if (form && !window.confirm("确定删除此转换任务及其文件吗？此操作无法撤销。"))
      event.preventDefault();
  });

  schedule();
})();
