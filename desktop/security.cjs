const ORIGIN = "http://127.0.0.1:3000";
function isAryUrl(value) {
  try {
    return new URL(value).origin === ORIGIN;
  } catch {
    return false;
  }
}
function isExternalWebUrl(value) {
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
function allowPermission(permission, origin, details = {}) {
  if (!isAryUrl(origin)) return false;
  if (permission === "display-capture") return true;
  if (permission !== "media") return false;
  const types =
    details.mediaTypes ?? (details.mediaType ? [details.mediaType] : []);
  return (
    types.length > 0 &&
    types.every((type) => type === "audio" || type === "video")
  );
}
async function requestMediaAccess(details, ask) {
  const types =
    details.mediaTypes ?? (details.mediaType ? [details.mediaType] : []);
  if (!types.length || types.some((type) => !["audio", "video"].includes(type)))
    return false;
  for (const type of new Set(types)) {
    if (!(await ask(type === "video" ? "camera" : "microphone"))) return false;
  }
  return true;
}
function desktopSessionHeaders(details, webContentsId, token) {
  const headers = { ...details.requestHeaders };
  // Remove a renderer-supplied value even on requests that must not receive proof.
  for (const name of Object.keys(headers))
    if (name.toLowerCase() === "x-ary-desktop-session") delete headers[name];
  const origin = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "origin",
  )?.[1];
  if (
    token &&
    /^[a-f0-9]{64}$/.test(token) &&
    details.webContentsId === webContentsId &&
    isAryUrl(details.url) &&
    new URL(details.url).pathname.startsWith("/api/") &&
    details.method === "POST" &&
    origin === ORIGIN
  )
    headers["X-Ary-Desktop-Session"] = token;
  return headers;
}
module.exports = {
  desktopSessionHeaders,
  ORIGIN,
  isAryUrl,
  isExternalWebUrl,
  allowPermission,
  requestMediaAccess,
};
