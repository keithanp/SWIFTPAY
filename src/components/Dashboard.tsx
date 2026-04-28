import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ADVANCE_FEE_RATE, INITIAL_TRANSACTIONS, MOCK_PROJECTED_REVENUE, MOCK_REVENUE_HISTORY } from '../constants';
import { getFinancialInsights } from '../services/geminiService';
import type { FinancialState, Transaction } from '../types';
import {
  Activity,
  CheckCircle2,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Sparkles,
  TrendingUp,
  Wallet,
  Zap,
} from './Icons';

type DashboardProps = {
  onLogout: () => void;
  onHome: () => void;
};

function formatMoney(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const nextBulk = new Date();
nextBulk.setDate(nextBulk.getDate() + 38);

export function Dashboard({ onLogout, onHome }: DashboardProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [financials, setFinancials] = useState<FinancialState>({
    pendingAppleRevenue: 24_000,
    availableAdvance: 18_500,
    cashInBank: 42_200,
    totalAdvanced: 0,
  });
  const [transactions, setTransactions] = useState<Transaction[]>(INITIAL_TRANSACTIONS);
  const [modalOpen, setModalOpen] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState(5_000);
  const [advisorText, setAdvisorText] = useState<string | null>(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);

  const chartData = useMemo(() => {
    const map = new Map<string, { date: string; actual: number | null; projected: number | null }>();
    for (const row of MOCK_REVENUE_HISTORY) {
      map.set(row.date, { date: row.date, actual: row.revenue, projected: null });
    }
    for (const row of MOCK_PROJECTED_REVENUE) {
      const existing = map.get(row.date);
      if (existing) {
        existing.projected = row.revenue;
      } else {
        map.set(row.date, { date: row.date, actual: null, projected: row.revenue });
      }
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, []);

  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;
    setAdvisorLoading(true);
    setAdvisorText(null);
    void (async () => {
      try {
        const text = await getFinancialInsights(financials);
        if (!cancelled) setAdvisorText(text);
      } catch {
        if (!cancelled) {
          setAdvisorText('Unable to reach the advisor. Check your API key and try again.');
        }
      } finally {
        if (!cancelled) setAdvisorLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [financials, isConnected]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  const fee = Math.round(advanceAmount * ADVANCE_FEE_RATE * 100) / 100;
  const netAmount = Math.round((advanceAmount - fee) * 100) / 100;

  const handleConnect = () => {
    setConnecting(true);
    window.setTimeout(() => {
      setConnecting(false);
      setIsConnected(true);
    }, 2500);
  };

  const clampAdvance = (v: number) =>
    Math.min(Math.max(0, v), financials.availableAdvance);

  const handleConfirmAdvance = () => {
    const amount = clampAdvance(advanceAmount);
    if (amount <= 0) return;
    const f = Math.round(amount * ADVANCE_FEE_RATE * 100) / 100;
    const net = Math.round((amount - f) * 100) / 100;
    const tx: Transaction = {
      id: `tx-${Date.now()}`,
      type: 'advance',
      amount: net,
      date: new Date().toISOString().slice(0, 10),
      status: 'completed',
      description: 'Swiftpay advance (net deposit)',
    };
    const newAvailable = Math.round((financials.availableAdvance - amount) * 100) / 100;
    setTransactions((prev) => [tx, ...prev]);
    setFinancials((prev) => ({
      ...prev,
      cashInBank: Math.round((prev.cashInBank + net) * 100) / 100,
      availableAdvance: newAvailable,
      totalAdvanced: Math.round((prev.totalAdvanced + amount) * 100) / 100,
    }));
    setModalOpen(false);
    setAdvanceAmount(Math.min(5_000, Math.max(0, newAvailable)));
  };

  const iconForType = (t: Transaction['type']) => {
    switch (t) {
      case 'advance':
        return <Zap className="h-4 w-4 text-amber-500" />;
      case 'payout':
        return <Wallet className="h-4 w-4 text-blue-600" />;
      case 'sales':
        return <Activity className="h-4 w-4 text-emerald-600" />;
      default:
        return <CreditCard className="h-4 w-4 text-slate-500" />;
    }
  };

  if (!isConnected) {
    return (
      <div className="flex min-h-full flex-col bg-slate-50">
        <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={onHome}
            className="flex items-center gap-2 text-left text-slate-700 transition hover:text-slate-900"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
              S
            </div>
            <span className="font-semibold">Swiftpay</span>
          </button>
        </header>
        <div className="flex flex-1 items-center justify-center px-4 py-16">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-lg shadow-slate-200/40">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <LayoutDashboard className="h-7 w-7" />
            </div>
            <h1 className="mt-6 text-2xl font-bold tracking-tight text-slate-900">Connect App Store Connect</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Verify pending App Store revenue to unlock your dashboard, advances, and AI liquidity
              guidance.
            </p>
            <button
              type="button"
              disabled={connecting}
              onClick={handleConnect}
              className="mt-8 inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {connecting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Verifying Credentials...
                </span>
              ) : (
                'Connect & Verify Revenue'
              )}
            </button>
            <button
              type="button"
              onClick={onHome}
              className="mt-4 text-sm font-medium text-slate-500 hover:text-slate-800"
            >
              Back to marketing site
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50 pb-12">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={onHome}
            className="flex items-center gap-2 rounded-lg text-left transition hover:opacity-90"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white shadow-sm">
              S
            </div>
            <span className="font-semibold tracking-tight text-slate-900">Swiftpay</span>
          </button>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 sm:inline-flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
              KP
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-1">
            <p className="text-sm font-medium text-slate-500">Pending payouts</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
              {formatMoney(financials.pendingAppleRevenue)}
            </p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{ width: `${Math.min(100, (financials.pendingAppleRevenue / 35_000) * 100)}%` }}
              />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Next bulk payout · {nextBulk.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-1">
            <p className="text-sm font-medium text-slate-500">Available to advance</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-blue-600">
              {formatMoney(financials.availableAdvance)}
            </p>
            <button
              type="button"
              onClick={() => {
                setAdvanceAmount(Math.min(5_000, financials.availableAdvance));
                setModalOpen(true);
              }}
              disabled={financials.availableAdvance <= 0}
              className="mt-5 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              Get Funds Instantly
            </button>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-1">
            <p className="text-sm font-medium text-slate-500">Cash in bank</p>
            <p className="mt-2 flex items-center gap-2 text-3xl font-bold tracking-tight text-emerald-600">
              {formatMoney(financials.cashInBank)}
              <TrendingUp className="h-6 w-6 text-emerald-600" aria-hidden />
            </p>
            <p className="mt-3 text-xs text-slate-500">Operating balance · excludes pending Apple batch</p>
          </section>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          <div className="space-y-8 lg:col-span-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Revenue</h2>
                  <p className="text-sm text-slate-500">Historical daily sales vs. projected pipeline</p>
                </div>
                <div className="flex items-center gap-4 text-xs font-medium">
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="h-2 w-2 rounded-full bg-blue-600" />
                    Historical
                  </span>
                  <span className="flex items-center gap-1.5 text-slate-600">
                    <span className="h-2 w-2 rounded-full bg-blue-300" />
                    Projected
                  </span>
                </div>
              </div>
              <div className="mt-6 h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="fillActual" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="fillProj" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#93c5fd" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#93c5fd" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatShortDate}
                      stroke="#94a3b8"
                      tick={{ fontSize: 11 }}
                      minTickGap={24}
                    />
                    <YAxis
                      stroke="#94a3b8"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => `$${Number(v) / 1000}k`}
                      width={44}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 12,
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 10px 40px rgb(15 23 42 / 0.08)',
                      }}
                      labelFormatter={(label) => formatShortDate(String(label))}
                      formatter={(value: number, name: string) => [formatMoney(value), name === 'actual' ? 'Historical' : 'Projected']}
                    />
                    <Area
                      type="monotone"
                      dataKey="actual"
                      name="actual"
                      stroke="#2563eb"
                      strokeWidth={2}
                      fill="url(#fillActual)"
                      connectNulls
                    />
                    <Area
                      type="monotone"
                      dataKey="projected"
                      name="projected"
                      stroke="#93c5fd"
                      strokeWidth={2}
                      fill="url(#fillProj)"
                      connectNulls
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 text-slate-100 shadow-xl">
              <div className="flex items-center gap-2 border-b border-slate-800 px-6 py-4">
                <Sparkles className="h-5 w-5 text-amber-400" />
                <h2 className="text-sm font-semibold tracking-wide text-slate-200">AI liquidity advisor</h2>
              </div>
              <div className="px-6 py-6">
                {advisorLoading ? (
                  <div className="space-y-3 animate-pulse">
                    <div className="h-4 w-full rounded bg-slate-800" />
                    <div className="h-4 w-[92%] rounded bg-slate-800" />
                    <div className="h-4 w-[80%] rounded bg-slate-800" />
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed text-slate-300">{advisorText}</p>
                )}
              </div>
            </section>
          </div>

          <aside className="space-y-8">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Recent activity</h2>
              <ul className="mt-4 divide-y divide-slate-100">
                {transactions.map((tx) => (
                  <li key={tx.id} className="flex gap-3 py-3 first:pt-0">
                    <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-50">
                      {iconForType(tx.type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{tx.description}</p>
                      <p className="text-xs text-slate-500">{formatShortDate(tx.date)}</p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`text-sm font-semibold tabular-nums ${tx.amount >= 0 ? 'text-emerald-600' : 'text-slate-700'}`}
                      >
                        {tx.amount >= 0 ? '+' : ''}
                        {formatMoney(tx.amount)}
                      </p>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{tx.status}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Advance terms</h2>
              <dl className="mt-4 space-y-4 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600">Fee rate</dt>
                  <dd className="font-semibold text-slate-900">3.0%</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600">Repayment</dt>
                  <dd className="max-w-[55%] text-right font-medium text-slate-900">
                    Auto-debit on next Apple batch release (same cycle as pending payouts).
                  </dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-slate-200 pt-4">
                  <dt className="text-slate-600">Total advanced</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">{formatMoney(financials.totalAdvanced)}</dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>
      </main>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          onClick={() => setModalOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="advance-modal-title"
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="advance-modal-title" className="text-lg font-semibold text-slate-900">
                  Request advance
                </h2>
                <p className="mt-1 text-sm text-slate-500">Choose an amount up to your verified limit.</p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="mt-6">
              <label htmlFor="advance-input" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Amount
              </label>
              <div className="mt-2 flex items-center gap-3">
                <span className="text-lg font-semibold text-slate-400">$</span>
                <input
                  id="advance-input"
                  type="number"
                  min={0}
                  max={financials.availableAdvance}
                  value={advanceAmount}
                  onChange={(e) => setAdvanceAmount(clampAdvance(Number(e.target.value) || 0))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-lg font-semibold text-slate-900 outline-none ring-blue-600 focus:ring-2"
                />
              </div>
              <input
                type="range"
                min={0}
                max={financials.availableAdvance}
                step={100}
                value={advanceAmount}
                onChange={(e) => setAdvanceAmount(clampAdvance(Number(e.target.value)))}
                className="mt-4 w-full accent-blue-600"
              />
              <div className="mt-2 flex justify-between text-xs text-slate-500">
                <span>$0</span>
                <span>{formatMoney(financials.availableAdvance)}</span>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm">
              <div className="flex justify-between py-1">
                <span className="text-slate-600">Fee ({ADVANCE_FEE_RATE * 100}%)</span>
                <span className="font-medium text-slate-900">{formatMoney(fee)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 py-2 font-semibold text-slate-900">
                <span>Net to bank</span>
                <span className="text-emerald-600">{formatMoney(netAmount)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleConfirmAdvance}
              disabled={advanceAmount <= 0 || advanceAmount > financials.availableAdvance}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <CheckCircle2 className="h-4 w-4" />
              Confirm Request
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
