import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
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
  await expect(page.locator('[data-document-content]')).toBeVisible({
    timeout: 30_000,
  })
})

test('edits a table with the keyboard and menu and restores it after reload', async ({
  page,
}) => {
  const editor = page.locator('[data-document-content]')
  await editor.click()
  await page
    .getByRole('menubar', { name: 'Editor menu' })
    .getByRole('menuitem', { name: 'Insert', exact: true })
    .click()
  await page.getByRole('menuitem', { name: 'Table', exact: true }).click()
  const insert = page.getByRole('dialog', { name: 'Insert table' })
  await expect(insert.getByRole('spinbutton', { name: 'Rows' })).toBeFocused()
  const grid = insert.getByRole('grid', { name: 'Table dimensions' })
  const preview = grid.getByRole('gridcell', { name: '4 rows by 5 columns' })
  await preview.hover()
  await expect(insert.getByRole('spinbutton', { name: 'Rows' })).toHaveValue(
    '4',
  )
  await expect(insert.getByRole('spinbutton', { name: 'Columns' })).toHaveValue(
    '5',
  )
  await expect(grid.locator('[data-preview="true"]')).toHaveCount(20)
  await insert.getByRole('spinbutton', { name: 'Rows' }).hover()
  await expect(insert.getByRole('spinbutton', { name: 'Rows' })).toHaveValue(
    '3',
  )
  await grid.getByRole('gridcell', { name: '2 rows by 2 columns' }).click()
  await expect(grid.getByRole('gridcell', { selected: true })).toHaveCount(4)
  await expect(insert.getByRole('spinbutton', { name: 'Columns' })).toHaveValue(
    '2',
  )
  await insert.getByRole('button', { name: 'Insert table' }).click()
  await expect(insert).toBeHidden()

  const table = editor.getByRole('table')
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(table.getByRole('columnheader')).toHaveCount(2)
  await page.keyboard.type('Part')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Cost')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Notebook')
  await page.keyboard.press('Tab')
  await page.keyboard.type('$12')
  await expect(table.getByRole('columnheader', { name: 'Part' })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Cost' })).toBeVisible()
  await expect(table.getByRole('cell', { name: 'Notebook' })).toBeVisible()
  await expect(table.getByRole('cell', { name: '$12' })).toBeVisible()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Insert row below' }).click()
  await expect(table.getByRole('row')).toHaveCount(3)

  await table.getByRole('cell', { name: '$12' }).click()
  await page.getByRole('button', { name: 'Table actions' }).click()
  await page.getByRole('menuitem', { name: 'Insert column after' }).click()
  await expect(table.getByRole('row').nth(1).getByRole('cell')).toHaveCount(3)
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
  await expect(table.getByRole('row')).toHaveCount(3)
  await expect(table.getByRole('cell', { name: '$12' })).toBeVisible()
})

test('inserts a table from the slash menu and merges, splits, and deletes it', async ({
  page,
}) => {
  const editor = page.locator('[data-document-content]')
  await editor.click()
  await page.keyboard.type('/table')
  await page.getByRole('option', { name: 'Table', exact: true }).click()
  const insert = page.getByRole('dialog', { name: 'Insert table' })
  await insert.getByRole('checkbox', { name: 'Header row' }).click()
  await insert.getByRole('button', { name: 'Insert table' }).click()
  const table = editor.getByRole('table')
  await expect(table.getByRole('columnheader')).toHaveCount(0)
  const firstRow = table.getByRole('row').first()
  const cells = firstRow.getByRole('cell')
  await page.keyboard.type('Left')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Right')

  const start = await cells.nth(0).boundingBox()
  const end = await cells.nth(1).boundingBox()
  if (!start || !end) throw new Error('Expected table cells to be visible.')
  await page.mouse.move(start.x + 12, start.y + 12)
  await page.mouse.down()
  await page.mouse.move(end.x + 12, end.y + 12, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.press('Control+Shift+c')
  const counts = page.getByRole('dialog', { name: 'Word count' })
  await expect(counts.getByText('Selection', { exact: true })).toBeVisible()
  await expect(counts.locator('dd').first()).toHaveText('2')
  await page.getByRole('button', { name: 'Table actions' }).click()
  await page.getByRole('menuitem', { name: 'Merge selected cells' }).click()
  await expect(cells.first()).toHaveAttribute('colspan', '2')
  await expect(cells.first()).toContainText('Left')
  await expect(cells.first()).toContainText('Right')

  await page.getByRole('button', { name: 'Table actions' }).click()
  await page.getByRole('menuitem', { name: 'Split cell' }).click()
  await expect(cells).toHaveCount(3)
  await page.getByRole('button', { name: 'Table actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete table' }).click()
  await expect(table).toHaveCount(0)
  await page.keyboard.type('Text after deletion')
  await expect(editor).toContainText('Text after deletion')
})

test('inserts a page break after a table when the caret is in a cell', async ({
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
  await page.keyboard.type('/table')
  await page.getByRole('option', { name: 'Table', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Insert table' })
    .getByRole('button', { name: 'Insert table' })
    .click()
  await page.keyboard.insertText('First page table')
  await page.keyboard.press('Control+Enter')

  await expect(pages).toHaveCount(2)
  await expect(pages.first().getByRole('table')).toContainText(
    'First page table',
  )
  await expect(
    editor.locator(':scope > [data-lexical-page-break]'),
  ).toHaveCount(1)
  await expect(pages.nth(1).getByRole('table')).toHaveCount(0)
})

test('scrolls wide tables within a narrow canvas and expands them for print', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const editor = page.getByRole('textbox', { name: 'Document content' })
  await editor.click()
  await page.keyboard.type('/table')
  await page.getByRole('option', { name: 'Table', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Insert table' })
  await expect(
    dialog.getByRole('grid', { name: 'Table dimensions' }),
  ).toBeHidden()
  await dialog.getByRole('spinbutton', { name: 'Columns' }).fill('12')
  await dialog.getByRole('button', { name: 'Insert table' }).click()

  const scroller = editor.locator('.concept-table-scroll')
  await expect
    .poll(() =>
      scroller.evaluate((node) => node.scrollWidth > node.clientWidth),
    )
    .toBe(true)
  const table = scroller.getByRole('table')
  const cell = table.getByRole('row').last().getByRole('cell').last()
  await cell.click()
  await page.keyboard.insertText('Last column')
  await expect(cell).toHaveText('Last column')
  await page.emulateMedia({ media: 'print' })
  await expect(scroller).toHaveCSS('overflow-x', 'visible')
  await expect(table).toHaveCSS('table-layout', 'fixed')
})
