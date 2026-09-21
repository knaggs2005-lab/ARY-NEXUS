import {
  protectedPath,
  reviewCategories,
  type DevelopmentRun,
} from "./self-development";

export const AUTONOMY = "development_autonomy_v1";
export const autonomyLimits = Object.freeze({
  concurrent: 1,
  changesPerDay: 1,
  costUsdPerDay: 1,
  retries: 0,
  diffBytes: 8192,
  files: 2,
  priorSuccesses: 3,
  cooldownMs: 48 * 3600000,
  discoveryIntervalMs: 24 * 3600000,
});
export type ReleaseAttempt = {
  run_id: string;
  action_id: string;
  at: string;
  cost_usd: number;
  status: "reserved" | "released" | "rolled_back" | "stopped";
  commit?: string;
  ref?: string;
  rollback?: string;
  reason?: string;
};
export type Qualification = {
  run_id: string;
  outcome_id: string;
  action_id: string;
  at: string;
  release_hash: string;
  candidate: string;
};
export type AutonomyLedger = {
  attempts: ReleaseAttempt[];
  qualifications: Qualification[];
  discoveries: { run_id: string; at: string; action_id: string }[];
};
export const emptyLedger = (): AutonomyLedger => ({
  attempts: [],
  qualifications: [],
  discoveries: [],
});
export function documentationPath(path: string) {
  return (
    /^docs\/[A-Za-z0-9_/-]+\.md$/.test(path) &&
    !protectedPath(path) &&
    !/(?:auth|secret|permission|policy|prompt|instruction|development|deploy|dependenc|migration|finance|payment|phone|call|messag|integration|device|control|skill|agent|automation|brain|memory|audit|hermes|twilio)/i.test(
      path,
    )
  );
}
export function completeValidation(run: DevelopmentRun, candidate: string) {
  const v = run.validation;
  return (
    !!v &&
    v.passed &&
    v.operation_id !== run.patch?.action_id &&
    v.candidate === candidate &&
    v.sandbox === "macos-seatbelt-deny-default-v1" &&
    ["test", "focused", "typecheck", "format", "build"].every(
      (name) =>
        v.commands.filter((c) => c.command === name).length === 1 &&
        v.commands.some(
          (c) =>
            c.command === name &&
            c.exit_code === 0 &&
            !c.signal &&
            !c.truncated &&
            (!c.termination || c.termination === "exited"),
        ),
    )
  );
}
export function evaluateAutonomy(input: {
  enabled: boolean;
  run: DevelopmentRun;
  candidate: string;
  diff: string;
  files: string[];
  history: DevelopmentRun[];
  ledger: AutonomyLedger;
  costUsd: number | null;
  now: number;
}) {
  const { run, candidate, files, diff, ledger, now } = input;
  const reasons: string[] = [];
  if (!input.enabled) reasons.push("Level 2 is disabled");
  if (run.phase !== "RELEASE_CANDIDATE" || !run.release || run.decision)
    reasons.push("An undecided release candidate is required");
  if (
    !run.plan ||
    !run.plan_hash ||
    !run.patch ||
    !run.mission_id ||
    !run.evidence.length
  )
    reasons.push("Provenance or approved plan evidence is incomplete");
  if (
    !files.length ||
    files.length > autonomyLimits.files ||
    files.some((p) => !documentationPath(p))
  )
    reasons.push(
      "Only ordinary documentation corrections are eligible; all other classes require owner review",
    );
  if (
    files.some((p) => !run.plan?.paths.includes(p)) ||
    run.plan?.paths.some((p) => !documentationPath(p))
  )
    reasons.push("Scope includes unqualified or protected paths");
  if (
    new TextEncoder().encode(diff).length > autonomyLimits.diffBytes ||
    !diff.trim()
  )
    reasons.push("Diff is empty or exceeds budget");
  if (
    !run.patch?.value.changes.length ||
    run.patch.value.changes.some(
      (c) =>
        !documentationPath(c.path) || c.before === null || !c.content.trim(),
    )
  )
    reasons.push("Only edits to existing nonempty documentation are eligible");
  if (
    /^deleted file mode|^new file mode|^old mode|^new mode|^rename |^copy |^GIT binary patch/m.test(
      diff,
    ) ||
    /^\+(?!\+).*(?:```|<\/?[A-Za-z]|https?:|sk-[A-Za-z0-9]|(?:password|token|secret)\s*[:=])/m.test(
      diff,
    )
  )
    reasons.push(
      "Ambiguous executable, link, secret, binary, deletion or mode change requires review",
    );
  if (
    !completeValidation(run, candidate) ||
    run.validation?.tester !== `isolated-runner:${run.validation?.operation_id}`
  )
    reasons.push("Complete passing independent validation is required");
  const review = run.review;
  if (
    !review?.ready ||
    review.candidate !== candidate ||
    review.reviewer === run.patch?.author ||
    review.action_id === run.patch?.action_id ||
    review.action_id === run.validation?.operation_id ||
    !review.reviewer.startsWith("independent-provider:") ||
    /fixture|stub|mock|local-evidence/i.test(
      `${review.model} ${review.provider}`,
    ) ||
    reviewCategories.some((k) => review.result.checks[k]?.verdict !== "pass")
  )
    reasons.push(
      "Independent real-provider review with all checks passing is required",
    );
  if (
    !run.workspace ||
    run.workspace.candidate !== candidate ||
    !/^[a-f0-9]{40}$/.test(run.workspace.base)
  )
    reasons.push("A bound candidate and rollback commit are required");
  const successes = new Set(
    ledger.qualifications
      .filter((q) =>
        input.history.some(
          (h) =>
            h.id !== run.id &&
            h.id === q.run_id &&
            h.owner === run.owner &&
            h.phase === "COMPLETED" &&
            h.decision?.accept &&
            h.release?.hash === q.release_hash &&
            h.review?.candidate === q.candidate &&
            h.review.ready &&
            completeValidation(h, q.candidate) &&
            h.plan?.paths.length &&
            h.plan.paths.every(documentationPath),
        ),
      )
      .map((q) => q.run_id),
  );
  if (successes.size < autonomyLimits.priorSuccesses)
    reasons.push(
      "Three distinct owner-qualified successful documentation outcomes are required",
    );
  const today = new Date(now).toISOString().slice(0, 10);
  const daily = ledger.attempts.filter((a) => a.at.slice(0, 10) === today);
  if (ledger.attempts.some((a) => ["reserved", "stopped"].includes(a.status)))
    reasons.push(
      "An active or uncertain release requires owner reconciliation",
    );
  if (ledger.attempts.some((a) => a.run_id === run.id))
    reasons.push("No automatic retry of a release attempt");
  if (daily.length >= autonomyLimits.changesPerDay)
    reasons.push("Daily change budget exhausted");
  if (
    input.costUsd === null ||
    !Number.isFinite(input.costUsd) ||
    input.costUsd < 0 ||
    daily.reduce((n, a) => n + a.cost_usd, 0) + (input.costUsd ?? 0) >
      autonomyLimits.costUsdPerDay
  )
    reasons.push("Complete cost evidence within the daily budget is required");
  if (
    ledger.attempts.some(
      (a) =>
        ["stopped", "rolled_back"].includes(a.status) &&
        now - Date.parse(a.at) < autonomyLimits.cooldownMs,
    )
  )
    reasons.push("Failed-release cooldown is active");
  return {
    eligible: reasons.length === 0,
    decision: reasons.length ? "OWNER_REVIEW" : "ELIGIBLE",
    reasons,
    risk_class: "documentation-only",
    policy_version: AUTONOMY,
    qualified_outcomes: successes.size,
    limits: autonomyLimits,
  };
}
