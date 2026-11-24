import { expect, test } from '@playwright/test'

test('formats a selection through icon popovers and updates its color swatch', async ({
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

  const toolbar = page.getByRole('toolbar', { name: 'Text formatting' })
  await expect(toolbar.getByRole('combobox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Strikethrough' })).toBeHidden()
  await toolbar.getByRole('button', { name: /^Paragraph styles/ }).click()
  await page.getByRole('button', { name: 'Heading 2', exact: true }).click()
  await expect(
    editor.getByRole('heading', { name: 'colorcheck', level: 2 }),
  ).toBeVisible()

  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await toolbar.getByRole('button', { name: 'More formatting' }).click()
  const more = page.getByRole('dialog', {
    name: 'More formatting',
    exact: true,
  })
  await expect(
    more.getByRole('button', { name: 'Strikethrough' }),
  ).toBeVisible()
  await more.getByRole('button', { name: /^Line spacing/ }).click()
  const line = page.getByRole('dialog', { name: 'Line spacing', exact: true })
  await line
    .getByRole('spinbutton', { name: 'Custom line spacing' })
    .fill('1.75')
  await line.getByRole('button', { name: 'Apply' }).click()
  await expect
    .poll(() =>
      editor
        .getByRole('heading', { name: 'colorcheck' })
        .evaluate((element) => (element as HTMLElement).style.lineHeight),
    )
    .toBe('1.75')

  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await toolbar.getByRole('button', { name: 'Typography', exact: true }).click()
  const typography = page.getByRole('dialog', {
    name: 'Typography',
    exact: true,
  })
  const size = typography.getByRole('spinbutton', { name: 'Font size (pt)' })
  await expect(size).not.toHaveValue('')
  await size.fill('17')
  await size.press('Enter')
  await expect(editor.locator('[style*="font-size: 17pt"]')).toContainText(
    'colorcheck',
  )
})
