import { useEffect, useId, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import {
  CARD_PAYMENTS,
  FREE_CARDS_PER_MONTH,
  PLANS,
  fetchPayment,
  formatDay,
  formatUsd,
  monthlyPrice,
  paymentMessage,
  promoMessage,
  redeemPromo,
  savingPercent,
  startCheckout,
  type Plan,
  type PlanId,
  type PaymentRow,
} from '../lib/billing';
import { usePlanStatus } from '../lib/usePlanStatus';
import { navigate, setAfterSignIn } from '../lib/route';
import { ProfileMenu } from './ProfileMenu';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLL_MS = 5000;
const POLL_FOR_MS = 30 * 60 * 1000;

const PAID_FEATURES = [
  'Unlimited cards',
  'PNG up to 3×, MP4 over your own clips',
  'Copy and share straight from the editor',
  'Card and media saved to your account',
];

const FREE_FEATURES = [
  `${FREE_CARDS_PER_MONTH} card a month`,
  'Restyle and re-export that card as often as you like',
  'PNG, MP4, copy and share',
  'Card and media saved to your account',
];

export function PricingPage({ search }: { search: string }) {
  const { session, user, mode, loading: authLoading, signOut } = useAuth();
  const signedIn = mode === 'account' && Boolean(session);
  const plan = usePlanStatus(session?.user.id ?? null, signedIn);
  const [busyPlan, setBusyPlan] = useState<PlanId | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const params = new URLSearchParams(search);
  const returningPayment = params.get('payment');
  const cancelled = params.get('cancelled') === '1';

  const accountsOff = mode === 'local';
  const status = plan.status;

  const goSignIn = () => {
    setAfterSignIn('/pricing');
    navigate('/');
  };

  const buy = async (id: PlanId) => {
    if (!signedIn) return goSignIn();
    setBusyPlan(id);
    setCheckoutError(null);
    try {
      window.location.assign(await startCheckout(id));
      // Stays busy: the page is being left.
    } catch (caught) {
      setCheckoutError(caught instanceof Error ? caught.message : 'The payment page could not be opened.');
      setBusyPlan(null);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <a
          className="brand brand--link"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          <span className="brand__mark" aria-hidden="true" />
          <div>
            <h1>Astra</h1>
            <p>Plans</p>
          </div>
        </a>
        <div className="topbar__actions">
          <button type="button" className="btn btn--ghost btn--small" onClick={() => navigate('/')}>
            Back to editor
          </button>
          {signedIn || accountsOff ? (
            <ProfileMenu
              user={user}
              mode={mode}
              onSignOut={() => {
                void signOut();
              }}
            />
          ) : (
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={goSignIn}
              disabled={authLoading}
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      <main className="pricing">
        <section className="pricing__hero">
          <p className="pricing__eyebrow">Plans</p>
          <h2>Post every win.</h2>
          <p>
            A free account makes one card a month. A plan makes as many as you trade — every PNG,
            every MP4, no counter.
          </p>
        </section>

        {returningPayment && UUID.test(returningPayment) && signedIn ? (
          <PaymentWatcher id={returningPayment} onChange={() => void plan.refresh()} />
        ) : null}
        {cancelled ? (
          <p className="pricing__banner" role="status">
            Payment cancelled. Nothing was charged.
          </p>
        ) : null}
        {accountsOff ? (
          <p className="pricing__banner" role="status">
            Accounts are off on this copy of Astra, so there is nothing to buy a plan for — every
            export is already unlimited here.
          </p>
        ) : null}
        {checkoutError ? (
          <p className="pricing__banner pricing__banner--error" role="alert">
            {checkoutError}
          </p>
        ) : null}
        {plan.error ? (
          <p className="pricing__banner pricing__banner--error" role="alert">
            {plan.error}
          </p>
        ) : null}

        {signedIn && status ? (
          <div className="pricing__current" aria-live="polite">
            <span className="pricing__current-label">Your plan</span>
            {status.isPaid && status.paidUntil ? (
              <strong>Unlimited · until {formatDay(status.paidUntil)}</strong>
            ) : (
              <strong>
                Free · {Math.max(0, status.freeLimit - status.freeUsed)} of {status.freeLimit} card
                {status.freeLimit === 1 ? '' : 's'} left this month
              </strong>
            )}
            {!status.isPaid ? (
              <span className="pricing__current-note">Resets {formatDay(status.resetsAt)}</span>
            ) : null}
          </div>
        ) : null}

        <div className="pricing__grid">
          <article className="tier">
            <header className="tier__head">
              <h3>Free</h3>
              <p className="tier__price">
                <span className="tier__amount">$0</span>
              </p>
              <p className="tier__sub">Forever</p>
            </header>
            <ul className="tier__features">
              {FREE_FEATURES.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn--ghost tier__cta"
              onClick={() => (signedIn || accountsOff ? navigate('/') : goSignIn())}
            >
              {signedIn || accountsOff ? 'Open the editor' : 'Create a free account'}
            </button>
          </article>

          {PLANS.map((tier) => (
            <PaidTier
              key={tier.id}
              plan={tier}
              featured={tier.months > 1}
              busy={busyPlan === tier.id}
              disabled={accountsOff || authLoading || busyPlan !== null}
              signedIn={signedIn}
              isPaid={Boolean(status?.isPaid)}
              onBuy={() => void buy(tier.id)}
            />
          ))}
        </div>

        <p className="pricing__pay">
          {CARD_PAYMENTS
            ? 'Pay with card, Apple Pay, Google Pay, or crypto — USDT, USDC, BTC, ETH, SOL and hundreds more.'
            : 'Pay with crypto — USDT, USDC, BTC, ETH, SOL and hundreds more.'}{' '}
          Checkout is handled by NOWPayments. Plans are paid in advance and never renew on their own;
          buying again while a plan is running adds the time to the end of it.
        </p>

        {!accountsOff ? <PromoForm signedIn={signedIn} onSignIn={goSignIn} onRedeemed={() => void plan.refresh()} /> : null}

        <section className="pricing__faq" aria-label="Questions">
          <div>
            <h4>What counts as a card?</h4>
            <p>
              A result — the trade or the period and the name on it. Change the colour, the
              background, the frame or the export size as often as you like and it is still the same
              card. Different numbers make a new one.
            </p>
          </div>
          <div>
            <h4>When does the free card come back?</h4>
            <p>On the first day of every month (UTC). Unused cards do not carry over.</p>
          </div>
          <div>
            <h4>What happens when a plan ends?</h4>
            <p>
              The account goes back to one card a month. Your saved card and uploads stay where they
              are.
            </p>
          </div>
          <div>
            <h4>How long does a crypto payment take?</h4>
            <p>
              Usually a few minutes, until the network confirms it. This page updates by itself once
              it has.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

function PaidTier({
  plan,
  featured,
  busy,
  disabled,
  signedIn,
  isPaid,
  onBuy,
}: {
  plan: Plan;
  featured: boolean;
  busy: boolean;
  disabled: boolean;
  signedIn: boolean;
  isPaid: boolean;
  onBuy: () => void;
}) {
  const saving = savingPercent(plan);
  const period = plan.months === 1 ? 'month' : `${plan.months} months`;
  const label = !signedIn
    ? 'Sign in to subscribe'
    : isPaid
      ? `Add ${period}`
      : plan.months === 1
        ? 'Get monthly'
        : `Get ${period}`;

  return (
    <article className={`tier${featured ? ' tier--featured' : ''}`}>
      {featured && saving > 0 ? <span className="tier__badge">Save {saving}%</span> : null}
      <header className="tier__head">
        <h3>{plan.label}</h3>
        <p className="tier__price">
          <span className="tier__amount">{formatUsd(plan.price)}</span>
          <span className="tier__per">/ {period}</span>
        </p>
        <p className="tier__sub">
          {plan.months === 1
            ? 'One month, paid once'
            : `${formatUsd(monthlyPrice(plan))} a month, paid once`}
        </p>
      </header>
      <ul className="tier__features">
        {PAID_FEATURES.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <button
        type="button"
        className={`btn ${featured ? 'btn--primary' : 'btn--ghost'} tier__cta`}
        onClick={onBuy}
        disabled={disabled}
      >
        {busy ? 'Opening payment…' : label}
      </button>
    </article>
  );
}

function PromoForm({
  signedIn,
  onSignIn,
  onRedeemed,
}: {
  signedIn: boolean;
  onSignIn: () => void;
  onRedeemed: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const inputId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!signedIn) return onSignIn();
    if (busy || !code.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await redeemPromo(code);
      setMessage({ text: promoMessage(result), ok: result.ok });
      if (result.ok) {
        setCode('');
        onRedeemed();
      }
    } catch (caught) {
      setMessage({ text: caught instanceof Error ? caught.message : 'The code could not be applied.', ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section pricing__promo">
      <div className="section__head">
        <h2>Promo code</h2>
        <p>A code for free time is added to your plan straight away.</p>
      </div>
      <form className="section__body" onSubmit={(event) => void submit(event)}>
        <label className="field__label" htmlFor={inputId}>
          Code
        </label>
        <div className="pricing__promo-row">
          <input
            id={inputId}
            className="input input--number"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="ENTER CODE"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={40}
            disabled={busy}
          />
          <button type="submit" className="btn btn--primary" disabled={busy || (signedIn && !code.trim())}>
            {!signedIn ? 'Sign in to redeem' : busy ? 'Applying…' : 'Redeem'}
          </button>
        </div>
        {message ? (
          <p
            className={`auth__message${message.ok ? ' auth__message--ok' : ' auth__message--error'}`}
            role={message.ok ? 'status' : 'alert'}
          >
            {message.text}
          </p>
        ) : null}
      </form>
    </section>
  );
}

/**
 * Shown on the way back from NOWPayments. A crypto payment is not final when
 * the customer is sent back — the chain still has to confirm it and the
 * webhook to land — so this keeps asking until the payment settles one way or
 * the other, then refreshes the plan.
 */
function PaymentWatcher({ id, onChange }: { id: string; onChange: () => void }) {
  const [payment, setPayment] = useState<PaymentRow | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    let lastStatus = '';

    const poll = async () => {
      const next = await fetchPayment(id);
      if (cancelled) return;
      setPayment(next);
      const key = `${next?.status}:${next?.credited_at}`;
      if (key !== lastStatus) {
        lastStatus = key;
        onChange();
      }
      if (paymentMessage(next).done) return;
      if (Date.now() - started > POLL_FOR_MS) return setGaveUp(true);
      timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // onChange is a fresh closure every render; the poll keeps the first one.
  }, [id]);

  const message = paymentMessage(payment);
  const tone = message.failed ? ' pricing__banner--error' : message.done ? ' pricing__banner--ok' : '';
  return (
    <p className={`pricing__banner${tone}`} role="status" aria-live="polite">
      {!message.done ? <span className="pricing__pulse" aria-hidden="true" /> : null}
      {gaveUp
        ? 'Still waiting for the network to confirm your payment. It will be added to your plan as soon as it does — you can close this page.'
        : message.text}
    </p>
  );
}
