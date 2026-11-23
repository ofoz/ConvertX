import { describe, expect, test } from "bun:test";

import { authPageHref, normalizeAuthReturn } from "../../src/helpers/authReturn";

describe("authentication return targets", () => {
  test.each([
    ["/", "", "/"],
    ["/?to=docx", "", "/?to=docx"],
    ["/?to=H264.MP4&converter=ffmpeg", "", "/?to=H264.MP4&converter=ffmpeg"],
    [
      "/workshop/?to=pdf&converter=libreoffice",
      "/workshop",
      "/workshop/?to=pdf&converter=libreoffice",
    ],
    ["/?to=%64ocx", "", "/?to=docx"],
  ])("rebuilds a local workshop destination (%s)", (input, root, expected) => {
    expect(normalizeAuthReturn(input, root)).toBe(expected);
  });

  test.each([
    undefined,
    null,
    123,
    "https://example.com/",
    "//example.com/",
    "///example.com/",
    "/\\example.com/",
    "/login",
    "/account",
    "/?next=https://example.com",
    "/?to=docx&to=pdf",
    "/?to=docx&constructor=abc",
    "/?to=docx#https://example.com",
    "/?to=%0d%0aLocation%3Aevil",
    "/?to=../../",
    "/?to=%2f%2fevil",
    "/?to=%252f%252fevil",
    "/?to=",
    "/?to=with+spaces",
    "/%2fexample.com",
    "/?converter=a&converter=b",
    "/?to=" + "a".repeat(65),
  ])("rejects external, malformed or unapproved destinations (%s)", (input) => {
    expect(normalizeAuthReturn(input, "")).toBeUndefined();
  });

  test("does not cross an application's WEBROOT", () => {
    expect(normalizeAuthReturn("/?to=pdf", "/workshop")).toBeUndefined();
    expect(normalizeAuthReturn("/workshop-extra/?to=pdf", "/workshop")).toBeUndefined();
    expect(authPageHref("/workshop", "login", "/workshop/?to=pdf&converter=pandoc")).toBe(
      "/workshop/login?next=%2Fworkshop%2F%3Fto%3Dpdf%26converter%3Dpandoc",
    );
    expect(authPageHref("", "register")).toBe("/register");
  });
});
