// Public landing deck for signed-out visitors: five full-screen slides, no page scroll.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { chainIcon, chainName, logo, nearLogo } from "../assets.ts";
import { Button, Icon } from "../ds.jsx";
import "./landing.css";
import { clamp, fromHash, GITHUB, highlight, keyStep, shopUrl, SLIDES, snippet, swipeStep, toHash, wheelGate } from "./logic.ts";

/// Minutes from email sign-in to the first invoice link. Set from a timed onboarding run (tasks 3.2).
const MINUTES = 3;
/// Networks a payer can pay from today: the screenable 1Click origins (relay EVM_CHAINS, btc, zec) plus NEAR direct.
const NETWORKS = ["base", "eth", "arb", "btc", "zec", "near"];
/// Other chains on 1Click's live token list (39 on 2026-11-06) that Gateflow can't screen yet.
const MORE_CHAINS = 33;
const SHOP = shopUrl(import.meta.env.VITE_SHOP_URL);

function Chain({ id }: { id: string }) {
  return (
    <span className="landing-chain">
      <img src={chainIcon(id)} alt="" />
      {chainName(id)}
    </span>
  );
}

const More = () => <span className="landing-more">+{MORE_CHAINS} more via NEAR Intents, coming soon</span>;

/// Payments from every network land straight in the merchant's own wallet.
function Flow() {
  const ys = NETWORKS.map((_, i) => 24 + i * 46);
  const mid = 139;
  return (
    <svg className="landing-flow" viewBox="0 0 560 300" role="img" aria-label="Payments from Base, Ethereum, Arbitrum, Bitcoin, Zcash and NEAR go straight to your business wallet">
      {ys.map((y) => (
        <path key={y} d={`M150 ${y} C 280 ${y}, 290 ${mid}, 380 ${mid}`} />
      ))}
      {NETWORKS.map((id, i) => (
        <g key={id}>
          <image href={chainIcon(id)} x={6} y={ys[i] - 13} width={26} height={26} />
          <text x={42} y={ys[i] + 5}>
            {chainName(id)}
          </text>
        </g>
      ))}
      <text className="landing-flow-caption" x={6} y={296}>
        +{MORE_CHAINS} more coming
      </text>
      <circle className="landing-flow-account" cx={410} cy={mid} r={30} />
      <g transform={`translate(${410 - 14} ${mid - 14})`}>
        <Icon name="wallet" size={28} />
      </g>
      <text x={450} y={mid - 4}>
        Your business
      </text>
      <text x={450} y={mid + 14}>
        wallet
      </text>
    </svg>
  );
}

function Hook() {
  return (
    <div className="landing-hero">
      <div>
        <h1 className="landing-display">
          <span className="landing-display-muted">Stripe for Web2.</span> Gateflow for Web3.
        </h1>
        <p className="landing-lead">
          Accept crypto from any chain in {MINUTES} minutes, without running a crypto backend.
        </p>
        <p className="landing-claims">
          <span>
            <Icon name="shield-check" size={18} /> Compliance built in
          </span>
          <span>
            <Icon name="key-round" size={18} /> Self-custody
          </span>
          <span>
            <Icon name="network" size={18} /> Any chain
          </span>
        </p>
      </div>
      <Flow />
    </div>
  );
}

const STACK = [
  ["Blockchain nodes", "for every chain you accept"],
  ["Hot wallets and keys", "to receive and move funds"],
  ["Bridges", "to move funds between chains"],
  ["A compliance vendor", "to screen who pays you"],
];

function Problem() {
  return (
    <div className="landing-split">
      <div>
        <h2 className="landing-title">Taking crypto usually means building a crypto backend.</h2>
        <p className="landing-lead">With Gateflow you skip all of it. There is no crypto backend to run.</p>
      </div>
      <div className="landing-compare">
        <div className="landing-before">
          <h3>Without Gateflow</h3>
          <ul>
            {STACK.map(([name, why]) => (
              <li key={name}>
                <Icon name="x" size={16} />
                <span>
                  {name}
                  <span className="landing-long"> {why}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="landing-after">
          <h3>
            With <img src={logo} alt="Gateflow" />
          </h3>
          <p>One payment link</p>
        </div>
      </div>
    </div>
  );
}

const STEPS: [string, ReactNode][] = [
  ["Sign in with your email", "No wallet or seed phrase. A passkey on your device secures your account."],
  ["Share a link", "Create an invoice in the console or ask the assistant, then send the link to your buyer."],
  [
    "Get paid from any chain",
    <>
      Buyers pay from any of these networks, and the money lands in your own account.
      <span className="landing-chains">
        {NETWORKS.map((id) => (
          <Chain key={id} id={id} />
        ))}
        <More />
      </span>
    </>,
  ],
];

function How() {
  return (
    <div>
      <h2 className="landing-title">Live in three steps.</h2>
      <ol className="landing-steps">
        {STEPS.map(([title, text], i) => (
          <li key={i} className="landing-step" style={{ ["--i" as string]: i }}>
            <span className="landing-step-n">{i + 1}</span>
            <strong>{title}</strong>
            <span>{text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/// Buyer pays, Gateflow checks the payer, then the payment forks: to the merchant, or back to the buyer.
function Verdict() {
  return (
    <svg className="landing-verdict" viewBox="0 0 616 260" role="img" aria-label="The buyer pays, Gateflow screens the payer in a TEE, then the payment settles to your business wallet if clean or refunds to the buyer if flagged">
      <path d="M128 130 H 186" />
      <path className="landing-verdict-ok" d="M346 130 C 380 130, 380 62, 414 62" />
      <path className="landing-verdict-bad" d="M346 130 C 380 130, 380 198, 414 198" />
      <rect className="landing-verdict-node" x={2} y={106} width={126} height={48} rx={24} />
      <text x={65} y={135} textAnchor="middle">
        Buyer pays
      </text>
      <rect className="landing-verdict-gate" x={186} y={92} width={160} height={76} rx={8} />
      <image href={logo} x={206} y={110} width={120} height={40} />
      <text x={266} y={194} textAnchor="middle">
        TEE screening
      </text>
      <text className="landing-flow-caption" x={266} y={212} textAnchor="middle">
        of every payer
      </text>
      <rect className="landing-verdict-okbox" x={414} y={32} width={200} height={60} rx={8} />
      <path className="landing-verdict-tick" d="M430 58 l6 6 l12 -13" />
      <text x={452} y={60}>
        Your business wallet
      </text>
      <text className="landing-flow-caption" x={452} y={78}>
        if the payer is clean
      </text>
      <rect className="landing-verdict-badbox" x={414} y={168} width={200} height={60} rx={8} />
      <path className="landing-verdict-back" d="M440 188 l-8 6 l8 6 M432 194 h14" />
      <text x={452} y={196}>
        Back to buyer
      </text>
      <text className="landing-flow-caption" x={452} y={214}>
        refunded if flagged
      </text>
    </svg>
  );
}

const TEE_CHECKS = ["Sanctions lists", "Fraud-risk score", "The real sender, even across chains"];

/// What the enclave checks, and that its verdicts are provable.
function TeeCard() {
  return (
    <div className="landing-tee">
      <div className="landing-tee-head">
        <Icon name="cpu" size={20} /> TEE screening
      </div>
      <ul>
        {TEE_CHECKS.map((c) => (
          <li key={c}>
            <Icon name="check" size={16} /> {c}
          </li>
        ))}
      </ul>
      <p className="landing-long">Verdicts come with a TEE attestation you can check.</p>
    </div>
  );
}

function Trust() {
  return (
    <div className="landing-split">
      <div>
        <h2 className="landing-title">Every payer is screened before the money reaches you.</h2>
        <p className="landing-lead landing-long">
          We check each payer against sanctions and fraud-risk lists. The check runs in tamper-proof hardware (a TEE), so nobody can skip or fake it, including us.
        </p>
        <ul className="landing-points">
          <li>
            <Icon name="arrow-left-right" size={18} /> Funds go only to your wallet or back to the payer.
          </li>
          <li>
            <Icon name="lock" size={18} /> Gateflow never holds your keys.
          </li>
          <li>
            <Icon name="key-square" size={18} /> Bring your own key (BYOK) for AML and KYT providers <span className="landing-soon">Coming soon</span>
          </li>
        </ul>
      </div>
      <div className="landing-trust-side">
        <Verdict />
        <TeeCard />
      </div>
    </div>
  );
}

function Snippet() {
  return (
    <pre className="landing-snippet">
      <code>
        {highlight(snippet(location.origin)).map((tok, i) => (
          <span key={i} className={`landing-tok-${tok.t}`}>
            {tok.s}
          </span>
        ))}
      </code>
    </pre>
  );
}

function Developers({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="landing-split">
      <div>
        <h2 className="landing-title">Easy integration.</h2>
        <p className="landing-lead">
          Share invoice links from the console, or open checkout on your own site. Create invoices over the API and get a signed webhook when they are paid.
        </p>
        <div className="landing-ctas">
          <Button variant="primary" size="lg" onClick={onLaunch}>
            Launch console
          </Button>
          <a className="landing-link-button" href={SHOP} target="_blank" rel="noopener">
            Example shop
          </a>
        </div>
      </div>
      <Snippet />
    </div>
  );
}

export default function Landing({ onLaunch }: { onLaunch: () => void }) {
  const [index, setIndex] = useState(() => fromHash(location.hash));
  const go = useRef((step: number) => setIndex((i) => clamp(i + step)));

  useEffect(() => history.replaceState(null, "", toHash(index)), [index]);

  useEffect(() => {
    const step = go.current;
    const gate = wheelGate();
    let touch: { x: number; y: number } | undefined;
    const onKey = (e: KeyboardEvent) => {
      const s = keyStep(e.key, (e.target as Element | null)?.tagName);
      if (s === 0 || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      step(s);
    };
    const onWheel = (e: WheelEvent) => {
      const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * (e.deltaMode === 1 ? 16 : 1);
      step(gate(e.timeStamp, d));
    };
    const onTouchStart = (e: TouchEvent) => {
      touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : undefined;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (touch && t) step(swipeStep(t.clientX - touch.x, t.clientY - touch.y));
      touch = undefined;
    };
    const onHash = () => setIndex(fromHash(location.hash));
    window.addEventListener("hashchange", onHash);
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      root.style.overflow = overflow;
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  const slides = [<Hook />, <Problem />, <How />, <Trust />, <Developers onLaunch={onLaunch} />];
  return (
    <div className="landing">
      <header className="landing-header">
        <img src={logo} alt="gateflow" className="landing-logo" />
        <nav>
          <a className="landing-header-link" href={GITHUB} target="_blank" rel="noopener">
            GitHub
          </a>
          <Button variant="primary" size="sm" onClick={onLaunch}>
            Launch console
          </Button>
        </nav>
      </header>
      <main className="landing-slides">
        {slides.map((s, i) => (
          <section key={i} className={i === index ? "landing-slide is-active" : "landing-slide"} aria-hidden={i !== index} aria-label={`Slide ${i + 1} of ${SLIDES}`}>
            {s}
          </section>
        ))}
      </main>
      <footer className="landing-footer">
        <span className="landing-powered">
          <img src={nearLogo} alt="" /> Powered by NEAR
        </span>
        <span className="landing-dots">
          {slides.map((_, i) => (
            <button key={i} type="button" aria-label={`Slide ${i + 1}`} aria-current={i === index ? "step" : undefined} onClick={() => setIndex(i)} />
          ))}
        </span>
      </footer>
    </div>
  );
}
