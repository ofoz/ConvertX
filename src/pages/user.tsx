import { Elysia, t } from "elysia";

import { AuthLayout } from "../components/authLayout";
import db from "../db/db";
import { User } from "../db/types";
import { authPageHref, normalizeAuthReturn } from "../helpers/authReturn";
import { ACCOUNT_REGISTRATION, BRANDING, HTTP_ALLOWED, WEBROOT } from "../helpers/env";
import { userService } from "../services/user";

export { userService } from "../services/user";

export let FIRST_RUN = db.query("SELECT * FROM users").get() === null || false;

function ErrorBanner({ message }: { message: string }) {
  const displayMessage =
    message === "Invalid credentials."
      ? "邮箱或密码不正确，请检查后重试。"
      : message === "Email already in use."
        ? "此邮箱已注册，请更换邮箱后重试。"
        : message;
  return (
    <div class="sx-form-error" id="sx-form-error" role="alert">
      <p safe>{displayMessage}</p>
    </div>
  );
}

function LoginPage({
  error,
  email = "",
  returnTo,
}: {
  error?: string;
  email?: string;
  returnTo?: string | undefined;
}) {
  return (
    <AuthLayout title="登录" scene="login">
      <section class="sx-auth-card">
        <div class="sx-auth-heading">
          <span class="eyebrow">欢迎回来</span>
          <h1>登录账号</h1>
          <p class="muted">登录后继续管理你的转换任务。</p>
        </div>
        <form method="post" class="sx-form">
          {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
          {error ? <ErrorBanner message={error} /> : null}
          <label class="sx-labeled-field">
            <span>邮箱地址</span>
            <input
              type="email"
              name="email"
              placeholder="name@example.com"
              autocomplete="email"
              value={email}
              required
              class="form-field"
            />
          </label>
          <label class="sx-labeled-field">
            <span>密码</span>
            <input
              type="password"
              name="password"
              placeholder="输入密码"
              autocomplete="current-password"
              required
              class="form-field"
            />
          </label>
          <button type="submit" class="sx-submit btn-primary">
            登录
          </button>
          {ACCOUNT_REGISTRATION ? (
            <p class="sx-auth-switch muted">
              还没有账号？ <a href={authPageHref(WEBROOT, "register", returnTo)}>创建账号</a>
            </p>
          ) : null}
        </form>
      </section>
    </AuthLayout>
  );
}

function AccountPage({ email, error }: { email: string; error?: string }) {
  return (
    <AuthLayout title="账号设置" scene="account">
      <section class="sx-auth-card sx-account-card">
        <div class="sx-auth-heading">
          <span class="eyebrow">个人设置</span>
          <h1>账号设置</h1>
          <p class="muted">更新邮箱或设置新密码。更改前请验证当前密码。</p>
        </div>
        <form method="post" class="sx-form">
          {error ? <ErrorBanner message={error} /> : null}
          <label class="sx-labeled-field">
            <span>邮箱地址</span>
            <input
              type="email"
              name="email"
              placeholder="name@example.com"
              autocomplete="email"
              value={email}
              required
              class="form-field"
            />
          </label>
          <label class="sx-labeled-field">
            <span>
              新密码 <small>（留空则保持不变）</small>
            </span>
            <input
              type="password"
              name="newPassword"
              placeholder="输入新密码"
              autocomplete="new-password"
              class="form-field"
            />
          </label>
          <label class="sx-labeled-field">
            <span>当前密码</span>
            <input
              type="password"
              name="password"
              placeholder="验证当前密码"
              autocomplete="current-password"
              required
              class="form-field"
            />
          </label>
          <button type="submit" class="sx-submit btn-primary">
            保存更改
          </button>
        </form>
      </section>
    </AuthLayout>
  );
}

const PASSWORD_CONFIRMATION_MESSAGE = "两次输入的密码不一致，请重新确认。";

function RegistrationPage({
  setup = false,
  email = "",
  error,
  returnTo,
}: {
  setup?: boolean;
  email?: string;
  error?: string;
  returnTo?: string | undefined;
}) {
  return (
    <AuthLayout title={setup ? "初始设置" : "注册"} scene={setup ? "setup" : "register"}>
      <section class={setup ? "sx-auth-card sx-setup-card" : "sx-auth-card"}>
        <div class="sx-auth-heading">
          <span class="eyebrow">{setup ? "初次使用" : "新用户"}</span>
          {setup ? <h1 safe>{`欢迎使用${BRANDING}`}</h1> : <h1>创建账号</h1>}
          <p class="muted">
            {setup
              ? "先创建管理员账号，即可开始管理你的文件转换。"
              : "创建账号以保存并查看你的转换任务。"}
          </p>
        </div>
        <form
          method="post"
          action={`${WEBROOT}/register`}
          class="sx-form"
          data-register-form
          data-password-mismatch-message={PASSWORD_CONFIRMATION_MESSAGE}
        >
          {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
          {error ? <ErrorBanner message={error} /> : null}
          <label class="sx-labeled-field">
            <span>邮箱地址</span>
            <input
              type="email"
              name="email"
              placeholder="name@example.com"
              autocomplete="email"
              value={email}
              required
              class="form-field"
            />
          </label>
          <label class="sx-labeled-field">
            <span>密码</span>
            <input
              type="password"
              name="password"
              placeholder="设置密码"
              autocomplete="new-password"
              required
              class="form-field"
            />
          </label>
          <label class="sx-labeled-field">
            <span>确认密码</span>
            <input
              type="password"
              name="confirmPassword"
              placeholder="再次输入密码"
              autocomplete="new-password"
              aria-describedby="password-confirmation-error"
              required
              class="form-field"
            />
            <span
              id="password-confirmation-error"
              class="sx-confirmation-error"
              role="status"
              aria-live="polite"
              hidden
            />
          </label>
          <button type="submit" class="sx-submit btn-primary">
            {setup ? "创建账号并继续" : "注册"}
          </button>
          {!setup && (
            <p class="sx-auth-switch muted">
              已经有账号？ <a href={authPageHref(WEBROOT, "login", returnTo)}>返回登录</a>
            </p>
          )}
        </form>
        {setup && <p class="sx-setup-note muted">账号信息仅用于保护你的转换任务。</p>}
      </section>
    </AuthLayout>
  );
}

export const user = new Elysia()
  .use(userService)
  .get("/setup", ({ query, redirect }) => {
    const returnTo = normalizeAuthReturn(query.next, WEBROOT);
    if (!FIRST_RUN) return redirect(authPageHref(WEBROOT, "login", returnTo), 302);
    return <RegistrationPage setup returnTo={returnTo} />;
  })
  .get("/register", ({ query, redirect }) => {
    const returnTo = normalizeAuthReturn(query.next, WEBROOT);
    if (!ACCOUNT_REGISTRATION) return redirect(authPageHref(WEBROOT, "login", returnTo), 302);
    return <RegistrationPage returnTo={returnTo} />;
  })
  .post(
    "/register",
    async ({
      body: { email, password, confirmPassword, returnTo: submittedReturnTo },
      set,
      redirect,
      jwt,
      cookie: { auth },
    }) => {
      const returnTo = normalizeAuthReturn(submittedReturnTo, WEBROOT);
      if (!ACCOUNT_REGISTRATION && !FIRST_RUN) {
        return redirect(authPageHref(WEBROOT, "login", returnTo), 302);
      }

      if (password !== confirmPassword) {
        set.status = 400;
        return (
          <RegistrationPage
            setup={FIRST_RUN}
            email={email}
            error={PASSWORD_CONFIRMATION_MESSAGE}
            returnTo={returnTo}
          />
        );
      }

      const existingUser = await db.query("SELECT * FROM users WHERE email = ?").get(email);
      if (existingUser) {
        set.status = 400;
        if (returnTo)
          return (
            <RegistrationPage
              setup={FIRST_RUN}
              email={email}
              error="Email already in use."
              returnTo={returnTo}
            />
          );
        return { message: "Email already in use." };
      }
      const savedPassword = await Bun.password.hash(password);

      db.query("INSERT INTO users (email, password) VALUES (?, ?)").run(email, savedPassword);

      const user = db.query("SELECT * FROM users WHERE email = ?").as(User).get(email);

      if (!user) {
        set.status = 500;
        return {
          message: "Failed to create user.",
        };
      }

      FIRST_RUN = false;

      const accessToken = await jwt.sign({
        id: String(user.id),
      });

      if (!auth) {
        set.status = 500;
        return {
          message: "No auth cookie, perhaps your browser is blocking cookies.",
        };
      }

      // set cookie
      auth.set({
        value: accessToken,
        httpOnly: true,
        secure: !HTTP_ALLOWED,
        maxAge: 60 * 60 * 24 * 7,
        sameSite: "strict",
      });

      return redirect(returnTo ?? `${WEBROOT}/`, 302);
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String({ minLength: 1 }),
        confirmPassword: t.String({ minLength: 1 }),
        returnTo: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/login",
    async ({ jwt, query, redirect, cookie: { auth } }) => {
      const returnTo = normalizeAuthReturn(query.next, WEBROOT);
      if (FIRST_RUN) {
        return redirect(authPageHref(WEBROOT, "setup", returnTo), 302);
      }

      if (auth?.value) {
        const user = await jwt.verify(auth.value);

        if (user) {
          return redirect(returnTo ?? `${WEBROOT}/`, 302);
        }

        auth.remove();
      }

      return <LoginPage returnTo={returnTo} />;
    },
    { body: "signIn", cookie: "optionalSession" },
  )
  .post(
    "/login",
    async function handler({ body, set, redirect, jwt, cookie: { auth } }) {
      const returnTo = normalizeAuthReturn(body.returnTo, WEBROOT);
      const existingUser = db.query("SELECT * FROM users WHERE email = ?").as(User).get(body.email);

      if (!existingUser) {
        set.status = 403;
        return <LoginPage error="Invalid credentials." email={body.email} returnTo={returnTo} />;
      }

      const validPassword = await Bun.password.verify(body.password, existingUser.password);

      if (!validPassword) {
        set.status = 403;
        return <LoginPage error="Invalid credentials." email={body.email} returnTo={returnTo} />;
      }

      const accessToken = await jwt.sign({
        id: String(existingUser.id),
      });

      if (!auth) {
        set.status = 500;
        return {
          message: "No auth cookie, perhaps your browser is blocking cookies.",
        };
      }

      // set cookie
      auth.set({
        value: accessToken,
        httpOnly: true,
        secure: !HTTP_ALLOWED,
        maxAge: 60 * 60 * 24 * 7,
        sameSite: "strict",
      });

      return redirect(returnTo ?? `${WEBROOT}/`, 302);
    },
    { body: "signIn" },
  )
  .get("/logoff", ({ redirect, cookie: { auth } }) => {
    if (auth?.value) {
      auth.remove();
    }

    return redirect(`${WEBROOT}/`, 302);
  })
  .post("/logoff", ({ redirect, cookie: { auth } }) => {
    if (auth?.value) {
      auth.remove();
    }

    return redirect(`${WEBROOT}/`, 302);
  })
  .get(
    "/account",
    async ({ user, redirect }) => {
      if (!user) {
        return redirect(`${WEBROOT}/login`, 302);
      }

      const userData = db.query("SELECT * FROM users WHERE id = ?").as(User).get(user.id);

      if (!userData) {
        return redirect(`${WEBROOT}/`, 302);
      }

      return <AccountPage email={userData.email} />;
    },
    {
      auth: true,
    },
  )
  .post(
    "/account",
    async function handler({ body, set, redirect, jwt, cookie: { auth } }) {
      if (!auth?.value) {
        return redirect(`${WEBROOT}/login`, 302);
      }

      const user = await jwt.verify(auth.value);
      if (!user) {
        return redirect(`${WEBROOT}/login`, 302);
      }
      const existingUser = db.query("SELECT * FROM users WHERE id = ?").as(User).get(user.id);

      if (!existingUser) {
        if (auth?.value) {
          auth.remove();
        }
        return redirect(`${WEBROOT}/login`, 302);
      }

      const validPassword = await Bun.password.verify(body.password, existingUser.password);
      const emailValue = body.email || existingUser.email;

      if (!validPassword) {
        set.status = 403;
        return <AccountPage email={emailValue} error="Invalid credentials." />;
      }

      const fields = [];
      const values = [];

      if (body.email) {
        const existingEmailUser = await db
          .query("SELECT id FROM users WHERE email = ?")
          .as(User)
          .get(body.email);
        if (existingEmailUser && existingEmailUser.id.toString() !== user.id) {
          set.status = 409;
          return <AccountPage email={emailValue} error="Email already in use." />;
        }
        fields.push("email");
        values.push(body.email);
      }
      if (body.newPassword) {
        fields.push("password");
        values.push(await Bun.password.hash(body.newPassword));
      }

      if (fields.length > 0) {
        db.query(
          `UPDATE users SET ${fields.map((field) => `${field}=?`).join(", ")} WHERE id=?`,
        ).run(...values, user.id);
      }

      return redirect(`${WEBROOT}/`, 302);
    },
    {
      body: t.Object({
        email: t.MaybeEmpty(t.String()),
        newPassword: t.MaybeEmpty(t.String()),
        password: t.String(),
      }),
      cookie: "session",
    },
  );
