import { expect, test, type Page } from '@playwright/test';
import { FakeDrive } from './fakeDrive';

// Following someone's shared plan (PPL-3) and their line under my days (PPL-4), against a fake
// Drive and a fake Google picker.
test.skip(({ isMobile }) => isMobile, 'the same panel sits in the Legend toggle on phones');

const cell = (page: Page, date: string) => page.locator(`[data-date="${date}"]`);
const STAMP = '2027-01-01T00:00:00.000Z';

/** A made-up plan of Mihai's: approved 8–12 March, an idea on 22–23 March. */
function mihaisPlan() {
  const meta = { createdAt: STAMP, updatedAt: STAMP };
  const block = (id: string, start: string, end: string, status: string) => ({
    id,
    ...meta,
    personId: 'm',
    typeId: 't',
    start,
    end,
    status,
  });
  return {
    schemaVersion: 1,
    owner: { googleSub: 'mihai' },
    settings: { lang: 'ro', updatedAt: STAMP },
    people: { m: { id: 'm', ...meta, name: 'Mihai', color: '#000', hasAccount: true } },
    leaveTypes: {
      t: {
        id: 't',
        ...meta,
        key: 'annual',
        name: { ro: 'Concediu de odihnă', en: 'Annual leave' },
        color: '#e05a9a',
        budget: 'annual',
        needsApproval: true,
      },
    },
    blocks: { a: block('a', '2027-03-08', '2027-03-12', 'approved'), b: block('b', '2027-03-22', '2027-03-23', 'idea') },
  };
}

async function open(page: Page, drive: FakeDrive) {
  await page.clock.install({ time: new Date('2027-03-01T10:00:00') });
  await drive.attach(page);
  await page.goto('./');
  await expect(page.getByRole('grid')).toBeVisible();
}

async function follow(page: Page, id: string) {
  await page.evaluate((pick) => ((window as unknown as { fakePick: unknown }).fakePick = pick), { id, name: 'vacation-planner.json' });
  await page.getByRole('button', { name: 'Urmărește un plan…' }).click();
}

test('a followed plan shows as a line under my days, named in the legend and the tooltip', async ({ page }) => {
  const drive = new FakeDrive();
  const mihai = drive.addShared(mihaisPlan());
  await open(page, drive);
  await expect(page.getByText('Nu urmărești planul nimănui.')).toBeVisible();
  await follow(page, mihai);

  const panel = page.locator('.people');
  await expect(panel).toContainText('Mihai');
  await expect(panel).toContainText('linia 1');
  await expect(cell(page, '2027-03-10').locator('.line.st-approved')).toHaveCount(1);
  await expect(cell(page, '2027-03-08').locator('.line.start')).toHaveCount(1);
  await expect(cell(page, '2027-03-22').locator('.line.st-idea')).toHaveCount(1);
  await expect(cell(page, '2027-03-10')).toHaveAttribute('data-tip', /Mihai: Concediu de odihnă \(aprobat\)/);

  // My leave on the same days: everyone is off, and it's all approved.
  await cell(page, '2027-03-09').click();
  await cell(page, '2027-03-11').click();
  const dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  await dialog.getByRole('radio', { name: 'Aprobat' }).check();
  await dialog.getByRole('button', { name: 'Salvează' }).click();
  await expect(cell(page, '2027-03-10').locator('.together.st-approved')).toHaveCount(1);
  await expect(cell(page, '2027-03-10')).toHaveAttribute('data-tip', /Toți cei afișați și tu sunteți liberi/);
  await expect(cell(page, '2027-03-08').locator('.together')).toHaveCount(0); // I work that day

  // Switched off: no line, still followed, and it syncs (it's in my plan).
  await panel.getByRole('checkbox').uncheck();
  await expect(cell(page, '2027-03-10').locator('.line')).toHaveCount(0);
  await expect(panel).toContainText('ascuns');
  await expect.poll(() => Object.values(drive.content().following as Record<string, { hidden?: boolean }>)[0]?.hidden).toBe(true);
});

test('a plan that stops being readable says so and is no longer drawn', async ({ page }) => {
  const drive = new FakeDrive();
  const mihai = drive.addShared(mihaisPlan());
  await open(page, drive);
  await follow(page, mihai);
  await expect(cell(page, '2027-03-10').locator('.line.st-approved')).toHaveCount(1);
  drive.files.delete(mihai); // sharing stopped
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.people')).toContainText('nu se poate citi: nu mai e împărțit cu tine sau a fost șters');
  await expect(cell(page, '2027-03-10').locator('.line.st-approved')).toHaveCount(0);
});

test('"everyone off" is said only when every plan shown has loaded', async ({ page }) => {
  const drive = new FakeDrive();
  const mihai = drive.addShared(mihaisPlan());
  await open(page, drive);
  await cell(page, '2027-03-09').click();
  await cell(page, '2027-03-11').click();
  const dialog = page.getByRole('dialog', { name: 'Concediu nou' });
  await dialog.getByRole('radio', { name: 'Aprobat' }).check();
  await dialog.getByRole('button', { name: 'Salvează' }).click();
  await follow(page, mihai);
  await expect(cell(page, '2027-03-10').locator('.together')).toHaveCount(1);
  await follow(page, 'shared-404'); // a plan that can't be read: nobody knows if they are off
  await expect(page.locator('.people')).toContainText('nu se poate citi');
  await expect(cell(page, '2027-03-10').locator('.together')).toHaveCount(0);
  await expect(cell(page, '2027-03-10')).not.toHaveAttribute('data-tip', /liberi/);
});

test('two quick clicks on "Follow" follow the plan once, and an unfollow can be undone', async ({ page }) => {
  const drive = new FakeDrive();
  const mihai = drive.addShared(mihaisPlan());
  await open(page, drive);
  await page.evaluate((pick) => ((window as unknown as { fakePick: unknown }).fakePick = pick), {
    id: mihai,
    name: 'vacation-planner.json',
  });
  await page.getByRole('button', { name: 'Urmărește un plan…' }).dblclick();
  const panel = page.locator('.people');
  await expect(panel).toContainText('linia 1');
  await expect(panel.getByRole('listitem').filter({ hasText: 'Mihai' })).toHaveCount(1);
  await panel.getByRole('button', { name: /Nu mai urmări planul lui Mihai/ }).click();
  await expect(page.getByText('Nu mai urmărești planul lui Mihai.')).toBeVisible();
  await page.getByRole('button', { name: 'Anulează' }).click();
  await expect(panel).toContainText('linia 1');
});

test('a copy of my own plan shared back to me is not drawn as someone else', async ({ page }) => {
  const drive = new FakeDrive();
  const copy = drive.addShared({ ...mihaisPlan(), owner: { googleSub: 'u1' } });
  await open(page, drive);
  await follow(page, copy);
  await expect(page.locator('.people')).toContainText('e tot planul tău');
  await expect(cell(page, '2027-03-10').locator('.line.st-approved')).toHaveCount(0);
});

test('my own plan is not followed', async ({ page }) => {
  const drive = new FakeDrive();
  await open(page, drive);
  const mine = [...drive.files.keys()][0]!;
  await follow(page, mine);
  await expect(page.locator('.people')).toContainText('Acesta e planul tău.');
});

test('sharing my plan: add someone, see them, stop', async ({ page }) => {
  const drive = new FakeDrive();
  await open(page, drive);
  await page.getByRole('button', { name: 'Setări' }).click();
  await page.getByRole('button', { name: 'Împarte planul…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Împarte planul' });
  await expect(dialog).toContainText('Planul nu e împărțit cu nimeni.');
  await dialog.getByLabel('Adresa de e-mail').fill('mihai@example.test');
  await dialog.getByRole('button', { name: 'Împarte', exact: true }).click();
  await expect(dialog).toContainText('Gata: mihai@example.test îți poate vedea planul.');
  await expect(dialog.locator('.shares')).toContainText('mihai@example.test');
  const file = [...drive.files.keys()][0]!;
  expect(drive.shares.get(file)).toEqual([{ id: 'perm-1', emailAddress: 'mihai@example.test' }]);
  await dialog.getByRole('button', { name: 'Nu mai împărți planul cu mihai@example.test' }).click();
  await expect(dialog).toContainText('Planul nu e împărțit cu nimeni.');
});
