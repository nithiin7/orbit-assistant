import { expect, test } from "@playwright/test";

import { PASSWORD, signIn, signUp, signUpAndSkipSetup } from "./support";

test("a new person signs up and lands in their personal workspace", async ({ page }) => {
  await signUpAndSkipSetup(page);

  await expect(page.getByRole("link", { name: "Tasks" }).first()).toBeVisible();
});

test("a new person walks through the setup guide and finishes", async ({ page }) => {
  await signUp(page);

  await expect(page.getByRole("heading", { name: "Welcome to Orbit" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Make it feel right" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  for (const area of ["Money", "Health", "Google or Microsoft", "AI assistant"]) {
    // The checkbox is visually hidden inside its card, which takes the click instead; a direct
    // `uncheck()` waits forever on the card intercepting the pointer.
    const checkbox = page.getByRole("checkbox", { name: new RegExp(area) });
    await page.locator("label").filter({ has: checkbox }).click();
    await expect(checkbox).not.toBeChecked();
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Go to the dashboard" }).click();

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finish setting up Orbit" })).toHaveCount(0);
});

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/tasks");

  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("a task is added and completed", async ({ page }) => {
  await signUpAndSkipSetup(page);
  await page.goto("/tasks");

  const title = page.getByRole("textbox", { name: "Task title" });
  await title.fill("Book the dentist");
  await title.press("Enter");
  const task = page.getByRole("checkbox", { name: "Book the dentist" });
  await expect(task).toBeVisible();

  await task.click();
  await page.getByRole("button", { name: /^Completed/ }).click();
  await expect(page.getByRole("checkbox", { name: "Book the dentist" })).toBeChecked();
});

test("a quick note is captured and found by universal search", async ({ page }) => {
  await signUpAndSkipSetup(page);
  await page.goto("/tasks");

  await page.getByRole("button", { name: "Quick note" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Title (optional)" }).fill("Passport renewal");
  await dialog.getByLabel("Note").fill("Bring two photos and the old passport.");
  await dialog.getByRole("button", { name: "Save to Inbox" }).click();
  await expect(dialog.getByText("Saved to your Inbox")).toBeVisible();

  await page.goto("/search?q=passport");
  await expect(page.getByRole("option", { name: /Passport renewal/ })).toBeVisible();
});

test("changing the password keeps this session and works for the next sign-in", async ({
  page,
}) => {
  const { email } = await signUpAndSkipSetup(page);
  await page.goto("/settings/account");

  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password", { exact: true }).fill("a brand new secret");
  await page.getByLabel("Confirm new password").fill("a brand new secret");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Password changed. Other sessions were signed out.")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await signIn(page, email, PASSWORD);
  await expect(page.getByText("The email or password is incorrect.")).toBeVisible();
  await signIn(page, email, "a brand new secret");
  await expect(page).not.toHaveURL(/\/sign-in/);
});
