const invalidConversionIdCharacter = /[^a-zA-Z0-9_.-]/;

/** Accept an already-decoded query or form field and rebuild the local destination. */
export function normalizeAuthReturn(value: unknown, webroot: string): string | undefined {
  if (typeof value !== "string" || /[\\#\s]/u.test(value)) return;

  const home = `${webroot}/`;
  // Allow two 64-character IDs, even if every character is percent-encoded.
  if (value.length > home.length + 400) return;
  const separator = value.indexOf("?");
  const path = separator === -1 ? value : value.slice(0, separator);
  if (path !== home) return;
  if (separator === -1) return home;

  const params = new URLSearchParams(value.slice(separator + 1));
  const filtered = new URLSearchParams();
  for (const [key, id] of params) {
    if (
      (key !== "to" && key !== "converter") ||
      filtered.has(key) ||
      id.length === 0 ||
      id.length > 64 ||
      invalidConversionIdCharacter.test(id)
    )
      return;
    filtered.set(key, id);
  }
  const query = filtered.toString();
  return query ? `${home}?${query}` : home;
}

export function authPageHref(
  webroot: string,
  page: "login" | "register" | "setup",
  returnTo?: string,
) {
  const path = `${webroot}/${page}`;
  return returnTo === undefined ? path : `${path}?${new URLSearchParams({ next: returnTo })}`;
}
