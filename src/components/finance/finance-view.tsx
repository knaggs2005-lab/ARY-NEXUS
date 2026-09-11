"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FinanceService } from "../../services/finance-service";
import {
  financeImport,
  money,
  currencies,
  parseMoneyInput,
} from "../../domain/finance";
import { api } from "../api";
import styles from "./finance.module.css";
type Report = Awaited<ReturnType<FinanceService["report"]>>;
export function FinanceView({
  focusKey,
  onEntity,
  entities = [],
  goals = [],
}: {
  focusKey?: string | null;
  onEntity?: (id: string) => void;
  entities?: { id: string; name: string }[];
  goals?: { id: string; title: string }[];
}) {
  const [report, setReport] = useState<Report | null>(null),
    [selected, setSelected] = useState<string | null>(focusKey ?? null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [why, setWhy] = useState(false),
    [cutoff, setCutoff] = useState("");
  const [preview, setPreview] = useState<unknown>(null),
    [showImport, setShowImport] = useState(false);
  const alive = useRef(true),
    locked = useRef(false),
    panel = useRef<HTMLElement>(null);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (focusKey) {
      setSelected(focusKey);
      setWhy(true);
    }
  }, [focusKey]);
  useEffect(() => {
    if (selected)
      panel.current?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "nearest",
      });
  }, [selected, why]);
  async function run(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function action(tool: string, input: unknown) {
    return (
      await api("actions/request", {
        method: "POST",
        body: JSON.stringify({
          tool,
          input,
          request_key: crypto.randomUUID(),
          reason:
            tool === "finance.import"
              ? "User reviewed a financial source import; no money movement"
              : "User requested financial source visibility",
        }),
      })
    ).json();
  }
  async function load() {
    await run(async () => {
      setReport(null);
      const r = await action(
        "finance.read",
        cutoff ? { as_of: new Date(cutoff).toISOString() } : {},
      );
      if (alive.current) setReport(r.result);
    });
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      currency = f.get("currency") as keyof typeof currencies,
      balance = String(f.get("balance")).trim();
    let amount: number | null;
    try {
      amount = parseMoneyInput(balance, currency);
    } catch {
      setError("Enter an amount with the correct currency precision.");
      return;
    }
    const asOf = new Date(String(f.get("date"))).toISOString();
    try {
      setPreview(
        financeImport.parse({
          import_key: crypto.randomUUID(),
          account_key: f.get("key"),
          parent_id: null,
          as_of: asOf,
          observed_at: new Date().toISOString(),
          source_label: f.get("source"),
          source_reference: f.get("reference"),
          payload: {
            account: {
              name: f.get("name"),
              institution: f.get("institution"),
              kind: f.get("kind"),
              currency,
            },
            balance_minor: amount,
            coverage: null,
            transactions: [],
            bills: [],
            holdings: [],
            holdings_complete: false,
            entity_ids: f.get("entity") ? [f.get("entity")] : [],
            goal_ids: f.get("goal") ? [f.get("goal")] : [],
          },
        }),
      );
      setError("");
    } catch {
      setError("Check the statement fields and date.");
    }
  }
  const account = report?.accounts.find((a) => a.key === selected),
    parsed = financeImport.safeParse(preview);
  return (
    <section className={styles.finance} aria-label="Ary Finance">
      <header>
        <span className={styles.eyebrow}>ARY / FINANCE</span>
        <h2>Money, with context.</h2>
        <p>
          Recorded sources. Clear boundaries. Every change has a place to look.
        </p>
        <div className={styles.toolbar}>
          <label>
            Evidence available as of
            <input
              aria-label="Financial as of"
              type="datetime-local"
              value={cutoff}
              onChange={(e) => setCutoff(e.target.value)}
            />
          </label>
          <button disabled={busy} onClick={() => void load()}>
            Refresh evidence
          </button>
          <button disabled={busy} onClick={() => setShowImport(!showImport)}>
            Import statement
          </button>
        </div>
      </header>
      {busy && (
        <p role="status" className={styles.pulse}>
          Reading sources and checking permissions…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {showImport && (
        <section
          aria-label="Financial statement import"
          className={styles.importer}
        >
          <h3>Record a source</h3>
          <p>
            Import a normalized JSON statement for transactions, recurring bills
            and holdings, or record a balance below. This never connects to a
            bank or moves money.
          </p>
          <label>
            Statement JSON
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void run(async () => {
                    if (file.size > 60000)
                      throw new Error(
                        "Use a statement file smaller than 60 KB",
                      );
                    setPreview(
                      financeImport.parse(JSON.parse(await file.text())),
                    );
                  });
              }}
            />
          </label>
          <a href="/finance-statement-template.json" download>
            Download blank statement template
          </a>
          <form onSubmit={submit} className={styles.fields}>
            <label>
              Stable account key
              <input
                required
                name="key"
                placeholder="Use the same key for every statement"
              />
            </label>
            <label>
              Account name
              <input required name="name" />
            </label>
            <label>
              Institution
              <input required name="institution" />
            </label>
            <label>
              Account type
              <select name="kind">
                {[
                  "cash",
                  "investment",
                  "asset",
                  "credit",
                  "loan",
                  "liability",
                ].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              Currency
              <select name="currency">
                {Object.keys(currencies).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Balance (blank means unknown)
              <input
                name="balance"
                inputMode="decimal"
                placeholder="Debt: positive amount owed"
              />
            </label>
            <label>
              Statement as of
              <input required type="datetime-local" name="date" />
            </label>
            <label>
              Source label
              <input required name="source" placeholder="September statement" />
            </label>
            <label>
              Source reference
              <input
                required
                name="reference"
                placeholder="Document name and page/row"
              />
            </label>
            <label>
              Related entity/project
              <select name="entity">
                <option value="">Unlinked</option>
                {entities.map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Related goal
              <select name="goal">
                <option value="">Unlinked</option>
                {goals.map((g) => (
                  <option value={g.id} key={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={busy}>Preview source</button>
          </form>
          {parsed.success && (
            <div className={styles.preview}>
              <h4>
                {parsed.data.payload.account.name} ·{" "}
                {money(
                  parsed.data.payload.balance_minor,
                  parsed.data.payload.account.currency,
                )}
              </h4>
              <p>
                {parsed.data.source_label} · {parsed.data.source_reference}
              </p>
              <p>
                As of {parsed.data.as_of} ·{" "}
                {parsed.data.payload.transactions.length} transactions ·{" "}
                {parsed.data.payload.bills.length} bills ·{" "}
                {parsed.data.payload.holdings.length} holdings
              </p>
              <details>
                <summary>Review complete source data</summary>
                <pre>{JSON.stringify(parsed.data, null, 2)}</pre>
              </details>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await action("finance.import", parsed.data);
                    setNotice(
                      `Statement ${r.result.recovered ? "already recorded" : "imported"}: ${r.result.snapshot_id}. Refresh evidence to view it.`,
                    );
                    setPreview(null);
                  })
                }
              >
                Review and import
              </button>
            </div>
          )}
        </section>
      )}
      {report && (
        <>
          <p className={styles.note}>{report.scope}</p>
          {report.empty && (
            <div className={styles.empty}>
              <h3>No financial sources yet.</h3>
              <p>
                Balances, income, debt and portfolio values stay unknown until
                you import supporting records.
              </p>
            </div>
          )}
          {report.groups.map((g) => (
            <section
              key={g.currency}
              aria-label={`${g.currency} recorded totals`}
            >
              <div className={styles.currency}>
                {g.currency} ·{" "}
                {g.coverage_complete
                  ? "Coverage through selected time"
                  : "Partial transaction coverage"}
              </div>
              <div className={styles.metrics}>
                {[
                  ["Recorded net worth", g.net_worth_minor],
                  ["Recorded assets", g.assets_minor],
                  ["Recorded debt", g.debt_minor],
                  ["Investment accounts", g.portfolio_minor],
                  ["Recorded net spending", g.spending_minor],
                  ["Recorded income", g.income_minor],
                ].map(([label, value]) => (
                  <article key={String(label)}>
                    <span>{label}</span>
                    <strong key={`${label}:${value}`}>
                      {money(value as number | null, g.currency)}
                    </strong>
                  </article>
                ))}
              </div>
              {g.missing_balances > 0 && (
                <p>
                  {g.missing_balances} missing balances prevent a net-worth
                  total.
                </p>
              )}
            </section>
          ))}
          <div className={styles.layout}>
            <aside aria-label="Financial accounts">
              {report.accounts.map((a) => (
                <button
                  key={a.key}
                  aria-pressed={selected === a.key}
                  onClick={() => {
                    setSelected(a.key);
                    setWhy(false);
                  }}
                >
                  <span>{a.latest.payload.account.name}</span>
                  <strong>
                    {money(
                      a.latest.payload.balance_minor,
                      a.latest.payload.account.currency,
                    )}
                  </strong>
                  <small>
                    {a.latest.payload.account.kind} ·{" "}
                    {new Date(a.latest.as_of).toLocaleString()}
                  </small>
                </button>
              ))}
            </aside>
            {account && (
              <section
                ref={panel}
                className={styles.detail}
                aria-label="Financial context"
                key={account.key}
              >
                <div className={styles.eyebrow}>
                  {account.latest.payload.account.institution} /{" "}
                  {account.latest.payload.account.currency}
                </div>
                <h3>{account.latest.payload.account.name}</h3>
                <p>
                  Balance as of{" "}
                  {new Date(account.latest.as_of).toLocaleString()} · Imported{" "}
                  {new Date(account.latest.created_at).toLocaleString()}
                </p>
                <button onClick={() => setWhy(true)}>
                  Why did this change?
                </button>
                {why && (
                  <article
                    className={styles.explanation}
                    aria-label="Financial change evidence"
                  >
                    <h4>Follow the evidence</h4>
                    <p>{account.explanation}</p>
                    <div className={styles.paths}>
                      {[account.previous, account.latest]
                        .filter(Boolean)
                        .map((r) => (
                          <div key={r!.id}>
                            <strong>{r!.source_label}</strong>
                            <p>{r!.source_reference}</p>
                            <small>Source observed {r!.observed_at}</small>
                            <p>
                              {money(
                                r!.payload.balance_minor,
                                r!.payload.account.currency,
                              )}
                            </p>
                          </div>
                        ))}
                    </div>
                    <p>
                      No market gains, spending causes, tax implications or
                      business impact were inferred.
                    </p>
                  </article>
                )}
                <div
                  className={styles.timeline}
                  aria-label="Financial timeline"
                >
                  {account.timeline.map((t) => (
                    <button key={t.id} onClick={() => setWhy(true)}>
                      <small>{new Date(t.as_of).toLocaleDateString()}</small>
                      <strong>
                        {money(
                          t.balance_minor,
                          account.latest.payload.account.currency,
                        )}
                      </strong>
                      <span>{t.source_label}</span>
                    </button>
                  ))}
                </div>
                {(account.entities.length > 0 || account.goals.length > 0) && (
                  <section
                    className={styles.relationships}
                    aria-label="Financial relationships"
                  >
                    <svg
                      viewBox="0 0 500 35"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <path d="M0 17 C150 17 150 4 250 4 S400 17 500 17 M0 17 C150 17 150 30 250 30 S400 17 500 17" />
                    </svg>
                    <div>
                      {account.entities.map((e) => (
                        <button key={e.id} onClick={() => onEntity?.(e.id)}>
                          {e.type} · {e.name} ↗
                        </button>
                      ))}
                      {account.goals.map((g) => (
                        <span key={g.id}>Goal · {g.title}</span>
                      ))}
                    </div>
                  </section>
                )}
                <h4>Transactions · selected UTC month</h4>
                <p>
                  {account.coverage_complete
                    ? "Source declares complete coverage through the selected time."
                    : "Partial source coverage; totals are recorded subtotals, not a complete spending or income statement."}{" "}
                  Transfers are excluded from spending and income.
                </p>
                <div className={styles.table}>
                  <table>
                    <thead>
                      <tr>
                        <th>When / source</th>
                        <th>Context</th>
                        <th>Classification</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {account.transactions.map((t) => (
                        <tr key={t.source_id}>
                          <td>
                            {new Date(t.at).toLocaleDateString()}
                            <small>{t.source_id}</small>
                          </td>
                          <td>{t.description}</td>
                          <td>{t.kind}</td>
                          <td>
                            {money(
                              t.amount_minor,
                              account.latest.payload.account.currency,
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!account.transactions.length && (
                  <p>No posted transactions recorded in this month.</p>
                )}
                {account.unclassified_count > 0 && (
                  <p>
                    {account.unclassified_count} unclassified transactions are
                    excluded from spending/income totals.
                  </p>
                )}
                <h4>Recurring bills · source-declared</h4>
                {account.latest.payload.bills.length ? (
                  account.latest.payload.bills.map((b) => (
                    <article className={styles.row} key={b.source_id}>
                      <span>
                        {b.name} · {b.frequency}
                        <small>
                          Due {new Date(b.next_due).toLocaleDateString()} ·
                          source {b.source_id}
                        </small>
                      </span>
                      <strong>
                        {money(
                          b.amount_minor,
                          account.latest.payload.account.currency,
                        )}
                      </strong>
                    </article>
                  ))
                ) : (
                  <p>
                    No recurring bill schedule was provided. Recurrence is not
                    inferred from repeated merchants.
                  </p>
                )}
                <h4>Investment holdings</h4>
                <p>
                  {account.latest.payload.holdings_complete
                    ? "Source declares its holdings list complete."
                    : "Holdings coverage is unknown or partial."}{" "}
                  Values are source-reported at the statement date; no live
                  prices. Holdings are not added again to net worth.
                </p>
                {account.latest.payload.holdings.map((h) => (
                  <article className={styles.row} key={h.source_id}>
                    <span>
                      {h.name} {h.symbol}
                      <small>
                        {h.quantity} units · source {h.source_id}
                      </small>
                    </span>
                    <strong>
                      {money(
                        h.value_minor,
                        account.latest.payload.account.currency,
                      )}
                    </strong>
                  </article>
                ))}
                <details>
                  <summary>
                    Source and revision history · {account.history.length}
                  </summary>
                  {account.history.map((h) => (
                    <p key={h.id}>
                      {h.source_label} · {h.as_of} ·{" "}
                      {h.superseded
                        ? "Historical correction"
                        : "Recorded source"}
                      <small>
                        {h.id} · observed {h.observed_at}
                      </small>
                    </p>
                  ))}
                </details>
              </section>
            )}
          </div>
        </>
      )}
    </section>
  );
}
