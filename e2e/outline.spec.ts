import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

async function selectSlashOption(page: Page, query: string, name: string) {
  await page.keyboard.type(`/${query}`)
  await page.getByRole('option', { name, exact: true }).click()
}

async function expectCaretAt(heading: Locator) {
  await expect
    .poll(() =>
      heading.evaluate((element) =>
        element.contains(window.getSelection()?.anchorNode ?? null),
      ),
    )
    .toBe(true)
  await expect(heading).toBeInViewport()
}

test('inserts a live contents block, navigates from the sidebar, and reopens saved contents', async ({
  page,
}) => {
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
  await selectSlashOption(page, 'table of contents', 'Table of contents')
  const contents = editor.getByRole('navigation', { name: 'Table of contents' })
  await expect(contents).toContainText(
    'Add headings to build the table of contents.',
  )

  await selectSlashOption(page, 'heading 1', 'Heading 1')
  await page.keyboard.insertText('First chapter')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('Opening paragraph')
  await page.keyboard.press('Enter')
  for (let index = 1; index <= 18; index++) {
    await page.keyboard.insertText(`Paragraph ${index}`)
    await page.keyboard.press('Enter')
  }
  await selectSlashOption(page, 'heading 2', 'Heading 2')
  await page.keyboard.insertText('Second chapter')
  await page.keyboard.press('Enter')
  await expect(contents.locator('ul ul a')).toHaveText('Second chapter')

  const menu = page.getByRole('menubar', { name: 'Editor menu' })
  await menu.getByRole('menuitem', { name: 'View', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Document outline' }).click()
  const outline = page.getByRole('navigation', { name: 'Document outline' })
  await expect(outline).toBeFocused()
  await expect(outline.getByRole('link')).toHaveText([
    'First chapter',
    'Second chapter',
  ])

  const first = editor.getByRole('heading', { name: 'First chapter' })
  await outline.getByRole('link', { name: 'First chapter' }).click()
  await expect(editor).toBeFocused()
  await expectCaretAt(first)

  const second = editor.getByRole('heading', { name: 'Second chapter' })
  await contents.getByRole('link', { name: 'Second chapter' }).click()
  await expect(editor).toBeFocused()
  await expectCaretAt(second)
  await page.keyboard.press('End')
  await page.keyboard.insertText(' revised')
  await expect(
    outline.getByRole('link', { name: 'Second chapter revised' }),
  ).toBeVisible()
  await expect(
    contents.getByRole('link', { name: 'Second chapter revised' }),
  ).toBeVisible()
  await page.keyboard.press('ArrowDown')

  await menu.getByRole('menuitem', { name: 'Insert', exact: true }).click()
  await page
    .getByRole('menuitem', { name: 'Table of contents', exact: true })
    .click()
  await expect(contents).toHaveCount(2)
  await expect(
    page.getByRole('button', { name: 'All changes saved locally' }),
  ).toBeVisible()

  await page.reload()
  await expect(contents).toHaveCount(2, { timeout: 30_000 })
  await expect(contents.first().getByRole('link')).toHaveText([
    'First chapter',
    'Second chapter revised',
  ])
  await contents.last().hover()
  await contents
    .last()
    .getByRole('button', { name: 'Remove table of contents' })
    .click()
  await expect(contents).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await expect(contents).toHaveCount(2)
})
