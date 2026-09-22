import { useMemo, useRef, useState } from 'react';
import type { CardState } from '../types';
import { useAuth } from '../lib/auth';
import { CardPreview } from './CardPreview';
import { ProfileMenu } from './ProfileMenu';
import { SiteNav } from './SiteNav';
import { createDefaultState } from '../lib/defaults';
import { THEMES } from '../lib/themes';
import { MAX_CLIP_SECONDS } from '../lib/images';
import { CARD } from '../lib/render';
import {
  CARD_PAYMENTS,
  FREE_CARDS_PER_MONTH,
  FREE_FEATURES,
  PAID_FEATURES,
  PLANS,
  formatUsd,
  monthlyPrice,
  savingPercent,
} from '../lib/billing';
import { PRICING_PATH, STUDIO_PATH, navigate, setAfterSignIn } from '../lib/route';

/**
 * The front page: what Astra is, what it does, and what the plans cost.
 *
 * The card in the hero is not a screenshot — it is the real renderer, the same
 * `CardPreview` the editor uses, painting a real `CardState`. That is the one
 * claim on this page worth demonstrating rather than asserting, and it costs
 * nothing: with no artwork, avatar or logo there is nothing to decode, so the
 * card is on screen in the first frame or two.
 */

/** The card in the hero: a result worth posting, not the flat sample card. */
function heroState(themeId: string): CardState {
  const base = createDefaultState();
  return {
    ...base,
    period: { title: 'August 2026', startBalance: 10000, endBalance: 18420 },
    // No avatar is set here, so the framed slot would draw its empty
    // placeholder inside a pin badge — on a front page that reads as a broken
    // image rather than as "your face goes here". The bare slot is quieter.
    display: { ...base.display, themeId, compactHero: false, frameId: 'none' },
  };
}

const STEPS = [
  {
    n: '01',
    title: 'Type the numbers',
    body:
      'A single trade — symbol, direction, leverage, entry, exit — or a period: a month, a quarter, ' +
      'a week, with the balance either side. Astra works out the percentage and the multiple; you ' +
      'never format a number yourself.',
  },
  {
    n: '02',
    title: 'Make it yours',
    body:
      'Pick the accent, drop in a photo or a clip, set the scrim so the text stays readable, frame ' +
      'your avatar, add your handle, wordmark and footer. Hide anything you do not want on it.',
  },
  {
    n: '03',
    title: 'Export and post',
    body:
      'A PNG up to 3×, an MP4 built frame by frame from your clip, or copy it straight to the ' +
      'clipboard. What you see in the preview is exactly what lands in the file.',
  },
];

const FEATURES = [
  {
    title: 'Two kinds of card',
    body:
      'A single trade or a whole period. Both draw through one layout, so your month card and your ' +
      'trade cards look like they came from the same place.',
  },
  {
    title: 'The maths, done',
    body:
      'Percentage, multiple and the money, derived from what you typed. It also says so when the ' +
      'sign of your profit disagrees with your prices, before you post it.',
  },
  {
    title: 'Six accents, or your own',
    body:
      'Mint, cyan, violet, gold, cherry and bone — or any hex colour you like. The text goes light ' +
      'or dark, and the whole card turns over with it.',
  },
  {
    title: 'Photo or video backgrounds',
    body:
      'Drag a still or a clip onto the card, zoom it, drag it into place, and dial the scrim until ' +
      `the text sits cleanly on top. Clips play up to ${MAX_CLIP_SECONDS} seconds, trimmed in the editor.`,
  },
  {
    title: 'Seven avatar frames',
    body:
      'A pin badge in any colour, a tag, gilt, a halo in the card’s accent, a stamp, corner ' +
      'brackets, or none at all.',
  },
  {
    title: 'Frame-exact MP4',
    body:
      'The video is built from your clip’s own frames rather than recorded off the screen: it keeps ' +
      'the source frame rate, the sound stays in step, and it encodes as fast as your machine can go.',
  },
  {
    title: 'Rendered in your browser',
    body:
      `Nothing is uploaded to be drawn. Every pixel of the ${CARD.width}×${CARD.height} card is ` +
      'painted on your machine, by the same code for the preview, the PNG and every video frame.',
  },
  {
    title: 'Saved to your account',
    body:
      'Your card and your uploads follow you to your phone, your laptop and back. Close the tab ' +
      'mid-edit and it is where you left it.',
  },
];

export function HomePage() {
  const { session, user, mode, loading: authLoading, signOut } = useAuth();
  const signedIn = mode === 'account' && Boolean(session);
  const accountsOff = mode === 'local';
  const [themeId, setThemeId] = useState(THEMES[0]!.id);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const card = useMemo(() => heroState(themeId), [themeId]);

  // Signed out, every call to action goes to the editor, which is where the
  // sign-in form lives; it opens the studio itself once there is a session.
  const start = () => {
    if (!signedIn && !accountsOff) setAfterSignIn(STUDIO_PATH);
    navigate(STUDIO_PATH);
  };

  const monthly = PLANS.find((plan) => plan.months === 1);
  const best = PLANS.reduce((a, b) => (savingPercent(b) > savingPercent(a) ? b : a), PLANS[0]!);

  return (
    <div className="app">
      <header className="topbar">
        <SiteNav current="home" />
        <div className="topbar__actions">
          {/* No plans button here: the nav beside the wordmark already has one,
              and two of them in the same bar is just noise. */}
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={start}
            disabled={authLoading}
          >
            {signedIn || accountsOff ? 'Open the editor' : 'Start free'}
          </button>
          {signedIn || accountsOff ? (
            <ProfileMenu
              user={user}
              mode={mode}
              onOpenPlans={signedIn ? () => navigate(PRICING_PATH) : undefined}
              onSignOut={() => {
                void signOut();
              }}
            />
          ) : null}
        </div>
      </header>

      <main className="home">
        <section className="home__hero">
          <div className="home__hero-copy">
            <p className="pricing__eyebrow">PnL cards for traders</p>
            <h2>Your results, worth posting.</h2>
            <p className="home__lede">
              Astra turns a trade or a month into a card people stop for — your numbers, your
              colours, your face, over your own photo or clip. It is drawn in your browser at{' '}
              {CARD.width}×{CARD.height}, exports as a PNG or an MP4, and takes about a minute.
            </p>
            <div className="home__cta">
              <button type="button" className="btn btn--primary home__cta-btn" onClick={start}>
                {signedIn || accountsOff ? 'Open the editor' : 'Make your first card — free'}
              </button>
              <button
                type="button"
                className="btn btn--ghost home__cta-btn"
                onClick={() => navigate(PRICING_PATH)}
              >
                See plans
              </button>
            </div>
            <p className="home__cta-note">
              {accountsOff
                ? 'Accounts are off on this copy — everything is saved in this browser, and every export is unlimited.'
                : `No card needed to start. A free account makes ${FREE_CARDS_PER_MONTH} card a month; plans start at ${
                    monthly ? formatUsd(monthly.price) : ''
                  } and never renew on their own.`}
            </p>
          </div>

          <div className="home__hero-card">
            <CardPreview state={card} canvasRef={canvasRef} />
            <div className="home__swatches">
              <div className="home__swatch-row" role="group" aria-label="Accent colour">
                {THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    className={`home__swatch${theme.id === themeId ? ' is-active' : ''}`}
                    style={{ background: theme.swatch }}
                    onClick={() => setThemeId(theme.id)}
                    aria-pressed={theme.id === themeId}
                    title={theme.name}
                  >
                    <span className="sr-only">{theme.name}</span>
                  </button>
                ))}
              </div>
              <span className="home__swatches-note">
                Live — this is the card renderer itself, not a picture of one.
              </span>
            </div>
          </div>
        </section>

        <section className="home__section" aria-labelledby="home-how">
          <h3 className="home__section-title" id="home-how">
            How it works
          </h3>
          <ol className="home__steps">
            {STEPS.map((step) => (
              <li key={step.n} className="home__step">
                <span className="home__step-n">{step.n}</span>
                <h4>{step.title}</h4>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="home__section" aria-labelledby="home-what">
          <h3 className="home__section-title" id="home-what">
            What Astra does
          </h3>
          <div className="home__features">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="home__feature">
                <h4>{feature.title}</h4>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="home__section" aria-labelledby="home-plans">
          <h3 className="home__section-title" id="home-plans">
            Plans
          </h3>
          <p className="home__section-lede">
            A free account makes {FREE_CARDS_PER_MONTH} card a month — the whole editor, every
            export, no watermark. A plan lifts the counter, and nothing else changes.
            {savingPercent(best) > 0
              ? ` ${best.label} works out at ${formatUsd(monthlyPrice(best))} a month, ${savingPercent(
                  best,
                )}% under paying monthly.`
              : ''}
          </p>

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
              <button type="button" className="btn btn--ghost tier__cta" onClick={start}>
                {signedIn || accountsOff ? 'Open the editor' : 'Create a free account'}
              </button>
            </article>

            {PLANS.map((plan) => {
              const featured = plan.months > 1;
              const saving = savingPercent(plan);
              const period = plan.months === 1 ? 'month' : `${plan.months} months`;
              return (
                <article key={plan.id} className={`tier${featured ? ' tier--featured' : ''}`}>
                  {featured && saving > 0 ? (
                    <span className="tier__badge">Save {saving}%</span>
                  ) : null}
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
                    onClick={() => navigate(PRICING_PATH)}
                  >
                    {plan.months === 1 ? 'Get monthly' : `Get ${period}`}
                  </button>
                </article>
              );
            })}
          </div>

          <dl className="home__plandetail">
            <div>
              <dt>What counts as a card</dt>
              <dd>
                The result and the name on it — the trade or the period figures, and your handle,
                wordmark and footer. Colour, background, frame and export size are not part of it,
                so your free card can be restyled and exported as often as you like. Different
                numbers make a new card.
              </dd>
            </div>
            <div>
              <dt>How you pay</dt>
              <dd>
                {CARD_PAYMENTS
                  ? 'Card, Apple Pay, Google Pay, or crypto — USDT, USDC, BTC, ETH, SOL and hundreds more.'
                  : 'Crypto — USDT, USDC, BTC, ETH, SOL and hundreds more.'}{' '}
                Checkout is handled by NOWPayments; Astra never sees your payment details.
              </dd>
            </div>
            <div>
              <dt>No subscription trap</dt>
              <dd>
                Plans are paid in advance and never renew on their own, so there is nothing to
                cancel. Buying again while a plan is running adds the time to the end of it.
              </dd>
            </div>
            <div>
              <dt>When a plan ends</dt>
              <dd>
                The account goes back to {FREE_CARDS_PER_MONTH} card a month. Your saved card and
                every upload stay exactly where they are.
              </dd>
            </div>
            <div>
              <dt>Promo codes</dt>
              <dd>
                A code for free time is added to your plan the moment you redeem it, on the plans
                page. One code per account.
              </dd>
            </div>
            <div>
              <dt>The free card comes back</dt>
              <dd>On the first day of every month, UTC. Unused cards do not carry over.</dd>
            </div>
          </dl>

          <button
            type="button"
            className="btn btn--ghost home__plans-more"
            onClick={() => navigate(PRICING_PATH)}
          >
            Full plans and promo codes
          </button>
        </section>

        <section className="home__closer">
          <h3>Post the next one today.</h3>
          <p>
            {FREE_CARDS_PER_MONTH} free card a month, the whole editor, no watermark. Nothing to
            install.
          </p>
          <button type="button" className="btn btn--primary home__cta-btn" onClick={start}>
            {signedIn || accountsOff ? 'Open the editor' : 'Start free'}
          </button>
        </section>

        <footer className="home__footer">
          <span className="home__footer-brand">Astra</span>
          <nav aria-label="Footer">
            <button type="button" className="linkish" onClick={start}>
              Cards
            </button>
            <button type="button" className="linkish" onClick={() => navigate(PRICING_PATH)}>
              Plans
            </button>
          </nav>
        </footer>
      </main>
    </div>
  );
}
