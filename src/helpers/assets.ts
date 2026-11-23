// Bump when shipping UI assets so existing browser caches get the new interface.
const UI_ASSET_VERSION = "workshop-11";

export const assetUrl = (webroot: string, filename: string) =>
  `${webroot}/${filename}?v=${UI_ASSET_VERSION}`;
