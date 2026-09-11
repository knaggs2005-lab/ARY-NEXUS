import {
  GoogleCalendarOAuth,
  calendarRedirect,
} from "../infrastructure/calendar/google-calendar";
/** Public OAuth handoff only; the ticket is minted by an authenticated, audited owner request. */
export async function calendarOAuthResponse(
  request: Request,
  route: string,
  config?: {
    oauth: GoogleCalendarOAuth;
    redirect: URL;
    path: string;
    label: string;
  },
) {
  const url = new URL(request.url),
    oauth = config?.oauth ?? new GoogleCalendarOAuth();
  const path = config?.path ?? "calendar",
    label = config?.label ?? "Google Calendar",
    redirect = config?.redirect ?? calendarRedirect();
  const cookie = (value: string, age: number) =>
    `ary_${path}_oauth=${value}; HttpOnly; SameSite=Lax; Path=/api/${path}/oauth; Max-Age=${age}${redirect.protocol === "https:" ? "; Secure" : ""}`;
  if (route === `${path}/oauth/launch`) {
    const launch = await oauth.launch(url.searchParams.get("ticket") || "");
    return new Response(null, {
      status: 303,
      headers: {
        Location: launch.url,
        "Set-Cookie": cookie(launch.browser, 600),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  if (route === `${path}/oauth/callback`) {
    const browser =
      request.headers
        .get("cookie")
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith(`ary_${path}_oauth=`))
        ?.slice(`ary_${path}_oauth=`.length) || "";
    await oauth.finish(
      url.searchParams.get("state") || "",
      browser,
      url.searchParams.get("code") || "",
    );
    return new Response(
      `<!doctype html><html lang=en><meta charset=utf-8><title>${label} connected</title><body><h1>${label} connected</h1><p>Return to Ary Nexus and select Refresh connection. External sends and changes still require your approval.</p></body></html>`,
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Set-Cookie": cookie("", 0),
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy":
            "default-src 'none'; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
  throw new Error("Unknown Calendar OAuth route");
}
