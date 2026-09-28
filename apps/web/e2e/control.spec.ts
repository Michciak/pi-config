import { expect, test, type Page } from "@playwright/test";

const now = "2026-09-28T10:00:00.000Z";

function question(id: string, mode: string, options: unknown[] = [], allowOther = false) {
  return {
    id, sessionId: "session-1", source: { kind: "orchestrator" },
    question: `${mode} question`, details: `Details for ${mode}`,
    mode, options, allowOther, status: "pending", answers: [], createdAt: now,
  };
}

async function mockControl(page: Page) {
  let questions = [
    question("text", "text"),
    question("single", "single-select", [
      { id: "option:0", label: "Alpha", value: "alpha-value", description: "First choice", index: 1 },
      { id: "option:1", label: "Other", value: "literal-other", index: 2 },
      { id: "other", label: "Other (custom)", value: "__other__", isOther: true },
    ], true),
    question("multi", "multi-select", [
      { id: "option:0", label: "One", value: "one", index: 1 },
      { id: "option:1", label: "Two", value: "two", index: 2 },
      { id: "other", label: "Other", value: "__other__", isOther: true },
    ], true),
  ];
  const answers = new Map<string, unknown[]>();

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/config") return route.fulfill({ json: { workspaceRoot: "/Dropbox/NETRIX" } });
    if (path === "/api/v1/snippets") return route.fulfill({ json: [] });
    if (path === "/api/v1/status") return route.fulfill({ json: {
      serverId: "test", control: "online", engine: "stopped", sessions: [], firebase: "disabled", version: "test",
    } });
    if (path === "/api/v1/approvals") return route.fulfill({ json: [] });
    if (path === "/api/v1/questions" && request.method() === "GET") return route.fulfill({ json: questions });
    const answer = path.match(/^\/api\/v1\/questions\/([^/]+)\/answer$/);
    if (answer) {
      const body = request.postDataJSON();
      answers.set(answer[1]!, body.answers);
      questions = questions.map((item) => item.id === answer[1]
        ? { ...item, status: "answered", answers: body.answers, resolvedAt: now } : item);
      return route.fulfill({ json: questions.find((item) => item.id === answer[1]) });
    }
    const cancel = path.match(/^\/api\/v1\/questions\/([^/]+)\/cancel$/);
    if (cancel) {
      questions = questions.map((item) => item.id === cancel[1] ? { ...item, status: "cancelled", resolvedAt: now } : item);
      return route.fulfill({ json: questions.find((item) => item.id === cancel[1]) });
    }
    return route.fulfill({ status: 404, json: { error: `Unhandled ${request.method()} ${path}` } });
  });
  return answers;
}

test("submits text, single-select, multi-select and custom Other answers", async ({ page }) => {
  const answers = await mockControl(page);
  await page.goto("/");
  await expect(page.getByText("Wymaga uwagi")).toBeVisible();

  const textCard = page.locator("#interaction-text");
  await textCard.locator("textarea").fill("");
  await textCard.getByRole("button", { name: "Odpowiedz" }).click();
  await expect.poll(() => answers.get("text")).toEqual([{ type: "text", label: "", value: "" }]);

  const singleCard = page.locator("#interaction-single");
  await singleCard.getByText("Alpha").click();
  await singleCard.getByRole("button", { name: "Odpowiedz" }).click();
  await expect.poll(() => answers.get("single")).toEqual([
    { type: "option", label: "Alpha", value: "alpha-value", index: 1 },
  ]);

  const multiCard = page.locator("#interaction-multi");
  await multiCard.getByText("One", { exact: true }).click();
  await multiCard.getByPlaceholder("Własna odpowiedź").fill("Custom value");
  await multiCard.getByRole("button", { name: "Odpowiedz" }).click();
  await expect.poll(() => answers.get("multi")).toEqual([
    { type: "option", label: "One", value: "one", index: 1 },
    { type: "other", label: "Custom value", value: "Custom value" },
  ]);
});

test("mobile deep link brings the requested interaction into view", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "mobile layout assertion");
  await mockControl(page);
  await page.goto("/?interaction=multi");
  const target = page.locator("#interaction-multi");
  await expect(target).toBeVisible();
  await expect(target.getByText("multi-select question")).toBeVisible();
  await expect(target).toHaveCSS("scroll-margin-top", /.+/);
});
