import { assetUrl } from "../helpers/assets";
import { BRANDING } from "../helpers/env";

export const BaseHtml = ({
  children,
  branding = BRANDING,
  title = branding,
  webroot = "",
}: {
  children: JSX.Element;
  title?: string;
  webroot?: string;
  branding?: string;
}) => (
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="color-scheme" content="light" />
      <meta name="theme-color" content="#edf5ff" />
      <meta name="webroot" content={webroot} />
      <meta name="branding" content={branding} />
      <meta name="application-name" content={branding} />
      <title safe>{title}</title>
      <link rel="stylesheet" href={assetUrl(webroot, "generated.css")} />
      <link rel="apple-touch-icon" sizes="180x180" href={`${webroot}/apple-touch-icon.png`} />
      <link rel="icon" type="image/png" sizes="32x32" href={`${webroot}/favicon-32x32.png`} />
      <link rel="icon" type="image/png" sizes="16x16" href={`${webroot}/favicon-16x16.png`} />
      <link rel="manifest" href={assetUrl(webroot, "site.webmanifest")} />
    </head>
    <body class="app-body">
      <a class="skip-link" href="#main-content">
        跳转到主要内容
      </a>
      {children}
      <footer class="app-footer">
        <div class="app-container app-footer-inner">
          <span>
            非官方同人界面 · <a href={`${webroot}/characters/ATTRIBUTION.md`}>角色与素材说明</a>
          </span>
        </div>
      </footer>
    </body>
  </html>
);
