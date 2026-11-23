import { assetUrl } from "../helpers/assets";
import {
  ACCOUNT_REGISTRATION,
  ALLOW_UNAUTHENTICATED,
  BRANDING,
  HIDE_HISTORY,
  WEBROOT,
} from "../helpers/env";
import { AuthMascot } from "./authMascot";
import { BaseHtml } from "./base";
import { Header } from "./header";

const scenes = {
  login: { image: "whale-cheerful.webp", message: "回来啦！今天想转换什么文件？" },
  register: { image: "whale-starry.webp", message: "初次见面，我是大肥鱼！" },
  setup: { image: "deepseek-standing.webp", message: "准备好了吗？一起给工坊开张吧！" },
  account: { image: "whale-serious.webp", message: "需要更新账号信息？在这里就好。" },
};

export function AuthLayout({
  title,
  scene,
  children,
}: {
  title: string;
  scene: keyof typeof scenes;
  children: JSX.Element;
}) {
  const { image, message } = scenes[scene];
  return (
    <BaseHtml webroot={WEBROOT} title={`${BRANDING} | ${title}`}>
      <>
        <Header
          webroot={WEBROOT}
          branding={BRANDING}
          accountRegistration={ACCOUNT_REGISTRATION}
          allowUnauthenticated={ALLOW_UNAUTHENTICATED}
          hideHistory={HIDE_HISTORY}
          loggedIn={scene === "account"}
          {...(scene === "account" ? { active: "account" as const } : {})}
        />
        <main class="app-container sx-auth-page" id="main-content" tabindex="-1">
          <div class="surface sx-auth-layout" data-auth-scene={scene}>
            <aside class="sx-auth-scene" aria-label="工坊接待处">
              <div class="sx-auth-arch" aria-hidden="true" />
              <div class="sx-auth-greeting">
                <strong>工坊接待处</strong>
                <p data-auth-mascot-message safe>
                  {message}
                </p>
              </div>
              <AuthMascot webroot={WEBROOT} restingImage={image} />
              <div class="sx-auth-counter" aria-hidden="true">
                <span>大肥鱼 · 接待</span>
              </div>
            </aside>
            {children}
          </div>
        </main>
        <script src={assetUrl(WEBROOT, "auth-character.js")} defer />
        {(scene === "register" || scene === "setup") && (
          <script src={assetUrl(WEBROOT, "auth.js")} defer />
        )}
      </>
    </BaseHtml>
  );
}
