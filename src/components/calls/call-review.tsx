import { callInput } from "../../domain/phone";
export function CallReview({ input }: { input: unknown }) {
  const parsed = callInput.safeParse(input);
  if (!parsed.success) return null;
  const c = parsed.data;
  return (
    <section aria-label="Exact call review">
      <h3>Approve one outbound call</h3>
      <p>
        Destination: <strong>{c.to}</strong>
      </p>
      <p>Saved contact: {c.contact_entity_id ?? "Explicit number"}</p>
      <p>Only this script will be spoken:</p>
      <blockquote style={{ whiteSpace: "pre-wrap" }}>{c.script}</blockquote>
      <p>
        Transcription:{" "}
        {c.capture_transcript ? "Requested · user confirmed consent" : "Off"}.
        No automatic redial. Up to 120 seconds.
      </p>
      <p>
        Approval authorizes contacting this destination and sending this script
        to the configured provider.
      </p>
    </section>
  );
}
