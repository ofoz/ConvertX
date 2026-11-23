import Elysia from "elysia";

import { BaseHtml } from "../components/base";
import { FormatLibrary } from "../components/formatLibrary";
import { Header } from "../components/header";
import { SymbolIcon } from "../components/symbol";
import { getAllInputs, getAllTargets } from "../converters/main";
import db from "../db/db";
import { User } from "../db/types";
import { assetUrl } from "../helpers/assets";
import {
  ACCOUNT_REGISTRATION,
  ALLOW_UNAUTHENTICATED,
  BRANDING,
  HIDE_HISTORY,
  WEBROOT,
} from "../helpers/env";
import { getFormatStats } from "../helpers/formatCatalog";
import { userService } from "./user";

export const listConverters = new Elysia().use(userService).get(
  "/converters",
  async ({ jwt, cookie: { auth } }) => {
    let loggedIn = false;
    if (auth?.value) {
      try {
        const verifiedUser = await jwt.verify(auth.value);
        if (verifiedUser && verifiedUser.id) {
          const exists = db.query("SELECT * FROM users WHERE id = ?").as(User).get(verifiedUser.id);
          const numericId = Number(verifiedUser.id);
          const anonymous =
            ALLOW_UNAUTHENTICATED &&
            Number.isSafeInteger(numericId) &&
            (numericId === 0 || numericId >= 2 ** 24);
          loggedIn = Boolean(exists || anonymous);
        }
        if (!loggedIn) auth.remove();
      } catch {
        auth.remove();
      }
    }
    const stats = getFormatStats();
    return (
      <BaseHtml webroot={WEBROOT} title={`${BRANDING} | 支持格式`}>
        <>
          <Header
            webroot={WEBROOT}
            allowUnauthenticated={ALLOW_UNAUTHENTICATED}
            branding={BRANDING}
            hideHistory={HIDE_HISTORY}
            active="formats"
            accountRegistration={ACCOUNT_REGISTRATION}
            loggedIn={loggedIn}
            publicNavigation
          />
          <main id="main-content" class="app-container cx-catalog-page" tabindex="-1">
            <div class="cx-catalog-hero">
              <div>
                <p class="eyebrow">EXPLORE THE POSSIBILITIES</p>
                <h1>
                  找到你需要的
                  <br />
                  <span>每一种格式。</span>
                </h1>
                <p class="muted">完整格式清单，按用途分组。搜索扩展名，即可找到输入与输出支持。</p>
              </div>
              <a class="cx-back-to-workspace btn-primary" href={`${WEBROOT}/`}>
                去转换文件 <SymbolIcon name="arrow" size={17} />
              </a>
            </div>
            <div class="cx-catalog-stats">
              <div>
                <strong>{stats.inputs}</strong>
                <span>种输入格式</span>
              </div>
              <div>
                <strong>{stats.outputs}</strong>
                <span>种输出格式</span>
              </div>
              <div>
                <strong>{stats.converters}</strong>
                <span>个转换引擎</span>
              </div>
            </div>
            <FormatLibrary webroot={WEBROOT} full />
            <details class="surface cx-engine-directory">
              <summary>
                <span>
                  <b>按转换引擎查看</b>
                  <small>高级浏览 · {stats.converters} 个引擎</small>
                </span>
                <SymbolIcon name="chevron" size={18} />
              </summary>
              <div class="cx-engine-grid">
                {Object.entries(getAllTargets()).map(([converter, targets]) => {
                  const inputs = getAllInputs(converter);
                  return (
                    <article class="cx-engine-card" data-engine={converter}>
                      <code safe>{converter}</code>
                      <p>
                        输入{" "}
                        <strong data-engine-input-count={inputs.length}>{inputs.length}</strong>
                        <span> / </span>输出{" "}
                        <strong data-engine-output-count={targets.length}>{targets.length}</strong>
                      </p>
                      <details>
                        <summary>查看引擎的全部格式</summary>
                        <h3>可输入</h3>
                        <div class="cx-format-tags">
                          {inputs.map((format) => (
                            <span class="cx-format-tag" safe>
                              {format}
                            </span>
                          ))}
                        </div>
                        <h3>可输出</h3>
                        <div class="cx-format-tags">
                          {targets.map((format) => (
                            <span class="cx-format-tag" safe>
                              {format}
                            </span>
                          ))}
                        </div>
                      </details>
                    </article>
                  );
                })}
              </div>
            </details>
          </main>
          <script src={assetUrl(WEBROOT, "catalog.js")} defer />
        </>
      </BaseHtml>
    );
  },
  { cookie: "optionalSession" },
);
