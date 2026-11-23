import { assetUrl } from "../helpers/assets";
import { BRANDING, DEFAULT_BRANDING } from "../helpers/env";
import { SymbolIcon } from "./symbol";

export const Header = ({
  loggedIn,
  accountRegistration,
  allowUnauthenticated,
  hideHistory,
  publicNavigation = false,
  webroot = "",
  branding = BRANDING,
  active,
}: {
  loggedIn?: boolean;
  accountRegistration?: boolean;
  allowUnauthenticated?: boolean;
  hideHistory?: boolean;
  publicNavigation?: boolean;
  webroot?: string;
  branding?: string;
  active?: "convert" | "formats" | "history" | "account";
}) => (
  <header class="app-header">
    <nav class="app-container app-nav" aria-label="主导航">
      <a
        class="app-brand"
        href={`${webroot}/`}
        aria-label={branding === DEFAULT_BRANDING ? `${branding}，营业中` : branding}
      >
        {branding === DEFAULT_BRANDING ? (
          <img
            class="app-brand-image"
            src={assetUrl(webroot, "brand-workshop.png")}
            alt={branding}
            width="311"
            height="69"
          />
        ) : (
          <>
            <span class="app-brand-mark" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32" fill="none">
                <path
                  d="M37 10c3-5 7-5 9-4-1 6-5 9-10 9-3 10-12 16-24 11C3 22 0 13 4 7c2 9 12 11 17 5 5-5 11-5 16-2Z"
                  fill="currentColor"
                />
                <path
                  d="M18 7c-4-4-1-7 2-6m3 5c1-5 5-5 6-3"
                  stroke="white"
                  stroke-width="2"
                  stroke-linecap="round"
                />
                <circle cx="29" cy="16" r="1.6" fill="white" />
              </svg>
            </span>
            <span class="app-brand-copy">
              <span class="app-brand-name" title={branding} safe>
                {branding}
              </span>
              <small class="app-brand-subtitle">FORMAT WORKSHOP</small>
            </span>
          </>
        )}
      </a>
      {(loggedIn || allowUnauthenticated || publicNavigation) && (
        <ul class="app-nav-links app-nav-links--workspace" aria-label="工作区">
          <li>
            <a
              class="app-nav-link"
              href={`${webroot}/`}
              aria-current={active === "convert" ? "page" : undefined}
            >
              <SymbolIcon name="layers" size={17} />
              <span>转换台</span>
            </a>
          </li>
          <li>
            <a
              class="app-nav-link"
              href={`${webroot}/converters`}
              aria-current={active === "formats" ? "page" : undefined}
            >
              <SymbolIcon name="grid" size={17} />
              <span>支持格式</span>
            </a>
          </li>
          {loggedIn && !hideHistory && (
            <li>
              <a
                class="app-nav-link"
                href={`${webroot}/history`}
                aria-current={active === "history" ? "page" : undefined}
              >
                <SymbolIcon name="history" size={17} />
                <span>历史记录</span>
              </a>
            </li>
          )}
        </ul>
      )}
      {(!loggedIn || !allowUnauthenticated) && (
        <ul class="app-nav-links app-nav-links--account" aria-label="账号操作">
          {loggedIn ? (
            <>
              <li>
                <a
                  class="app-nav-link"
                  href={`${webroot}/account`}
                  aria-current={active === "account" ? "page" : undefined}
                >
                  <SymbolIcon name="settings" size={17} />
                  <span>账号</span>
                </a>
              </li>
              <li>
                <a class="app-nav-link" href={`${webroot}/logoff`}>
                  退出
                </a>
              </li>
            </>
          ) : (
            <>
              <li>
                <a class="app-nav-link" href={`${webroot}/login`}>
                  登录
                </a>
              </li>
              {accountRegistration && (
                <li>
                  <a class="app-nav-link app-nav-link--register" href={`${webroot}/register`}>
                    注册
                  </a>
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </nav>
  </header>
);
