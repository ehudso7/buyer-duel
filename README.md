# Buyer Duel

A static, single-page site. Someone enters **one real purchase decision**: what they bought and what an AI recommended. The page draws a **1080×1080 scorecard** (PNG download) and **ready-to-paste captions**.

The free card is the distribution. The paid step is a **link**, not a checkout.

- No backend, database, accounts, or social APIs.
- No analytics, cookies, or keys. The page makes **no network requests** beyond loading its own three files.
- Inputs stay in the visitor's browser (`localStorage`) so they can come back for the 7-day check.

Files: `index.html`, `styles.css`, `app.js`, `README.md`. No build step and no npm.

---

## What the page does

1. **Inputs** (all client-side): category (headphones, flights, insurance, laptop, skincare, other), what you bought, price paid (with currency), what the AI recommended, AI price (optional), why you overrode it (optional, one line), outcome status (`Too early` / `7-day check due`).
2. **Scorecard** drawn on `<canvas>` at 1080×1080: `BUYER DUEL`, human pick vs AI pick, price gap, category, date, status, "Judge the outcome yourself.", and the public baseline in small type. Download it as a PNG. On phones that support it, a **Share image** button opens the system share sheet.
3. **Captions** with one-click copy and live length counters:
   - X / LinkedIn short (kept at under 280 using X's weighted count)
   - X / LinkedIn long
   - Instagram / TikTok
   - Stories overlay (under 12 words)
4. **Paid block** under the card: primary "Private 3-decision pack" → `PAYMENT_URL`; secondary category affiliate slot → `AFFILIATE_URL`, with an affiliate disclosure.
5. **7-day check**: the page remembers the duel and the date it was logged. After 7 days it tells the visitor the check is due; they switch the status and export a second card that shows "Logged … · Updated …"; selecting the status never asserts a week has elapsed or that an outcome was recorded.

### Public baseline (printed on every card, verbatim)

- 31% of surveyed consumers use AI at least occasionally in a purchase journey.
- 19% are regular AI users; about 70% of those regular users buy what the AI recommends.
- Source: BCG consumer survey, 2026, 13,000+ people, 12 markets.
- These are adoption figures, not proof that this decision was correct.

The card is a **comparison, not a verdict**. No copy on the page or in the captions says the AI pick (or the human pick) was better. Price gaps are described neutrally ("cost $X more/less than").

---

## Before launch: paste in your two links

Open `app.js`. The config block is at the very top:

```js
const CONFIG = Object.freeze({
  PAYMENT_URL: "https://example.com/pack",        // ← your payment link
  AFFILIATE_URL: "https://example.com/affiliate", // ← your default affiliate link
  AFFILIATE_URLS: Object.freeze({                 // optional per-category overrides
    headphones: "",
    flights: "",
    insurance: "",
    laptop: "",
    skincare: "",
    other: "",
  }),
});
```

1. **`PAYMENT_URL`**: a hosted payment link for the "Private 3-decision pack" (Stripe Payment Link, Gumroad, Lemon Squeezy, Ko-fi, etc.). Payment happens on that provider's page. Nothing is charged inside this repo.
2. **`AFFILIATE_URL`**: your default affiliate link. To use a different link per category, fill the matching key in `AFFILIATE_URLS`. Empty strings fall back to `AFFILIATE_URL`.

Rules:
- Use full `https://` URLs. Only valid HTTPS links without embedded credentials are enabled. Invalid URLs and example.com placeholders remain visibly unavailable and cannot navigate.
- While either value still contains `example.com`, the block says it is not configured and the browser console shows a warning.
- Payment links and affiliate links are public by design. **Do not put API keys or secret keys here.**
- To change the pack's name or description, edit the `#payment-link` block in `index.html`.

Commit and push. GitHub Pages redeploys in about a minute.

---

## Enable GitHub Pages

Exact setting:

1. Repo → **Settings** → **Pages**.
2. **Build and deployment** → **Source**: `Deploy from a branch`.
3. **Branch**: `main`, folder: `/ (root)`. Click **Save**.
4. Wait about a minute. The site is at `https://<your-user>.github.io/buyer-duel/`.

Same thing from the terminal with the GitHub CLI:

```bash
gh api -X POST repos/<owner>/buyer-duel/pages -f "source[branch]=main" -f "source[path]=/"
gh api repos/<owner>/buyer-duel/pages --jq .html_url
```

GitHub Pages on a free account requires the repo to be **public**.

### Custom domain (optional)

No `CNAME` file is committed. To add a domain, create a file named `CNAME` at the repo root containing only the domain (for example `duel.your-domain.tld`), point a DNS `CNAME` record at `<your-user>.github.io`, then set the same domain under Settings → Pages → Custom domain and tick **Enforce HTTPS**.

---

## Run it locally

Open `index.html` in a browser. It works from `file://`. Or serve the folder:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Quick acceptance check: pick a category, enter a product, price and AI pick, click **Download PNG**, then click **Copy** on a caption and paste it somewhere.

---

## How to post the PNG

1. Fill in the duel and click **Download PNG** (on a phone, **Share image** sends it straight to an app).
2. Copy the caption for the platform:
   - **X**: attach the PNG and paste the short caption (under 280). Use the long one for X Premium or as a reply.
   - **LinkedIn**: attach the PNG and paste the long caption.
   - **Instagram / TikTok**: post the PNG as a square image or carousel slide, paste the Instagram / TikTok caption.
   - **Stories**: upload the PNG, add a text sticker, paste the Stories overlay line.
3. Seven days later, come back to the same page in the same browser, switch the status to **7-day check due**, download the second card, and post it as a follow-up.

Captions are editable in the page before copying. Any change to the duel inputs regenerates them.

---

## Intentionally not built

- **No auto-posting** to X, Instagram, TikTok, LinkedIn or anywhere else. The visitor posts by hand.
- **No charges inside the repo.** No Stripe embed, no checkout code, no payment keys. The paid step is an outbound link.
- No user accounts, server, database, or email collection.
- No analytics or tracking that needs a key. The Content-Security-Policy blocks all outbound requests (`connect-src 'none'`).
- No claim that the AI pick or the human pick was better. The card is a comparison; the viewer judges.

An automation can draft the next caption for you, but it cannot publish and it cannot charge.

---

## Privacy and data

Everything typed stays in the browser under the `localStorage` key `buyerDuel.v1`. **Start a new duel** clears it. Private windows and cleared site data lose it. No form data is sent by the app. Following configured external links or using the share sheet leaves the app; review the destination’s terms. If storage is blocked, the page warns that inputs may be lost.

## Browser support

Current Chrome, Edge, Safari (macOS and iOS 15+), and Firefox. The PNG is generated with `canvas.toBlob`. Clipboard copy uses the Clipboard API with a fallback; if both are blocked, the caption text is selected so the visitor can press Ctrl/Cmd+C.

## Repair notes

Status is user-selected, not proof of elapsed time or a recorded outcome. Dates loaded from storage are checked; invalid and future creation dates are reset. Prices use one selected currency for both picks. Payment scope, delivery and privacy promises must be established by the operator before configuring a payment link. No paid service is currently enabled.
