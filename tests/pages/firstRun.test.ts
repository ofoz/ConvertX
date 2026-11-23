import { describe, expect, test } from "bun:test";

import type { User } from "../../src/db/types";
import { db, FIRST_ACCOUNT, firstRun as recordedFirstRun, SECOND_ACCOUNT } from "./helpers/app";

// helpers/app.ts walks through the first run when it loads the pages (see the comment
// there); these tests check the recorded responses.
if (!recordedFirstRun) {
  throw new Error("The database already had accounts when helpers/app.ts loaded the pages");
}
const firstRun = recordedFirstRun;

function findUser(email: string) {
  return db.query("SELECT * FROM users WHERE email = ?").get(email) as User | null;
}

describe("first run", () => {
  test("shows the account setup form", () => {
    expect(firstRun.setup.status).toBe(200);
    expect(firstRun.setup.body).toContain("欢迎使用大肥鱼格式工坊");
    expect(firstRun.setup.body).toContain("邮箱地址");
    expect(firstRun.setup.body).toContain('autocomplete="new-password"');
    expect(firstRun.setup.body).toContain('name="confirmPassword"');
    expect(firstRun.setup.body).toContain('action="/register"');
  });

  test("sends visitors of the login page to the setup", () => {
    expect(firstRun.login.status).toBe(302);
    expect(firstRun.login.location).toBe("/setup");
  });

  test("shows the public workspace before the first account without cookies", () => {
    expect(firstRun.home.status).toBe(200);
    expect(firstRun.home.location).toBeNull();
    expect(firstRun.home.cookies).toEqual([]);
    expect(firstRun.home.body).toContain('data-requires-auth="true"');
    expect(firstRun.home.body).toContain('data-login-url="/setup"');
    expect(firstRun.home.body).toContain('data-register-url="/setup"');
    expect(firstRun.home.body).not.toMatch(/data-job-id="\d+"/);
    expect(firstRun.home.body).toContain('data-format-category="documents"');
  });

  test("keeps setup open when the first password confirmation is wrong", () => {
    expect(firstRun.mismatch.status).toBe(400);
    expect(firstRun.mismatch.body).toContain("两次输入的密码不一致");
    expect(firstRun.mismatch.cookies.some((cookie) => cookie.startsWith("auth="))).toBe(false);
    expect(firstRun.setupAfterMismatch.status).toBe(200);
    expect(firstRun.setupAfterMismatch.body).toContain('name="confirmPassword"');
  });

  test("preserves a conversion selection through initial account setup", () => {
    expect(firstRun.setupResume.status).toBe(200);
    expect(firstRun.setupResume.body).toContain('name="returnTo"');
    expect(firstRun.setupResume.body).toContain("/?to=docx");
    expect(firstRun.setupResume.body).toContain('name="confirmPassword"');
    expect(firstRun.loginResume.status).toBe(302);
    expect(firstRun.loginResume.location).toBe("/setup?next=%2F%3Fto%3Ddocx");
  });

  test("registers the first account although registration is closed", async () => {
    expect(firstRun.register.status).toBe(302);
    expect(firstRun.register.location).toBe("/");
    expect(firstRun.register.cookies.some((cookie) => cookie.startsWith("auth="))).toBe(true);

    const user = findUser(FIRST_ACCOUNT.email);
    expect(user).not.toBeNull();
    // the password is stored as a hash, never in plain text
    expect(user?.password).not.toBe(FIRST_ACCOUNT.password);
    expect(await Bun.password.verify(FIRST_ACCOUNT.password, user?.password ?? "")).toBe(true);
  });

  test("closes the setup once the first account exists", () => {
    expect(firstRun.setupAfterwards.status).toBe(302);
    expect(firstRun.setupAfterwards.location).toBe("/login");
  });

  test("closes the registration once the first account exists", () => {
    expect(firstRun.registerAfterwards.status).toBe(302);
    expect(firstRun.registerAfterwards.location).toBe("/login");
    expect(findUser(SECOND_ACCOUNT.email)).toBeNull();
  });
});
