import { expect, test } from '@playwright/test'

test('creates a document, saves it locally, and reopens it after reload', async ({
  page,
}) => {
  await page.goto('/')

  const welcome = page.getByRole('alertdialog', { name: 'Welcome to Concept!' })
  const newDocument = page.getByRole('button', { name: 'New document' }).first()

  await expect(welcome.or(newDocument)).toBeVisible({ timeout: 30_000 })
  if (await welcome.isVisible()) {
    await welcome.getByRole('checkbox').click()
    const acknowledge = welcome.getByRole('button', { name: 'Acknowledge' })
    await expect(acknowledge).toBeEnabled()
    await acknowledge.click()
    await expect(welcome).toBeHidden()
  }

  await expect(newDocument).toBeVisible()
  await newDocument.click()

  const editor = page.locator('[contenteditable="true"]').first()
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await editor.click()
  await page.keyboard.type('playwright smoke document')

  await expect(
    page.getByRole('button', { name: 'All changes saved locally' }),
  ).toBeVisible()

  await page.reload()

  await page
    .getByRole('button', { name: /Untitled document/ })
    .first()
    .click({ timeout: 30_000 })
  await expect(
    page
      .locator('[contenteditable="true"]')
      .getByText('playwright smoke document'),
  ).toBeVisible({ timeout: 30_000 })
})
