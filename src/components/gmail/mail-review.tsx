import { gmailSendInput, gmailEvidenceInput } from "../../domain/gmail";
export function MailEvidenceReview({ input }: { input: unknown }) {
  const parsed = gmailEvidenceInput.safeParse(input);
  if (!parsed.success) return null;
  return (
    <section aria-label="Email evidence review">
      <strong>Save this selected quote as attributed email evidence?</strong>
      <blockquote
        style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}
      >
        {parsed.data.quote}
      </blockquote>
      <p>
        This records the email statement and its source. It does not confirm it
        as independently verified truth or rewrite an existing fact.
      </p>
    </section>
  );
}
export function MailReview({ input }: { input: unknown }) {
  const parsed = gmailSendInput.safeParse(input);
  if (!parsed.success) return null;
  const v = parsed.data;
  return (
    <section aria-label="Email send review">
      <strong>Send this exact email once</strong>
      <p>From: {v.from_account}</p>
      <p>To: {v.to.join(", ")}</p>
      {v.cc.length > 0 && <p>Cc: {v.cc.join(", ")}</p>}
      <p>Subject: {v.subject}</p>
      <pre style={{ whiteSpace: "pre-wrap", maxHeight: 250, overflow: "auto" }}>
        {v.body}
      </pre>
      <small>New plain-text message · No attachments</small>
    </section>
  );
}
