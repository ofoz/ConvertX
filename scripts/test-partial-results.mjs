// Run: bun scripts/test-partial-results.mjs
// Uses the local QA Playwright install by default. Override with PLAYWRIGHT_MODULE (file path)
// and BROWSER_EXECUTABLE (binary path) when using a different local installation.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  checkFixture,
  downloadContents,
  startPartialResultsFixture,
} from "./partial-results-fixture.mjs";

const timeout = 8_000;
const qaDir = new URL("../data/setup/partial-results-qa/", import.meta.url);
const workspaceSelector = "[data-service-workspace]";

async function stage(page, value) {
  await page.waitForFunction(
    ({ workspaceSelector, value }) =>
      document.querySelector(workspaceSelector)?.dataset.stage === value &&
      document.getElementById("service-hall")?.dataset.stage === value,
    { workspaceSelector, value },
    { timeout },
  );
}

const result = (page, id) => page.locator(`[data-download-file="${id}"]`);

async function collect(page, file, button = result(page, file.id)) {
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  assert.equal(download.suggestedFilename(), file.name);
  assert.equal(await download.failure(), null);
  assert.equal(await readFile(await download.path(), "utf8"), downloadContents(file));
}

async function assertWorking(page, fixture) {
  await stage(page, "working");
  assert.ok(await page.locator("#business-job-progress").isVisible());
  assert.ok(await page.locator("#business-next").isHidden());
  assert.ok(await page.locator("#hall-start-new").isHidden());
  assert.ok(await page.locator("#hall-receive").isDisabled());
  const before = fixture.created.length;
  await page.locator("#open-business").click();
  assert.match(await page.locator("#upload-message").textContent(), /还在办理/);
  assert.ok(await page.locator("#business-format-panel").isHidden());
  assert.equal(fixture.created.length, before, "No new order may be created while processing");
}

async function assertIdle(page) {
  await stage(page, "idle");
  assert.ok(await page.locator("#business-job-progress").isHidden());
  assert.ok(await page.locator("#hall-stack").isHidden());
  assert.ok(await page.locator("#download-again").isVisible());
  assert.ok(await page.locator("#business-next").isVisible());
}

function matchesPoll(job, status) {
  return (response) =>
    new URL(response.url()).pathname === `/api/jobs/${job.id}` && response.status() === status;
}

async function completeAndCollect(page, job) {
  const latest = job.files.at(-1);
  const completed = page.waitForResponse(matchesPoll(job, 200));
  job.publish(job.files.length, "completed");
  assert.equal((await (await completed).json()).status, "completed");
  await stage(page, "ready");
  assert.ok(await page.locator("#hall-stack").isVisible());
  assert.ok(await result(page, latest.id).isEnabled(), "Later result is available for collection");
  await collect(page, latest, page.locator("#collect-files"));
  await assertIdle(page);
}

async function setVisibility(page, hidden) {
  // Headless Edge may keep both tabs visible; control only the browser's visibility input.
  // Production JS still handles the event, uses its real timers and makes real HTTP requests.
  await page.evaluate((hidden) => {
    Object.defineProperties(document, {
      hidden: { configurable: true, value: hidden },
      visibilityState: { configurable: true, value: hidden ? "hidden" : "visible" },
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

async function testBrowser(fixture) {
  const moduleUrl = process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href
    : new URL("../data/setup/ui-browser/node_modules/playwright/index.mjs", import.meta.url).href;
  const { chromium } = await import(moduleUrl);
  const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE || (existsSync(edge) ? edge : undefined),
    headless: true,
  });
  const failures = [];

  async function scenario(name, job, run) {
    const context = await browser.newContext({
      acceptDownloads: true,
      locale: "zh-CN",
      reducedMotion: "reduce",
      viewport: { width: 1440, height: 1000 },
    });
    await context.addInitScript((jobId) => {
      sessionStorage.setItem(
        "convertx-hall::order-v1",
        JSON.stringify({ jobId, desired: "txt", claimed: [] }),
      );
    }, job.id);
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      assert.equal((await page.goto(`${fixture.origin}/workshop/${job.id}`)).status(), 200);
      await stage(page, "working");
      assert.equal(
        await page.locator("#business-result-list li").count(),
        job.snapshot.completedInputs,
      );
      assert.ok(await page.locator("#business-results").isVisible());
      await run(page, job);
      assert.deepEqual(errors, [], "Uncaught client exceptions");
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(error);
      console.error(`FAIL ${name}`, error, errors);
      const screenshot = fileURLToPath(new URL(`${name}.png`, qaDir));
      await mkdir(qaDir, { recursive: true });
      await page.screenshot({ path: screenshot, timeout: 3_000 }).catch(() => {});
    } finally {
      await context.close();
    }
  }

  try {
    await scenario("last-partial-keeps-working", fixture.addJob("41", 2, 1), async (page, job) => {
      await collect(page, job.files[0]);
      await assertWorking(page, fixture);
      assert.ok(await result(page, 1).isDisabled(), "Claimed row cannot be collected twice");
      assert.match(await page.locator("#job-progress-text").textContent(), /1 \/ 2/);
      const unchanged = await page.waitForResponse(matchesPoll(job, 304));
      assert.ok(
        unchanged.request().headers()["if-none-match"],
        "Polling continues conditionally after claiming",
      );
      await completeAndCollect(page, job);
      const before = fixture.created.length;
      await page.locator("#business-next").click();
      await stage(page, "choosing");
      assert.equal(
        fixture.created.length,
        before + 1,
        "A new order is allowed after final collection",
      );
    });

    await scenario(
      "multiple-partials-and-download-recovery",
      fixture.addJob("42", 3, 2),
      async (page, job) => {
        await collect(page, job.files[0]);
        await stage(page, "working");
        assert.ok(await result(page, 1).isDisabled());
        assert.ok(await result(page, 2).isEnabled(), "Another partial stays available");
        job.failNextHead = true;
        const url = `${fixture.origin}${job.files[1].downloadUrl}`;
        await Promise.all([
          page.waitForResponse(
            (response) =>
              response.url() === url &&
              response.status() === 503 &&
              response.request().method() === "HEAD",
          ),
          result(page, 2).click(),
        ]);
        await stage(page, "working");
        assert.match(await page.getByRole("alert").textContent(), /文件未能交给浏览器/);
        assert.ok(await result(page, 2).isEnabled(), "Failed result can be retried");
        assert.deepEqual(
          job.downloads.filter(({ id }) => id === 2),
          [{ method: "HEAD", id: 2 }],
        );
        await collect(page, job.files[1]);
        await stage(page, "working");
        assert.ok(
          await page.locator("#upload-message").isHidden(),
          "Successful retry clears failure notice",
        );
        assert.deepEqual(
          job.downloads.filter(({ id }) => id === 2),
          [
            { method: "HEAD", id: 2 },
            { method: "HEAD", id: 2 },
            { method: "GET", id: 2 },
          ],
        );
        await completeAndCollect(page, job);
      },
    );

    await scenario(
      "visibility-switch-during-partial-delivery",
      fixture.addJob("43", 2, 1),
      async (page, job) => {
        // Keep HEAD open so the visibility listener runs during "delivering", not just "working".
        let release;
        job.headGate = new Promise((resolve) => {
          release = resolve;
        });
        try {
          await Promise.all([
            page.waitForRequest(
              (request) =>
                request.url() === `${fixture.origin}${job.files[0].downloadUrl}` &&
                request.method() === "HEAD",
            ),
            result(page, 1).click(),
          ]);
          await stage(page, "delivering");
          await Promise.all([
            page.waitForResponse(matchesPoll(job, 304), { timeout: 25_000 }),
            setVisibility(page, true),
          ]);
          assert.equal(
            await page.locator("#service-hall").getAttribute("data-motion-paused"),
            "true",
          );
          await Promise.all([
            page.waitForResponse(matchesPoll(job, 304), { timeout: 6_000 }),
            setVisibility(page, false),
          ]);
          const [download] = await Promise.all([
            page.waitForEvent("download"),
            Promise.resolve().then(release),
          ]);
          assert.equal(download.suggestedFilename(), job.files[0].name);
          assert.equal(await download.failure(), null);
        } finally {
          release();
        }
        await stage(page, "working");
        await completeAndCollect(page, job);
      },
    );
    assert.deepEqual(fixture.unexpected, [], "Only expected fixture routes are used");
    if (failures.length)
      throw new Error(`${failures.length} partial-result browser scenario(s) failed`);
    console.log("3 partial-result browser scenarios passed.");
  } finally {
    await browser.close();
  }
}

const fixture = await startPartialResultsFixture();
try {
  if (process.argv.includes("--check-fixture")) {
    await checkFixture(fixture);
    console.log("PASS workspace rendering, real script, conditional poll and download fixture");
  } else {
    await testBrowser(fixture);
  }
} finally {
  fixture.close();
}
