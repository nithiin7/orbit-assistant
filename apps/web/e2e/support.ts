import { expect, type Page } from "@playwright/test";

export const PASSWORD = "correct horse battery";

/** A unique account for one journey, so journeys never depend on each other. */
export function newPerson(name: string): { name: string; email: string } {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { name, email: `${name.toLowerCase()}-${unique}@example.com` };
}

export async function signUp(page: Page, name = "Ada"): Promise<{ email: string }> {
  const person = newPerson(name);
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(person.name);
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).not.toHaveURL(/sign-up/);
  return person;
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
