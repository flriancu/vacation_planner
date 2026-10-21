import { DocBuilder } from './builder';

/**
 * A made-up plan for 2027, used instead of anyone's real data (NF-7).
 * Only the public holidays are real.
 *
 * Weekend holidays in 2027 and what the fictional person did with them:
 * - Sat 2 Jan: Friday 1 Jan is itself a holiday, so the swap went on Mon 4 Jan.
 * - Sun 24 Jan: still open (Fri 22 or Mon 25).
 * - Sat 1 May: Good Friday and Easter Monday surround it, so there is no option at all.
 * - Sun 15 Aug: swap on Mon 16 Aug.
 * - Sat 25 Dec: swap on Fri 24 Dec.
 * - Sun 26 Dec: dismissed (HR gave a floating day instead).
 * Plus employer bridge days 28–31 Dec and one of two floating days on Mon 31 May.
 */
export function demo2027(): DocBuilder {
  const b = new DocBuilder();
  b.year(2027, { annualOpening: 21, floatingQuota: 2 });

  b.block('swap', '2027-01-04', '2027-01-04', 'approved', { swapFor: '2027-01-02' });
  b.block('swap', '2027-08-16', '2027-08-16', 'approved', { swapFor: '2027-08-15' });
  b.block('swap', '2027-12-24', '2027-12-24', 'approved', { swapFor: '2027-12-25' });
  b.dismissSwap('2027-12-26');

  b.block('employer', '2027-12-28', '2027-12-31');
  b.block('floating', '2027-05-31', '2027-05-31', 'planned');
  return b;
}
