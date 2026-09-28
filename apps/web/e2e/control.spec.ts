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
  await singleCard.getByText("2. Other", { exact: true }).click();
  await singleCard.getByRole("button", { name: "Odpowiedz" }).click();
  await expect.poll(() => answers.get("single")).toEqual([
    { type: "option", label: "Other", value: "literal-other", index: 2 },
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

test("resumes a stopped RPC session and exposes contextual launchers", async ({ page }, testInfo) => {
  const session = {
    id: "session-1", name: "Recovered session", workspace: "/Dropbox/NETRIX/project",
    status: "error", createdAt: now, updatedAt: now,
  };
  let running = false;
  let model = { provider: "openai-codex", id: "gpt-5.5" };

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/config") return route.fulfill({ json: { workspaceRoot: "/Dropbox/NETRIX" } });
    if (path === "/api/v1/snippets" || path === "/api/v1/questions" || path === "/api/v1/approvals") return route.fulfill({ json: [] });
    if (path === "/api/v1/status") return route.fulfill({ json: {
      serverId: "test", control: "online", engine: "running", sessions: [{ ...session, status: running ? "idle" : "error" }], firebase: "disabled", version: "test",
    } });
    if (path === "/api/v1/sessions/session-1/resume") {
      running = true;
      return route.fulfill({ json: { ...session, status: "idle" } });
    }
    if (path === "/api/v1/sessions/session-1/subagents") return route.fulfill({ json: [{
      name: "scout", description: "Fast reconnaissance", tools: ["read"], skills: [], subagents: [], source: "global",
    }] });
    if (path === "/api/v1/sessions/session-1/commands") {
      if (!running) return route.fulfill({ status: 409, json: { error: "Session is not running" } });
      const body = request.postDataJSON();
      if (body.command === "get_messages") return route.fulfill({ json: { result: [] } });
      if (body.command === "get_commands") return route.fulfill({ json: { result: [
        { name: "route", description: "Delegate work", source: "extension", sourceInfo: { scope: "user" } },
        { name: "router", description: "Route alias", source: "extension", sourceInfo: { scope: "user" } },
        { name: "skill:web-debug", description: "Debug a web page", source: "skill", sourceInfo: { scope: "user" } },
      ] } });
      if (body.command === "get_state") return route.fulfill({ json: { result: { model, thinkingLevel: "medium" } } });
      if (body.command === "get_available_models") return route.fulfill({ json: { result: [
        { provider: "openai-codex", id: "gpt-5.5" }, { provider: "openrouter", id: "anthropic/claude-sonnet-4" },
      ] } });
      if (body.command === "set_model") {
        model = { provider: body.payload.provider, id: body.payload.modelId };
        return route.fulfill({ json: { result: null } });
      }
    }
    return route.fulfill({ status: 404, json: { error: `Unhandled ${request.method()} ${path}` } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Recovered session/ }).click();
  const picker = page.getByLabel("Model");
  await expect(picker).toHaveValue("openai-codex/gpt-5.5");
  await picker.selectOption("openrouter/anthropic/claude-sonnet-4");
  await expect(picker).toHaveValue("openrouter/anthropic/claude-sonnet-4");

  const composer = page.getByPlaceholder(/Napisz do Pi/);
  await composer.fill("/skill:w");
  await expect(page.getByRole("option", { name: /skill:web-debug/ })).toBeVisible();
  await composer.press("Enter");
  await expect(composer).toHaveValue("/skill:web-debug ");

  const toolbar = page.getByRole("navigation", { name: "Szybkie wywołania skilli i subagentów" });
  if (testInfo.project.name.startsWith("mobile")) {
    await expect(toolbar).toBeHidden();
  } else {
    await expect(toolbar).toBeVisible();
    await composer.fill("");
    await toolbar.getByRole("button", { name: "scout" }).click();
    await expect(composer).toHaveValue(/profilem "scout"/);
    await page.getByRole("button", { name: "Narzędzia" }).click();
    await expect(page.getByText("Narzędzia sesji")).toBeVisible();
    await expect(page.getByText("Automatyzacja", { exact: true })).toBeVisible();
    await expect(page.getByText("Bezpośredni bash", { exact: true })).toBeVisible();
  }
});

test("shows a newly created session immediately and allows deleting it", async ({ page }) => {
  const session = {
    id: "new-session", name: "New project", workspace: "/Dropbox/NETRIX/new-project",
    status: "idle", createdAt: now, updatedAt: now,
  };
  let deleted = false;

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/config") return route.fulfill({ json: { workspaceRoot: session.workspace } });
    if (path === "/api/v1/snippets" || path === "/api/v1/questions" || path === "/api/v1/approvals") return route.fulfill({ json: [] });
    if (path === "/api/v1/status") return route.fulfill({ json: {
      serverId: "test", control: "online", engine: "running", sessions: [], firebase: "disabled", version: "test",
    } });
    if (path === "/api/v1/sessions" && request.method() === "POST") return route.fulfill({ status: 201, json: session });
    if (path === "/api/v1/sessions/new-session" && request.method() === "DELETE") {
      deleted = true;
      return route.fulfill({ status: 204, body: "" });
    }
    if (path === "/api/v1/sessions/new-session/commands") {
      const command = request.postDataJSON().command;
      if (command === "get_messages" || command === "get_commands" || command === "get_available_models") return route.fulfill({ json: { result: [] } });
      if (command === "get_state") return route.fulfill({ json: { result: { thinkingLevel: "medium" } } });
    }
    return route.fulfill({ status: 404, json: { error: `Unhandled ${request.method()} ${path}` } });
  });

  await page.goto("/");
  await page.getByPlaceholder("Nazwa sesji").fill(session.name);
  await page.getByRole("button", { name: /Nowa sesja/ }).click();
  await expect(page.getByRole("heading", { name: session.name })).toBeVisible();
  await expect(page.getByRole("button", { name: `Usuń sesję ${session.name}` })).toBeVisible();

  await page.getByRole("button", { name: `Usuń sesję ${session.name}` }).click();
  await expect(page.getByRole("dialog")).toContainText(session.name);
  await page.getByRole("button", { name: "Usuń sesję", exact: true }).click();
  await expect.poll(() => deleted).toBe(true);
  await expect(page.getByRole("heading", { name: session.name })).toHaveCount(0);
});

test("mobile deep link brings the requested interaction into view", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "mobile layout assertion");
  await mockControl(page);
  await page.goto("/?interaction=multi");
  const target = page.locator("#interaction-multi");
  await expect(target).toBeVisible();
  await expect(target.getByText("multi-select question")).toBeVisible();
  await expect(target).toHaveCSS("scroll-margin-top", /.+/);
  const sizing = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
  }));
  expect(sizing.documentWidth).toBeLessThanOrEqual(sizing.viewport);
  expect(sizing.bodyWidth).toBeLessThanOrEqual(sizing.viewport);
  expect(sizing.scrollHeight).toBeGreaterThan(sizing.viewportHeight);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});
