// Character reactions use focus, pointer and element geometry only. This module
// never reads input values, selection positions, password lengths or stored data.
document.querySelectorAll(".sx-auth-layout").forEach((layout) => {
  const actor = layout.querySelector("[data-auth-mascot]");
  const message = layout.querySelector("[data-auth-mascot-message]");
  const form = layout.querySelector("form");
  if (!actor || !message || !form) return;
  const greeting = message.textContent;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let focused = null;
  let peekTimer;
  let coverTimer;
  let typingTimer;
  let gazeFrame;
  let active = true;
  let mascotVisible = true;
  const syncMotion = () => { actor.dataset.motionPaused = String(document.hidden || !mascotVisible); };
  const clamp = (n, limit) => Math.max(-limit, Math.min(limit, n));
  const isPassword = (target) => target instanceof HTMLInputElement && target.type === "password";
  const cancelPeek = () => {
    clearTimeout(peekTimer);
    clearTimeout(coverTimer);
  };
  const mode = (next) => {
    actor.dataset.mascotMode = next;
  };
  const gaze = (x, y) => {
    const box = actor.getBoundingClientRect();
    const eyeX = box.left + box.width * 0.48;
    const eyeY = box.top + box.height * 0.14;
    actor.style.setProperty("--gaze-x", clamp((x - eyeX) / 60, 7) + "px");
    actor.style.setProperty("--gaze-y", clamp((y - eyeY) / 45, 5) + "px");
    actor.style.setProperty("--head-turn", clamp((x - eyeX) / 500, 1.4) + "deg");
  };
  const lookAtField = () => {
    if (!focused) return;
    const rect = focused.getBoundingClientRect();
    gaze(rect.left + rect.width * 0.4, rect.top + rect.height / 2);
  };
  function planPeek() {
    cancelPeek();
    if (reduced.matches || document.hidden || !mascotVisible || !isPassword(focused)) return;
    peekTimer = setTimeout(() => {
      if (
        !active ||
        !mascotVisible ||
        document.hidden ||
        reduced.matches ||
        document.activeElement !== focused ||
        !isPassword(focused)
      )
        return;
      lookAtField();
      mode("peeking");
      coverTimer = setTimeout(() => {
        if (!active || !isPassword(focused)) return;
        mode("covered");
        planPeek();
      }, 720);
    }, 2900);
  }
  function reactToFocus(target) {
    focused =
      target instanceof HTMLInputElement && target.type !== "hidden" && form.contains(target)
        ? target
        : null;
    cancelPeek();
    if (isPassword(focused)) {
      mode("covered");
      message.textContent = "密码我不看！眼睛捂好啦…才没有偷偷瞄呢～";
      lookAtField();
      planPeek();
    } else if (focused) {
      mode("watching");
      message.textContent = "我在这里陪你，填好信息就可以继续啦～";
      lookAtField();
    } else {
      mode("idle");
      message.textContent = greeting;
      actor.style.setProperty("--gaze-x", "0px");
      actor.style.setProperty("--gaze-y", "0px");
      actor.style.setProperty("--head-turn", "0deg");
    }
  }
  form.addEventListener("focusin", (event) => reactToFocus(event.target));
  form.addEventListener("focusout", () =>
    queueMicrotask(() => reactToFocus(document.activeElement)),
  );
  form.addEventListener("input", (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    clearTimeout(typingTimer);
    actor.dataset.typing = "true";
    lookAtField();
    typingTimer = setTimeout(() => {
      delete actor.dataset.typing;
    }, 420);
  });
  document.addEventListener(
    "pointermove",
    (event) => {
      if (focused || reduced.matches || document.hidden || !mascotVisible) return;
      cancelAnimationFrame(gazeFrame);
      gazeFrame = requestAnimationFrame(() => gaze(event.clientX, event.clientY));
    },
    { passive: true },
  );
  const reposition = () => {
    if (!focused || !mascotVisible) return;
    cancelAnimationFrame(gazeFrame);
    gazeFrame = requestAnimationFrame(lookAtField);
  };
  window.addEventListener("resize", reposition, { passive: true });
  window.addEventListener("scroll", reposition, { passive: true });
  window.visualViewport?.addEventListener("resize", reposition, { passive: true });
  document.addEventListener("visibilitychange", () => {
    syncMotion();
    if (document.hidden) {
      cancelPeek();
      if (isPassword(focused)) mode("covered");
    } else reactToFocus(document.activeElement);
  });
  if (typeof IntersectionObserver === "function") {
    const observer = new IntersectionObserver((entries) => {
      mascotVisible = entries.some((entry) => entry.isIntersecting);
      syncMotion();
      if (!mascotVisible) { cancelPeek(); if (isPassword(focused)) mode("covered"); }
      else reactToFocus(document.activeElement);
    }, { rootMargin: "80px" });
    observer.observe(layout.querySelector(".sx-auth-scene") || actor);
  }
  reduced.addEventListener("change", () => reactToFocus(document.activeElement));
  window.addEventListener("pagehide", () => {
    active = false;
    cancelPeek();
    clearTimeout(typingTimer);
    cancelAnimationFrame(gazeFrame);
  });
  window.addEventListener("pageshow", () => {
    active = true;
    syncMotion();
    reactToFocus(document.activeElement);
  });
  const image = actor.querySelector(".sx-auth-interactive");
  const enhance = () => {
    actor.dataset.mascotEnhanced = "true";
  };
  if (image?.complete && image.naturalWidth > 0) enhance();
  else image?.addEventListener("load", enhance, { once: true });
  reactToFocus(document.activeElement);
});
