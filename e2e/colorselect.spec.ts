import { expect, test } from '@playwright/test'

test('color select swatch updates after applying a color to an unchanged selection', async ({
  page,
}) => {
  await page.goto('/')

  const welcome = page.getByRole('alertdialog', { name: 'Welcome to Concept!' })
  const newDocument = page.getByRole('button', { name: 'New document' }).first()
  await expect(welcome.or(newDocument)).toBeVisible({ timeout: 30_000 })
  if (await welcome.isVisible()) {
    await welcome.getByRole('checkbox').click()
    await welcome.getByRole('button', { name: 'Acknowledge' }).click()
    await expect(welcome).toBeHidden()
  }
  await newDocument.click()

  const editor = page.locator('[contenteditable="true"]').first()
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await editor.click()
  await page.keyboard.type('colorcheck')

  // Select the whole paragraph without moving the anchor afterwards.
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')

  const swatch = page
    .getByRole('button', { name: 'Text color' })
    .locator('span[aria-hidden="true"]')
  await expect(swatch).toHaveCount(0, { timeout: 10_000 })

  await page.getByRole('button', { name: 'Text color' }).click()
  await page.getByRole('button', { name: 'Red' }).click()

  // Same selection, style-only change: the swatch must appear now.
  await expect(swatch).toHaveCount(1, { timeout: 10_000 })
  await expect(swatch).toHaveCSS('background-color', 'rgb(239, 68, 68)')
})
