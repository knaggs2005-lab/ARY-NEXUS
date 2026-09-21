/** Browser contract acceptance only: real compiled UI, isolated API fixtures, no production data or effects. */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { DevelopmentRun } from "../src/domain/self-development";

async function main() {
  const port = 4327,
    origin = `http://127.0.0.1:${port}`;
  const server = spawn(
    process.execPath,
    [
      resolve("node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        WS_NO_BUFFER_UTIL: "1",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "ignore",
    },
  );
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null)
        throw Error("Isolated browser server exited");
      try {
        if ((await fetch(`${origin}/engineering`)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const id = randomUUID(),
      conversation = randomUUID(),
      mission = randomUUID();
    const run: DevelopmentRun = {
      version: 1,
      id,
      owner: randomUUID(),
      conversation_id: conversation,
      revision: 2,
      phase: "ARCHITECTURE_PLAN",
      observation: "Fix engineering fixture regression",
      evidence: [
        {
          table: "messages",
          id: randomUUID(),
          hash: "e".repeat(64),
          snapshot: { content: "Observed failure with provenance" },
        },
      ],
      proposal: "Correct a bounded regression",
      plan_hash: "a".repeat(64),
      plan: {
        run_id: id,
        revision: 1,
        base_commit: "b".repeat(40),
        paths: ["src/sample.ts"],
        acceptance: ["The regression is corrected"],
        risks: ["Small behavior change"],
        rollback: "Reject isolated worktree without modifying main",
        focused_tests: ["tests/sample.test.ts"],
      },
      history: [
        {
          phase: "OBSERVATION",
          role: "Observer Ary",
          action_id: randomUUID(),
          at: new Date().toISOString(),
        },
      ],
    };
    let enabled = true,
      empty = false,
      offline = false,
      warning = "",
      pending = false,
      state = "DRAFT",
      approved = false,
      request: any,
      decisionCount = 0;
    const calls: any[] = [];
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const path = url.pathname.slice(5),
        method = route.request().method();
      const reply = (body: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      if (path === "engineering" && method !== "POST")
        return reply({ error: "Native read must use POST" }, 405);
      if (path === "engineering")
        return offline
          ? reply({ error: "Fixture connection interrupted" }, 503)
          : reply({
              enabled,
              observed_at: new Date().toISOString(),
              items: empty
                ? []
                : [
                    {
                      run,
                      mission: run.mission_id
                        ? { id: mission, revision: 1, state }
                        : null,
                      snapshot: run.workspace
                        ? {
                            candidate: "c".repeat(64),
                            diff: "+export const value = 2;",
                            files: ["src/sample.ts"],
                          }
                        : null,
                      commands: [],
                      warning,
                      actions: pending
                        ? [
                            {
                              id: "pending-workspace",
                              tool: "development.workspace",
                              status: "approval_required",
                              at: new Date().toISOString(),
                              error: null,
                              pending: true,
                            },
                          ]
                        : [],
                    },
                  ],
            });
      if (path === "permissions/emergency-stop")
        return reply({ active: false, revision: null, reason: null });
      if (path.startsWith("permissions/attempts/") && method === "GET")
        return reply({
          id: "approval",
          tool_name: request.tool,
          status: "approval_required",
          workspace: "ary-nexus",
          input: { action_request: request },
          metadata: { reason: request.reason },
          permission_level: 4,
        });
      if (path.endsWith("/review")) {
        approved = route.request().postDataJSON().decision === "approved";
        return reply({ decision: approved ? "approved" : "rejected" });
      }
      if (path === "actions/request") {
        request = route.request().postDataJSON();
        calls.push(request);
        if (
          !["mission.control", "mission.tick", "mission.submit"].includes(
            request.tool,
          ) &&
          !approved
        )
          return reply(
            {
              code: "approval_required",
              action_id: "approval",
              tool: request.tool,
            },
            409,
          );
        approved = false;
        if (request.tool === "development.build") {
          run.phase = "APPROVED";
          run.mission_id = mission;
        }
        if (request.tool === "development.feedback") {
          state =
            request.input.decision === "revision" ? "PAUSED" : "CANCELLED";
          if (request.input.decision === "reject") run.phase = "REJECTED";
          run.revision++;
        }
        if (request.tool === "mission.control")
          state = request.input.command === "cancel" ? "CANCELLED" : "READY";
        if (request.tool === "development.decide") {
          decisionCount++;
          run.decision = { ...request.input, action_id: randomUUID() };
        }
        return reply({ result: { run_id: id } }, 201);
      }
      return reply({ error: `Unexpected API ${path}` }, 404);
    });
    await page.goto(`${origin}/engineering`);
    const select = () =>
      page
        .getByRole("button", { name: /Fix engineering fixture regression/ })
        .click();
    await select();
    await page
      .getByRole("button", { name: "Approve plan scope", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    assert.equal(
      run.phase,
      "ARCHITECTURE_PLAN",
      "opening approval cannot execute",
    );
    await page.getByRole("button", { name: "Reject", exact: true }).click();
    assert.equal(
      run.phase,
      "ARCHITECTURE_PLAN",
      "declining approval cannot execute",
    );
    await page
      .getByRole("button", { name: "Approve plan scope", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Approve once and continue", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Prepare mission", exact: true })
      .waitFor();
    assert.equal(run.phase, "APPROVED");
    await page
      .getByLabel("Decision / revision reason (at least 5 characters)")
      .fill("Clarify expected regression evidence");
    await page
      .getByRole("button", { name: "Request revision", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Approve once and continue", exact: true })
      .click();
    await page.waitForFunction(() =>
      document.querySelector("main")?.textContent?.includes("PAUSED"),
    );
    assert.equal(state, "PAUSED");
    state = "RUNNING";
    run.phase = "IMPLEMENTATION";
    run.workspace = {
      branch: `ary/dev/${id}`,
      base: "b".repeat(40),
      candidate: "c".repeat(64),
    };
    await page.reload();
    await select();
    await page.getByText("Current Git diff", { exact: true }).click();
    await page.getByText("+export const value = 2;", { exact: true }).waitFor();
    pending = true;
    state = "APPROVAL_REQUIRED";
    request = {
      tool: "development.workspace",
      input: { run_id: id },
      reason: "Exact approved workspace",
    };
    await page.reload();
    await select();
    await page
      .getByRole("button", {
        name: "Review development.workspace",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Approve once and continue", exact: true })
      .click();
    await page.getByText(/Approval recorded. Resume and advance/).waitFor();
    assert(
      !calls.some((c) => c.tool === "development.workspace"),
      "approval must not dispatch a lease-bound stage directly",
    );
    pending = false;
    await page
      .getByRole("button", { name: "Resume mission", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Advance approved mission", exact: true })
      .click();
    await page.getByRole("button", { name: "STOP run", exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector("main")?.textContent?.includes("CANCELLED"),
    );
    assert.equal(state, "CANCELLED");
    state = "WAITING";
    run.phase = "RELEASE_CANDIDATE";
    run.validation = {
      candidate: "c".repeat(64),
      sandbox: "fixture",
      operation_id: randomUUID(),
      passed: true,
      commands: ["focused", "test", "typecheck", "build", "format"].map(
        (command) => ({
          command: command as any,
          exit_code: 0,
          signal: null,
          duration_ms: 5,
          output: "Fixture passed",
          truncated: false,
        }),
      ),
    };
    run.review = {
      ready: true,
      result: {
        summary: "Reviewed exact fixture diff",
        checks: {
          scope: { verdict: "pass", reason: "Within approved file" },
        } as any,
      },
      candidate: "c".repeat(64),
      action_id: randomUUID(),
      reviewer: "reviewer",
      model: "fixture",
      provider: "fixture",
      metrics: { estimated_cost_usd: null } as any,
    };
    run.release = {
      hash: "d".repeat(64),
      manifest: {
        diff: "+export const value = 2;",
        rollback: run.plan!.rollback,
        files: ["src/sample.ts"],
      },
    };
    await page.reload();
    await select();
    await page.getByText("focused: passed", { exact: true }).waitFor();
    warning = "Scope drift detected; owner inspection required";
    await page.reload();
    await select();
    await page
      .getByLabel("Decision / revision reason (at least 5 characters)")
      .fill("Owner checks scope before approval");
    await page
      .getByText("Release candidate · NOT READY", { exact: true })
      .waitFor();
    assert(
      await page
        .getByRole("button", {
          name: "Approve release intent — no merge",
          exact: true,
        })
        .isDisabled(),
    );
    warning = "";
    await page.reload();
    await select();

    await page
      .getByLabel("Decision / revision reason (at least 5 characters)")
      .fill("Owner accepts reviewed fixture evidence");
    await page
      .getByRole("button", {
        name: "Approve release intent — no merge",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Approve once and continue", exact: true })
      .click();
    await page.getByText(/Owner decision: accepted intent/).waitFor();
    await page
      .getByRole("button", {
        name: "Submit recorded decision to mission",
        exact: true,
      })
      .click();
    await page.waitForTimeout(100);
    assert(
      calls.some(
        (c) =>
          c.tool === "mission.submit" &&
          c.input.submission.name === "owner_decision",
      ),
    );
    assert.equal(decisionCount, 1);
    assert(!calls.some((c) => /merge|push|deploy/.test(c.tool)));
    delete run.decision;
    await page.reload();
    await select();
    await page
      .getByLabel("Decision / revision reason (at least 5 characters)")
      .fill("Owner rejects fixture candidate");
    await page
      .getByRole("button", { name: "Reject release", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Approve once and continue", exact: true })
      .click();
    await page.getByText(/Owner decision: rejected/).waitFor();
    await page.setViewportSize({ width: 760, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "responsive layout overflows",
    );
    await page.screenshot({
      path: "/tmp/ary-engineering-browser.png",
      fullPage: true,
    });
    delete run.decision;
    run.phase = "PROPOSAL";
    state = "WAITING";
    await page.reload();
    await select();
    await page
      .getByLabel("Decision / revision reason (at least 5 characters)")
      .fill("Owner rejects the underlying proposal");
    await page.getByRole("button", { name: "Reject run", exact: true }).click();
    await page
      .getByRole("button", { name: "Approve once and continue", exact: true })
      .click();
    await page.waitForFunction(() =>
      document.querySelector("main")?.textContent?.includes("REJECTED"),
    );
    assert.equal(run.phase, "REJECTED");
    empty = true;
    await page.reload();
    await page.getByRole("heading", { name: "No development runs" }).waitFor();
    enabled = false;
    await page.reload();
    await page
      .getByRole("heading", { name: "Self-development is disabled" })
      .waitFor();
    offline = true;
    await page.reload();
    await page
      .getByRole("heading", { name: "Engineering needs attention" })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: proposal/plan approval and rejection; revision pause; workspace/diff/tests/review; STOP; release accept/reject without merge; responsive/reduced-motion; empty/disabled/error; no browser errors. Fixture API only; no live execution.",
    );
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
