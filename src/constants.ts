import type { DailyRevenue, Transaction } from './types';

function formatISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

const today = new Date();
today.setHours(0, 0, 0, 0);

export const MOCK_REVENUE_HISTORY: DailyRevenue[] = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(today);
  d.setDate(d.getDate() - (29 - i));
  return {
    date: formatISODate(d),
    revenue: randomBetween(12_000, 20_000),
    projected: false,
  };
});

export const MOCK_PROJECTED_REVENUE: DailyRevenue[] = Array.from({ length: 15 }, (_, i) => {
  const d = new Date(today);
  d.setDate(d.getDate() + (i + 1));
  return {
    date: formatISODate(d),
    revenue: randomBetween(12_000, 20_000),
    projected: true,
  };
});

export const INITIAL_TRANSACTIONS: Transaction[] = [
  {
    id: 'tx-1',
    type: 'payout',
    amount: 47_250,
    date: formatISODate(new Date(today.getFullYear(), today.getMonth() - 1, 5)),
    status: 'completed',
    description: 'Apple Sept Proceeds',
  },
  {
    id: 'tx-2',
    type: 'sales',
    amount: 3_842,
    date: formatISODate(new Date(today.getTime() - 2 * 86400000)),
    status: 'completed',
    description: 'Daily App Store Sales',
  },
  {
    id: 'tx-3',
    type: 'sales',
    amount: 4_110,
    date: formatISODate(new Date(today.getTime() - 86400000)),
    status: 'completed',
    description: 'Daily App Store Sales',
  },
  {
    id: 'tx-4',
    type: 'fee',
    amount: -120,
    date: formatISODate(new Date(today.getTime() - 86400000)),
    status: 'completed',
    description: 'Processing fee',
  },
];

export const ADVANCE_FEE_RATE = 0.03;
