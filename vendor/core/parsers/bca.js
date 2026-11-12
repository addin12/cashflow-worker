// myBCA "Internet Transaction Journal" and "Cash Withdrawal Successful" (English, "| Label | : | Value |" table, or one label and value per line).
import { parseDateTime, trailingDigits } from '../money.js';
import { valueAfter, firstValue } from '../text.js';
import { ok, skip, amountOf, feeOf, remark, joinDetails, institutionOf } from './common.js';

const LABELS = [
  'Status', 'Transaction Date', 'Transaction Type', 'Transfer Type', 'Payment to', 'Merchant Location',
  'Acquirer', 'Merchant PAN', 'Terminal ID', 'Source of Fund', 'Customer PAN', 'Total Payment', 'RRN',
  'Reference No.', 'Source Currency', 'Beneficiary Account', 'Transfer Currency', 'Beneficiary Name',
  'Save to Beneficiary List', 'Transfer Amount', 'Remarks', 'Beneficiary Bank', 'Beneficiary Account No.',
  'Amount', 'Fee', 'Transfer Method', 'Transaction Purpose', 'Pocket Name', 'Purpose', 'Category',
  'Pocket Account No.', 'Initial Deposit', 'Target', 'Source Pocket', 'Source Pocket Account No.',
  'BCA Virtual Account No.', 'Name', 'Company/Product Name', 'Bill Total', 'Description', 'Phone No.', 'ATM Code',
];

export const bca = {
  id: 'bca',
  matches: (m) => /@bca\.co\.id$/i.test(m.from) && /Transaction Journal|Cash Withdrawal/i.test(m.subject),
  parse(m) {
    const t = m.tokens;
    const get = (l) => valueAfter(t, l, LABELS);
    const status = get('Status');
    if (/pocket creation/i.test(status)) return skip('pocket created (money stays inside BCA)');
    if (!/success/i.test(status)) return skip(`status "${status || 'unknown'}"`);
    const when = parseDateTime(get('Transaction Date'));
    if (!when) throw new Error('no transaction date');
    const refNo = get('Reference No.');

    if (/transfer pocket/i.test(status)) {
      // Money leaving a BCA pocket. To the owner's own BCA account it is internal; sync decides.
      return ok({
        type: 'transfer', direction: 'out', ...when, amount: amountOf(get('Amount')), fee: 0,
        account: { institution: 'BCA', pocket: get('Source Pocket') },
        counterparty: { name: get('Beneficiary Name'), institution: 'BCA', account: get('Beneficiary Account').replace(/\D/g, '') },
        description: get('Beneficiary Name'), details: joinDetails('Pocket', get('Source Pocket')), refNo,
      });
    }

    const account = { institution: 'BCA', hint: trailingDigits(get('Source of Fund')) };
    const txType = get('Transaction Type');
    if (/qris/i.test(txType)) {
      const merchant = get('Payment to');
      return ok({
        type: 'payment', direction: 'out', ...when, amount: amountOf(get('Total Payment')), fee: 0, account,
        counterparty: { name: merchant }, description: merchant,
        details: joinDetails('QRIS', get('Merchant Location').split(',')[0]), refNo,
      });
    }

    const transferType = get('Transfer Type');
    if (/withdraw cash|cash withdrawal/i.test(`${transferType} ${m.subject}`)) {
      // Cardless cash from an ATM: money leaves the account, and no payee is named. It waits in Review for the person to say where it went.
      return ok({
        type: 'payment', direction: 'out', ...when, amount: amountOf(get('Amount')), fee: feeOf(get('Fee')), account,
        counterparty: { name: 'ATM' }, cash: true, description: 'Tarik tunai ATM', details: joinDetails('Cardless', get('ATM Code')), refNo,
      });
    }
    if (/virtual account/i.test(transferType)) {
      // Paying a bill/order through a BCA Virtual Account. "Name" is the account holder (often
      // the owner), so the payee is the company/product, never "Name".
      const company = get('Company/Product Name');
      const product = company.split('/').pop().trim() || company || 'Virtual Account';
      const bill = amountOf(firstValue(t, ['Bill Total', 'Total Payment'], LABELS));
      const total = feeOf(get('Total Payment'));
      return ok({
        type: 'payment', direction: 'out', ...when, amount: bill, fee: total > bill ? Math.round((total - bill) * 100) / 100 : 0, account,
        counterparty: { name: product }, description: product,
        details: joinDetails('Virtual Account', company.includes('/') ? company.split('/')[0].trim() : '', remark(get('Description'))), refNo,
      });
    }
    if (transferType) {
      const name = get('Beneficiary Name');
      const bank = get('Beneficiary Bank') || transferType.replace(/^Transfer to\s*/i, '').replace(/\s*Account$/i, '');
      const acct = (firstValue(t, ['Beneficiary Account No.', 'Beneficiary Account'], LABELS)).replace(/\D/g, '');
      return ok({
        type: 'transfer', direction: 'out', ...when,
        amount: amountOf(firstValue(t, ['Transfer Amount', 'Amount'], LABELS)), fee: feeOf(get('Fee')), account,
        counterparty: { name, institution: institutionOf(bank), account: acct },
        description: name, details: joinDetails(remark(get('Remarks')), get('Transfer Method')), refNo,
      });
    }
    return skip(`unknown BCA transaction type "${txType}"`);
  },
};
