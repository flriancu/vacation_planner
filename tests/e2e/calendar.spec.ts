import { expect, test, type Page } from '@playwright/test';

// The app runs on in-memory storage (milestone 2); every test starts from an empty plan.
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2027-03-01T10:00:00') });
  await page.goto('./');
  await expect(page.getByRole('grid')).toBeVisible();
});

const cell = (page: Page, date: string) => page.locator(`[data-date="${date}"]`);

/** Drag on desktop (CAL-8); tap the first and the last day on a phone. */
async function selectRange(page: Page, isMobile: boolean, from: string, to: string) {
  if (isMobile) {
    await cell(page, from).tap();
    await cell(page, to).tap();
    return;
  }
  await cell(page, from).scrollIntoViewIfNeeded();
  const a = (await cell(page, from).boundingBox())!;
  const b = (await cell(page, to).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
}

test('shows the year with holidays, weekends and month names (CAL-1..5)', async ({ page }) => {
  await expect(page.getByRole('navigation', { name: 'Anul' })).toContainText('2027');
  await expect(cell(page, '2027-01-06')).toHaveClass(/base-holiday/);
  await expect(cell(page, '2027-01-09')).toHaveClass(/base-weekend/);
  await expect(cell(page, '2027-03-01')).toHaveClass(/today/);
  await expect(page.getByText('Boboteaza').first()).toBeVisible(); // also in January after
  await expect(page.getByText('ianuarie 2027')).toBeVisible();
  // The view starts mid-December before and ends mid-January after (CAL-2).
  await expect(cell(page, '2026-12-14')).toHaveClass(/out-of-year/);
  await expect(cell(page, '2028-01-16')).toBeAttached();
});

test('creates, approves and deletes leave (CAL-6..9, BLK-4)', async ({ page, isMobile }) => {
  await selectRange(page, isMobile, '2027-08-09', '2027-08-13');
  const dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('editor-cost')).toHaveText('5 zile de concediu, 9 zile libere');
  await dialog.getByRole('radio', { name: 'Planificat' }).check();
  await dialog.getByRole('button', { name: 'Salvează' }).click();
  await expect(dialog).toBeHidden();
  await expect(cell(page, '2027-08-11')).toHaveClass(/fill-planned/);
  await expect(cell(page, '2027-08-09').locator('.badge')).toHaveText('5 → 9');

  await cell(page, '2027-08-10').click();
  const edit = page.getByRole('dialog', { name: 'Editează concediul' });
  await expect(edit.getByRole('radio')).toHaveCount(3); // one step either way from "planned"
  await edit.getByRole('radio', { name: 'Aprobat' }).check();
  await edit.getByRole('button', { name: 'Salvează' }).click();
  await expect(cell(page, '2027-08-11')).toHaveClass(/fill-approved/);
  await expect(cell(page, '2027-08-09').locator('.badge')).toHaveText('5 → 9 ✓');

  await cell(page, '2027-08-10').click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('dialog', { name: 'Editează concediul' }).getByRole('button', { name: 'Șterge' }).click();
  await expect(cell(page, '2027-08-11')).not.toHaveClass(/fill-/);
  await expect(cell(page, '2027-08-09').locator('.badge')).toHaveCount(0);
});

test('an idea is outlined but not filled, and costs only uncovered days', async ({ page, isMobile }) => {
  await selectRange(page, isMobile, '2027-04-26', '2027-04-29');
  const dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  // Good Friday 30 Apr, 1–2 May weekend, Easter Monday 3 May.
  await expect(dialog.getByTestId('editor-cost')).toHaveText('4 zile de concediu, 10 zile libere');
  await dialog.getByRole('button', { name: 'Salvează' }).click(); // default status: idea
  await expect(cell(page, '2027-04-27')).not.toHaveClass(/fill-/);
  await expect(cell(page, '2027-04-27').locator('.outline.st-idea')).toHaveCount(1);
});

test('Escape cancels a half-made selection', async ({ page, isMobile }) => {
  test.skip(isMobile, 'needs a keyboard');
  await cell(page, '2027-03-08').click();
  await expect(page.getByText(/Atinge acum ultima zi/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText(/Atinge acum ultima zi/)).toBeHidden();
  await cell(page, '2027-03-10').click(); // starts a new selection instead of finishing the old one
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('selects with the keyboard (NF-6)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'needs a keyboard');
  await cell(page, '2027-03-01').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  await expect(dialog.getByLabel('De la', { exact: true })).toHaveValue('2027-03-01');
  await expect(dialog.getByLabel('Până la', { exact: true })).toHaveValue('2027-03-03');
});

test('switches language and remembers it (I18N-1)', async ({ page }) => {
  await page.getByRole('button', { name: 'Switch to English' }).click();
  await expect(page.getByRole('heading', { name: 'Vacation planner' })).toBeVisible();
  await expect(page.getByText('Epiphany').first()).toBeVisible();
  await expect(page.getByText('January 2027')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Vacation planner' })).toBeVisible();
});

test('moves between years', async ({ page }) => {
  await page.getByRole('button', { name: 'Anul următor' }).click();
  await expect(page.getByRole('navigation', { name: 'Anul' })).toContainText('2028');
  await expect(cell(page, '2028-12-25')).toHaveClass(/base-holiday/);
  await expect(cell(page, '2026-12-14')).toHaveCount(0);
});
