import { calendarWriteInput, calendarUpdateInput } from "../../domain/calendar";
export function CalendarReview({ input }: { input: unknown }) {
  const update = calendarUpdateInput.safeParse(input),
    create = calendarWriteInput.safeParse(input);
  const data = update.success
    ? update.data
    : create.success
      ? create.data
      : null;
  if (!data) return null;
  return (
    <section aria-label="Calendar change review">
      <strong>
        {update.success ? "Update Google event" : "Create Google event"}
      </strong>
      <p>
        Primary calendar · No invitations · Approval for these exact details
      </p>
      <dl>
        {(["summary", "description", "start", "end", "time_zone"] as const).map(
          (key) => (
            <div key={key}>
              <dt>{key.replaceAll("_", " ")}</dt>
              <dd>
                {update.success &&
                  update.data.before[key] !== data.event[key] && (
                    <>
                      <del>{update.data.before[key] || "(empty)"}</del> →{" "}
                    </>
                  )}
                {data.event[key] || "(empty)"}
              </dd>
            </div>
          ),
        )}
      </dl>
    </section>
  );
}
