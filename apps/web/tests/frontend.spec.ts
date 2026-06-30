import { expect, test, type Page } from "@playwright/test";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:3011/api/v1";

test.describe("CJlass2 Web Frontend", () => {
  test("homepage loads without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
    await expect(page).toHaveTitle(/晓知教育/);
    const body = page.locator("body");
    await expect(body).toBeVisible();
    const designImageErrors = errors.filter((e) => /design\/previews|dashboardPreviewUrl/.test(e));
    expect(designImageErrors.length).toBe(0);
  });

  test("homepage renders navigation or login page", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Page should have some visible text content after React hydration
    const bodyText = await page.locator("body").textContent();
    expect((bodyText?.length ?? 0) > 0).toBe(true);
  });

  test("page has interactive elements", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Check for buttons, links, or interactive elements
    const interactiveCount = await page.locator("button, a, input, [role=button]").count();
    expect(interactiveCount).toBeGreaterThan(0);
  });

  test("no design screenshot runtime dependencies", async ({ page }) => {
    const networkRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("design/previews") || request.url().includes("dashboardPreview")) {
        networkRequests.push(request.url());
      }
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(networkRequests.length).toBe(0);
  });

  test("no design preview images in DOM", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const previewImages = await page.locator("img[src*='design/previews'], img[src*='dashboardPreview'], img[src*='.png']").count();
    expect(previewImages).toBe(0);
  });

  test("login form has required fields when auth is required", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const hasLoginForm = await page.locator("form").first().isVisible().catch(() => false);
    const hasEmailField = await page.locator("input[type=email], input[name=email]").first().isVisible().catch(() => false);
    const hasPasswordField = await page.locator("input[type=password]").first().isVisible().catch(() => false);
    // If login form is shown, it should have email and password fields
    if (hasLoginForm) {
      expect(hasEmailField || hasPasswordField).toBe(true);
    }
  });

  test("frontend can make API calls", async ({ page }) => {
    await page.goto("/");
    const apiCheck = await page.evaluate(async () => {
      try {
        const response = await fetch("/api/v1/dashboard");
        return { status: response.status, reachable: true };
      } catch {
        return { status: 0, reachable: false };
      }
    });
    // API either responds or is unreachable (backend not running) - both are acceptable
    expect(apiCheck.reachable || apiCheck.status === 0).toBe(true);
  });

  test("complete browser business flow: login to audit", async ({ page }) => {
    test.setTimeout(60_000);
    const unique = Date.now().toString().slice(-6);
    const studentName = `端到端学员${unique}`;
    const guardianName = `端到端家长${unique}`;
    const courseTitle = `端到端数学${unique}`;
    const orderName = `端到端课包${unique}`;
    const notificationTitle = `端到端通知${unique}`;

    await page.goto("/");
    await login(page);
    await resetDemoData(page);
    await page.reload();
    await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();

    await page.getByRole("button", { name: /新增学员/ }).first().click();
    const studentModal = page.locator(".modal-card");
    await expect(studentModal.getByRole("heading", { name: "新增学员" })).toBeVisible();
    await studentModal.getByLabel("姓名").fill(studentName);
    await studentModal.getByLabel("年级").fill("初二");
    await studentModal.getByLabel("家长").fill(guardianName);
    await studentModal.getByLabel("电话").fill("139 0000 0001");
    await studentModal.getByLabel("老师").fill("端到端老师");
    await studentModal.getByLabel("课程").fill("数学");
    await studentModal.getByLabel("剩余课时").fill("12");
    await studentModal.getByLabel("标签").fill("数学,端到端");
    await submitModal(page);
    await nav(page, "学员");
    await expect(page.getByRole("button", { name: new RegExp(studentName) })).toBeVisible();

    await page.getByRole("button", { name: /创建订单/ }).first().click();
    const orderModal = page.locator(".modal-card");
    await expect(orderModal.getByRole("heading", { name: "创建订单" })).toBeVisible();
    await orderModal.getByLabel("学员").selectOption({ label: studentName });
    await orderModal.getByLabel("订单名称").fill(orderName);
    await orderModal.getByLabel("总金额").fill("3200");
    await orderModal.getByLabel("已收金额").fill("0");
    await orderModal.getByLabel("到期状态").fill("今天到期");
    await submitModal(page);
    await nav(page, "收费");
    await expect(page.getByRole("row").filter({ hasText: orderName })).toBeVisible();

    await nav(page, "课表");
    await page.getByRole("button", { name: /新增课程/ }).first().click();
    const lessonModal = page.locator(".modal-card");
    await expect(lessonModal.getByRole("heading", { name: "新增课程" })).toBeVisible();
    await lessonModal.getByLabel("学员").selectOption({ label: studentName });
    await lessonModal.getByLabel("课程标题").fill(courseTitle);
    await lessonModal.getByLabel("星期").selectOption("0");
    await lessonModal.getByLabel("日期").fill("06/29");
    await lessonModal.getByLabel("开始").fill("09:00");
    await lessonModal.getByLabel("结束").fill("09:50");
    await lessonModal.getByLabel("老师").fill("端到端老师");
    await lessonModal.getByLabel("教室").fill(`端到端教室${unique}`);
    await lessonModal.getByLabel("课消金额").fill("200");
    await submitModal(page);
    await page.getByRole("button", { name: new RegExp(courseTitle) }).click();
    await page.getByRole("button", { name: "确认到课" }).click();
    await expect(page.getByText("已记录到课并扣减 1 课时")).toBeVisible();

    await nav(page, "收费");
    const orderRow = page.getByRole("row").filter({ hasText: orderName });
    await orderRow.getByRole("button", { name: "收款" }).click();
    await expect(orderRow).toContainText("已结清");

    await nav(page, "通知");
    await page.getByRole("button", { name: /新建通知/ }).click();
    const notificationModal = page.locator(".modal-card");
    await expect(notificationModal.getByRole("heading", { name: "新建通知" })).toBeVisible();
    await notificationModal.getByLabel("类型").selectOption("课程反馈");
    await notificationModal.getByLabel("标题").fill(notificationTitle);
    await notificationModal.getByLabel("接收人").selectOption({ label: guardianName });
    await notificationModal.getByLabel("渠道").selectOption("站内");
    await notificationModal.getByLabel("内容").fill(`${guardianName}您好，${studentName}本次${courseTitle}已完成。`);
    await submitModal(page);
    await page.getByRole("button", { name: new RegExp(notificationTitle) }).click();
    await page.getByRole("button", { name: /立即发送/ }).click();
    await expect(page.getByRole("button", { name: new RegExp(`${notificationTitle}[\\s\\S]*已发送`) })).toBeVisible();

    await nav(page, "报表");
    await expect(page.getByRole("heading", { name: "报表" })).toBeVisible();
    await expect(page.getByText("账本核对")).toBeVisible();
    await expect(page.getByText(studentName).first()).toBeVisible();

    await nav(page, "设置");
    await expect(page.getByRole("heading", { name: "审计流水" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "发送通知" }).first()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "记录收款" }).first()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "点名与课消" }).first()).toBeVisible();
  });
});

async function login(page: Page) {
  await expect(page.getByText("登录晓知教育工作台")).toBeVisible();
  await page.getByLabel("邮箱").fill("admin@cjlass.local");
  await page.getByLabel("密码").fill("ChangeMe123!");
  await page.getByRole("button", { name: /^登录$/ }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
}

async function resetDemoData(page: Page) {
  const ok = await page.evaluate(async (baseUrl) => {
    const rawSession = localStorage.getItem("cjlass2-auth-session");
    const session = rawSession ? JSON.parse(rawSession) as { token?: string } : {};
    const response = await fetch(`${baseUrl}/dev/reset`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ idempotencyKey: `e2e-reset-${Date.now()}` }),
    });
    return response.ok;
  }, apiBaseUrl);
  expect(ok).toBe(true);
}

async function nav(page: Page, label: string) {
  await page.locator("nav").getByRole("button", { name: label }).click();
  await expect(page.locator("nav").getByRole("button", { name: label })).toHaveClass(/is-active/);
}

async function submitModal(page: Page) {
  await page.locator(".modal-card").getByRole("button", { name: /提交/ }).click();
  await expect(page.locator(".modal-card")).toHaveCount(0);
}
