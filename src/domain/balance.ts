import { blockBudget, buildDays } from './calendar';
import { makeDate, yearEnd, yearStart, type ISODate } from './dates';
import { getYearSettings, live, type PlanDoc } from './schema';

export interface BudgetBalance {
  total: number;
  /** Approved working days before today. */
  used: number;
  /** Planned working days, plus approved ones from today on. */
  reserved: number;
  available: number;
  /** Working days covered only by ideas. */
  ideas: number;
  /** `available` if every idea were accepted. */
  ifIdeas: number;
}

export interface TypeTotals {
  used: number;
  reserved: number;
  ideas: number;
}

export interface YearBalance {
  year: number;
  annual: BudgetBalance & { opening: number; adjustments: number };
  floating: BudgetBalance & { quota: number };
  excused: BudgetBalance & { quota: number };
  /** Working days per leave type id (LT-5). */
  byType: Record<string, TypeTotals>;
  /** BAL-4: more booked than available. */
  overbooked: { annual: boolean; floating: boolean; excused: boolean };
  /** BAL-6: expiring days (floating, excused) still unplaced from 1 October on. */
  expiring: { floating: boolean; excused: boolean };
}

/**
 * Balances of one person for one calendar year (BAL-*, LT-6).
 *
 * Accounting is per working day, not per block: a day covered by several blocks
 * is charged once, to its highest-status block, so ideas that overlap planned
 * leave are never counted twice.
 */
export function yearBalance(doc: PlanDoc, personId: string, year: number, today: ISODate): YearBalance {
  const settings = getYearSettings(doc, personId, year);
  const opening = settings?.annualOpening ?? 0;
  const floatingQuota = settings?.floatingQuota ?? 0;
  const excusedQuota = settings?.excusedQuota ?? 0;
  const adjustments = live(doc.adjustments)
    .filter((a) => a.personId === personId && a.year === year)
    .reduce((sum, a) => sum + a.days, 0);

  const charged = { annual: zero(), floating: zero(), excused: zero() };
  const byType: Record<string, TypeTotals> = {};

  for (const day of buildDays(doc, personId, yearStart(year), yearEnd(year)).values()) {
    if (day.base !== 'work') continue;
    const block = day.blocks[0]; // highest status first
    if (!block) continue;
    const bucket: keyof TypeTotals =
      block.status === 'idea' ? 'ideas' : block.status === 'approved' && day.date < today ? 'used' : 'reserved';
    (byType[block.typeId] ??= zero())[bucket]++;
    const budget = blockBudget(doc, block, year);
    if (budget !== 'none') charged[budget][bucket]++;
  }

  const annual = finish(opening + adjustments, charged.annual);
  const floating = finish(floatingQuota, charged.floating);
  const excused = finish(excusedQuota, charged.excused);
  const lateInYear = today >= makeDate(year, 10, 1) && today <= yearEnd(year);
  return {
    year,
    annual: { ...annual, opening, adjustments },
    floating: { ...floating, quota: floatingQuota },
    excused: { ...excused, quota: excusedQuota },
    byType,
    overbooked: { annual: annual.available < 0, floating: floating.available < 0, excused: excused.available < 0 },
    expiring: { floating: lateInYear && floating.available > 0, excused: lateInYear && excused.available > 0 },
  };
}

function zero(): TypeTotals {
  return { used: 0, reserved: 0, ideas: 0 };
}

function finish(total: number, c: TypeTotals): BudgetBalance {
  const available = total - c.used - c.reserved;
  return { total, used: c.used, reserved: c.reserved, available, ideas: c.ideas, ifIdeas: available - c.ideas };
}
