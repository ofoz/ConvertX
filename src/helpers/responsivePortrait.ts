import { assetUrl } from "./assets";

const standingPortraitWidths: Readonly<Record<string, number>> = {
  "claude.webp": 1013,
  "deepseek-standing.webp": 1122,
  "gpt.webp": 1012,
  "whale-cheerful.webp": 935,
  "whale-exasperated.webp": 935,
  "whale-serious.webp": 935,
  "whale-starry.webp": 935,
};

/**
 * Return density-aware local display derivatives plus the untouched original fallback. SVG motion
 * masks and eye coordinates continue to use the original viewBox and filenames.
 */
export function responsivePortraitSources(webroot: string, filename: string): string | undefined {
  const rawName = filename.replace(/^characters\//, "");
  const name = rawName.endsWith(".webp") ? rawName : `${rawName}.webp`;
  const originalWidth = standingPortraitWidths[name];
  if (!originalWidth) return undefined;

  return [384, 768]
    .map((width) => `${assetUrl(webroot, `characters/display/${width}/${name}`)} ${width}w`)
    .concat(`${assetUrl(webroot, `characters/${name}`)} ${originalWidth}w`)
    .join(", ");
}
