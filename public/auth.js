document.querySelectorAll("[data-register-form]").forEach((form) => {
  const password = form.querySelector('input[name="password"]');
  const confirmation = form.querySelector('input[name="confirmPassword"]');
  const hint = form.querySelector("#password-confirmation-error");
  if (!password || !confirmation || !hint) return;
  const message = form.dataset.passwordMismatchMessage || "两次输入的密码不一致，请重新确认。";
  const validate = () => {
    const mismatch = confirmation.value.length > 0 && password.value !== confirmation.value;
    confirmation.setCustomValidity(mismatch ? message : "");
    if (mismatch) confirmation.setAttribute("aria-invalid", "true");
    else confirmation.removeAttribute("aria-invalid");
    hint.textContent = mismatch ? message : "";
    hint.hidden = !mismatch;
    return !mismatch;
  };
  password.addEventListener("input", validate);
  confirmation.addEventListener("input", validate);
  confirmation.addEventListener("blur", validate);
  form.addEventListener("submit", (event) => {
    if (!validate()) {
      event.preventDefault();
      confirmation.reportValidity();
      confirmation.focus();
    }
  });
  validate();
});
