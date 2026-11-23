import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { Header } from "../../src/components/header";
import {
  app,
  createUser,
  db,
  request,
  resetEnv,
  setCookie,
  setCookieValue,
  setEnv,
} from "./helpers/app";

afterEach(() => {
  resetEnv();
});

type JobRow = { id: number; user_id: string; date_created: string; status: string };

function jobsOf(userId: number | string) {
  return db.query("SELECT * FROM jobs WHERE user_id = ? ORDER BY id").all(userId) as JobRow[];
}

async function userIdOf(response: Response) {
  const payload = await app.decorator.jwt.verify(setCookieValue(response, "auth") ?? "");
  return payload ? payload.id : undefined;
}

function jobCount() {
  return (db.query("SELECT COUNT(*) AS count FROM jobs").get() as { count: number }).count;
}

function headerOf(body: string) {
  return body.slice(body.indexOf("<header"), body.indexOf("</header>") + "</header>".length);
}

async function expectGuestWorkspace(response: Response, before: number) {
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
  expect(setCookie(response, "jobId")).toBeUndefined();
  expect(jobCount()).toBe(before);
  const body = await response.text();
  expect(body).toContain("data-service-workspace");
  expect(body).toContain('data-requires-auth="true"');
  expect(body).not.toMatch(/data-job-id="\d+"/);
  expect(body).toContain('data-value="png,inkscape"');
  expect(body).toContain('data-format-category="documents"');
  const header = headerOf(body);
  expect(header).toContain('href="/converters"');
  expect(header).not.toContain('href="/history"');
  expect(header).not.toContain('href="/account"');
  expect(header).not.toContain('href="/logoff"');
  return body;
}

describe("GET / with accounts", () => {
  test("renders the public workspace without creating a session or job", async () => {
    const before = jobCount();
    const signing = spyOn(app.decorator.jwt, "sign");
    try {
      const response = await request("/");
      await expectGuestWorkspace(response, before);
      expect(setCookie(response, "auth")).toBeUndefined();
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(signing).not.toHaveBeenCalled();
    } finally {
      signing.mockRestore();
    }
  });

  test("clears an invalid session and renders the public workspace", async () => {
    const before = jobCount();
    const response = await request("/", { cookies: { auth: "not-a-jwt", jobId: "999999" } });
    await expectGuestWorkspace(response, before);
    expect(setCookie(response, "auth")).toContain("Max-Age=0");
  });

  test("clears a deleted account session without starting a job", async () => {
    const user = await createUser();
    db.query("DELETE FROM users WHERE id = ?").run(user.id);
    const before = jobCount();
    const response = await request("/", { cookies: { auth: user.token } });
    await expectGuestWorkspace(response, before);
    expect(setCookie(response, "auth")).toContain("Max-Age=0");
    expect(jobsOf(user.id)).toEqual([]);
  });

  test("honours WEBROOT and closed/open registration links for guests", async () => {
    const before = jobCount();
    setEnv({ WEBROOT: "/workshop", ACCOUNT_REGISTRATION: false });
    const closed = await request("/");
    const body = await closed.text();
    expect(closed.status).toBe(200);
    expect(closed.headers.getSetCookie()).toEqual([]);
    expect(body).toContain('data-login-url="/workshop/login"');
    expect(body).toContain('data-register-url=""');
    expect(headerOf(body)).toContain('href="/workshop/converters"');
    setEnv({ WEBROOT: "/workshop", ACCOUNT_REGISTRATION: true });
    const open = await request("/");
    expect(await open.text()).toContain('data-register-url="/workshop/register"');
    expect(open.headers.getSetCookie()).toEqual([]);
    expect(jobCount()).toBe(before);
  });

  test("keeps public navigation opt-in for other headers", () => {
    expect(String(Header({}))).not.toContain('href="/converters"');
    const publicHeader = String(Header({ publicNavigation: true }));
    expect(publicHeader).toContain('href="/converters"');
    expect(publicHeader).not.toContain('href="/history"');
    expect(publicHeader).not.toContain('href="/account"');
  });

  test("uses the supplied workshop brand image for the default brand and text for custom branding", () => {
    const defaultHeader = String(Header({}));
    expect(defaultHeader).toContain('src="/brand-workshop.png?v=workshop-11"');
    expect(defaultHeader).toContain('alt="大肥鱼格式工坊"');

    const customHeader = String(Header({ branding: "我的转换站" }));
    expect(customHeader).toContain(">我的转换站</span>");
    expect(customHeader).not.toContain("brand-workshop.png");
  });

  test("starts a new job and remembers it in the jobId cookie", async () => {
    const user = await createUser();

    const response = await request("/", { cookies: { auth: user.token } });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('data-requires-auth="false"');
    const jobs = jobsOf(user.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("not started");
    expect(Date.now() - Date.parse(jobs[0]?.date_created ?? "")).toBeLessThan(60_000);

    expect(setCookieValue(response, "jobId")).toBe(String(jobs[0]?.id));
    expect(setCookie(response, "jobId")).toContain("HttpOnly");
    expect(setCookie(response, "jobId")).toContain("Secure");
    expect(setCookie(response, "jobId")).toContain("SameSite=Strict");
    expect(setCookie(response, "jobId")).toContain(`Max-Age=${24 * 60 * 60}`);
  });

  test("starts a fresh job on every visit", async () => {
    const user = await createUser();

    const first = await request("/", { cookies: { auth: user.token } });
    const second = await request("/", { cookies: { auth: user.token } });

    expect(jobsOf(user.id)).toHaveLength(2);
    expect(Number(setCookieValue(second, "jobId"))).toBeGreaterThan(
      Number(setCookieValue(first, "jobId")),
    );
  });

  test("offers every target of every converter", async () => {
    const user = await createUser();

    const body = await (await request("/", { cookies: { auth: user.token } })).text();

    expect(body).toContain('action="/convert"');
    expect(body).toContain('<option value="csv,vcf">csv</option>');
    expect(body).toContain('data-value="png,inkscape"');
  });

  test("links the account and logoff pages in the header", async () => {
    const user = await createUser();

    const body = await (await request("/", { cookies: { auth: user.token } })).text();

    expect(body).toContain('href="/account"');
    expect(body).toContain('href="/logoff"');
  });
});

describe("GET / without accounts (ALLOW_UNAUTHENTICATED)", () => {
  test("creates an anonymous session and a job for visitors without a session", async () => {
    setEnv({ ALLOW_UNAUTHENTICATED: true });

    const response = await request("/");

    expect(response.status).toBe(200);
    const userId = await userIdOf(response);
    // anonymous ids start at 2^24 so they never collide with registered accounts
    expect(Number(userId)).toBeGreaterThanOrEqual(2 ** 24);
    expect(setCookie(response, "auth")).toContain(`Max-Age=${24 * 60 * 60}`);
    expect(jobsOf(userId ?? "")).toHaveLength(1);
  });

  test("gives every anonymous visitor a different id", async () => {
    setEnv({ ALLOW_UNAUTHENTICATED: true });

    const first = await userIdOf(await request("/"));
    const second = await userIdOf(await request("/"));

    expect(first).not.toBe(second);
  });

  test("shares one anonymous id when UNAUTHENTICATED_USER_SHARING is enabled", async () => {
    setEnv({ ALLOW_UNAUTHENTICATED: true, UNAUTHENTICATED_USER_SHARING: true });

    expect(await userIdOf(await request("/"))).toBe("0");
    expect(await userIdOf(await request("/"))).toBe("0");
  });

  test("hides the account and logoff links", async () => {
    setEnv({ ALLOW_UNAUTHENTICATED: true });

    const body = await (await request("/")).text();

    expect(body).not.toContain('href="/account"');
    expect(body).not.toContain('href="/logoff"');
  });

  test("keeps an existing session", async () => {
    setEnv({ ALLOW_UNAUTHENTICATED: true });
    const user = await createUser();

    const response = await request("/", { cookies: { auth: user.token } });

    expect(setCookie(response, "auth")).toBeUndefined();
    expect(jobsOf(user.id)).toHaveLength(1);
  });
});
