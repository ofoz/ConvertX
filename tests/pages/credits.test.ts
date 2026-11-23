import { afterEach, describe, expect, test } from "bun:test";

import { assetUrl } from "../../src/helpers/assets";
import { createUser, request, resetEnv, setEnv } from "./helpers/app";

afterEach(resetEnv);

describe("character and artwork page", () => {
  test.each(["/credits", "/characters/ATTRIBUTION.md"])(
    "renders the styled public page at %s",
    async (route) => {
      const response = await request(route);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      const body = await response.text();
      expect(body).toContain("credits-character-grid");
      expect(body).toContain("大肥鱼");
      expect(body).toContain("Claude");
      expect(body).toContain("GPT");
      for (const author of ["上善", "ZipZipPipe", "Small-tailqwq", "JAdpp"])
        expect(body).toContain(author);
      expect(body).toContain("CC BY-NC-SA 4.0");
      expect(body).toContain("非商业用途");
      expect(body).not.toContain("源码项目");
      expect(body).not.toContain("开源");
      expect(body).not.toContain("https://github.com/C4illin/ConvertX");
      expect(body).not.toContain("app-footer-version");
    },
  );

  test("preserves signed-in navigation and WEBROOT asset links", async () => {
    setEnv({ WEBROOT: "/workshop" });
    const user = await createUser();
    const body = await (await request("/credits", { cookies: { auth: user.token } })).text();
    expect(body).toContain('href="/workshop/account"');
    expect(body).toContain('href="/workshop/characters/ATTRIBUTION.raw.md"');
    expect(body).toContain(assetUrl("/workshop", "characters/whale-cheerful.webp"));
  });

  test("keeps the complete original attribution as a downloadable record", async () => {
    const response = await request("/characters/ATTRIBUTION.raw.md");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    const body = await response.text();
    expect(body).toContain("# Character artwork attribution");
    expect(body).toContain("CC BY-NC-SA 4.0");
    expect(body).toContain("bdfe1e481815b6292f48b3badb6c037ae7df4bca");
  });
});
