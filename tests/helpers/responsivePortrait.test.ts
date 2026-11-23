import { describe, expect, test } from "bun:test";

import { responsivePortraitSources } from "../../src/helpers/responsivePortrait";

const names = [
  ["deepseek-standing.webp", 1122],
  ["claude.webp", 1013],
  ["gpt.webp", 1012],
  ["whale-cheerful.webp", 935],
  ["whale-serious.webp", 935],
  ["whale-exasperated.webp", 935],
  ["whale-starry.webp", 935],
] as const;

describe("responsive standing portraits", () => {
  test.each(names)("keeps display derivatives and original fallback for %s", (filename, width) => {
    expect(responsivePortraitSources("/workshop", filename)).toBe(
      `/workshop/characters/display/384/${filename}?v=workshop-11 384w, /workshop/characters/display/768/${filename}?v=workshop-11 768w, /workshop/characters/${filename}?v=workshop-11 ${width}w`,
    );
  });

  test("resolves the scene character helper’s extensionless filenames", () => {
    expect(responsivePortraitSources("/workshop", "claude")).toBe(
      "/workshop/characters/display/384/claude.webp?v=workshop-11 384w, /workshop/characters/display/768/claude.webp?v=workshop-11 768w, /workshop/characters/claude.webp?v=workshop-11 1013w",
    );
    expect(responsivePortraitSources("/workshop", "whale-cheerful")).toContain(
      "whale-cheerful.webp?v=workshop-11 935w",
    );
  });

  test("leaves atlases, pose crops and unrelated image files untouched", () => {
    expect(responsivePortraitSources("", "characters/crop-deepseek-work-0.webp")).toBeUndefined();
    expect(responsivePortraitSources("", "pet-dafeiyu.webp")).toBeUndefined();
    expect(responsivePortraitSources("", "../claude.webp")).toBeUndefined();
    expect(responsivePortraitSources("", "claude.png")).toBeUndefined();
  });
});
