// What the Worker and the seed script agree on (the synthetic household).
import { buildCategorySlots } from '../vendor/core/categories.js';

export const CATS = ['Food & Beverages', 'Belanja Harian', 'Transportasi & Bensin', 'Langganan Digital', 'Hobi', 'Kesehatan & Optik', 'Tagihan & Utilitas', 'Skincare', 'Barber'];
export const CONFIG = { owner_name: 'Me', partner_name: 'Dewi', partner_email: 'x@example.com', start_date: '2026-09-01', payday_day: 28 };
export const SLOTS = buildCategorySlots({ income: ['Gaji'], expense: CATS });
export const SALARY_CATEGORY = 'Gaji';
export const ACCOUNTS = ['BCA', 'GoPay', 'BRI Dewi', 'OVO', 'Mandiri', 'Jago', 'blu'].map((stream, i) => ({ stream, type: 'Spending', owner: i % 2 ? 'Dewi' : 'Me', institution: stream, match_hint: '', opening_balance: i * 100000 }));
export const OWNERS = ['', 'Me', 'Dewi'];
