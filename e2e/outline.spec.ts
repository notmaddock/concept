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
  await expect(
    outline.getByRole('link', { name: 'First chapter' }),
  ).toHaveAttribute('aria-current', 'location')
  await expect(page).toHaveURL(/#L[\w-]+~concept-heading-[\w-]+$/)
  const firstUrl = page.url()
  await editor.getByText('Opening paragraph', { exact: true }).click()
  await expect(
    outline.getByRole('link', { name: 'First chapter' }),
  ).toHaveAttribute('aria-current', 'location')
  await editor.getByRole('heading', { name: 'Second chapter' }).click()
  await expect(
    outline.getByRole('link', { name: 'Second chapter' }),
  ).toHaveAttribute('aria-current', 'location')
  await expect(page).toHaveURL(firstUrl)

  const second = editor.getByRole('heading', { name: 'Second chapter' })
  await contents.getByRole('link', { name: 'Second chapter' }).click()
  await expect(editor).toBeFocused()
  await expectCaretAt(second)
  const secondUrl = page.url()
  expect(secondUrl).not.toBe(firstUrl)
  await page.keyboard.press('End')
  await page.keyboard.insertText(' revised')
  await expect(
    outline.getByRole('link', { name: 'Second chapter revised' }),
  ).toBeVisible()
  await expect(
    contents.getByRole('link', { name: 'Second chapter revised' }),
  ).toBeVisible()
  await expect(page).toHaveURL(secondUrl)
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
  await expectCaretAt(
    editor.getByRole('heading', { name: 'Second chapter revised' }),
  )
  await contents.last().hover()
  await contents
    .last()
    .getByRole('button', { name: 'Remove table of contents' })
    .click()
  await expect(contents).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await expect(contents).toHaveCount(2)
})

test('shows page numbers and dotted leaders in paged contents and prints internal links', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  const welcome = page.getByRole('alertdialog', { name: 'Welcome to Concept!' })
  const create = page.getByRole('button', { name: 'New document' }).first()
  await expect(welcome.or(create)).toBeVisible({ timeout: 30_000 })
  if (await welcome.isVisible()) {
    await welcome.getByRole('checkbox').click()
    await welcome.getByRole('button', { name: 'Acknowledge' }).click()
  }
  await create.click()
  const editor = page.getByRole('textbox', { name: 'Document content' })
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await editor.click()
  await selectSlashOption(page, 'toc', 'Table of contents')
  const contents = editor.getByRole('navigation', { name: 'Table of contents' })
  await selectSlashOption(page, 'heading 1', 'Heading 1')
  await page.keyboard.insertText('First destination')
  await page.keyboard.press('Enter')
  await expect(contents.getByRole('link')).toHaveText('First destination')
  await expect(contents).toHaveCSS('border-top-width', '0px')
  await contents.hover()
  await contents
    .getByRole('button', { name: 'Table of contents style' })
    .click()
  const options = page.getByRole('dialog', { name: 'Contents style' })
  await expect(
    options.getByRole('button', { name: 'Page numbers' }),
  ).toBeDisabled()
  await page.keyboard.press('Escape')

  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Page setup', exact: true }).click()
  const setup = page.getByRole('dialog', { name: 'Page setup' })
  await setup.getByRole('combobox', { name: 'Paper size' }).click()
  await page.getByRole('option', { name: /^A4/ }).click()
  await setup.getByRole('button', { name: 'Apply' }).click()

  const pages = editor.locator(':scope > .concept-page')
  await expect(pages).toHaveCount(1)
  await pages.first().locator('p').last().click()
  await page.keyboard.press('Control+Enter')
  await expect(pages).toHaveCount(2)
  await pages.last().locator('p').first().click()
  await selectSlashOption(page, 'heading 2', 'Heading 2')
  await page.keyboard.insertText('Second destination')
  await expect(contents.getByRole('link')).toHaveCount(2)

  await contents.hover()
  await contents
    .getByRole('button', { name: 'Table of contents style' })
    .click()
  await options.getByRole('button', { name: 'Page numbers' }).click()
  await expect(contents.locator('[aria-label="Page 1"]')).toHaveText('1')
  await expect(contents.locator('[aria-label="Page 2"]')).toHaveText('2')
  await options.getByRole('button', { name: 'Dotted leaders' }).click()
  await expect(contents.locator('.border-dotted')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'All changes saved locally' }),
  ).toBeVisible()

  await page.reload()
  await expect(contents.locator('.border-dotted')).toHaveCount(2, {
    timeout: 30_000,
  })
  const destination = await contents
    .getByRole('link', { name: /Second destination/ })
    .getAttribute('href')
  const pdf = await page.pdf({
    path: testInfo.outputPath('linked-contents.pdf'),
    preferCSSPageSize: true,
  })
  expect(destination).toBeTruthy()
  expect(pdf.toString('latin1')).toContain(`/Dest /${destination!.slice(1)}`)
})
