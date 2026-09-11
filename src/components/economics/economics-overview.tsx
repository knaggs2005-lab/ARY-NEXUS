"use client";
import { useEffect, useRef } from "react";
import type { RoiService } from "@/services/roi-service";
import styles from "../roi.module.css";
type Report = Awaited<ReturnType<RoiService["report"]>>;
export const economicsMoney = (value: number | null) =>
  value === null
    ? "Not recorded"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: value !== 0 && Math.abs(value) < 0.01 ? 6 : 2,
      }).format(value);
function Metric({
  label,
  value,
  format,
  detail,
  month,
  lowerBetter = false,
}: {
  label: string;
  value: number | null;
  format: (n: number | null) => string;
  detail: string;
  month: string;
  lowerBetter?: boolean;
}) {
  const element = useRef<HTMLElement>(null),
    previous = useRef({ month, value });
  useEffect(() => {
    const old = previous.current;
    previous.current = { month, value };
    const node = element.current;
    if (
      !node ||
      old.month !== month ||
      old.value === value ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    node.dataset.change =
      old.value !== null && value !== null
        ? value > old.value !== lowerBetter
          ? "improved"
          : "degraded"
        : "updated";
    const motion = node.animate(
      [
        { opacity: 0.6, transform: "translateY(3px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 350, easing: "ease-out" },
    );
    const timer = setTimeout(() => delete node.dataset.change, 1000);
    return () => {
      clearTimeout(timer);
      motion.cancel();
      delete node.dataset.change;
    };
  }, [value, month, lowerBetter]);
  return (
    <article ref={element} className={styles.card} data-metric={label}>
      <span>{label}</span>
      <strong>{format(value)}</strong>
      <small>{detail}</small>
    </article>
  );
}
export function EconomicsOverview({ report }: { report: Report }) {
  const metrics = [
    {
      label: "Operating cost",
      value: report.operatingCost,
      format: economicsMoney,
      detail: "Recorded model + additional compute + tools",
      lowerBetter: true,
    },
    {
      label: "Influenced revenue",
      value: report.revenue,
      format: economicsMoney,
      detail: "Confirmed attribution; not revenue booked by Ary",
    },
    {
      label: "Expenses avoided",
      value: report.expenses,
      format: economicsMoney,
      detail: "Confirmed savings supported by evidence",
    },
    {
      label: "Time saved",
      value: report.minutes,
      format: (n: number | null) =>
        n === null ? "Not recorded" : `${Number((n / 60).toFixed(2))} hours`,
      detail: "Confirmed attribution; never converted into dollars",
    },
    {
      label: "Monthly net contribution",
      value: report.netContribution,
      format: economicsMoney,
      detail: "Recorded confirmed benefit less recorded operating cost",
    },
    {
      label: "ROI multiple",
      value: report.roiMultiple,
      format: (n: number | null) =>
        n === null ? "Not available" : `${n.toFixed(2)}×`,
      detail:
        "Confirmed benefit ÷ recorded cost; incomplete model costs withheld",
    },
  ];
  const quality = report.attributionQuality;
  return (
    <>
      <div className={styles.cards}>
        {metrics.map((m) => (
          <Metric key={m.label} {...m} month={report.month} />
        ))}
      </div>
      <div className={styles.quality}>
        <div>
          <span>Action attempts</span>
          <strong>{report.actionCount}</strong>
          <small>
            {report.executedActionCount} successful non-replay attempts ·{" "}
            {report.replayCount} replays. Includes reads and audit operations.
          </small>
        </div>
        <div>
          <span>Attribution quality</span>
          <strong>
            {quality.meanConfidence === null
              ? "Unassessed"
              : `${Math.round(quality.meanConfidence * 100)}%`}
          </strong>
          <small>
            Mean stated confidence of eligible assessments; not independently
            verified.
          </small>
        </div>
        <div>
          <span>Evidence status</span>
          <strong>{quality.confirmed} confirmed</strong>
          <small>
            {quality.uncertain} uncertain · {quality.pending} pending ·{" "}
            {quality.rejected} rejected · {report.unassessedOutcomes} unassessed
            outcomes
          </small>
        </div>
      </div>
      {report.calculationStatus === "incomplete_costs" && (
        <p role="status" className={styles.warning}>
          Net contribution and ROI are withheld: model costs are incomplete or
          legacy costs may overlap. Known cost subtotals remain visible.
        </p>
      )}
      <div className={styles.charts}>
        <section
          className={styles.chart}
          aria-label="Monthly contribution trend"
        >
          <header>
            <div>
              <span className={styles.eyebrow}>SIX MONTHS / UTC</span>
              <h3>Contribution over time</h3>
            </div>
            <small>Recorded net · USD</small>
          </header>
          <ContributionChart rows={report.trends} />
        </section>
        <section
          className={styles.chart}
          aria-label="Operating cost composition"
        >
          <span className={styles.eyebrow}>COST COMPOSITION</span>
          <h3>Where compute becomes cost</h3>
          {[
            { label: "Model", amount: report.modelCost },
            { label: "Additional compute", amount: report.computeCost },
            { label: "Tools", amount: report.toolCost },
          ].map((r) => (
            <div key={r.label} className={styles.costBar}>
              <div>
                <span>{r.label}</span>
                <strong>{economicsMoney(r.amount)}</strong>
              </div>
              <div className={styles.track}>
                <span
                  style={{
                    width:
                      r.amount !== null && report.operatingCost
                        ? `${(r.amount / report.operatingCost) * 100}%`
                        : "0%",
                  }}
                />
              </div>
            </div>
          ))}
          <small>
            Blank categories remain unassessed. Add only costs not already
            counted elsewhere.
          </small>
        </section>
      </div>
    </>
  );
}
function ContributionChart({ rows }: { rows: Report["trends"] }) {
  const known = rows.flatMap((r) =>
      r.netContribution === null ? [] : [Math.abs(r.netContribution)],
    ),
    max = Math.max(...known, 1);
  return (
    <>
      <svg
        viewBox="0 0 600 240"
        role="img"
        aria-label="Recorded monthly net contribution. Gaps represent unknown values, not zero."
      >
        <line x1="35" x2="575" y1="110" y2="110" stroke="#7e97ab55" />
        <text x="12" y="114" fill="#a7bac9" fontSize="11">
          0
        </text>
        {rows.map((r, i) => {
          const x = 68 + i * 95,
            h =
              r.netContribution === null
                ? 0
                : (Math.abs(r.netContribution) / max) * 70;
          return (
            <g key={r.month}>
              <title>
                {r.month}:{" "}
                {r.netContribution === null
                  ? "Unknown"
                  : economicsMoney(r.netContribution)}
              </title>
              {r.netContribution === null ? (
                <text
                  x={x}
                  y={104}
                  textAnchor="middle"
                  fill="#8397a8"
                  fontSize="18"
                >
                  —
                </text>
              ) : (
                <rect
                  x={x - 17}
                  y={r.netContribution >= 0 ? 110 - h : 110}
                  width="34"
                  height={Math.max(h, 1)}
                  rx="4"
                  fill={r.netContribution >= 0 ? "#94bdb3" : "#caa494"}
                />
              )}
              <text
                x={x}
                y={207}
                textAnchor="middle"
                fill="#b1c2d1"
                fontSize="11"
              >
                {r.month}
              </text>
              <text
                x={x}
                y={226}
                textAnchor="middle"
                fill="#a7bac9"
                fontSize="10"
              >
                {r.netContribution === null
                  ? "Unknown"
                  : Math.abs(r.netContribution) >= 10000
                    ? new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: "USD",
                        notation: "compact",
                        maximumFractionDigits: 1,
                      }).format(r.netContribution)
                    : economicsMoney(r.netContribution)}
              </text>
            </g>
          );
        })}
      </svg>
      <details>
        <summary>Accessible monthly data</summary>
        <div className={styles.scroll}>
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Cost</th>
                <th>Revenue</th>
                <th>Savings</th>
                <th>Net</th>
                <th>ROI</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}>
                  <td>{r.month}</td>
                  <td>{economicsMoney(r.operatingCost)}</td>
                  <td>{economicsMoney(r.revenue)}</td>
                  <td>{economicsMoney(r.expenses)}</td>
                  <td>{economicsMoney(r.netContribution)}</td>
                  <td>
                    {r.roiMultiple === null
                      ? "Unknown"
                      : `${r.roiMultiple.toFixed(2)}×`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <small>
        Unknown months remain gaps. These are attributed recorded totals, not
        complete profit or cash flow.
      </small>
    </>
  );
}
