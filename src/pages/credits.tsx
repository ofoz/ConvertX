import { Elysia } from "elysia";

import { BaseHtml } from "../components/base";
import { Header } from "../components/header";
import { SymbolIcon } from "../components/symbol";
import { assetUrl } from "../helpers/assets";
import {
  ACCOUNT_REGISTRATION,
  ALLOW_UNAUTHENTICATED,
  BRANDING,
  HIDE_HISTORY,
  WEBROOT,
} from "../helpers/env";
import { responsivePortraitSources } from "../helpers/responsivePortrait";
import { userService } from "./user";

const characters = [
  {
    name: "大肥鱼",
    role: "DeepSeek · 文件转换专员",
    image: "whale-cheerful.webp",
    className: "credits-portrait credits-portrait-blue",
    text: "在工位上接收文件、认真办理，忙完再摸一会儿鱼。",
    artist: "上善 · ZipZipPipe",
    link: "https://space.bilibili.com/4168597",
  },
  {
    name: "Claude",
    role: "代码专席 · 加班进行中",
    image: "claude.webp",
    className: "credits-portrait credits-portrait-peach",
    text: "坐在左侧赶代码。虽然有点不开心，手上的工作还是没有停。",
    artist: "ZipZipPipe",
    link: "https://www.bilibili.com/opus/1233069202138464289",
  },
  {
    name: "GPT",
    role: "咨询专席 · 礼貌值班中",
    image: "gpt.webp",
    className: "credits-portrait credits-portrait-mint",
    text: "在右侧陪伴值班，提醒你把文件交给中间的大肥鱼。",
    artist: "ZipZipPipe",
    link: "https://www.bilibili.com/opus/1233069202138464289",
  },
];

function CreditsPage({ loggedIn }: { loggedIn: boolean }) {
  return (
    <BaseHtml webroot={WEBROOT} title={`${BRANDING} | 角色与素材说明`}>
      <>
        <Header
          webroot={WEBROOT}
          branding={BRANDING}
          loggedIn={loggedIn}
          accountRegistration={ACCOUNT_REGISTRATION}
          allowUnauthenticated={ALLOW_UNAUTHENTICATED}
          hideHistory={HIDE_HISTORY}
        />
        <main id="main-content" class="app-container credits-page" tabindex="-1">
          <section class="credits-hero">
            <div>
              <p class="eyebrow">WORKSHOP CHARACTERS</p>
              <h1>
                工坊的伙伴，<span>每一位都有来处。</span>
              </h1>
              <p>
                这里记录陪你办理业务的角色、创作者与素材出处。
                <br />
                感谢每一位让这个小工坊变得生动的人。
              </p>
            </div>
            <div class="credits-hero-actions">
              <span class="credits-fan-badge">
                <SymbolIcon name="sparkles" size={15} />
                非官方同人形象
              </span>
              <a class="btn-primary" href={`${WEBROOT}/`}>
                回到工坊 <SymbolIcon name="arrow" size={17} />
              </a>
            </div>
          </section>
          <section class="credits-character-grid" aria-label="角色与插画来源">
            {characters.map((character) => (
              <article class="surface credits-character-card">
                <div class={character.className}>
                  <span class="credits-arch" aria-hidden="true" />
                  <img
                    src={assetUrl(WEBROOT, `characters/${character.image}`)}
                    {...(() => {
                      const srcset = responsivePortraitSources(WEBROOT, character.image);
                      return srcset ? { srcset, sizes: "280px" } : {};
                    })()}
                    alt={`${character.name}的二次元同人立绘`}
                    draggable="false"
                  />
                  <span class="credits-window-label" safe>
                    {character.name}
                  </span>
                </div>
                <div class="credits-character-copy">
                  <span class="eyebrow" safe>
                    {character.role}
                  </span>
                  <h2 safe>{character.name}</h2>
                  <p safe>{character.text}</p>
                  <div class="credits-artist">
                    <span>角色设计 / 立绘</span>
                    <strong safe>{character.artist}</strong>
                  </div>
                  <a href={character.link} target="_blank" rel="noopener noreferrer">
                    查看作者与作品 <SymbolIcon name="arrow" size={14} />
                  </a>
                </div>
              </article>
            ))}
          </section>
          <section class="surface credits-panel" aria-labelledby="credits-authors-title">
            <div class="credits-section-heading">
              <span class="credits-section-icon">
                <SymbolIcon name="layers" size={21} />
              </span>
              <div>
                <p class="eyebrow">WITH THANKS</p>
                <h2 id="credits-authors-title">从角色设计，到来到工坊</h2>
              </div>
            </div>
            <p class="muted">
              大肥鱼形象与相关素材保留以下完整署名链；Claude、GPT 的立绘设计来自 ZipZipPipe。
            </p>
            <div class="credits-contributors">
              <div>
                <b>01</b>
                <h3>上善</h3>
                <p>鲸鱼娘原始角色设计。</p>
                <a
                  href="https://www.pixiv.net/users/62155430"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  作者主页 ↗
                </a>
              </div>
              <div>
                <b>02</b>
                <h3>ZipZipPipe</h3>
                <p>鲸鱼娘女仆形象再设计，以及 Claude、GPT 的角色立绘。</p>
                <a
                  href="https://space.bilibili.com/4168597"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  作者主页 ↗
                </a>
              </div>
              <div>
                <b>03</b>
                <h3>Small-tailqwq</h3>
                <p>女仆皮肤素材发布与原始署名保存。</p>
              </div>
              <div>
                <b>04</b>
                <h3>JAdpp</h3>
                <p>立绘整理、表情准备，以及参考既有形象制作的 AI 辅助动作图集。</p>
              </div>
            </div>
          </section>
          <section class="credits-information-grid">
            <article class="surface credits-panel credits-license">
              <div class="credits-section-heading">
                <span class="credits-section-icon">
                  <SymbolIcon name="file" size={21} />
                </span>
                <div>
                  <p class="eyebrow">ARTWORK TERMS</p>
                  <h2>插画的使用约定</h2>
                </div>
              </div>
              <a
                class="credits-license-name"
                href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
                target="_blank"
                rel="noopener noreferrer"
              >
                CC BY-NC-SA 4.0 <span>↗</span>
              </a>
              <div class="credits-license-tags">
                <span>保留署名</span>
                <span>非商业用途</span>
                <span>相同方式共享</span>
              </div>
              <p>
                角色图片及其图集裁切版本按上述许可标注。使用或改编相关美术素材时，请保留作者、来源和改动说明，完整约定以许可原文为准。
              </p>
              <p>角色均为非官方同人设计，不代表相关厂商的官方形象、合作或背书。</p>
            </article>
            <article class="surface credits-panel">
              <div class="credits-section-heading">
                <span class="credits-section-icon">
                  <SymbolIcon name="sparkles" size={21} />
                </span>
                <div>
                  <p class="eyebrow">MADE FOR THIS WORKSHOP</p>
                  <h2>在这里，变成一个小故事</h2>
                </div>
              </div>
              <ul class="credits-adaptations">
                <li>
                  <strong>图片与动作</strong>
                  <span>
                    沿用来源中的透明立绘，办公和休闲动作来自网上图集的本地裁帧；部分图集由素材整理者进行
                    AI 辅助创作，并非本地临时生成的立绘。
                  </span>
                </li>
                <li>
                  <strong>工坊场景</strong>
                  <span>柜台、电脑、手臂手势、文件叠放和页面布局为本地 CSS / SVG 呈现调整。</span>
                </li>
                <li>
                  <strong>真实的办理状态</strong>
                  <span>
                    角色演出跟随文件上传、处理和取件状态。实际转换由当前服务器的工具完成。
                  </span>
                </li>
              </ul>
            </article>
          </section>
          <details class="surface credits-records">
            <summary>
              <span>
                <strong>素材记录与原始许可</strong>
                <small>需要核对来源或改编信息？资料都保留在这里。</small>
              </span>
              <SymbolIcon name="chevron" size={18} />
            </summary>
            <div class="credits-record-links">
              <a href={`${WEBROOT}/characters/ATTRIBUTION.raw.md`} download="">
                下载完整署名说明 <SymbolIcon name="download" size={15} />
              </a>
              <a href={`${WEBROOT}/characters/assets.json`} download="">
                下载素材来源与校验清单 <SymbolIcon name="download" size={15} />
              </a>
              <a href={`${WEBROOT}/characters/upstream-NOTICE.md`} download="">
                原始素材使用说明 <SymbolIcon name="download" size={15} />
              </a>
              <a href={`${WEBROOT}/characters/licenses/dsh-deep-whale-NOTICE.txt`} download="">
                鲸鱼娘原始署名记录 <SymbolIcon name="download" size={15} />
              </a>
              <a href={`${WEBROOT}/characters/licenses/dsh-deep-whale-LICENSE.txt`} download="">
                鲸鱼娘原始许可 <SymbolIcon name="download" size={15} />
              </a>
            </div>
            <p>
              来源版本及每个文件的哈希、尺寸和裁切坐标记录于素材清单中。来源中的 AI
              辅助素材许可仅在整理者持有相应权利的范围内适用。
            </p>
          </details>
        </main>
      </>
    </BaseHtml>
  );
}

export const credits = new Elysia()
  .use(userService)
  .get(
    "/credits",
    async ({ jwt, cookie: { auth } }) => (
      <CreditsPage loggedIn={Boolean(auth?.value && (await jwt.verify(auth.value)))} />
    ),
    { cookie: "optionalSession" },
  )
  .get(
    "/characters/ATTRIBUTION.md",
    async ({ jwt, cookie: { auth } }) => (
      <CreditsPage loggedIn={Boolean(auth?.value && (await jwt.verify(auth.value)))} />
    ),
    { cookie: "optionalSession" },
  )
  .get("/characters/ATTRIBUTION.raw.md", ({ set }) => {
    set.headers["content-type"] = "text/markdown; charset=utf-8";
    set.headers["content-disposition"] = 'attachment; filename="character-attribution.md"';
    return Bun.file("./public/characters/ATTRIBUTION.md");
  });
