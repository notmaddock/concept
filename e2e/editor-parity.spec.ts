import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function newDocument(page: Page) {
  await page.goto('/')
  const welcome = page.getByRole('alertdialog', { name: 'Welcome to Concept!' })
  const create = page.getByRole('button', { name: 'New document' }).first()
  await expect(welcome.or(create)).toBeVisible({ timeout: 30_000 })
  if (await welcome.isVisible()) {
    await welcome.getByRole('checkbox').click()
    await welcome.getByRole('button', { name: 'Acknowledge' }).click()
  }
  await create.click()
  const editor = page.locator('[data-document-content][contenteditable="true"]')
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await editor.click()
  return editor
}

test('counts the document and a selection while the editor stays usable', async ({
  page,
}) => {
  const editor = await newDocument(page)
  await page.keyboard.insertText('Two words')
  await page.keyboard.press('Control+Shift+c')
  const counts = page.getByRole('dialog', { name: 'Word count' })
  await expect(counts.getByText('Entire document')).toBeVisible()
  await expect(counts.locator('dd')).toHaveText(['2', '9', '8'])

  await page.keyboard.press('Shift+Home')
  await expect(counts.getByText('Selection', { exact: true })).toBeVisible()
  await expect(counts.locator('dd')).toHaveText(['2', '9', '8'])
  await page.keyboard.insertText('One')
  await expect(editor).toContainText('One')
  await expect(counts.locator('dd')).toHaveText(['1', '3', '3'])
  await counts.getByRole('button', { name: 'Close word count' }).click()
  await expect(counts).toBeHidden()
})

test('finds repeated text, navigates, replaces, and undoes replace all', async ({
  page,
}) => {
  const editor = await newDocument(page)
  await page.keyboard.insertText('Apple, apple, APPLE')
  await page.keyboard.press('Control+f')
  const find = page.getByRole('dialog', { name: 'Find and replace' })
  const query = find.getByRole('textbox', { name: 'Find text' })
  await expect(query).toBeFocused()
  await query.fill('apple')
  await expect(find.getByRole('status')).toHaveText('1 of 3')
  await expect
    .poll(() => page.evaluate(() => CSS.highlights.get('concept-find')?.size))
    .toBe(2)
  await find.getByRole('button', { name: 'Previous match' }).click()
  await expect(find.getByRole('status')).toHaveText('3 of 3')
  await find.getByRole('checkbox', { name: 'Match case' }).check()
  await expect(find.getByRole('status')).toHaveText('1 of 1')
  await find.getByRole('textbox', { name: 'Replace with' }).fill('pear')
  await find.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(editor).toContainText('Apple, pear, APPLE')
  await expect(query).toBeFocused()
  await find.getByRole('textbox', { name: 'Replace with' }).press('Control+f')
  await expect(query).toBeFocused()

  await find.getByRole('checkbox', { name: 'Match case' }).uncheck()
  await find.getByRole('button', { name: 'Replace all' }).click()
  await expect(editor).toContainText('pear, pear, pear')
  await page.keyboard.press('Escape')
  await expect(find).toBeHidden()
  await page.keyboard.press('Control+z')
  await expect(editor).toContainText('Apple, pear, APPLE')

  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Find and replace/ }).click()
  await expect(query).toBeFocused()
  await query.press('Escape')
  await expect(find).toBeHidden()
})

test('updates the live contents when another tab edits a heading', async ({
  page,
  context,
}) => {
  const editor = await newDocument(page)
  await page.keyboard.type('/toc')
  await page
    .getByRole('option', { name: 'Table of contents', exact: true })
    .click()
  const contents = editor.getByRole('navigation', { name: 'Table of contents' })
  await expect(contents).toContainText('Add headings')

  const second = await context.newPage()
  await second.goto(page.url())
  const secondEditor = second.getByRole('textbox', { name: 'Document content' })
  await expect(secondEditor).toBeVisible({ timeout: 30_000 })
  await secondEditor.locator('p').last().click()
  await second.keyboard.press('Control+Alt+1')
  await second.keyboard.insertText('Shared launch plan')
  await expect(
    contents.getByRole('link', { name: 'Shared launch plan' }),
  ).toBeVisible()

  await second.keyboard.insertText(' updated')
  await expect(
    contents.getByRole('link', { name: 'Shared launch plan updated' }),
  ).toBeVisible()
  await second.close()
})

test('reveals an active find match deep inside a long paragraph', async ({
  page,
}) => {
  await page.setViewportSize({ width: 850, height: 650 })
  await newDocument(page)
  await page.keyboard.insertText(
    `target ${'ordinary words '.repeat(400)}target`,
  )
  await page.keyboard.press('Control+f')
  const find = page.getByRole('dialog', { name: 'Find and replace' })
  await find.getByRole('textbox', { name: 'Find text' }).fill('target')
  await expect(find.getByRole('status')).toHaveText('1 of 2')
  await find.getByRole('button', { name: 'Next match' }).click()
  await expect(find.getByRole('status')).toHaveText('2 of 2')
  await expect
    .poll(() =>
      page
        .getByRole('main', { name: 'Document workspace' })
        .evaluate((main) => {
          const highlight = CSS.highlights.get('concept-find-active')
          const range = highlight?.values().next().value
          const match = range instanceof Range && range.getClientRects()[0]
          const bounds = main.getBoundingClientRect()
          return Boolean(
            match && match.top >= bounds.top && match.bottom <= bounds.bottom,
          )
        }),
    )
    .toBe(true)
})

test('keeps menu labels on one line and gives up shortcut space when narrow', async ({
  page,
}) => {
  await newDocument(page)
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
  const menuItem = page.getByRole('menuitem', {
    name: /^Paste without formatting/,
  })
  const label = menuItem.getByText('Paste without formatting', { exact: true })
  const fits = () =>
    label.evaluate((element) => {
      const row = element.parentElement!
      const box = row.getBoundingClientRect()
      const key = row.querySelector('kbd')!.getBoundingClientRect()
      return {
        wholeLabel: element.scrollWidth <= element.clientWidth,
        shortcutVisible: key.bottom <= box.bottom + 1 && key.top < box.bottom,
        oneLine: element.getBoundingClientRect().height <= box.height,
      }
    })
  await expect
    .poll(fits)
    .toEqual({ wholeLabel: true, shortcutVisible: true, oneLine: true })
  await page.setViewportSize({ width: 245, height: 800 })
  await expect
    .poll(fits)
    .toEqual({ wholeLabel: true, shortcutVisible: false, oneLine: true })
})
