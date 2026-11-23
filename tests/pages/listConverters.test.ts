import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { getAllInputs, getAllTargets } from "../../src/converters/main";
import { getFormatCatalog } from "../../src/helpers/formatCatalog";
import {
  app,
  createUser,
  db,
  request,
  resetEnv,
  setCookie,
  setEnv,
  signToken,
} from "./helpers/app";

afterEach(resetEnv);
const jobCount = () =>
  (db.query("SELECT COUNT(*) AS count FROM jobs").get() as { count: number }).count;
const headerOf = (body: string) =>
  body.slice(body.indexOf("<header"), body.indexOf("</header>") + "</header>".length);

describe("GET /converters", () => {
  test("is publicly readable without minting JWTs, cookies or jobs", async () => {
    const before = jobCount();
    const signing = spyOn(app.decorator.jwt, "sign");
    try {
      const response = await request("/converters", { headers: { accept: "text/html" } });
      expect(response.status).toBe(200);
      expect(response.headers.getSetCookie()).toEqual([]);
      const header = headerOf(await response.text());
      expect(header).toContain('href="/converters"');
      expect(header).not.toContain('href="/history"');
      expect(header).not.toContain('href="/account"');
      expect(signing).not.toHaveBeenCalled();
      expect(jobCount()).toBe(before);
    } finally {
      signing.mockRestore();
    }
  });

  test("clears invalid and deleted-account auth while keeping the catalogue public", async () => {
    const user = await createUser();
    db.query("DELETE FROM users WHERE id = ?").run(user.id);
    const before = jobCount();
    for (const token of ["not-a-jwt", user.token]) {
      const response = await request("/converters", { cookies: { auth: token } });
      expect(response.status).toBe(200);
      expect(setCookie(response, "auth")).toContain("Max-Age=0");
      expect(setCookie(response, "jobId")).toBeUndefined();
      const header = headerOf(await response.text());
      expect(header).not.toContain('href="/history"');
      expect(header).not.toContain('href="/account"');
    }
    expect(jobCount()).toBe(before);
  });

  test("retains valid-account navigation without allocating a catalogue job", async () => {
    const user = await createUser();
    const before = jobCount();
    const response = await request("/converters", { cookies: { auth: user.token } });
    expect(response.status).toBe(200);
    const header = headerOf(await response.text());
    expect(header).toContain('href="/history"');
    expect(header).toContain('href="/account"');
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(jobCount()).toBe(before);
  });

  test("preserves WEBROOT, registration visibility and hidden history", async () => {
    setEnv({ WEBROOT: "/workshop", ACCOUNT_REGISTRATION: true });
    const guest = await request("/converters");
    const header = headerOf(await guest.text());
    expect(header).toContain('href="/workshop/converters"');
    expect(header).toContain('href="/workshop/register"');
    expect(header).not.toContain('href="/workshop/history"');
    setEnv({ WEBROOT: "/workshop", HIDE_HISTORY: true });
    const user = await createUser();
    expect(
      headerOf(await (await request("/converters", { cookies: { auth: user.token } })).text()),
    ).not.toContain('href="/workshop/history"');
  });

  test("does not create anonymous sessions even when explicit anonymous mode is enabled", async () => {
    setEnv({ ALLOW_UNAUTHENTICATED: true });
    const before = jobCount();
    const guest = await request("/converters");
    expect(guest.status).toBe(200);
    expect(guest.headers.getSetCookie()).toEqual([]);
    for (const id of [0, 2 ** 24 + 1]) {
      const token = await signToken(id);
      const response = await request("/converters", { cookies: { auth: token } });
      expect(response.status).toBe(200);
      const header = headerOf(await response.text());
      expect(header).toContain('href="/history"');
      expect(header).not.toContain('href="/account"');
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(jobCount()).toBe(before);
  });

  test("lists every converter with the number of inputs and targets", async () => {
    const user = await createUser();
    const body = await (await request("/converters", { cookies: { auth: user.token } })).text();
    for (const [converter, targets] of Object.entries(getAllTargets())) {
      const start = body.indexOf(`data-engine="${converter}"`);
      expect(start).toBeGreaterThan(-1);
      const card = body.slice(start, body.indexOf("</article>", start));
      expect(card).toContain(`data-engine-input-count="${getAllInputs(converter).length}"`);
      expect(card).toContain(`data-engine-output-count="${targets.length}"`);
    }
  });

  test("renders purpose groups and complete directional format lists", async () => {
    const user = await createUser();
    const body = await (await request("/converters", { cookies: { auth: user.token } })).text();
    for (const group of getFormatCatalog())
      expect(body).toContain(`data-format-category="${group.id}"`);
    expect(body).toContain('data-format-token="vcf" data-format-kind="input"');
    expect(body).toContain('data-format-token="csv" data-format-kind="output"');
    expect(body).toContain('data-format-token="pdf" data-format-kind="input"');
    expect(body).toContain("data-catalog-search");
    expect(body).toContain('data-format-direction="output"');
    expect(body).toContain("data-expand-catalog");
  });
});
