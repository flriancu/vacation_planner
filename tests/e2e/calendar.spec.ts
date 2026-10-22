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
  // Holiday names are in the tooltip, not on the calendar.
  await expect(cell(page, '2027-01-06')).toHaveAttribute('data-tip', /Boboteaza/);
  await expect(page.getByText('ianuarie 2027')).toBeVisible();
  // The view starts mid-December before and ends mid-January after (CAL-2).
  await expect(cell(page, '2026-12-14')).toHaveClass(/out-of-year/);
  await expect(cell(page, '2028-01-16')).toBeAttached();
});

test('creates, approves and deletes leave (CAL-6..9, BLK-4)', async ({ page, isMobile }) => {
  await selectRange(page, isMobile, '2027-08-09', '2027-08-13');
  const dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('editor-cost')).toContainText('Folosești 5 zile de concediu');
  await expect(dialog.getByTestId('editor-cost')).toContainText('→ ești liber 9 zile la rând:');
  await dialog.getByRole('radio', { name: 'Planificat' }).check();
  await dialog.getByRole('button', { name: 'Salvează' }).click();
  await expect(dialog).toBeHidden();
  await expect(cell(page, '2027-08-11')).toHaveClass(/fill-planned/);
  await expect(cell(page, '2027-08-09')).toHaveAttribute(
    'data-tip',
    /Concediu de odihnă \(planificat\): folosești 5 zile de concediu\n→ ești liber 9 zile la rând/,
  );

  await cell(page, '2027-08-10').click();
  const edit = page.getByRole('dialog', { name: 'Editează concediul' });
  await expect(edit.getByRole('radio', { disabled: false })).toHaveCount(3); // one step either way from "planned"
  await edit.getByRole('radio', { name: 'Aprobat' }).check();
  await edit.getByRole('button', { name: 'Salvează' }).click();
  await expect(cell(page, '2027-08-11')).toHaveClass(/fill-approved/);
  await expect(cell(page, '2027-08-09').locator('.outline.st-approved')).toHaveCount(1);

  await cell(page, '2027-08-10').click();
  await page.getByRole('dialog', { name: 'Editează concediul' }).getByRole('button', { name: 'Șterge' }).click();
  await expect(cell(page, '2027-08-11')).not.toHaveClass(/fill-/);
  // No "are you sure?": an undo message instead.
  await expect(page.getByText('Concediul a fost șters.')).toBeVisible();
  await page.getByRole('button', { name: 'Anulează' }).click();
  await expect(cell(page, '2027-08-11')).toHaveClass(/fill-approved/);
  await cell(page, '2027-08-10').click();
  await page.getByRole('dialog', { name: 'Editează concediul' }).getByRole('button', { name: 'Șterge' }).click();
  await expect(cell(page, '2027-08-11')).not.toHaveClass(/fill-/);
  await expect(cell(page, '2027-08-09')).not.toHaveAttribute('data-tip', /.+/);
});

test('an idea is outlined but not filled, and costs only uncovered days', async ({ page, isMobile }) => {
  await selectRange(page, isMobile, '2027-04-26', '2027-04-29');
  const dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  // Good Friday 30 Apr, 1–2 May weekend, Easter Monday 3 May.
  await expect(dialog.getByTestId('editor-cost')).toContainText('Folosești 4 zile de concediu');
  await expect(dialog.getByTestId('editor-cost')).toContainText('→ ești liber 10 zile la rând:');
  await dialog.getByRole('button', { name: 'Salvează' }).click(); // default status: idea
  await expect(cell(page, '2027-04-27')).not.toHaveClass(/fill-/);
  await expect(cell(page, '2027-04-27').locator('.outline.st-idea')).toHaveCount(1);
});

test('leave around an office closure is outlined outside it, the closure inside', async ({ page, isMobile }) => {
  await selectRange(page, isMobile, '2027-08-10', '2027-08-12');
  let dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  await dialog.getByRole('combobox', { name: 'Tip' }).click();
  await dialog.getByRole('option', { name: 'Birou închis' }).click();
  await dialog.getByRole('radio', { name: 'Planificat' }).check();
  await dialog.getByRole('button', { name: 'Salvează' }).click();
  await selectRange(page, isMobile, '2027-08-05', '2027-08-18');
  dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  await dialog.getByRole('radio', { name: 'Aprobat' }).check();
  await dialog.getByRole('button', { name: 'Salvează' }).click();
  await expect(dialog).toBeHidden();
  // The closure owns the day, but the leave that encloses it is drawn outermost.
  const outlines = cell(page, '2027-08-11').locator('.outline');
  await expect(outlines).toHaveCount(2);
  await expect(outlines.nth(0)).toHaveClass(/st-approved/);
  await expect(outlines.nth(0)).toHaveAttribute('style', /--i: 0/);
  await expect(outlines.nth(1)).toHaveAttribute('style', /--c: var\(--free-edge\); --i: 1/);
  // The outline turns at the top left of Thu 12 (row 1 starts on Thu 5): the corner is drawn.
  await expect(cell(page, '2027-08-12').locator('.outline.st-approved .corner.tl')).toHaveCount(1);
});

test('the leave type list shows each type as the calendar draws it', async ({ page, isMobile }) => {
  await selectRange(page, isMobile, '2027-08-10', '2027-08-12');
  const dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  const field = dialog.getByRole('combobox', { name: 'Tip' });
  await expect(field).toHaveText('Concediu de odihnă');
  await dialog.getByRole('radio', { name: 'Planificat' }).check();
  if (isMobile) await field.tap();
  else await field.click();
  await expect(field).toHaveAttribute('aria-expanded', 'true');
  // Office closed in the "off anyway" colours, the other types in the leave colours, in the chosen status.
  await expect(dialog.getByRole('option', { name: 'Birou închis' }).locator('.swatch')).toHaveClass(/free-block/);
  await expect(dialog.getByRole('option', { name: 'Învoire' }).locator('.swatch')).toHaveClass(/fill-planned/);
  // A tap on a phone (Safari once sent no click for it), a click elsewhere.
  const closed = dialog.getByRole('option', { name: 'Birou închis' });
  if (isMobile) await closed.tap();
  else await closed.click();
  await expect(field).toHaveText('Birou închis');
  await expect(dialog.getByRole('listbox')).toBeHidden();
});

test('the leave type list works from the keyboard, and Escape closes only the list', async ({ page, isMobile }) => {
  test.skip(isMobile, 'needs a keyboard');
  await selectRange(page, isMobile, '2027-08-10', '2027-08-12');
  const dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  const field = dialog.getByRole('combobox', { name: 'Tip' });
  await field.focus();
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('listbox')).toBeHidden();
  await expect(dialog).toBeVisible();
  // Typing letters jumps to a name (diacritics optional), Enter chooses it.
  await page.keyboard.type('bi');
  await expect(field).toHaveAttribute('aria-activedescendant', /.+/);
  await page.keyboard.press('Enter');
  await expect(field).toHaveText('Birou închis');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(field).toHaveText('Concediu fără plată');
  await expect(field).toBeFocused();
  // A whole name, spaces included: the space is part of the search, not "choose".
  await page.keyboard.type('Concediu m');
  await page.keyboard.press('Enter');
  await expect(field).toHaveText('Concediu medical');
  await page.waitForTimeout(600);
  await page.keyboard.type('concediu de');
  await page.keyboard.press('Enter');
  await expect(field).toHaveText('Concediu de odihnă');
});

test('the open leave type list moves nothing, and a tap beside it closes it without acting', async ({ page, isMobile }) => {
  await selectRange(page, isMobile, '2027-08-09', '2027-08-11');
  let dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  await dialog.getByRole('button', { name: 'Salvează' }).click();
  await cell(page, '2027-08-10').click();
  dialog = page.getByRole('dialog', { name: 'Editează concediul' });
  const remove = dialog.getByRole('button', { name: 'Șterge' });
  const before = await remove.boundingBox();
  await dialog.getByRole('combobox', { name: 'Tip' }).click();
  await expect(dialog.getByRole('listbox')).toBeVisible();
  // The list floats: the buttons below stay where they were.
  expect(await remove.boundingBox()).toEqual(before);
  const heading = dialog.getByRole('heading', { name: 'Editează concediul' });
  if (isMobile) await heading.tap();
  else await heading.click();
  await expect(dialog.getByRole('listbox')).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(cell(page, '2027-08-10')).toHaveClass(/idea-only|fill-/);
});

test("the phone's back gesture closes the open list, not the editor", async ({ page, isMobile }) => {
  await selectRange(page, isMobile, '2027-08-10', '2027-08-12');
  const dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  await dialog.getByRole('combobox', { name: 'Tip' }).click();
  await expect(dialog.getByRole('listbox')).toBeVisible();
  // Android's back gesture reaches a modal dialog as a cancelable "cancel" event.
  await dialog.evaluate((d) => d.dispatchEvent(new Event('cancel', { cancelable: true })));
  await expect(dialog.getByRole('listbox')).toBeHidden();
  await expect(dialog).toBeVisible();
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
  const dates = dialog.getByRole('button', { name: /^Perioada/ });
  await expect(dates).toHaveAttribute('data-start', '2027-03-01');
  await expect(dates).toHaveAttribute('data-end', '2027-03-03');
});

test('switches language and remembers it (I18N-1)', async ({ page }) => {
  await page.getByRole('button', { name: 'Setări' }).click();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page).toHaveTitle('Vacation planner');
  await expect(cell(page, '2027-01-06')).toHaveAttribute('data-tip', /Epiphany/);
  await expect(page.getByText('January 2027')).toBeVisible();
  await page.reload();
  await expect(page).toHaveTitle('Vacation planner');
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
});

test('moves between years', async ({ page }) => {
  await page.getByRole('button', { name: 'Anul următor' }).click();
  await expect(page.getByRole('navigation', { name: 'Anul' })).toContainText('2028');
  await expect(cell(page, '2028-12-25')).toHaveClass(/base-holiday/);
  await expect(cell(page, '2026-12-14')).toHaveCount(0);
});

test('signed out, the demo offers Google sign-in (AUTH-1, AUTH-3)', async ({ page, isMobile }) => {
  await expect(page.getByText(/^Mod demo: ce adaugi aici nu se salvează\./)).toBeVisible();
  // Phones get the short label so the header fits one row.
  await expect(page.getByRole('button', { name: isMobile ? 'Conectează-te' : 'Conectează-te cu Google', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Confidențialitate' })).toHaveAttribute('href', 'privacy.html');
  await expect(page.getByRole('link', { name: 'Condiții de utilizare' })).toHaveAttribute('href', 'terms.html');
});

test('the privacy and terms pages share the language choice with the app', async ({ page }) => {
  await page.goto('./privacy.html');
  // The test browser is English, so the page starts in English; pick Romanian first.
  await page.getByRole('button', { name: 'Română' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Confidențialitate');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy');
  // One language choice everywhere: the terms page and the app follow it.
  await page.getByRole('link', { name: 'Terms of use' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms of use');
  await expect(page.getByText('check with HR before you book your leave')).toBeVisible();
  await page.getByRole('link', { name: '← Back to the app' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
});

test('Today jumps back to the current year and week', async ({ page }) => {
  await page.getByRole('button', { name: 'Anul următor' }).click();
  await expect(page.getByRole('navigation', { name: 'Anul' })).toContainText('2028');
  await page.getByRole('button', { name: 'Azi' }).click();
  await expect(page.getByRole('navigation', { name: 'Anul' })).toContainText('2027');
  await expect(cell(page, '2027-03-01')).toBeInViewport();
});

test('settings and the demo notice are reachable, and the notice can be closed', async ({ page }) => {
  await expect(page.getByRole('status').filter({ hasText: 'Demo' })).toHaveAttribute('data-tip', 'Demo: nu se salvează');
  await page.getByRole('button', { name: 'Setări' }).click();
  await expect(page.getByLabel('Culori')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Culori')).toBeHidden();
  await page.getByRole('button', { name: 'Închide' }).click();
  await expect(page.getByText(/^Mod demo: ce adaugi aici/)).toBeHidden();
});

test('header labels never wrap, even in a narrow window (one row, one sign-in action)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop widths');
  await page.addInitScript(() =>
    localStorage.setItem('vacation-planner.account', JSON.stringify({ email: 'someone@gmail.com', name: 'Ana' })),
  );
  for (const width of [860, 1000, 1280]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('./');
    const heights = await page
      .locator('.app-header button, .app-header .status')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    expect(Math.max(...heights), `width ${width}`).toBeLessThanOrEqual(36); // --ctl-h is 34 px
    expect(await page.locator('.app-header').evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(60);
    await expect(page.getByRole('button', { name: /^Continuă ca Ana$/ })).toHaveCount(1);
  }
});

test('the editor date picker: first day, then last day, with a preview (keyboard too)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'needs a keyboard');
  await cell(page, '2027-01-04').click();
  await cell(page, '2027-01-05').click();
  const dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  const dates = dialog.getByRole('button', { name: /^Perioada/ });
  await expect(dates).toContainText(/luni 4 ianuarie 2027 – marți 5 ianuarie 2027/i);
  await dates.click();
  const picker = dialog.getByRole('dialog', { name: 'Alege perioada' });
  await expect(picker).toContainText('Alege prima zi.');
  await expect(picker.locator('[data-day="2027-01-06"]')).toHaveClass(/dp-holiday/);
  await expect(picker.locator('[data-day="2027-01-04"] button')).toBeFocused(); // focus starts on the current start (APG)
  await page.keyboard.press('Enter'); // first day: 4 Jan
  await expect(picker).toContainText(/Prima zi: luni 4 ianuarie 2027\. Alege acum ultima zi\./);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight'); // 7 Jan, previewed
  await expect(picker.locator('[data-day="2027-01-06"]')).toHaveClass(/rdp-range_middle/);
  await page.keyboard.press('Enter');
  await expect(picker).toBeHidden();
  await expect(dates).toHaveAttribute('data-end', '2027-01-07');
  // Clicking the last day before the first works too; Escape cancels the picker, not the editor.
  await dates.click();
  await picker.locator('[data-day="2027-01-15"]').click();
  await picker.locator('[data-day="2027-01-11"]').click();
  await expect(dates).toHaveAttribute('data-start', '2027-01-11');
  await expect(dates).toHaveAttribute('data-end', '2027-01-15');
  await dates.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dates).toHaveAttribute('data-start', '2027-01-11');
});

test('tooltips are the app own ones, also above the editor, and Escape dismisses them', async ({ page, isMobile }) => {
  test.skip(isMobile, 'hover');
  const tip = page.getByRole('tooltip');
  // The page first jumps to today, and scrolling hides tooltips; hover again until it settles.
  await expect(async () => {
    await page.mouse.move(0, 0); // a fresh hover each try
    await cell(page, '2027-01-06').hover();
    await expect(tip).toHaveText('Boboteaza', { timeout: 1000 });
  }).toPass();
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
});
