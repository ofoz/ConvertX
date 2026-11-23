import { afterEach, describe, expect, test } from "bun:test";

import { assetUrl } from "../../src/helpers/assets";
import { buildDownloadUrl } from "../../src/helpers/buildDownloadUrl";
import { createJob, createUser, db, request, resetEnv, setCookie, setEnv } from "./helpers/app";

afterEach(() => {
  resetEnv();
});

test("encodes reserved characters in download filenames", () => {
  expect(buildDownloadUrl("", "1/2/", "clip #1?.gif")).toBe("/download/1/2/clip%20%231%3F.gif");
});

test("preserves output path segments while encoding the filename", () => {
  expect(buildDownloadUrl("/convertx", "user/job/", "報告 100%.pdf")).toBe(
    "/convertx/download/user/job/%E5%A0%B1%E5%91%8A%20100%25.pdf",
  );
});

const done = (name: string) => ({
  file_name: `${name}.vcf`,
  output_file_name: `${name}.csv`,
  status: "Done",
});

describe.each([
  ["GET", "/results"],
  ["POST", "/progress"],
])("%s %s/:jobId", (method, route) => {
  test("requires a session", async () => {
    const user = await createUser();
    const job = createJob(user.id);

    const response = await request(`${route}/${job}`, {
      method,
      headers: { accept: "application/json" },
    });

    expect(response.status).toBe(401);
  });

  test.each([
    ["another user's job", true],
    ["a job that does not exist", false],
  ])("answers 404 for %s", async (_, exists) => {
    const user = await createUser();
    const other = await createUser();
    const job = exists ? createJob(other.id, { numFiles: 1, files: [done("secret")] }) : 999_999;

    const response = await request(`${route}/${job}`, { method, cookies: { auth: user.token } });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Job not found." });
  });

  test("lists converted files with Chinese preview and download actions", async () => {
    const user = await createUser();
    const job = createJob(user.id, {
      numFiles: 2,
      status: "completed",
      files: [done("a"), done("my file #1")],
    });

    const body = await (
      await request(`${route}/${job}`, { method, cookies: { auth: user.token } })
    ).text();

    expect(body).toContain(`href="/download/${user.id}/${job}/a.csv"`);
    expect(body).toContain(`href="/download/${user.id}/${job}/my%20file%20%231.csv"`);
    expect(body).toContain('download="my file #1.csv"');
    expect(body).toContain("转换完成");
    expect(body).toContain("预览");
    expect(body).toContain("批量下载");
  });

  test.each(["Failed, check logs", "File type not supported"])(
    "shows no links for files with status '%s'",
    async (status) => {
      const user = await createUser();
      const job = createJob(user.id, {
        numFiles: 1,
        status: "completed",
        files: [{ file_name: "a.xyz", output_file_name: "a.pdf", status }],
      });

      const body = await (
        await request(`${route}/${job}`, { method, cookies: { auth: user.token } })
      ).text();

      expect(body).toContain("a.xyz");
      expect(body).toContain("无法下载");
      expect(body).toContain(
        status === "Failed, check logs" ? "转换失败，请查看日志" : "不支持此文件类型",
      );
      expect(body).not.toContain("/download/");
    },
  );

  test("escapes file names and statuses", async () => {
    const user = await createUser();
    const name = '"><img src=x onerror=alert(1)>.csv';
    const job = createJob(user.id, {
      status: "completed",
      numFiles: 1,
      files: [{ file_name: name, output_file_name: "safe.csv", status: "<b>Done</b>" }],
    });

    const body = await (
      await request(`${route}/${job}`, { method, cookies: { auth: user.token } })
    ).text();

    // neither the text nor the download attribute can be broken out of
    expect(body).not.toContain('title=""><img');
    expect(body).toContain('title="&#34;><img');
    expect(body).not.toContain("<b>Done</b>");
    expect(body).toContain("状态未知");
    expect(body).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;.csv");
    expect(body).toContain("状态未知");
  });

  test("disables delete and tar download while files are still converting", async () => {
    const user = await createUser();
    const job = createJob(user.id, { numFiles: 2, files: [done("a")] });

    const body = await (
      await request(`${route}/${job}`, { method, cookies: { auth: user.token } })
    ).text();

    expect(body).toContain('data-state="running"');
    expect(body).toContain('aria-busy="true"');
    expect(body).toMatch(/<progress max="2" value="1"/);
    expect(body).not.toContain(`action="/delete/${job}"`);
    expect(body).not.toContain(`href="/archive/${job}"`);
  });

  test("enables delete and tar download once every file is converted", async () => {
    const user = await createUser();
    const job = createJob(user.id, {
      numFiles: 2,
      status: "completed",
      files: [done("a"), done("b")],
    });

    const body = await (
      await request(`${route}/${job}`, { method, cookies: { auth: user.token } })
    ).text();

    expect(body).not.toContain('aria-busy="true"');
    expect(body).toContain('data-state="success"');
    expect(body).toContain('<progress max="2" value="2"');
    expect(body).toContain("再转换一批");
    expect(body).toContain("批量下载");
    expect(body).toContain(`action="/delete/${job}"`);
    expect(body).toContain(`href="/archive/${job}"`);
  });

  test("prefixes all links with WEBROOT", async () => {
    setEnv({ WEBROOT: "/convertx" });
    const user = await createUser();
    const job = createJob(user.id, { numFiles: 1, status: "completed", files: [done("a")] });

    const body = await (
      await request(`${route}/${job}`, { method, cookies: { auth: user.token } })
    ).text();

    expect(body).toContain(`href="/convertx/download/${user.id}/${job}/a.csv"`);
    expect(body).toContain(`action="/convertx/delete/${job}"`);
    expect(body).toContain(`href="/convertx/archive/${job}"`);
  });

  test("keeps the session and the current job", async () => {
    const user = await createUser();
    const job = createJob(user.id);

    const response = await request(`${route}/${job}`, {
      method,
      cookies: { auth: user.token, jobId: job },
    });

    expect(setCookie(response, "jobId")).toBeUndefined();
    expect(setCookie(response, "auth")).toBeUndefined();
  });

  // no page sets job_id anymore (the job cookie is called jobId), but the handlers still
  // clear it for browsers that kept it
  test("clears the legacy job_id cookie", async () => {
    const user = await createUser();
    const job = createJob(user.id);

    const response = await request(`${route}/${job}`, {
      method,
      cookies: { auth: user.token, job_id: job },
    });

    expect(setCookie(response, "job_id")).toContain("Max-Age=0");
  });
});

describe("GET /results/:jobId", () => {
  test("uses job status and unique input files instead of output-row count", async () => {
    const user = await createUser();
    const job = createJob(user.id, {
      numFiles: 1,
      status: "pending",
      files: [
        done("book"),
        { file_name: "book.vcf", output_file_name: "book-1.csv", status: "Done" },
      ],
    });

    const body = await (await request(`/results/${job}`, { cookies: { auth: user.token } })).text();

    expect(body).toContain('data-state="running"');
    expect(body).toContain('data-announcement="正在转换。1 / 1 个源文件，成功 1，失败 0。"');
    expect(body).toContain(`href="/download/${user.id}/${job}/book-1.csv"`);
    expect(body).not.toContain(`action="/delete/${job}"`);
  });

  test("shows partial failures while keeping successful files downloadable", async () => {
    const user = await createUser();
    const job = createJob(user.id, {
      numFiles: 2,
      status: "completed",
      files: [
        done("ok"),
        { file_name: "bad.vcf", output_file_name: "bad.csv", status: "Failed, check logs" },
      ],
    });

    const body = await (await request(`/results/${job}`, { cookies: { auth: user.token } })).text();

    expect(body).toContain('data-state="partial"');
    expect(body).toContain("部分文件转换失败");
    expect(body).toContain('href="/download/');
    expect(body).toContain("无法下载");
    expect(body).toContain(`action="/delete/${job}"`);
    expect(body).not.toContain(`href="/archive/${job}"`);
  });

  test("renders a full page with the results script", async () => {
    const user = await createUser();
    const job = createJob(user.id);

    const body = await (await request(`/results/${job}`, { cookies: { auth: user.token } })).text();

    expect(body).toStartWith("<!doctype html>");
    expect(body).toContain("<title>大肥鱼格式工坊 | 转换结果</title>");
    expect(body).toContain(`<script src="${assetUrl("", "results.js")}" defer`);
    expect(body).toContain('data-progress-url="/progress/');
  });
});

describe("POST /progress/:jobId", () => {
  test("uses a private ETag and returns 304 only to the authorized owner", async () => {
    const owner = await createUser();
    const other = await createUser();
    const job = createJob(owner.id, { numFiles: 1, status: "pending" });
    const first = await request(`/progress/${job}`, {
      method: "POST",
      cookies: { auth: owner.token },
    });
    const etag = first.headers.get("etag");
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, no-cache");
    expect(etag).toBeTruthy();
    const unchanged = await request(`/progress/${job}`, {
      method: "POST",
      cookies: { auth: owner.token },
      headers: { "if-none-match": etag! },
    });
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe("");
    expect(
      (await request(`/progress/${job}`, { method: "POST", headers: { "if-none-match": etag! } }))
        .status,
    ).toBe(401);
    expect(
      (
        await request(`/progress/${job}`, {
          method: "POST",
          cookies: { auth: other.token },
          headers: { "if-none-match": etag! },
        })
      ).status,
    ).toBe(404);
  });

  test("updates the ETag when file rows change and retains latest result links", async () => {
    const user = await createUser();
    const job = createJob(user.id, { numFiles: 1, status: "pending" });
    const first = await request(`/progress/${job}`, {
      method: "POST",
      cookies: { auth: user.token },
    });
    const etag = first.headers.get("etag")!;
    const file = { file_name: "new.vcf", output_file_name: "new.csv", status: "Done" };
    db.query(
      "INSERT INTO file_names (job_id,file_name,output_file_name,status) VALUES (?,?,?,?)",
    ).run(job, file.file_name, file.output_file_name, file.status);
    const next = await request(`/progress/${job}`, {
      method: "POST",
      cookies: { auth: user.token },
      headers: { "if-none-match": etag },
    });
    expect(next.status).toBe(200);
    expect(next.headers.get("etag")).not.toBe(etag);
    expect(await next.text()).toContain(`href="/download/${user.id}/${job}/new.csv"`);
  });

  test("renders only the results fragment for polling", async () => {
    const user = await createUser();
    const job = createJob(user.id);

    const body = await (
      await request(`/progress/${job}`, { method: "POST", cookies: { auth: user.token } })
    ).text();

    expect(body).toStartWith('<article id="sx-results" class="sx-result-stack"');
    expect(body).not.toContain("<html");
  });
});
