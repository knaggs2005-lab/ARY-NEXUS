import { OAuth2Client } from "google-auth-library";
import { GoogleCalendarOAuth } from "../calendar/google-calendar";
import { EncryptedCalendarVault, type CalendarVault } from "../calendar/vault";
import { AppError } from "../../domain/validation";
export const gmailScopes = {
  read: "https://www.googleapis.com/auth/gmail.readonly",
  send: "https://www.googleapis.com/auth/gmail.send",
};
export function gmailConfigured() {
  return Boolean(
    process.env.GOOGLE_GMAIL_CLIENT_ID &&
    process.env.GOOGLE_GMAIL_CLIENT_SECRET &&
    process.env.GOOGLE_GMAIL_REDIRECT_URI &&
    /^[a-f0-9]{64}$/i.test(process.env.ARY_INTEGRATION_ENCRYPTION_KEY || ""),
  );
}
export function gmailRedirect() {
  const raw = process.env.GOOGLE_GMAIL_REDIRECT_URI;
  if (!raw) throw new AppError("Gmail OAuth is not configured", 503);
  const u = new URL(raw);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/api/gmail/oauth/callback" ||
    (u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(u.hostname)
      ))
  )
    throw new AppError("Invalid Gmail callback configuration", 503);
  return u;
}
export function gmailClient() {
  return new OAuth2Client({
    clientId: process.env.GOOGLE_GMAIL_CLIENT_ID,
    clientSecret: process.env.GOOGLE_GMAIL_CLIENT_SECRET,
    redirectUri: gmailRedirect().href,
    transporterOptions: { timeout: 15000, retry: false },
  });
}
export function gmailOAuth(
  vault: CalendarVault = new EncryptedCalendarVault(),
) {
  return new GoogleCalendarOAuth(vault, {
    configured: gmailConfigured,
    redirect: gmailRedirect,
    client: gmailClient,
    clientId: () => process.env.GOOGLE_GMAIL_CLIENT_ID,
    prefix: "gmail:",
    path: "gmail",
    label: "Gmail",
    scopes: (write) =>
      write ? [gmailScopes.read, gmailScopes.send] : [gmailScopes.read],
  });
}
