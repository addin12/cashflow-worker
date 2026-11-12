// The asset and debt list for the yearly tax return (SPT Tahunan, "Daftar Harta" and "Daftar Utang"):
// accounts at 31 December and the Aset tab, each with its SPT code. A starting point to copy from,
// not tax advice: the form asks for the purchase price (harga perolehan) of most things, which only
// the owner knows when "Harga beli" is empty.

const num = (v) => Number(v) || 0;
const round2 = (n) => Math.round(n * 100) / 100;

/** SPT codes (kode harta / kode utang) and their names. */
const SPT_CODES = {
  '011': 'Uang tunai', '012': 'Tabungan', '014': 'Deposito', '019': 'Setara kas lainnya', '021': 'Piutang',
  '032': 'Saham', '034': 'Obligasi pemerintah (SBN)', '036': 'Reksa dana', '039': 'Investasi lainnya',
  '042': 'Sepeda motor', '043': 'Mobil', '049': 'Alat transportasi lainnya', '051': 'Logam mulia',
  '053': 'Barang seni dan antik', '055': 'Peralatan elektronik dan furnitur', '059': 'Harta bergerak lainnya',
  '061': 'Tanah dan/atau bangunan untuk tempat tinggal', '101': 'Utang bank / lembaga keuangan bukan bank', '102': 'Kartu kredit',
  '109': 'Utang lainnya',
};

const WALLET = /gopay|ovo|\bdana\b|shopee|linkaja|e-?wallet|flip|jenius pay/i;
function accountCode(name) {
  if (/cash|tunai|dompet/i.test(name)) return '011';
  if (/deposito/i.test(name)) return '014';
  if (/saham|sekuritas|rdn/i.test(name)) return '032';
  if (WALLET.test(name) && !/darurat/i.test(name)) return '019';
  return '012';
}
const ASSET_CODES = {
  property: '061', gold: '051', stock: '032', fund: '036', bond: '034', deposit: '014', pension: '039', crypto: '039',
  goods: '055', collectible: '053', receivable: '021', other: '059',
};
function assetCode(a) {
  if (a.kind === 'vehicle') return /mobil|car/i.test(a.name) ? '043' : /motor/i.test(a.name) ? '042' : '049';
  if (a.kind === 'debt') return /kartu kredit|credit card/i.test(a.name) ? '102' : /bank|kpr|kta|leasing|cicilan|pinjol|kredit/i.test(a.name) ? '101' : '109';
  if (a.kind === 'paylater') return /kartu kredit|credit card/i.test(a.name) ? '102' : '101';
  return ASSET_CODES[a.kind] || '059';
}

/**
 * @param {{balances: {stream, balance}[], assets: object[], year: number, asOf: string}} input
 *   balances as of `asOf` (31 December, or today while the year runs)
 * @returns {{year, asOf, harta: {code, label, name, value, cost}[], utang: {code, label, name, value}[], totalHarta, totalUtang}}
 *   value: what it is worth now; cost: the purchase price when known (null: fill it in)
 */
export function sptList({ balances, assets, year, asOf }) {
  const harta = [];
  const utang = [];
  for (const b of balances) {
    if (b.balance < 0) utang.push({ code: '102', name: b.stream, value: round2(-b.balance) });
    else if (b.balance > 0) { const code = accountCode(b.stream); harta.push({ code, name: b.stream, value: round2(b.balance), cost: round2(b.balance) }); }
  }
  for (const a of assets) {
    const value = round2(num(a.qty === '' || a.qty == null ? 1 : a.qty) * (num(a.price) > 0 ? num(a.price) : num(a.unit_value)));
    const code = assetCode(a);
    if (a.kind === 'debt' || a.kind === 'paylater') utang.push({ code, name: a.name, value });
    else harta.push({ code, name: a.name, value, cost: num(a.paid) > 0 ? round2(num(a.paid)) : null });
  }
  const label = (x) => ({ ...x, label: SPT_CODES[x.code] });
  const byCode = (a, b) => a.code.localeCompare(b.code) || b.value - a.value;
  return {
    year, asOf, harta: harta.sort(byCode).map(label), utang: utang.sort(byCode).map(label),
    totalHarta: round2(harta.reduce((t, x) => t + x.value, 0)), totalUtang: round2(utang.reduce((t, x) => t + x.value, 0)),
  };
}
