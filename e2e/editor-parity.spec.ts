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

  await find.getByRole('checkbox', { name: 'Match case' }).uncheck()
  await find.getByRole('button', { name: 'Replace all' }).click()
  await expect(editor).toContainText('pear, pear, pear')
  await find.getByRole('button', { name: 'Close find' }).click()
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
