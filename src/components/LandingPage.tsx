import {
  ArrowRight,
  Lock,
  Shield,
  Smartphone,
  Sparkles,
  TrendingUp,
  Zap,
} from './Icons';

type LandingPageProps = {
  onEnterApp: () => void;
};

export function LandingPage({ onEnterApp }: LandingPageProps) {
  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-lg font-bold text-white shadow-sm shadow-blue-600/25">
              S
            </div>
            <span className="text-lg font-semibold tracking-tight">Swiftpay</span>
          </div>
          <button
            type="button"
            onClick={onEnterApp}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            Login
          </button>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-white to-slate-50">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-100/60 via-transparent to-transparent" />
          <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:flex lg:items-center lg:gap-16 lg:px-8 lg:py-28">
            <div className="max-w-2xl">
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
                <Sparkles className="h-3.5 w-3.5" />
                Now funding apps with $10k+ monthly revenue
              </p>
              <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
                Stop letting Apple hold your growth hostage.
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-slate-600 sm:text-xl">
                Apple sits on your proceeds for 30–65 days while you still pay ads, contractors, and
                infra. Swiftpay verifies your pending App Store revenue and advances capital in as
                little as 24 hours—secured against what you have already earned.
              </p>
              <div className="mt-10 flex flex-wrap gap-4">
                <button
                  type="button"
                  onClick={onEnterApp}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition hover:bg-blue-700"
                >
                  Get Liquidity Now
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onEnterApp}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                >
                  View Demo
                </button>
              </div>
            </div>
            <div className="mt-14 hidden flex-1 lg:mt-0 lg:block">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-500">Pending payouts</span>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                    Verified
                  </span>
                </div>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">$24,180</p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full w-[72%] rounded-full bg-blue-600" />
                </div>
                <p className="mt-3 text-xs text-slate-500">Next bulk payout · Est. 38 days</p>
                <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-6">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Available advance</p>
                    <p className="mt-1 text-xl font-bold text-blue-600">$18.5k</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">Cash in bank</p>
                    <p className="mt-1 flex items-center gap-1 text-xl font-bold text-emerald-600">
                      $42.2k
                      <TrendingUp className="h-4 w-4" />
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">How it works</h2>
            <p className="mt-3 text-slate-600">
              Three steps from connect to capital—no jargon, no surprises.
            </p>
          </div>
          <div className="mt-14 grid gap-8 md:grid-cols-3">
            <article className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Smartphone className="h-6 w-6" />
              </div>
              <h3 className="mt-6 text-lg font-semibold text-slate-900">Connect & verify</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Link App Store Connect. We read pending sales and payout schedules—never your users’
                personal data.
              </p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Zap className="h-6 w-6" />
              </div>
              <h3 className="mt-6 text-lg font-semibold text-slate-900">Instant advance</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Choose an amount up to your verified limit. Funds hit your operating account on
                eligible rails in as little as one business day.
              </p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Shield className="h-6 w-6" />
              </div>
              <h3 className="mt-6 text-lg font-semibold text-slate-900">Automatic repayment</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                When Apple releases your batch, we reconcile principal and a transparent fee—like a
                revolver, not a loan shark.
              </p>
            </article>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-white py-14">
          <div className="mx-auto max-w-6xl px-4 text-center sm:px-6 lg:px-8">
            <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Social proof
            </p>
            <p className="mx-auto mt-3 max-w-3xl text-lg font-medium text-slate-800">
              Trusted by developers scaling user acquisition on{' '}
              <span className="text-slate-900">TikTok</span>, <span className="text-slate-900">Meta</span>
              , <span className="text-slate-900">Unity</span>, and more.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-8 text-slate-400">
              <Lock className="h-8 w-8" aria-hidden />
              <span className="text-sm font-semibold text-slate-400">SOC2-ready posture</span>
              <span className="hidden h-4 w-px bg-slate-200 sm:block" />
              <span className="text-sm text-slate-500">Read-only App Store Connect</span>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-slate-50 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-sm font-bold text-white">
              S
            </div>
            © {new Date().getFullYear()} Swiftpay. Prototype UI.
          </div>
          <a
            href="https://github.com/keithanp/SWIFTPAY"
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
            target="_blank"
            rel="noreferrer"
          >
            github.com/keithanp/SWIFTPAY
          </a>
        </div>
      </footer>
    </div>
  );
}
