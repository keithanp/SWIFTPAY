import { useCallback, useEffect, useMemo, useState } from 'react';
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
import type { AdvanceRow, DashboardSummary, PayoutProfile, PricingTransparency } from '../pipelineTypes';
import {
  fetchAdvances,
  fetchDashboardSummary,
  fetchPayoutProfile,
  fetchPricingTransparency,
  getPipelineJwt,
  postAdvance,
  postAdvanceTransition,
  postPayoutVerifyStub,
  postVerificationRefresh,
  putKycChecklist,
  putPayoutProfile,
  setPipelineJwt,
} from '../services/pipelineApi';
import type { FinancialState, Transaction } from '../types';
import {
  Activity,
  CheckCircle2,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Shield,
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

function buildMockChartData() {
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
}

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

  const [pipelineJwtDraft, setPipelineJwtDraft] = useState('');
  const [pipelineFromApi, setPipelineFromApi] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pipelineRunHint, setPipelineRunHint] = useState<string | null>(null);
  const [ledgerDaily, setLedgerDaily] = useState<{ date: string; netUsdCents: number }[] | null>(null);
  const [pipelineMeta, setPipelineMeta] = useState<{
    confidence: number;
    policyVersion: string;
    latestRunStatus: string | null;
  } | null>(null);

  const [payoutProfile, setPayoutProfile] = useState<PayoutProfile | null>(null);
  const [pricing, setPricing] = useState<PricingTransparency | null>(null);
  const [advances, setAdvances] = useState<AdvanceRow[]>([]);
  const [payoutDraft, setPayoutDraft] = useState({ bankDisplayName: '', accountLast4: '', routingLast4: '' });
  const [advanceActionId, setAdvanceActionId] = useState<string | null>(null);

  const loadPipelineAux = useCallback(async () => {
    if (!getPipelineJwt()?.trim()) return;
    try {
      const [p, pr, a] = await Promise.all([
        fetchPayoutProfile(),
        fetchPricingTransparency(),
        fetchAdvances(),
      ]);
      setPayoutProfile(p);
      setPricing(pr);
      setAdvances(a.advances);
      setPayoutDraft({
        bankDisplayName: p.bankDisplayName,
        accountLast4: p.accountLast4 ?? '',
        routingLast4: p.routingLast4 ?? '',
      });
    } catch {
      /* non-fatal: dashboard summary may still work */
    }
  }, []);

  useEffect(() => {
    const existing = getPipelineJwt();
    if (existing) setPipelineJwtDraft(existing);
  }, []);

  const chartData = useMemo(() => {
    if (ledgerDaily?.length) {
      const map = new Map<string, { date: string; actual: number | null; projected: number | null }>();
      for (const row of ledgerDaily) {
        map.set(row.date, { date: row.date, actual: row.netUsdCents / 100, projected: null });
      }
      const last = ledgerDaily[ledgerDaily.length - 1]!.date;
      for (const row of MOCK_PROJECTED_REVENUE) {
        if (row.date > last) {
          const existing = map.get(row.date);
          if (existing) {
            existing.projected = row.revenue;
          } else {
            map.set(row.date, { date: row.date, actual: null, projected: row.revenue });
          }
        }
      }
      return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
    }
    return buildMockChartData();
  }, [ledgerDaily]);

  const applySummary = useCallback((summary: DashboardSummary) => {
    const availCents = summary.availableAfterAdvancesCents ?? summary.decision.max_advance_cents;
    const availUsd = availCents / 100;
    const t28 = summary.features?.trailing_28d_net_usd_cents ?? 0;
    const pendingUsd = t28 / 100;
    const outstandingUsd = (summary.outstandingAdvanceCents ?? 0) / 100;
    setFinancials((prev) => ({
      ...prev,
      pendingAppleRevenue: pendingUsd > 0 ? pendingUsd : prev.pendingAppleRevenue,
      availableAdvance: availUsd,
      totalAdvanced: outstandingUsd > 0 ? outstandingUsd : prev.totalAdvanced,
    }));
    setLedgerDaily(summary.ledgerDaily);
    setPipelineFromApi(true);
    setPipelineError(null);
    setPipelineMeta({
      confidence: summary.decision.confidence,
      policyVersion: summary.decision.policy_version,
      latestRunStatus: summary.latestRun?.status ?? null,
    });
  }, []);

  const syncFromPipeline = useCallback(async () => {
    if (!getPipelineJwt()?.trim()) {
      setPipelineError('Save a pipeline JWT first (from POST /v1/auth/token).');
      return;
    }
    setPipelineBusy(true);
    setPipelineError(null);
    setPipelineRunHint(null);
    try {
      const summary = await fetchDashboardSummary();
      applySummary(summary);
      await loadPipelineAux();
    } catch (e) {
      setPipelineFromApi(false);
      setPipelineError((e as Error).message);
    } finally {
      setPipelineBusy(false);
    }
  }, [applySummary, loadPipelineAux]);

  const runIngestionRefresh = useCallback(async () => {
    if (!getPipelineJwt()?.trim()) {
      setPipelineError('Save a pipeline JWT first.');
      return;
    }
    setPipelineBusy(true);
    setPipelineError(null);
    try {
      await postVerificationRefresh();
      setPipelineRunHint('Ingestion queued. Syncing in a few seconds…');
      for (let i = 0; i < 45; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const summary = await fetchDashboardSummary();
          applySummary(summary);
          if (summary.latestRun?.status === 'succeeded' || summary.latestRun?.status === 'failed') {
            setPipelineRunHint(
              summary.latestRun.status === 'succeeded'
                ? 'Ingestion completed.'
                : `Ingestion failed: ${summary.latestRun.error_message ?? 'unknown'}`,
            );
            break;
          }
        } catch {
          /* still running */
        }
      }
      await loadPipelineAux();
    } catch (e) {
      setPipelineError((e as Error).message);
    } finally {
      setPipelineBusy(false);
    }
  }, [applySummary, loadPipelineAux]);

  useEffect(() => {
    if (!isConnected) return;
    if (!getPipelineJwt()?.trim()) return;
    void syncFromPipeline();
  }, [isConnected, syncFromPipeline]);

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

  const savePipelineJwt = () => {
    setPipelineJwt(pipelineJwtDraft.trim() || null);
    setPipelineError(null);
  };

  const clearPipelineJwt = () => {
    setPipelineJwt(null);
    setPipelineJwtDraft('');
    setPipelineFromApi(false);
    setLedgerDaily(null);
    setPipelineMeta(null);
    setPipelineRunHint(null);
    setPayoutProfile(null);
    setPricing(null);
    setAdvances([]);
    setFinancials({
      pendingAppleRevenue: 24_000,
      availableAdvance: 18_500,
      cashInBank: 42_200,
      totalAdvanced: 0,
    });
  };

  const clampAdvance = (v: number) =>
    Math.min(Math.max(0, v), financials.availableAdvance);

  const handleConfirmAdvance = () => {
    const amount = clampAdvance(advanceAmount);
    if (amount <= 0) return;

    void (async () => {
      if (getPipelineJwt()?.trim()) {
        setPipelineBusy(true);
        setPipelineError(null);
        try {
          const amountCents = Math.round(amount * 100);
          const res = await postAdvance({ amountCents });
          const netUsd = res.netCents / 100;
          const tx: Transaction = {
            id: res.id,
            type: 'advance',
            amount: netUsd,
            date: new Date().toISOString().slice(0, 10),
            status: 'pending',
            description: `Advance requested (${res.status})`,
          };
          setTransactions((prev) => [tx, ...prev]);
          setFinancials((prev) => ({
            ...prev,
            cashInBank: Math.round((prev.cashInBank + netUsd) * 100) / 100,
          }));
          const summary = await fetchDashboardSummary();
          applySummary(summary);
          await loadPipelineAux();
          setModalOpen(false);
          setAdvanceAmount(Math.min(5_000, Math.max(0, (summary.availableAfterAdvancesCents ?? 0) / 100)));
        } catch (e) {
          setPipelineError((e as Error).message);
        } finally {
          setPipelineBusy(false);
        }
        return;
      }

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
    })();
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

            <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pipeline API (dev)</p>
              <p className="mt-1 text-xs text-slate-600">
                Paste the JWT from <code className="rounded bg-white px-1">POST /v1/auth/token</code> so the
                dashboard can load verified limits and revenue from the Swiftpay API (
                <code className="rounded bg-white px-1">docs/PIPELINE.md</code>).
              </p>
              <label htmlFor="pipeline-jwt" className="mt-3 block text-xs font-medium text-slate-700">
                Access token
              </label>
              <input
                id="pipeline-jwt"
                type="password"
                autoComplete="off"
                value={pipelineJwtDraft}
                onChange={(e) => setPipelineJwtDraft(e.target.value)}
                placeholder="eyJhbGciOi…"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 outline-none ring-blue-600 focus:ring-2"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={savePipelineJwt}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Save token
                </button>
                <button
                  type="button"
                  onClick={clearPipelineJwt}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Clear
                </button>
              </div>
              {getPipelineJwt() ? (
                <p className="mt-2 text-xs font-medium text-emerald-700">Token saved in this browser.</p>
              ) : null}
            </div>

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
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Verified revenue (API)</h2>
              <p className="text-xs text-slate-500">
                {pipelineFromApi
                  ? `Loaded from pipeline · policy ${pipelineMeta?.policyVersion ?? '—'} · confidence ${pipelineMeta?.confidence ?? '—'} · last job ${pipelineMeta?.latestRunStatus ?? '—'}`
                  : 'Save a JWT on the gate screen, then sync to replace demo numbers with Postgres-backed limits and ledger.'}
              </p>
              {pipelineRunHint ? <p className="mt-1 text-xs font-medium text-blue-700">{pipelineRunHint}</p> : null}
              {pipelineError ? <p className="mt-1 text-xs font-medium text-red-600">{pipelineError}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pipelineBusy}
                onClick={() => void syncFromPipeline()}
                className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
              >
                Sync from API
              </button>
              <button
                type="button"
                disabled={pipelineBusy}
                onClick={() => void runIngestionRefresh()}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-60"
              >
                Run ingestion refresh
              </button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Chart “Historical” uses <code className="rounded bg-slate-50 px-1">revenue_daily</code> when synced;
            projected tail stays demo-style.
          </p>
        </section>

        {getPipelineJwt()?.trim() ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-slate-900">Payout destination (stub)</h2>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Where advances land once funded. Values are stored server-side; this is not a live bank link.
              </p>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-500">Bank display name</label>
                  <input
                    value={payoutDraft.bankDisplayName}
                    onChange={(e) => setPayoutDraft((d) => ({ ...d, bankDisplayName: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-500">Routing last 4</label>
                    <input
                      value={payoutDraft.routingLast4}
                      onChange={(e) => setPayoutDraft((d) => ({ ...d, routingLast4: e.target.value.slice(0, 4) }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500">Account last 4</label>
                    <input
                      value={payoutDraft.accountLast4}
                      onChange={(e) => setPayoutDraft((d) => ({ ...d, accountLast4: e.target.value.slice(0, 4) }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pipelineBusy}
                    onClick={() =>
                      void (async () => {
                        setPipelineBusy(true);
                        try {
                          const p = await putPayoutProfile({
                            bankDisplayName: payoutDraft.bankDisplayName,
                            routingLast4: payoutDraft.routingLast4 || undefined,
                            accountLast4: payoutDraft.accountLast4 || undefined,
                          });
                          setPayoutProfile((prev) => (prev ? { ...prev, ...p } : p));
                        } catch (e) {
                          setPipelineError((e as Error).message);
                        } finally {
                          setPipelineBusy(false);
                        }
                      })()
                    }
                    className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    Save payout stub
                  </button>
                  <button
                    type="button"
                    disabled={pipelineBusy}
                    onClick={() =>
                      void (async () => {
                        setPipelineBusy(true);
                        try {
                          await postPayoutVerifyStub();
                          const p = await fetchPayoutProfile();
                          setPayoutProfile(p);
                        } catch (e) {
                          setPipelineError((e as Error).message);
                        } finally {
                          setPipelineBusy(false);
                        }
                      })()
                    }
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Stub: mark verified
                  </button>
                </div>
                <p className="text-xs font-medium text-slate-600">
                  Verification:{' '}
                  <span className="text-blue-700">{payoutProfile?.verificationState ?? '—'}</span>
                </p>
              </div>

              <div className="mt-8 border-t border-slate-100 pt-6">
                <h3 className="text-sm font-semibold text-slate-900">KYC checklist (stub)</h3>
                <ul className="mt-3 space-y-2">
                  {(
                    [
                      ['govId', 'Government-issued ID'],
                      ['proofOfAddress', 'Proof of address (≤90 days)'],
                      ['beneficialOwners', 'Beneficial owners attestation'],
                      ['bankLinkAuthorized', 'Bank linking authorization'],
                    ] as const
                  ).map(([key, label]) => (
                    <li key={key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300"
                        checked={Boolean(payoutProfile?.kycChecklist?.[key])}
                        disabled={pipelineBusy || !payoutProfile}
                        onChange={() =>
                          void (async () => {
                            if (!payoutProfile) return;
                            setPipelineBusy(true);
                            try {
                              const cur = payoutProfile.kycChecklist[key];
                              const r = await putKycChecklist({ [key]: !cur } as Partial<PayoutProfile['kycChecklist']>);
                              setPayoutProfile({
                                ...payoutProfile,
                                kycChecklist: r.kycChecklist,
                                verificationState: r.verificationState,
                              });
                            } catch (e) {
                              setPipelineError((e as Error).message);
                            } finally {
                              setPipelineBusy(false);
                            }
                          })()
                        }
                      />
                      <span className="text-sm text-slate-700">{label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Pricing transparency</h2>
              {pricing ? (
                <div className="mt-3 space-y-4 text-sm text-slate-600">
                  <div>
                    <p className="font-semibold text-slate-900">Fee schedule</p>
                    <p className="mt-1">
                      Advance fee: <span className="font-medium">{pricing.feeSchedule.advanceFeeRatePercent}%</span> of
                      gross advance ({pricing.feeSchedule.feeRateBps} bps).
                    </p>
                    <ul className="mt-2 list-inside list-disc text-xs">
                      {pricing.feeSchedule.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Illustrative APR range</p>
                    <p className="mt-1 text-xs">{pricing.appleDelayAssumptions.copy}</p>
                    <p className="mt-2 font-mono text-xs text-slate-700">
                      ~{pricing.illustrativeApr.aprPercentAt35DayHold}% APR proxy @ {pricing.appleDelayAssumptions.impliedHoldDaysMin}d hold · ~
                      {pricing.illustrativeApr.aprPercentAt65DayHold}% @ {pricing.appleDelayAssumptions.impliedHoldDaysMax}d hold
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">{pricing.illustrativeApr.formula}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">{pricing.chargebacksAndDelays.title}</p>
                    <ul className="mt-2 list-inside list-disc text-xs">
                      {pricing.chargebacksAndDelays.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>
                  {pricing.activeReasonCodes.length > 0 ? (
                    <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
                      <p className="text-xs font-semibold text-amber-900">Active policy signals</p>
                      <ul className="mt-2 space-y-1 text-xs text-amber-950">
                        {pricing.activeReasonCodes.map((c) => (
                          <li key={c}>
                            <span className="font-mono">{c}</span>: {pricing.reasonCodeDisclosures[c] ?? '—'}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">No active underwriting reason codes on the latest limit.</p>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">Sync from API to load pricing disclosures.</p>
              )}
            </section>
          </div>
        ) : null}

        {getPipelineJwt()?.trim() ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Advances (lifecycle)</h2>
            <p className="mt-1 text-sm text-slate-500">
              Immutable server records with audit events. Use stub actions to simulate funding and repayment.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Created</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2 pr-3">Fee</th>
                    <th className="py-2 pr-3">Net</th>
                    <th className="py-2 pr-3">APR proxy</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {advances.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-500">
                        No advances yet — request one via “Get Funds Instantly”.
                      </td>
                    </tr>
                  ) : (
                    advances.map((a) => (
                      <tr key={a.id} className="border-b border-slate-100">
                        <td className="py-2 pr-3 text-xs text-slate-600">
                          {new Date(a.createdAt).toLocaleString()}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">{formatMoney(a.amountCents / 100)}</td>
                        <td className="py-2 pr-3 tabular-nums">{formatMoney(a.feeCents / 100)}</td>
                        <td className="py-2 pr-3 tabular-nums text-emerald-700">{formatMoney(a.netCents / 100)}</td>
                        <td className="py-2 pr-3 text-xs">
                          {a.effectiveAprProxyBps != null ? `${(a.effectiveAprProxyBps / 100).toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
                            {a.status}
                          </span>
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-1">
                            {a.status === 'requested' ? (
                              <button
                                type="button"
                                disabled={advanceActionId === a.id}
                                onClick={() =>
                                  void (async () => {
                                    setAdvanceActionId(a.id);
                                    try {
                                      await postAdvanceTransition(a.id, 'funded');
                                      await loadPipelineAux();
                                      const s = await fetchDashboardSummary();
                                      applySummary(s);
                                    } catch (e) {
                                      setPipelineError((e as Error).message);
                                    } finally {
                                      setAdvanceActionId(null);
                                    }
                                  })()
                                }
                                className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                              >
                                Simulate fund
                              </button>
                            ) : null}
                            {a.status === 'funded' ? (
                              <button
                                type="button"
                                disabled={advanceActionId === a.id}
                                onClick={() =>
                                  void (async () => {
                                    setAdvanceActionId(a.id);
                                    try {
                                      await postAdvanceTransition(a.id, 'repaid');
                                      await loadPipelineAux();
                                      const s = await fetchDashboardSummary();
                                      applySummary(s);
                                    } catch (e) {
                                      setPipelineError((e as Error).message);
                                    } finally {
                                      setAdvanceActionId(null);
                                    }
                                  })()
                                }
                                className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                              >
                                Simulate repay
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-1">
            <p className="text-sm font-medium text-slate-500">
              {pipelineFromApi ? 'Trailing 28d net (verified)' : 'Pending payouts'}
            </p>
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
            <p className="mt-3 text-xs text-slate-500">
              {pipelineFromApi ? 'Demo balance (not from pipeline).' : 'Operating balance · excludes pending Apple batch'}
            </p>
          </section>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          <div className="space-y-8 lg:col-span-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Revenue</h2>
                  <p className="text-sm text-slate-500">
                    {ledgerDaily?.length
                      ? 'API ledger (USD) + demo projected tail'
                      : 'Historical daily sales vs. projected pipeline (demo)'}
                  </p>
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
