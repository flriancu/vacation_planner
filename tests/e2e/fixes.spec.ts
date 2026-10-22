import { expect, test, type Page } from '@playwright/test';

// Regressions found by adversarial testing, in the demo (in-memory) app.
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2027-03-01T10:00:00') });
  await page.goto('./');
  await expect(page.getByRole('grid')).toBeVisible();
});

const cell = (page: Page, date: string) => page.locator(`[data-date="${date}"]`);

/** A new-leave editor for `from`–`to`, opened by clicking the first and the last day. */
async function newLeave(page: Page, from: string, to: string) {
  await cell(page, from).click();
  await cell(page, to).click();
  const dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('the picker shows the first and last day of the range on the accent fill', async ({ page, isMobile }) => {
  test.skip(isMobile, 'same component on phones');
  const dialog = await newLeave(page, '2027-03-08', '2027-03-10');
  await dialog.getByRole('button', { name: /^Perioada/ }).click();
  for (const day of ['2027-03-08', '2027-03-10']) {
    const button = dialog.locator(`[data-day="${day}"] button`);
    const bg = await button.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg, `${day} background`).not.toBe('rgba(0, 0, 0, 0)');
    // Two-digit numbers are not clipped: the text fits its button.
    expect(await button.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
});

test('the year arrows stop at the last year the holiday rules cover', async ({ page }) => {
  const next = page.getByRole('button', { name: 'Anul următor' });
  for (let y = 2027; y < 2099; y++) await next.click();
  await expect(page.getByRole('navigation', { name: 'Anul' })).toContainText('2099');
  await expect(next).toBeDisabled();
  await expect(page.getByRole('grid')).toBeVisible();
});

test('unsaved changes are not dropped by Escape without asking', async ({ page }) => {
  const dialog = await newLeave(page, '2027-03-08', '2027-03-10');
  await dialog.getByLabel('Notă').fill('zbor la 6');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('Ai modificări nesalvate.');
  await dialog.getByRole('button', { name: 'Continuă editarea' }).click();
  await expect(dialog.getByLabel('Notă')).toHaveValue('zbor la 6');
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Renunță la ele' }).click();
  await expect(dialog).toBeHidden();
});

test('after saving, keyboard focus is back on the day', async ({ page, isMobile }) => {
  test.skip(isMobile, 'needs a keyboard');
  const dialog = await newLeave(page, '2027-03-08', '2027-03-10');
  await dialog.getByRole('button', { name: 'Salvează' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(':focus')).toHaveAttribute('data-date', '2027-03-08');
});

test('a click that trembles a few pixels stays a one-day click', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mouse only');
  const box = (await cell(page, '2027-03-09').boundingBox())!;
  // Pressed near the bottom edge, then a 5 px shake into the next week's row.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 3, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toBeHidden(); // a first click only: the selection waits for the last day
  await expect(page.locator('.cal-pending')).toContainText('9 martie');
});

test('two deletes can both be undone', async ({ page }) => {
  for (const [from, to] of [
    ['2027-03-08', '2027-03-08'],
    ['2027-03-15', '2027-03-15'],
  ] as const) {
    const dialog = await newLeave(page, from, to);
    await dialog.getByRole('button', { name: 'Salvează' }).click();
    await expect(dialog).toBeHidden();
  }
  for (const day of ['2027-03-08', '2027-03-15']) {
    await cell(page, day).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Șterge' }).click();
  }
  await expect(page.getByRole('status').filter({ hasText: 'șterse' })).toContainText('Au fost șterse 2 concedii.');
  await page.getByRole('button', { name: 'Anulează' }).dblclick();
  await expect(cell(page, '2027-03-08')).toHaveClass(/idea-only/);
  await expect(cell(page, '2027-03-15')).toHaveClass(/idea-only/);
  await expect(page.locator('.cal-pending')).toHaveCount(0); // the second click didn't start a selection
});

test('planned leave cannot be saved over other planned leave (BLK-5)', async ({ page }) => {
  let dialog = await newLeave(page, '2027-03-08', '2027-03-10');
  await dialog.getByRole('radio', { name: 'Planificat' }).check();
  await dialog.getByRole('button', { name: 'Salvează' }).click();
  await expect(dialog).toBeHidden();
  await page.locator('.cal-pending').waitFor({ state: 'detached' });
  await cell(page, '2027-03-11').click();
  await cell(page, '2027-03-09').click();
  dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  await dialog.getByRole('radio', { name: 'Planificat' }).check();
  await expect(dialog.getByText('Se suprapune cu alt concediu')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Salvează' })).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Idee' }).check();
  await expect(dialog.getByRole('button', { name: 'Salvează' })).toBeEnabled();
});

test('the editor opens with its title focused, not the leave-type list (iPhones open a focused list at once)', async ({ page }) => {
  const dialog = await newLeave(page, '2027-03-08', '2027-03-10');
  await expect(dialog.getByRole('heading', { name: 'Concediu nou' })).toBeFocused();
  await expect(dialog.getByLabel('Tip')).not.toBeFocused();
  await dialog.getByRole('button', { name: 'Salvează' }).click();
  await cell(page, '2027-03-09').click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Editează concediul' })).toBeFocused();
});

test('no number of Escapes drops a draft without the question being answered', async ({ page }) => {
  const dialog = await newLeave(page, '2027-03-08', '2027-03-10');
  await dialog.getByLabel('Notă').fill('zbor la 6');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Escape'); // question, keep editing, question…
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Continuă editarea' }).click();
  await page.keyboard.press('Escape'); // asks again, never closes
  await expect(dialog.getByRole('alert')).toContainText('Ai modificări nesalvate.');
  await expect(dialog.getByLabel('Notă')).toHaveValue('zbor la 6');
});

test('a holiday can have only one swap day', async ({ page }) => {
  // Sun 24 Jan 2027 is a holiday: Fri 22 or Mon 25 Jan.
  for (const [day, expectSaved] of [
    ['2027-01-22', true],
    ['2027-01-25', false],
  ] as const) {
    const dialog = await newLeave(page, day, day);
    await dialog.getByLabel('Tip').selectOption({ label: 'Zi compensatorie' });
    await dialog.getByRole('radio', { name: 'Planificat' }).check();
    if (expectSaved) {
      await dialog.getByRole('button', { name: 'Salvează' }).click();
      await expect(dialog).toBeHidden();
    } else {
      await expect(dialog.getByText('Sărbătoarea aceasta are deja o zi compensatorie')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Salvează' })).toBeDisabled();
    }
  }
});

test('leave on the other year’s days at the edge of the view stays in this view', async ({ page }) => {
  const dialog = await newLeave(page, '2026-12-14', '2026-12-15');
  await dialog.getByRole('button', { name: 'Salvează' }).click();
  await expect(page.getByRole('navigation', { name: 'Anul' })).toContainText('2027');
});

test('the year arrow keeps keyboard focus at the last year', async ({ page, isMobile }) => {
  test.skip(isMobile, 'needs a keyboard');
  const next = page.getByRole('button', { name: 'Anul următor' });
  await next.focus();
  for (let y = 2027; y < 2100; y++) await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Anul' })).toContainText('2099');
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await expect(next).toBeFocused();
});

test('the last click of a selection that shakes onto the next day still ends it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mouse only');
  await cell(page, '2027-03-08').click();
  const box = (await cell(page, '2027-03-10').boundingBox())!;
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 4, box.y + box.height / 2, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: 'Concediu nou' }).getByRole('button', { name: /^Perioada/ })).toHaveAttribute(
    'data-end',
    '2027-03-10',
  );
});

test('a day under two blocks says which block each line is about, and the break once', async ({ page }) => {
  for (const [from, to, type, status] of [
    ['2027-12-28', '2027-12-31', 'Birou închis', 'Planificat'],
    ['2027-12-20', '2028-01-07', null, 'Aprobat'],
  ] as const) {
    const dialog = await newLeave(page, from, to);
    if (type) await dialog.getByLabel('Tip').selectOption({ label: type });
    await dialog.getByRole('radio', { name: status }).check();
    await dialog.getByRole('button', { name: 'Salvează' }).click();
    await expect(dialog).toBeHidden();
  }
  const tip = (await cell(page, '2027-12-29').getAttribute('data-tip'))!;
  expect(tip.split('\n')).toEqual([
    'Birou închis (planificat): nu folosești zile de concediu',
    'Concediu de odihnă (aprobat): folosești 9 zile de concediu',
    expect.stringMatching(/^→ ești liber 23 de zile la rând: sâmbătă 18 decembrie 2027 – duminică 9 ianuarie 2028$/),
  ]);
});
