import { it, expect, vi } from "vitest";
import { TwilioPhoneProvider } from "../src/infrastructure/phone/twilio-phone";
import { ARY_CALL_DISCLOSURE } from "../src/domain/phone";
const sid = "CA" + "b".repeat(32);
const call = (status = "queued") => ({
  sid,
  status,
  duration: null,
  price: null,
  price_unit: "USD",
});
const response = (v: unknown) => new Response(JSON.stringify(v));
const adapter = (f: typeof fetch) =>
  new TwilioPhoneProvider(
    "AC" + "a".repeat(32),
    "fixture-secret",
    "+14155550100",
    f,
  );
it("uses fixed HTTPS APIs and XML-escapes only the approved script with bounded duration and recording off", async () => {
  const f = vi.fn<typeof fetch>().mockResolvedValue(response(call()));
  const p = adapter(f);
  await p.initiate({
    to: "+14155550123",
    script:
      ARY_CALL_DISCLOSURE + " <Redirect>https://evil.test</Redirect> & hello",
    operationId: "op",
    captureTranscript: false,
  });
  const [url, options] = f.mock.calls[0];
  expect(String(url)).toBe(
    "https://api.twilio.com/2010-04-01/Accounts/AC" +
      "a".repeat(32) +
      "/Calls.json",
  );
  const body = new URLSearchParams(String(options?.body));
  expect(body.get("Twiml")).toContain("&lt;Redirect&gt;");
  expect(body.get("Twiml")).not.toContain("<Redirect>");
  expect(body.get("Record")).toBe("false");
  expect(body.get("TimeLimit")).toBe("120");
  expect(body.get("From")).toBe("+14155550100");
  expect(options?.redirect).toBe("error");
});
it("checks live number intelligence rather than trusting formatting", async () => {
  const f = vi.fn<typeof fetch>().mockResolvedValue(
    response({
      phone_number: "+14155550123",
      valid: true,
      country_code: "US",
      line_type_intelligence: { type: "premium", error_code: null },
    }),
  );
  expect((await adapter(f).inspectNumber("+14155550123")).lineType).toBe(
    "premium",
  );
  expect(String(f.mock.calls[0][0])).toContain("Fields=line_type_intelligence");
});
it.each([
  ["ringing", "canceled"],
  ["in-progress", "completed"],
])("interrupts %s calls using %s", async (status, end) => {
  const f = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response(call(status)))
    .mockResolvedValueOnce(response(call(end)));
  await adapter(f).cancelCall(sid);
  expect(
    new URLSearchParams(String(f.mock.calls[1][1]?.body)).get("Status"),
  ).toBe(end);
});
it("completed status does not create a fake transcript or repeat termination", async () => {
  const f = vi
    .fn<typeof fetch>()
    .mockResolvedValue(response(call("completed")));
  const value = await adapter(f).cancelCall(sid);
  expect(f).toHaveBeenCalledTimes(1);
  expect(value.transcript).toBeNull();
});
it("refuses unsupported transcripts and invalid provider references", async () => {
  const f = vi.fn<typeof fetch>();
  const p = adapter(f);
  await expect(p.getCall("../../other-account")).rejects.toThrow(
    "Invalid provider",
  );
  await expect(
    p.initiate({
      to: "+14155550123",
      script: ARY_CALL_DISCLOSURE,
      operationId: "op",
      captureTranscript: true,
    }),
  ).rejects.toThrow("does not support");
  expect(f).not.toHaveBeenCalled();
});
it("sanitizes provider failures without printing response secrets", async () => {
  const f = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("secret contact details", { status: 401 }));
  await expect(adapter(f).getCall(sid)).rejects.toThrow("HTTP 401");
});
it("maps reported duration/cost without inventing a model cost or business result", async () => {
  const f = vi.fn<typeof fetch>().mockResolvedValue(
    response({
      ...call("completed"),
      duration: "17",
      price: "-0.004",
      price_unit: "USD",
    }),
  );
  expect(await adapter(f).getCall(sid)).toMatchObject({
    duration_seconds: 17,
    cost: { amount: "-0.004", currency: "USD" },
    transcript: null,
  });
});
