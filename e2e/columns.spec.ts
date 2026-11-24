import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

async function openColumnsMenu(page: Page) {
  await page.getByRole('menuitem', { name: 'Format', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Columns', exact: true }).hover()
}

async function insertColumns(page: Page, count: 'Two' | 'Three') {
  await page.keyboard.type(`/${count.toLowerCase()} columns`)
  await page
    .getByRole('option', { name: `${count} columns`, exact: true })
    .click()
}

function renderedTrackCount(layout: Locator) {
  return layout.evaluate(
    (element) =>
      getComputedStyle(element).gridTemplateColumns.split(' ').length,
  )
}

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(15_000)
  await page.goto('/')
  const welcome = page.getByRole('alertdialog', { name: 'Welcome to Concept!' })
  const create = page.getByRole('button', { name: 'New document' }).first()
  await expect(welcome.or(create)).toBeVisible({ timeout: 30_000 })
  if (await welcome.isVisible()) {
    await welcome.getByRole('checkbox').click()
    await welcome.getByRole('button', { name: 'Acknowledge' }).click()
    await expect(welcome).toBeHidden()
  }
  await create.click()

  const editor = page.getByRole('textbox', { name: 'Document content' })
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await editor.click()
})

test('edits columns with the keyboard, restores them after reload, and keeps text when resizing', async ({
  page,
}) => {
  const editor = page.locator('[data-document-content]')
  await insertColumns(page, 'Three')
  const layout = editor.locator('[data-concept-columns]')
  const columns = layout.locator('[data-concept-column]')
  await expect(columns).toHaveCount(3)

  await page.keyboard.type('First column')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Second column')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Third column')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Following paragraph')
  await expect(columns).toHaveText([
    'First column',
    'Second column',
    'Third column',
  ])
  await expect(layout).not.toContainText('Following paragraph')
  await expect(editor).toContainText('Following paragraph')
  await expect(
    page.getByRole('button', { name: 'All changes saved locally' }),
  ).toBeVisible()

  await page.reload()
  if (!(await editor.isVisible())) {
    await page
      .getByRole('button', { name: /Untitled document/ })
      .first()
      .click()
  }
  await expect(columns).toHaveText([
    'First column',
    'Second column',
    'Third column',
  ])
  await expect.poll(() => renderedTrackCount(layout)).toBe(3)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => renderedTrackCount(layout)).toBe(1)
  await page.emulateMedia({ media: 'print' })
  await expect.poll(() => renderedTrackCount(layout)).toBe(3)
  await page.emulateMedia({ media: 'screen' })
  await page.setViewportSize({ width: 1280, height: 720 })

  await columns.last().getByText('Third column').click()
  await openColumnsMenu(page)
  await page.getByRole('menuitem', { name: 'Two columns', exact: true }).click()
  await expect(columns).toHaveCount(2)
  await expect(columns.nth(1).locator('p')).toHaveText([
    'Second column',
    'Third column',
  ])

  await columns.nth(1).getByText('Third column').click()
  await openColumnsMenu(page)
  await page.getByRole('menuitem', { name: 'One column', exact: true }).click()
  await expect(layout).toHaveCount(0)
  await expect(
    editor.locator(':scope > p').filter({ hasText: /column|Following/ }),
  ).toHaveText([
    'First column',
    'Second column',
    'Third column',
    'Following paragraph',
  ])

  await expect(editor).toBeFocused()
  await page.keyboard.press('Control+z')
  await expect(columns).toHaveCount(2)
  await expect(columns.nth(1).locator('p')).toHaveText([
    'Second column',
    'Third column',
  ])
  await page.keyboard.press('Control+Shift+z')
  await expect(layout).toHaveCount(0)
})

test('keeps a column section together when inserting a manual page break from inside it', async ({
  page,
}) => {
  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Page setup', exact: true }).click()
  const setup = page.getByRole('dialog', { name: 'Page setup' })
  await setup.getByRole('combobox', { name: 'Paper size' }).click()
  await page.getByRole('option', { name: /^A4/ }).click()
  await setup.getByRole('button', { name: 'Apply' }).click()

  const editor = page.locator('[data-document-content]')
  const pages = editor.locator(':scope > .concept-page')
  await expect(pages).toHaveCount(1)
  await pages.first().locator('p').first().click()
  await insertColumns(page, 'Two')
  await page.keyboard.type('Left page column')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Right page column')
  await page.keyboard.press('Control+Enter')

  await expect(pages).toHaveCount(2)
  await expect(pages.first().locator('[data-concept-column]')).toHaveText([
    'Left page column',
    'Right page column',
  ])
  await expect(
    editor.locator(':scope > [data-lexical-page-break]'),
  ).toHaveCount(1)
  await pages.nth(1).locator('p').first().click()
  await page.keyboard.type('Next page')
  await expect(pages.nth(1)).toContainText('Next page')
  await expect(pages.first()).not.toContainText('Next page')
})
