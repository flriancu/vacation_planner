import { expect, test, type Page } from '@playwright/test';
import { FakeDrive } from './fakeDrive';

// Signed in, against a fake Drive (fakeDrive.ts): the saving and loading paths.
test.skip(({ isMobile }) => isMobile, 'storage, not layout: desktop is enough');

const cell = (page: Page, date: string) => page.locator(`[data-date="${date}"]`);

async function open(page: Page, drive: FakeDrive) {
  await page.clock.install({ time: new Date('2027-03-01T10:00:00') });
  await drive.attach(page);
  page.on('dialog', (d) => void d.accept()); // "leave the page?" while a save is pending
  await page.goto('./');
  await expect(page.getByRole('grid')).toBeVisible();
}

async function addPlanned(page: Page, from: string, to: string) {
  await cell(page, from).click();
  await cell(page, to).click();
  const dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  await dialog.getByRole('radio', { name: 'Planificat' }).check();
  await dialog.getByRole('button', { name: 'Salvează' }).click();
  await expect(dialog).toBeHidden();
}

const savedStarts = (drive: FakeDrive) =>
  Object.values((drive.content()?.blocks ?? {}) as Record<string, { start: string; deleted?: boolean }>)
    .filter((b) => !b.deleted)
    .map((b) => b.start);

test('an edit survives a reload right after it, and reaches Drive', async ({ page }) => {
  const drive = new FakeDrive();
  await open(page, drive);
  await addPlanned(page, '2027-03-08', '2027-03-10');
  await page.reload(); // well inside the 1.5 s before the save
  await expect(cell(page, '2027-03-09')).toHaveClass(/fill-planned/);
  await expect.poll(() => savedStarts(drive)).toEqual(['2027-03-08']);
});

test('a failed save says so, offers to try again, and then saves', async ({ page }) => {
  const drive = new FakeDrive();
  await open(page, drive);
  drive.failWrites = 1000;
  await addPlanned(page, '2027-03-08', '2027-03-10');
  const retry = page.getByRole('button', { name: /Nu s-a salvat · Reîncearcă/ });
  await expect(retry).toBeVisible();
  drive.failWrites = 0;
  await retry.click();
  await expect(page.getByRole('banner').getByText('Salvat')).toBeVisible();
  expect(savedStarts(drive)).toEqual(['2027-03-08']);
});

test('a plan file with entries this version cannot read still opens, and keeps them', async ({ page }) => {
  // A file as another device would have written it, with one block this app can't use.
  const seedDrive = new FakeDrive();
  await open(page, seedDrive);
  await addPlanned(page, '2027-03-08', '2027-03-10');
  await expect.poll(() => savedStarts(seedDrive)).toEqual(['2027-03-08']);
  const file = structuredClone(seedDrive.content()) as { blocks: Record<string, Record<string, unknown>> };
  const good = Object.values(file.blocks)[0]!;
  file.blocks.odd = { ...good, id: 'odd', status: 'tentative', start: '2027-04-05', end: '2027-04-05' };

  const drive = new FakeDrive(file);
  const next = await page.context().newPage();
  await open(next, drive);
  await expect(cell(next, '2027-03-09')).toHaveClass(/fill-planned/);
  await expect(next.getByText(/nu pot fi citite de această versiune \(1\)/)).toBeVisible();
  // Saving something else keeps the unreadable entry in the file, untouched.
  await addPlanned(next, '2027-03-22', '2027-03-22');
  await expect.poll(() => savedStarts(drive).sort()).toEqual(['2027-03-08', '2027-03-22', '2027-04-05']);
  expect((drive.content().blocks as Record<string, { status: string }>).odd!.status).toBe('tentative');
});

test('a block that already breaks a rule (from another device) can still take a note, but no new dates or status', async ({ page }) => {
  const drive = new FakeDrive();
  await open(page, drive);
  await cell(page, '2027-03-10').click();
  await cell(page, '2027-03-11').click();
  await page.getByRole('dialog', { name: 'Concediu nou' }).getByRole('button', { name: 'Salvează' }).click(); // an idea
  await addPlanned(page, '2027-03-08', '2027-03-12'); // planned leave may cover an idea
  await expect.poll(() => savedStarts(drive).length).toBe(2);
  // Another device made that idea planned: now two planned blocks overlap.
  const blocks = drive.content().blocks as Record<string, { start: string; status: string; updatedAt: string }>;
  const other = Object.values(blocks).find((b) => b.start === '2027-03-10')!;
  other.status = 'planned';
  other.updatedAt = '2027-03-02T00:00:00.000Z'; // later than this device's own copy of it
  [...drive.files.values()][0]!.version++;
  await page.reload();
  await page.locator('[data-date="2027-03-10"] .outline').nth(1).waitFor();

  await cell(page, '2027-03-08').click();
  const edit = page.getByRole('dialog', { name: 'Editează concediul' });
  await edit.getByLabel('Notă').fill('zbor');
  await expect(edit.getByRole('button', { name: 'Salvează' })).toBeEnabled();
  await edit.getByRole('radio', { name: 'Aprobat' }).check();
  await expect(edit.getByRole('button', { name: 'Salvează' })).toBeDisabled();
  await expect(edit.getByText('Se suprapune cu alt concediu')).toBeVisible();
});

test('only one header menu is open at a time', async ({ page }) => {
  await open(page, new FakeDrive());
  await page.getByRole('button', { name: 'Setări' }).click();
  await page.getByRole('button', { name: /^Cont:/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu-panel')).toHaveCount(1);
  await expect(page.locator('.menu-panel')).toContainText('ana@example.test');
});

test('signing out from the load-error screen keeps changes that never reached Drive', async ({ page }) => {
  const drive = new FakeDrive();
  await open(page, drive);
  drive.failWrites = 1000;
  await addPlanned(page, '2027-03-08', '2027-03-10'); // saved on this device only
  await expect(page.getByRole('button', { name: /Nu s-a salvat/ })).toBeVisible();
  drive.failLists = 1000;
  await page.reload();
  await page.getByRole('button', { name: 'Deconectare' }).click();
  const copy = await page.evaluate(() => localStorage.getItem('vacation-planner.replica.u1'));
  expect(copy).toContain('2027-03-08');
  expect(JSON.parse(copy!).unsaved).toBe(true);
});
