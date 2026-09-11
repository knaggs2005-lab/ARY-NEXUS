import { financeImport, money } from "../../domain/finance";
export function FinanceImportReview({ input }: { input: unknown }) {
  const parsed = financeImport.safeParse(input);
  if (!parsed.success) return null;
  const v = parsed.data;
  return (
    <section aria-label="Financial import review">
      <strong>Import this source into Ary?</strong>
      <p>
        {v.payload.account.name} · {v.payload.account.institution} ·{" "}
        {v.payload.account.kind}
      </p>
      <p>
        Reported balance:{" "}
        {money(v.payload.balance_minor, v.payload.account.currency)} · as of{" "}
        {v.as_of}
      </p>
      <p>
        {v.source_label} · {v.source_reference}
      </p>
      <p>
        {v.payload.transactions.length} transactions · {v.payload.bills.length}{" "}
        recurring bills · {v.payload.holdings.length} holdings
      </p>
      <p>
        {v.parent_id
          ? "Appends a correction; the previous source remains historical."
          : "Adds a source snapshot. Existing statements remain unchanged."}{" "}
        No bank connection or money movement.
      </p>
    </section>
  );
}
