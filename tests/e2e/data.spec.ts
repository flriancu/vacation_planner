import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

// The plan's data (IO-2, IO-4): a copy saved and added back, and the calendar file.
test.skip(({ isMobile }) => isMobile, 'Settings sits in the ⋯ menu on phones; the same dialogs');

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2027-03-01T10:00:00') });
  await page.goto('./');
  await expect(page.getByRole('grid')).toBeVisible();
});

const cell = (page: Page, date: string) => page.locator(`[data-date="${date}"]`);

async function addLeave(page: Page, from: string, to: string, status: string, note = '') {
  await cell(page, from).click();
  await cell(page, to).click();
  const dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  await dialog.getByRole('radio', { name: status }).check();
  if (note) await dialog.getByLabel('Notă').fill(note);
  await dialog.getByRole('button', { name: 'Salvează' }).click();
  await expect(dialog).toBeHidden();
}

async function settingsAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'Setări' }).click();
  await page.getByRole('button', { name }).click();
}

test('a saved copy of the plan can be added back', async ({ page }) => {
  await addLeave(page, '2027-03-08', '2027-03-10', 'Planificat', 'zbor la 6');
  const saving = page.waitForEvent('download');
  await settingsAction(page, 'Salvează o copie a planului');
  const file = await (await saving).path();
  const copy = JSON.parse(await readFile(file, 'utf8')) as {
    schemaVersion: number;
    blocks: Record<string, { start: string; note?: string }>;
  };
  expect(copy.schemaVersion).toBe(1);
  expect(Object.values(copy.blocks).map((b) => [b.start, b.note])).toEqual([['2027-03-08', 'zbor la 6']]);

  // Delete the leave, then add the copy back.
  await cell(page, '2027-03-09').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Șterge' }).click();
  await expect(cell(page, '2027-03-09')).not.toHaveClass(/fill-planned/);
  const choosing = page.waitForEvent('filechooser');
  await settingsAction(page, 'Adaugă dintr-o copie…');
  await (await choosing).setFiles(file);
  const preview = page.getByRole('dialog', { name: 'Adaugă dintr-o copie' });
  // A copy adds only what is new: the leave I deleted since doesn't come back, and it says why.
  await expect(preview).toContainText('Nu e nimic nou de adăugat din această copie.');
  await expect(preview).toContainText('Nu se adaugă: deja în planul tău sau șterse din el: 1.');
  await expect(preview.getByRole('button', { name: 'Adaugă la planul meu' })).toBeDisabled();
  // Closed, it gives the focus back to Settings, and the menu isn't left open behind it.
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  await expect(page.getByRole('button', { name: 'Setări' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Salvează o copie a planului' })).toBeHidden();
});

test('a copy is added to a plan that never had it', async ({ page }) => {
  const choosing = page.waitForEvent('filechooser');
  await settingsAction(page, 'Adaugă dintr-o copie…');
  const plan = {
    schemaVersion: 1,
    owner: { googleSub: 'someone' },
    settings: { lang: 'ro', updatedAt: '2026-01-01T00:00:00.000Z' },
    people: {
      p: {
        id: 'p',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        name: 'X',
        color: '#000',
        hasAccount: true,
      },
    },
    leaveTypes: {
      t: {
        id: 't',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        key: 'annual',
        name: { ro: 'Concediu de odihnă', en: 'Annual leave' },
        color: '#e05a9a',
        budget: 'annual',
        needsApproval: true,
      },
    },
    blocks: {
      h: {
        id: 'h',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        personId: 'p',
        typeId: 't',
        start: '2027-04-26',
        end: '2027-04-30',
        status: 'approved',
      },
    },
  };
  await (await choosing).setFiles({ name: 'copie.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) });
  await page.getByRole('dialog').getByRole('button', { name: 'Adaugă la planul meu' }).click();
  await expect(cell(page, '2027-04-28')).toHaveClass(/fill-approved/);
});

test('a file that is not a plan says so', async ({ page }) => {
  const choosing = page.waitForEvent('filechooser');
  await settingsAction(page, 'Adaugă dintr-o copie…');
  await (await choosing).setFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
  await expect(page.getByText('Fișierul nu e o copie a unui plan. E un fișier JSON, dar nu e un plan.')).toBeVisible();
});

test('the year exports as a calendar file, planned and approved by default', async ({ page }) => {
  await addLeave(page, '2027-03-08', '2027-03-10', 'Aprobat');
  await addLeave(page, '2027-03-22', '2027-03-22', 'Idee');
  await settingsAction(page, 'Exportă în calendar (.ics)…');
  const dialog = page.getByRole('dialog', { name: 'Exportă în calendar' });
  await expect(dialog).toContainText('În fișier: un concediu.');
  const saving = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Descarcă' }).click();
  const download = await saving;
  expect(download.suggestedFilename()).toBe('concedii-2027.ics');
  const ics = await readFile(await download.path(), 'utf8');
  expect(ics).toContain('DTSTART;VALUE=DATE:20270308');
  expect(ics).toContain('DTEND;VALUE=DATE:20270311');
  expect(ics).toContain('SUMMARY:Concediu de odihnă');
  expect(ics).not.toContain('20270322');
  await dialog.getByRole('checkbox', { name: 'Idee' }).check();
  await expect(dialog).toContainText('În fișier: 2 concedii.');
});
