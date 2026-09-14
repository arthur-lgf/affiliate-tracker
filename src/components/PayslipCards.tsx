import { TableScroller } from './TableScroller';
import { formatMoney } from '@/lib/analytics';
import { cardCount, type PayslipLine } from '@/lib/payslip-view';

/**
 * The ruled table of cards on a payslip, and the total under them.
 *
 * Its own component rather than markup inside the payslip page, because the
 * page reads the viewer before it draws anything, which a render outside a
 * Next request cannot do. Taking the lines and the total as props is what lets
 * scripts/payslip-cards-render-checks.tsx draw it at every width it is read at.
 *
 * The total is the request's own, fixed when it was made, and never a sum taken
 * here: it is the figure that was asked for, and the one a payment is checked
 * against.
 */
export function PayslipCards({ lines, total }: { lines: PayslipLine[]; total: number }) {
  return (
    /* The window every other wide table in this feature uses: one a keyboard
       can reach and scroll with the arrow keys, with buttons of its own if it
       ever overflows. Those buttons belong to the screen, not the document, so
       they stay off paper. */
    <TableScroller className="mt-3" label="Cards on this request" controlsClassName="no-print">
      {/*
        Three columns from sm up. Below it the customer goes under the card and
        the amount keeps a column of its own, so a phone shows every figure
        without scrolling sideways for it. The words that move are written once
        for each width, and each copy is display:none at the other, so a screen
        reader reads them once.

        Paper always gets the three columns, whatever size it is. Letter or A4
        at the browser's usual scale is wider than sm, but A5 is not, and nor is
        either one printed at a larger scale, and a payslip printed from a phone
        should not come out looking like a phone. So every column and line that
        changes at sm has a print: beside it.

        The minimum width does not. A window that scrolls on a screen is cut off
        on paper, so a sheet narrower than the table would lose its right-hand
        edge, and the right-hand edge is the amounts. That is also why a card
        name is never allowed to hold the table open: see the card's cell.
      */}
      <table className="w-full border-collapse text-left sm:min-w-[480px]">
        <thead>
          <tr className="border-y border-edge bg-paper-card">
            <th scope="col" className="label-cap px-3 py-2.5">
              Card
            </th>
            <th scope="col" className="label-cap hidden px-3 py-2.5 sm:table-cell print:table-cell">
              Customer
            </th>
            <th scope="col" className="label-cap px-3 py-2.5 text-right">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key} className="divider-row">
              {/* A name with no spaces in it, such as a slug with no campaign
                  behind it, breaks where it has to, at every width and on
                  paper. Left whole it does not fit: on a phone it pushes the
                  amount off the edge, from sm up it runs over the customer
                  beside it, and on a narrow sheet, A5 for one, it pushes the
                  amounts off the paper, where no scrolling brings them back. A
                  name with spaces in it still breaks at its spaces. */}
              <td className="max-w-[260px] px-3 py-2.5 align-top text-[13px] font-medium text-ink wrap-anywhere">
                {line.card}
                <span className="mt-0.5 block text-[12px] font-normal text-ink-soft sm:hidden print:hidden">
                  {line.customer}
                </span>
              </td>
              <td className="hidden max-w-[220px] px-3 py-2.5 align-top text-[12px] text-ink-soft sm:table-cell print:table-cell">
                {line.customer}
              </td>
              <td className="tnum whitespace-nowrap px-3 py-2.5 align-top text-right text-[13px] font-semibold text-ink">
                {formatMoney(line.amount)}
              </td>
            </tr>
          ))}
        </tbody>
        {/* A table that runs onto a second sheet repeats its footer at the foot
            of every sheet, the way it repeats its headings at the top. The
            headings are welcome there. The total is not, because the first
            sheet would show it under only some of the cards. On paper the
            footer is an ordinary group of rows, so it prints once, after the
            last card. */}
        <tfoot className="print:table-row-group">
          <tr className="border-t-2 border-edge-strong">
            <th scope="row" className="px-3 py-3 text-left text-[13px] font-semibold text-ink">
              Total requested
              <span className="mt-0.5 block text-[12px] font-normal text-ink-dim sm:hidden print:hidden">
                {cardCount(lines.length)}
              </span>
            </th>
            <td className="hidden px-3 py-3 text-[12px] text-ink-dim sm:table-cell print:table-cell">
              {cardCount(lines.length)}
            </td>
            <td className="tnum mark whitespace-nowrap px-3 py-3 text-right text-[16px] font-semibold text-ink">
              {formatMoney(total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </TableScroller>
  );
}
