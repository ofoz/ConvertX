(() => {
  const workspace = document.querySelector("[data-service-workspace]");
  if (!workspace) return;
  const $ = (id) => document.getElementById(id);
  const webroot = document.querySelector("meta[name='webroot']").content;
  const form = $("convert-form");
  const picker = form.querySelector(".select_container");
  const initialPicker = picker.innerHTML;
  const input = $("file-input");
  const hall = $("service-hall");
  // Narrow screens show one coworker per slide; open on the service counter.
  const stationTrack = hall?.querySelector(".hall-stations");
  const spotlightStation = hall?.querySelector(".hall-station-deepseek");
  const narrow = matchMedia("(max-width: 700px)");
  function centerSpotlight() {
    if (!stationTrack || !spotlightStation || !narrow.matches) return;
    stationTrack.scrollLeft =
      spotlightStation.offsetLeft - (stationTrack.clientWidth - spotlightStation.offsetWidth) / 2;
  }
  centerSpotlight();
  narrow.addEventListener("change", centerSpotlight);
  const records = new Map();
  const claimed = new Set();
  const aliases = { jpg: "jpeg", jfif: "jpeg", htm: "html", tex: "latex", md: "markdown" };
  const params = new URLSearchParams(location.search);
  const storageKey = `convertx-hall:${webroot}:order-v1`;
  const canonical = (value) => aliases[value.toLowerCase()] || value.toLowerCase();
  const sizeLabel = (n) =>
    n < 1024
      ? `${n} B`
      : n < 1048576
        ? `${(n / 1024).toFixed(1)} KB`
        : `${(n / 1048576).toFixed(1)} MB`;
  let jobId = workspace.dataset.jobId || "";
  let requiresAuth = workspace.dataset.requiresAuth === "true";
  let desired = "";
  let sourceType = "";
  let stage = "welcome";
  let formatsLoading = false;
  let formatGeneration = 0;
  let formatController;
  let currentJob = null;
  let nextFileId = 0;
  let autoTimer;
  let pollTimer;
  let pollBusy = false;
  let pollFailures = 0;
  let downloadBusy = false;
  let autoPaused = false;
  const maxFileBytes = Number(workspace.dataset.maxFileBytes) || 256 * 1024 * 1024;
  const maxFiles = Number(workspace.dataset.maxFiles) || 20;
  const pendingUploads = [];
  let activeUploads = 0;
  let pollEtag = "";
  let pollSignature = "";
  let pollOwner = "";
  let pollDelay = 1200;
  let creatingJob;
  let submitting = false;

  const chosenValue = () => form.querySelector("select[name='convert_to']")?.value || "";
  const deliverable = () =>
    (currentJob?.files || []).filter((file) => file.status === "Done" && file.downloadUrl);
  const remaining = () => deliverable().filter((file) => !claimed.has(String(file.id)));
  const busy = () => stage === "working" || stage === "delivering" || submitting;
  const allUploaded = () =>
    records.size > 0 && [...records.values()].every((record) => record.status === "ready");
  function persist() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ jobId, desired, claimed: [...claimed] }));
    } catch {
      /* The hall still works if browser storage is unavailable. */
    }
  }
  function notice(text = "", error = false) {
    const node = $("upload-message");
    node.textContent = text;
    node.dataset.tone = error ? "error" : "info";
    node.setAttribute("role", error ? "alert" : "status");
    node.hidden = !text;
  }
  function speak(text) {
    const node = $("hall-dialogue");
    if (node && node.textContent !== text) node.textContent = text;
  }
  function setStage(value, text) {
    stage = value;
    workspace.dataset.stage = value;
    if (hall) hall.dataset.stage = value;
    if (text) speak(text);
    paint();
  }
  function cancelAuto() {
    clearTimeout(autoTimer);
    autoTimer = undefined;
  }
  function headers(id = jobId) {
    const values = { Accept: "application/json", "X-ConvertX-UI": "hall" };
    if (id) values["X-ConvertX-Job"] = String(id);
    return values;
  }
  async function jsonRequest(route, init = {}, id = jobId) {
    const response = await fetch(`${webroot}${route}`, {
      ...init,
      headers: { ...headers(id), ...init.headers },
      credentials: "same-origin",
    });
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error("服务没有返回可识别的办理结果，请刷新页面再试。");
    }
    if (!response.ok) {
      const error = new Error(
        [401, 403].includes(response.status)
          ? "登录已失效，请重新登录后再办理。"
          : body.message || "业务暂时没有办成，请稍后重试。",
      );
      error.status = response.status;
      throw error;
    }
    return body;
  }
  function authenticationUrl(destination) {
    const query = new URLSearchParams();
    if (desired) query.set("to", desired);
    const converter = params.get("converter");
    if (converter) query.set("converter", converter);
    const target = `${webroot}/${query.size ? "?" + query.toString() : ""}`;
    const url = new URL(destination, location.origin);
    url.searchParams.set("next", target);
    return url.pathname + url.search;
  }
  function requestAuthentication() {
    if (!requiresAuth) return false;
    cancelAuto();
    const loginDestination = workspace.dataset.loginUrl || `${webroot}/login`;
    const login = authenticationUrl(loginDestination);
    const firstSetup = new URL(loginDestination, location.origin).pathname === `${webroot}/setup`;
    $("business-auth-login").href = login;
    $("business-auth-login").textContent = firstSetup ? "创建首个账号并继续" : "登录并继续";
    const registration = workspace.dataset.registerUrl;
    $("business-auth-register").hidden = !registration || firstSetup;
    $("business-auth-description").textContent = firstSetup
      ? "工坊已准备好。创建首个账号后，就能开始办理文件转换。"
      : registration
        ? "工坊可以自由浏览；办理文件转换前，请先登录或创建账号。"
        : "工坊可以自由浏览；办理文件转换前，请先登录。";
    if (registration) $("business-auth-register").href = authenticationUrl(registration);
    $("business-auth-selection").textContent = desired
      ? `已选 ${desired.toUpperCase()}，登录后会继续这项业务。`
      : "所选目标格式会保留，登录后继续。";
    speak("需要交文件了吗？请先登录或注册，选好的格式会帮你保留哦～");
    const dialog = $("business-auth-dialog");
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
      $("business-auth-login").focus({ preventScroll: true });
    } else location.assign(login);
    return true;
  }
  async function ensureJob() {
    if (requiresAuth) throw new Error("请先登录后再办理文件。");
    if (jobId) return jobId;
    if (!creatingJob)
      creatingJob = jsonRequest("/api/jobs", { method: "POST" }, "")
        .then((result) => {
          jobId = String(result.jobId);
          if (!/^\d+$/.test(jobId)) throw new Error("业务单号无效，请刷新页面。");
          persist();
          return jobId;
        })
        .finally(() => {
          creatingJob = undefined;
        });
    return creatingJob;
  }
  function showPicker() {
    if (stage === "error" && currentJob?.status === "completed") {
      newBusiness();
      return;
    }
    if (busy()) {
      notice("这一单还在办理，请先等鲸鱼娘处理完。");
      return;
    }
    if (stage === "ready") {
      speak("文件已经在桌上啦，先取走这一单，再来办新的业务吧～");
      return;
    }
    if (stage === "idle") {
      newBusiness();
      return;
    }
    cancelAuto();
    autoPaused = true;
    $("business-format-panel").hidden = false;
    setStage("choosing", "今天想转换成什么格式？在下面挑一个业务就好啦！");
    $("business-order").scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      block: "start",
    });
    $("target-search")?.focus({ preventScroll: true });
  }
  function paint() {
    const files = [...records.values()];
    const uploading = files.filter((record) => record.status === "uploading").length;
    const failed = files.filter((record) => record.status === "error").length;
    const receive = Boolean(desired && !busy() && !["ready", "idle"].includes(stage));
    const canStart =
      allUploaded() &&
      Boolean(chosenValue()) &&
      !formatsLoading &&
      !busy() &&
      !["ready", "idle"].includes(stage);
    $("hall-receive").disabled = !receive;
    $("fallback-upload").disabled = !receive;
    $("business-receive-note").hidden = !receive;
    $("business-selection").hidden = !desired;
    $("chosen-format").textContent = desired ? desired.toUpperCase() : "请选择目标格式";
    $("source-summary").textContent = sourceType
      ? `${sourceType.toUpperCase()} → ${desired.toUpperCase()} · ${files.length || currentJob?.totalFiles || 0} 个输入文件`
      : "选好格式后，点鲸鱼娘的手交文件。";
    $("business-ticket").textContent = requiresAuth
      ? "游客浏览"
      : desired && jobId
        ? `业务单 #${jobId}`
        : "等待选择业务";
    $("target-fieldset").disabled = busy() || ["ready", "idle"].includes(stage);
    $("change-business").disabled = busy() || ["ready", "idle"].includes(stage);
    $("file-list-heading").hidden = files.length === 0;
    $("file-count").textContent = `本次交来 ${files.length} 个文件`;
    $("clear-files").disabled = busy();
    $("convert-submit").hidden = !canStart;
    $("convert-submit").disabled = !canStart;
    $("add-more-files").hidden = !canStart;
    $("retry-business").hidden = stage !== "error";
    $("business-login").hidden = !workspace.dataset.authExpired;
    $("business-login").href = authenticationUrl(workspace.dataset.loginUrl || `${webroot}/login`);
    if (requiresAuth)
      document.querySelectorAll(".app-nav-links--account a").forEach((link) => {
        const path = new URL(link.href, location.origin).pathname;
        if (path === `${webroot}/login` || path === `${webroot}/setup`)
          link.href = authenticationUrl(workspace.dataset.loginUrl || `${webroot}/login`);
        if (path === `${webroot}/register` && workspace.dataset.registerUrl)
          link.href = authenticationUrl(workspace.dataset.registerUrl);
      });
    $("business-job-progress").hidden = stage !== "working";
    $("business-next").hidden = stage !== "idle";
    $("hall-start-new").hidden = stage !== "idle";
    $("download-again").hidden = stage !== "idle" || deliverable().length === 0;
    const left = remaining();
    $("hall-stack").hidden = !["ready", "delivering"].includes(stage) || left.length === 0;
    $("collect-files").disabled = downloadBusy || !left.length;
    $("hall-stack-count").textContent = `${left.length} 份`;
    $("hall-top-file").textContent =
      left.length > 1 && currentJob?.archiveUrl && claimed.size === 0
        ? `领取全部 ${left.length} 份`
        : left[0]?.name || "文件已办好";
    $("hall-top-file").title = left[0]?.name || "";
    $("hall-task-label").textContent =
      stage === "working"
        ? `${sourceType ? sourceType.toUpperCase() + " → " : "正在转换为 "}${desired.toUpperCase()}`
        : stage === "idle"
          ? "本单已交付 · 摸鱼中"
          : stage === "ready"
            ? "业务办好，等待取件"
            : "等待办理";
    $("selection-status").textContent = requiresAuth
      ? "可自由浏览与选择格式；交文件时再登录或注册。"
      : stage === "working"
        ? "鲸鱼娘正在实际处理文件，完成后会把结果放到桌上。"
        : stage === "ready"
          ? "点桌上的文件取件；也可以在下方逐份领取。"
          : stage === "idle"
            ? "文件已交给浏览器保存；如果没找到，可以重新取件。"
            : failed
              ? `${failed} 个文件上传失败，请重试或移除。`
              : uploading
                ? `正在接收 ${uploading} 个文件…`
                : stage === "placing"
                  ? "文件收好啦，马上自动开工；还想加文件可以点“继续加文件”。"
                  : autoPaused && canStart
                    ? "文件已收好，确认后点“立即开始办理”。"
                    : desired
                      ? "点鲸鱼娘的手，或点“选择文件”；上传完成后会自动办理。"
                      : "先选择目标格式，鲸鱼娘就会准备接收文件。";
    const active = ["welcome", "choosing"].includes(stage)
      ? 0
      : ["receiving", "uploading", "placing", "error"].includes(stage)
        ? 1
        : stage === "working"
          ? 2
          : 3;
    [...document.querySelectorAll("[data-business-step]")].forEach((node, index) => {
      node.classList.toggle("is-active", index === active);
      node.classList.toggle("is-complete", index < active);
    });
  }
  function applyTarget(value, speakSelection = true) {
    cancelAuto();
    const select = form.querySelector("select[name='convert_to']");
    if (!select || ![...select.options].some((option) => option.value === value)) return false;
    select.value = value;
    desired = value.split(",")[0];
    form.querySelectorAll(".target").forEach((button) => {
      const selected = button.dataset.target === desired;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const engine = $("engine-choice");
    engine.replaceChildren();
    [...select.options]
      .filter((option) => option.value.startsWith(`${desired},`))
      .forEach((option) => engine.add(new Option(option.value.split(",")[1], option.value)));
    engine.value = value;
    engine.disabled = !sourceType;
    $("business-format-panel").hidden = true;
    autoPaused = false;
    persist();
    if (speakSelection)
      setStage(
        "receiving",
        `转成 ${desired.toUpperCase()} 对吧？已经准备好啦，请点我的手，把文件交给我～`,
      );
    paint();
    maybeStart();
    return true;
  }
  async function chooseTarget(value) {
    if (busy() || ["ready", "idle"].includes(stage)) return;
    cancelAuto();
    notice();
    try {
      if (!requiresAuth) await ensureJob();
      if (applyTarget(value)) {
        hall.scrollIntoView({
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
          block: "center",
        });
        $("hall-receive").focus({ preventScroll: true });
      }
    } catch (error) {
      showError(error);
    }
  }
  async function loadFormats(type) {
    formatController?.abort();
    formatController = new AbortController();
    const version = ++formatGeneration;
    formatsLoading = true;
    paint();
    try {
      const response = await fetch(`${webroot}/conversions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileType: type }),
        signal: formatController.signal,
      });
      if (!response.ok) throw new Error("格式匹配失败，请稍后再试。");
      const html = await response.text();
      if (version !== formatGeneration) return;
      picker.innerHTML = html;
      const select = form.querySelector("select[name='convert_to']");
      const preferredEngine = params.get("converter");
      const candidates = [...select.options].filter((option) =>
        option.value.startsWith(`${desired},`),
      );
      const target =
        candidates.find(
          (option) => !preferredEngine || option.value.endsWith(`,${preferredEngine}`),
        ) || candidates[0];
      $("format-count").textContent = `${form.querySelectorAll(".target").length} 种可选格式`;
      if (target) applyTarget(target.value, false);
      else {
        $("business-format-panel").hidden = false;
        autoPaused = true;
        setStage(
          "error",
          `这份 ${type.toUpperCase()} 暂时不能转成 ${desired.toUpperCase()}，我把可办理的格式列出来了，可以换一种试试。`,
        );
        notice("已保留上传文件。请选择下面兼容的目标格式，无需再次上传。", true);
      }
    } catch (error) {
      if (version === formatGeneration && error.name !== "AbortError") showError(error);
    } finally {
      if (version === formatGeneration) {
        formatsLoading = false;
        paint();
        maybeStart();
      }
    }
  }
  function maybeStart() {
    if (
      autoPaused ||
      autoTimer ||
      busy() ||
      ["ready", "idle"].includes(stage) ||
      formatsLoading ||
      !allUploaded() ||
      !chosenValue()
    )
      return;
    setStage("placing", "文件收到啦！我先把它们放在办公桌上，马上开始办理～");
    autoTimer = setTimeout(() => {
      autoTimer = undefined;
      startConversion();
    }, 1100);
  }
  function filterTargets() {
    const query = canonical($("target-search").value.trim().replace(/^\./, ""));
    let matches = 0;
    form.querySelectorAll(".target").forEach((button) => {
      button.hidden = Boolean(
        query && !`${button.dataset.target} ${button.textContent}`.toLowerCase().includes(query),
      );
      if (!button.hidden) matches += 1;
    });
    $("target-search-empty").hidden = matches > 0;
  }
  function finishUpload(record, success, text) {
    if (!records.has(record.id)) return;
    record.status = success ? "ready" : "error";
    record.xhr = null;
    record.row.dataset.state = record.status;
    record.row.querySelector("[data-upload-status]").textContent = success
      ? "鲸鱼娘已接收"
      : "上传失败";
    record.row.querySelector("progress").hidden = success;
    record.row.querySelector("[data-retry-file]").hidden = success;
    if (!success) {
      notice(text || "文件没有送到，请重试上传。", true);
      setStage("error", "刚才没有接稳这份文件，点“重试”再交给我一次吧。");
    }
    paint();
    maybeStart();
  }
  function upload(record) {
    if (!record || record.queued || record.xhr || requestAuthentication()) return;
    cancelAuto();
    record.queued = true;
    record.status = "uploading";
    record.row.dataset.state = "uploading";
    record.row.querySelector("[data-retry-file]").hidden = true;
    record.row.querySelector("[data-upload-status]").textContent = "等待交文件…";
    pendingUploads.push(record);
    pumpUploads();
  }
  function pumpUploads() {
    while (activeUploads < 3 && pendingUploads.length) {
      const record = pendingUploads.shift();
      record.queued = false;
      if (records.get(record.id) !== record) continue;
      if (requiresAuth) { finishUpload(record, false, "请先重新登录后再交文件。"); continue; }
      activeUploads++;
      try { sendUpload(record); } catch (error) {
        activeUploads--;
        record.xhr = null;
        finishUpload(record, false, error.message || "上传未能开始，请重试。");
      }
    }
  }
  function sendUpload(record) {
    cancelAuto();
    record.status = "uploading";
    record.row.dataset.state = "uploading";
    record.row.querySelector("[data-retry-file]").hidden = true;
    record.row.querySelector("[data-upload-status]").textContent = "正在交文件…";
    const progress = record.row.querySelector("progress");
    progress.hidden = false;
    progress.removeAttribute("value");
    const data = new FormData();
    data.append("file", record.file, record.file.name);
    const xhr = new XMLHttpRequest();
    record.xhr = xhr;
    xhr.addEventListener("loadend", () => {
      activeUploads = Math.max(0, activeUploads - 1);
      if (record.xhr === xhr) record.xhr = null;
      pumpUploads();
    }, { once: true });
    xhr.open("POST", `${webroot}/upload`);
    xhr.timeout = 180000;
    Object.entries(headers(record.jobId)).forEach(([key, value]) =>
      xhr.setRequestHeader(key, value),
    );
    xhr.upload.onprogress = (event) => {
      if (records.has(record.id) && event.lengthComputable) {
        progress.value = (event.loaded / event.total) * 100;
        record.row.querySelector("[data-upload-status]").textContent =
          `交接中 ${Math.round(progress.value)}%`;
      }
    };
    xhr.onload = () => {
      let success = false;
      let failureMessage = "";
      try {
        const result = JSON.parse(xhr.responseText);
        success = xhr.status >= 200 && xhr.status < 300 && result.message === "Files uploaded successfully.";
        if (!success && typeof result.message === "string") failureMessage = result.message;
      } catch {
        /* A login page is not a successful upload. */
      }
      if ([401, 403].includes(xhr.status)) {
        workspace.dataset.authExpired = "true";
        workspace.dataset.requiresAuth = "true";
        requiresAuth = true;
        input.disabled = true;
      }
      finishUpload(
        record,
        success,
        [401, 403].includes(xhr.status)
          ? "登录已过期，请先重新登录。"
          : failureMessage || (xhr.status === 413 ? "文件超过当前上传限制，请压缩或分批办理。" : "上传未完成，请重试或换一份文件。"),
      );
    };
    xhr.onerror = () => finishUpload(record, false, "网络连接中断，请重试上传。");
    xhr.ontimeout = () => finishUpload(record, false, "上传超时，请重试；大文件可能需要更长时间。");
    xhr.onabort = () => {
      if (records.has(record.id)) finishUpload(record, false);
    };
    setStage("uploading", "我接着呢，把文件交给我就好～");
    xhr.send(data);
  }
  async function addFiles(files) {
    if (requestAuthentication()) {
      input.value = "";
      return;
    }
    if (!desired) {
      notice("请先选择想转换成的格式，再把文件交给鲸鱼娘。");
      showPicker();
      return;
    }
    if (busy() || ["ready", "idle"].includes(stage)) return;
    try {
      await ensureJob();
    } catch (error) {
      showError(error);
      return;
    }
    cancelAuto();
    autoPaused = false;
    for (const file of files) {
      if (file.size > maxFileBytes) { notice(`“${file.name}”超过单个文件 ${sizeLabel(maxFileBytes)} 的限制。`, true); continue; }
      if (records.size >= maxFiles) { notice(`每单最多 ${maxFiles} 个文件，请分批办理。`, true); break; }
      const dot = file.name.lastIndexOf(".");
      if (dot <= 0 || dot === file.name.length - 1) {
        notice("这份文件没有扩展名，请补全扩展名后再交给我。", true);
        continue;
      }
      const type = canonical(file.name.slice(dot + 1));
      if (sourceType && sourceType !== type) {
        notice(`这一单是 ${sourceType.toUpperCase()} 文件，不同格式请分开办理。`, true);
        continue;
      }
      if ([...records.values()].some((record) => record.file.name === file.name)) {
        notice(`“${file.name}”已经接收过啦，不会重复收取。`);
        continue;
      }
      const first = records.size === 0;
      sourceType = type;
      const row = document.createElement("div");
      row.className = "cx-file-row";
      row.setAttribute("role", "listitem");
      row.innerHTML =
        '<span class="cx-file-type" aria-hidden="true"></span><div class="cx-file-info"><strong data-file-name></strong><div class="cx-file-meta"><span data-file-size></span><span data-upload-status></span></div><progress max="100" aria-label="文件上传进度"></progress></div><div class="cx-file-actions"><button type="button" data-retry-file class="cx-text-button" hidden>重试</button><button type="button" data-remove-file class="icon-button" title="移除文件">×</button></div>';
      row.dataset.fileId = String(++nextFileId);
      row.querySelector(".cx-file-type").textContent = type.slice(0, 5).toUpperCase();
      row.querySelector("[data-file-name]").textContent = file.name;
      row.querySelector("[data-file-name]").title = file.name;
      row.querySelector("[data-file-size]").textContent = sizeLabel(file.size);
      row.querySelector("[data-remove-file]").setAttribute("aria-label", `移除 ${file.name}`);
      const record = { id: row.dataset.fileId, file, row, jobId, status: "uploading", xhr: null };
      records.set(record.id, record);
      $("file-list").appendChild(row);
      persist();
      if (first) loadFormats(type);
      upload(record);
    }
    input.value = "";
    paint();
  }
  async function removeFile(id) {
    if (busy()) return;
    cancelAuto();
    autoPaused = true;
    const record = records.get(id);
    if (!record) return;
    records.delete(id);
    record.xhr?.abort();
    record.row.remove();
    if (!records.size) {
      sourceType = "";
      formatController?.abort();
      formatGeneration += 1;
      formatsLoading = false;
      picker.innerHTML = initialPicker;
      const option = [...form.querySelector("select[name='convert_to']").options].find((item) =>
        item.value.startsWith(`${desired},`),
      );
      if (option) applyTarget(option.value, false);
    }
    setStage("receiving", "好啦，文件已从这一单移除。需要时再交给我～");
    paint();
    try {
      await jsonRequest(
        "/delete",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: record.file.name }),
        },
        record.jobId,
      );
    } catch {
      notice("已从列表移除，但服务器清理未完成，可稍后重新办理。", true);
    }
  }
  function showError(error) {
    submitting = false;
    cancelAuto();
    if ([401, 403].includes(error.status)) {
      workspace.dataset.authExpired = "true";
      workspace.dataset.requiresAuth = "true";
      requiresAuth = true;
    }
    notice(error.message || "这单暂时没有办成，请稍后再试。", true);
    setStage(
      "error",
      [401, 403].includes(error.status)
        ? "登录好像过期了，先重新登录，再来找我办业务吧。"
        : "遇到一点小问题，文件不会假装办好。可以换个格式或重新办理这一单。",
    );
  }
  async function startConversion() {
    if (requestAuthentication()) return;
    cancelAuto();
    if (busy() || !allUploaded() || formatsLoading || !chosenValue()) return;
    autoPaused = true;
    submitting = true;
    notice();
    setStage("working", "文件放好啦！我要开始认真工作了，请稍等一下～");
    $("job-progress-text").textContent = "正在提交这一单…";
    try {
      const result = await jsonRequest("/convert", {
        method: "POST",
        body: new URLSearchParams({
          file_names: JSON.stringify([...records.values()].map((record) => record.file.name)),
          convert_to: chosenValue(),
        }),
      });
      if (!result.jobId || String(result.jobId) !== String(jobId))
        throw new Error("办理单号与当前业务不匹配。");
      submitting = false;
      persist();
      paint();
      await pollJob();
    } catch (error) {
      showError(error);
    }
  }
  function renderResults() {
    const files = currentJob?.files || [];
    $("business-results").hidden = files.length === 0;
    $("business-result-count").textContent = `${deliverable().length} 份可领取`;
    const list = $("business-result-list");
    list.replaceChildren();
    files.forEach((file) => {
      const row = document.createElement("li");
      row.className = "business-result-row";
      const name = document.createElement("span");
      name.textContent = file.name;
      name.title = file.name;
      row.appendChild(name);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-secondary";
      if (file.status === "Done" && file.downloadUrl) {
        const taken = claimed.has(String(file.id));
        button.textContent = taken ? "已交付" : "领取文件";
        button.disabled = taken || downloadBusy;
        button.dataset.downloadFile = String(file.id);
        row.dataset.state = taken ? "claimed" : "ready";
      } else {
        button.textContent = "本份未办成";
        button.disabled = true;
        row.dataset.state = "error";
      }
      row.appendChild(button);
      list.appendChild(row);
    });
  }
  async function pollJob() {
    clearTimeout(pollTimer);
    if (pollBusy || !jobId || requiresAuth) return;
    pollBusy = true;
    const requested = jobId;
    if (pollOwner !== requested) {
      pollOwner = requested;
      pollEtag = "";
      pollSignature = "";
      pollDelay = 1200;
    }
    try {
      const requestHeaders = headers(requested);
      if (pollEtag) requestHeaders["If-None-Match"] = pollEtag;
      const response = await fetch(`${webroot}/api/jobs/${encodeURIComponent(requested)}`, { headers: requestHeaders, credentials: "same-origin", cache: "no-store" });
      if (requested !== jobId) return;
      let changed = false;
      if (response.status !== 304) {
        if (!response.ok || response.redirected) {
          const error = new Error([401,403].includes(response.status) || response.redirected ? "登录已失效，请重新登录后再办理。" : "暂时无法读取办理进度。");
          error.status = response.redirected ? 401 : response.status;
          throw error;
        }
        const result = await response.json();
        const signature = JSON.stringify(result);
        changed = signature !== pollSignature;
        pollSignature = signature;
        currentJob = result;
        pollEtag = response.headers.get("ETag") || "";
      }
      if (!currentJob) throw new Error("进度数据尚未准备好。");
      const result = currentJob;
      pollFailures = 0;
      $("reconnect-job").hidden = true;
      pollDelay = changed ? 1200 : Math.min(5000, Math.round(pollDelay * 1.5));
      if (changed) {
        if (!sourceType && result.files[0]?.inputName.includes(".")) sourceType = canonical(result.files[0].inputName.split(".").pop());
        $("job-progress-text").textContent = `已办理 ${result.completedInputs} / ${result.totalFiles} 个输入文件`;
        renderResults();
        if (result.status === "completed") {
          if (deliverable().length) {
            if (remaining().length) setStage("ready", deliverable().length === result.files.length ? `办好啦！${deliverable().length} 份文件都在桌上，点文件就可以取走啦～` : `有 ${deliverable().length} 份办好啦，先取走成功的文件；没办成的可以换个引擎再试。`);
            else setStage("idle", "下载请求已交给浏览器啦，没收到可以重新取件～ 要办新业务再叫我哦。");
          } else setStage("error", "这一单没能生成可领取的文件，试试其他格式或引擎，我再帮你办一次。");
        } else {
          const queued = result.queue?.queued || 0;
          const running = result.queue?.running || 0;
          setStage("working", queued && !running ? `这一单有 ${queued} 个文件正在排队，轮到后就开始处理，请稍等一下哦～` : "我正在电脑前处理你的文件，办好就放到桌上，稍等一下哦～");
        }
        persist();
      }
      if (result.status !== "completed") pollTimer = setTimeout(pollJob, document.hidden ? 15000 : pollDelay);
    } catch (error) {
      if (requested !== jobId) return;
      if ([401,403,404].includes(error.status)) { showError(error); return; }
      pollFailures++;
      $("reconnect-job").hidden = false;
      notice("与工坊的连接暂时中断，正在重试。后台任务可能仍在继续，不会提前显示办好。", true);
      pollTimer = setTimeout(pollJob, document.hidden ? 15000 : Math.min(15000, 1500 * 2 ** Math.min(pollFailures, 3)));
    } finally { pollBusy = false; }
  }
  async function takeFiles(fileId) {
    if (downloadBusy) return;
    const left = remaining();
    const file = fileId ? left.find((item) => String(item.id) === String(fileId)) : left[0];
    if (!file) return;
    const archive = !fileId && left.length > 1 && claimed.size === 0 && currentJob.archiveUrl;
    let target = archive || file.downloadUrl;
    let name = archive ? `converted_files_${jobId}.tar` : file.name;
    downloadBusy = true;
    notice();
    setStage("delivering", archive ? "正在整理打包文件，准备好后交给浏览器下载～" : "正在准备交给浏览器，下载进度请查看浏览器的下载列表～");
    renderResults();
    try {
      if (archive) {
        const prepared = await jsonRequest(`/archive/${encodeURIComponent(jobId)}/prepare`, { method: "POST" });
        const preparedUrl = new URL(prepared.url, location.origin);
        if (preparedUrl.origin !== location.origin || preparedUrl.pathname !== `${webroot}/archive/${jobId}`) throw new Error("归档下载地址无效，请重试。");
        target = preparedUrl.pathname;
        name = prepared.name;
      }
      const response = await fetch(target, { method: "HEAD", headers: headers(), credentials: "same-origin", cache: "no-store" });
      if (!response.ok || response.redirected || !/^attachment(?:;|$)/i.test(response.headers.get("Content-Disposition") || "")) {
        throw new Error("文件未能交给浏览器，可能已失效或需要重新登录，请重试。");
      }
      const anchor = document.createElement("a");
      anchor.href = target;
      anchor.download = name;
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      (archive ? left : [file]).forEach((item) => claimed.add(String(item.id)));
      persist();
      if (currentJob?.status !== "completed") {
        setStage("working", "这份文件已交给浏览器，其余文件还在处理中；全部办完后我会通知你～");
      } else if (remaining().length) {
        setStage("ready", `已将下载请求交给浏览器，桌上还有 ${remaining().length} 份可以领取～`);
      } else {
        setStage("idle", "下载已交给浏览器啦！请在下载列表查看进度，没收到随时再来领取～");
      }
      $("download-hint").textContent = "下载由浏览器直接处理，不代表已经保存完成；若取消、失败或没找到文件，可以重新取件。";
    } catch (error) {
      notice(error.message || "下载未能开始，文件仍留在桌上，请重试。", true);
      if (currentJob?.status === "completed") {
        setStage("ready", "刚才没有交付成功，文件还在桌上，点一下再试吧。");
      } else {
        setStage("working", "刚才没有交付成功，可以在下方重试领取；其余文件仍在处理中。");
      }
    } finally {
      downloadBusy = false;
      renderResults();
      paint();
    }
  }
  async function newBusiness() {
    if (busy()) return;
    if (stage === "ready" && remaining().length) {
      speak("先把桌上的文件取走，再来办新业务吧～");
      return;
    }
    cancelAuto();
    clearTimeout(pollTimer);
    formatController?.abort();
    formatGeneration += 1;
    const oldRecords = [...records.values()];
    records.clear();
    oldRecords.forEach((record) => record.xhr?.abort());
    $("file-list").replaceChildren();
    claimed.clear();
    currentJob = null;
    sourceType = "";
    desired = "";
    formatsLoading = false;
    jobId = "";
    autoPaused = true;
    picker.innerHTML = initialPicker;
    $("business-results").hidden = true;
    $("business-format-panel").hidden = false;
    delete workspace.dataset.authExpired;
    notice();
    try {
      if (!requiresAuth) await ensureJob();
      setStage("choosing", "欢迎回来！下一单想转换成什么格式？我准备好啦～");
      $("business-order").scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (error) {
      showError(error);
    }
  }
  function openFileChooser() {
    if (requestAuthentication()) return;
    if (!desired) {
      showPicker();
      return;
    }
    if (busy() || ["ready", "idle"].includes(stage)) return;
    cancelAuto();
    autoPaused = true;
    if (stage === "placing") setStage("receiving", "还想加文件吗？我继续接着，选好后会一起办理～");
    paint();
    input.click();
  }
  input.addEventListener("change", () => addFiles([...input.files]));
  $("close-business-auth").addEventListener("click", () => $("business-auth-dialog").close());
  $("browse-without-login").addEventListener("click", () => $("business-auth-dialog").close());
  $("hall-receive").addEventListener("click", openFileChooser);
  $("fallback-upload").addEventListener("click", openFileChooser);
  $("add-more-files").addEventListener("click", openFileChooser);
  $("open-business").addEventListener("click", showPicker);
  $("change-business").addEventListener("click", showPicker);
  $("collect-files").addEventListener("click", () => takeFiles());
  $("hall-start-new").addEventListener("click", newBusiness);
  $("business-next").addEventListener("click", newBusiness);
  $("retry-business").addEventListener("click", newBusiness);
  $("download-again").addEventListener("click", () => {
    claimed.clear();
    persist();
    renderResults();
    setStage("ready", "没有问题，文件还保留着，再从桌上领取一次吧～");
  });
  $("reconnect-job").addEventListener("click", pollJob);
  $("business-result-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-download-file]");
    if (button) takeFiles(button.dataset.downloadFile);
  });
  $("clear-files").addEventListener("click", () => {
    [...records.keys()].forEach(removeFile);
  });
  $("file-list").addEventListener("click", (event) => {
    const row = event.target.closest("[data-file-id]");
    if (!row) return;
    if (event.target.closest("[data-remove-file]")) removeFile(row.dataset.fileId);
    if (event.target.closest("[data-retry-file]")) {
      autoPaused = false;
      notice();
      upload(records.get(row.dataset.fileId));
    }
  });
  hall.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (desired && !busy()) hall.classList.add("is-dragover");
  });
  hall.addEventListener("dragleave", (event) => {
    if (!(event.relatedTarget instanceof Node) || !hall.contains(event.relatedTarget))
      hall.classList.remove("is-dragover");
  });
  hall.addEventListener("drop", (event) => {
    event.preventDefault();
    hall.classList.remove("is-dragover");
    addFiles([...(event.dataTransfer?.files || [])]);
  });
  form.addEventListener("click", (event) => {
    const target = event.target.closest(".target");
    if (target && !target.disabled) chooseTarget(target.dataset.value);
  });
  form.addEventListener("input", (event) => {
    if (event.target.id === "target-search") filterTargets();
  });
  form.addEventListener("change", (event) => {
    if (event.target.id === "engine-choice") {
      autoPaused = false;
      applyTarget(event.target.value);
    }
  });
  form.addEventListener("keydown", (event) => {
    if (event.target.id === "target-search" && ["Enter", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const first = [...form.querySelectorAll(".target")].find(
        (button) => !button.hidden && !button.disabled,
      );
      if (first) {
        if (event.key === "Enter") first.click();
        else first.focus();
      }
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    startConversion();
  });
  let hallVisible = true;
  const syncHallMotion = () => { hall.dataset.motionPaused = String(document.hidden || !hallVisible); };
  syncHallMotion();
  if (typeof IntersectionObserver === "function") {
    const observer = new IntersectionObserver((entries) => {
      hallVisible = entries.some((entry) => entry.isIntersecting);
      syncHallMotion();
    }, { rootMargin: "160px" });
    observer.observe(hall);
  }
  document.addEventListener("visibilitychange", () => {
    syncHallMotion();
    if ((stage === "working" || stage === "delivering") && currentJob?.status !== "completed") {
      clearTimeout(pollTimer);
      if (document.hidden) pollTimer = setTimeout(pollJob, 15000);
      else { pollDelay = 1200; pollJob(); }
    }
  });

  async function restore() {
    let saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    } catch {
      saved = null;
    }
    if (
      !requiresAuth &&
      saved &&
      /^\d+$/.test(String(saved.jobId)) &&
      typeof saved.desired === "string"
    ) {
      try {
        const result = await jsonRequest(
          `/api/jobs/${encodeURIComponent(saved.jobId)}`,
          {},
          String(saved.jobId),
        );
        const savedClaims = new Set(
          (Array.isArray(saved.claimed) ? saved.claimed : []).map(String),
        );
        const alreadyCollected =
          result.status === "completed" &&
          result.files
            .filter((file) => file.status === "Done" && file.downloadUrl)
            .every((file) => savedClaims.has(String(file.id)));
        if (
          ["pending", "completed"].includes(result.status) &&
          !(params.get("to") && alreadyCollected)
        ) {
          jobId = String(saved.jobId);
          desired = saved.desired;
          (Array.isArray(saved.claimed) ? saved.claimed : []).forEach((id) =>
            claimed.add(String(id)),
          );
          $("business-format-panel").hidden = true;
          await pollJob();
          return;
        }
      } catch {
        /* A removed or foreign order must not prevent a fresh visit. */
      }
    }
    const preferred = params.get("to");
    const option =
      preferred &&
      [...form.querySelector("select[name='convert_to']").options].find((item) =>
        item.value.startsWith(`${canonical(preferred)},`),
      );
    if (option) {
      await chooseTarget(option.value);
      return;
    }
    setStage(
      "welcome",
      "欢迎光临！我是 DeepSeek 鲸鱼娘。今天想办什么格式转换业务呀？先在下面选一个目标格式吧～",
    );
    setTimeout(() => {
      if (stage === "welcome") setStage("choosing");
    }, 1900);
  }
  paint();
  restore();
})();
