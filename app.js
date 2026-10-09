/*
 * Buyer Duel — static, client-only scorecard generator.
 * No network calls, no analytics, no accounts. Inputs persist in localStorage only.
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // OPERATOR CONFIG — replace these two links before launch (see README).
  // ---------------------------------------------------------------------------
  const CONFIG = Object.freeze({
    // Your payment link (Stripe Payment Link, Gumroad, Lemon Squeezy, etc.).
    PAYMENT_URL: "https://example.com/pack",
    // Default affiliate link, used for every category without its own entry below.
    AFFILIATE_URL: "https://example.com/affiliate",
    // Optional per-category affiliate links. Leave "" to fall back to AFFILIATE_URL.
    AFFILIATE_URLS: Object.freeze({
      headphones: "",
      flights: "",
      insurance: "",
      laptop: "",
      skincare: "",
      other: "",
    }),
  });

  // Public baseline. Printed verbatim on every card; do not add other stats.
  const BASELINE = Object.freeze({
    lines: [
      "31% of surveyed consumers use AI at least occasionally in a purchase journey.",
      "19% are regular AI users; about 70% of those regular users buy what the AI recommends.",
    ],
    source: "Source: BCG consumer survey, 2026, 13,000+ people, 12 markets.",
    caveat: "These are adoption figures, not proof that this decision was correct.",
  });

  const STORAGE_KEY = "buyerDuel.v1";
  const CARD_SIZE = 1080;
  const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const COLORS = Object.freeze({
    bg: "#0e0f13",
    panel: "#171a22",
    line: "#2a2e3a",
    text: "#f3f4f7",
    muted: "#9aa0b2",
    human: "#ff8a3d",
    ai: "#5cc8ff",
  });

  const CATEGORIES = Object.freeze({
    headphones: { label: "Headphones", noun: "headphones", tag: "headphones" },
    flights: { label: "Flights", noun: "a flight", tag: "travel" },
    insurance: { label: "Insurance", noun: "insurance", tag: "insurance" },
    laptop: { label: "Laptop", noun: "a laptop", tag: "laptop" },
    skincare: { label: "Skincare", noun: "skincare", tag: "skincare" },
    other: { label: "Other", noun: "a purchase", tag: "shopping" },
  });
  const STATUSES = Object.freeze({
    "too-early": { label: "Too early to judge", short: "Too early" },
    "7-day-check": { label: "7-day check due", short: "7-day check" },
  });
  const CURRENCIES = new Set(["USD", "EUR", "GBP", "CAD", "AUD", "INR", "JPY", "BRL", "MXN"]);
  const MAX_PRICE = 10_000_000;

  const $ = (id) => document.getElementById(id);
  const form = $("duel-form");
  const canvas = $("card");
  const ctx = canvas.getContext("2d");
  const fields = {
    category: $("category"),
    product: $("product"),
    price: $("price"),
    currency: $("currency"),
    aiPick: $("aiPick"),
    aiPrice: $("aiPrice"),
    reason: $("reason"),
  };

  // ---------------------------------------------------------------------------
  // Storage (fail-safe: private mode / blocked storage must not break the page)
  // ---------------------------------------------------------------------------
  const storage = {
    read() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        return data && typeof data === "object" ? data : null;
      } catch {
        return null;
      }
    },
    write(data) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* storage unavailable; nothing to clear */
      }
    },
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let meta = { createdAt: null, updatedAt: null };

  const clean = (s, max) =>
    String(s ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);

  const parseMoney = (raw) => {
    const s = String(raw ?? "").trim();
    if (s === "") return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE) return NaN;
    return Math.round(n * 100) / 100;
  };

  function readState() {
    const status = form.querySelector('input[name="status"]:checked')?.value;
    const category = fields.category.value in CATEGORIES ? fields.category.value : "other";
    const currency = CURRENCIES.has(fields.currency.value) ? fields.currency.value : "USD";
    return {
      category,
      product: clean(fields.product.value, 60),
      price: parseMoney(fields.price.value),
      currency,
      aiPick: clean(fields.aiPick.value, 60),
      aiPrice: parseMoney(fields.aiPrice.value),
      reason: clean(fields.reason.value, 90),
      status: status in STATUSES ? status : "too-early",
    };
  }

  function applyState(s) {
    if (!s) return;
    if (s.category in CATEGORIES) fields.category.value = s.category;
    if (CURRENCIES.has(s.currency)) fields.currency.value = s.currency;
    fields.product.value = typeof s.product === "string" ? s.product.slice(0, 60) : "";
    fields.aiPick.value = typeof s.aiPick === "string" ? s.aiPick.slice(0, 60) : "";
    fields.reason.value = typeof s.reason === "string" ? s.reason.slice(0, 90) : "";
    fields.price.value = Number.isFinite(s.price) ? String(s.price) : "";
    fields.aiPrice.value = Number.isFinite(s.aiPrice) ? String(s.aiPrice) : "";
    const radio = form.querySelector(`input[name="status"][value="${s.status in STATUSES ? s.status : "too-early"}"]`);
    if (radio) radio.checked = true;
  }

  function persist(state) {
    const hasContent = state.product || state.aiPick || state.price !== null;
    const now = new Date().toISOString();
    if (hasContent && !meta.createdAt) meta.createdAt = now;
    meta.updatedAt = now;
    storage.write({
      v: 1,
      state: {
        ...state,
        price: Number.isFinite(state.price) ? state.price : null,
        aiPrice: Number.isFinite(state.aiPrice) ? state.aiPrice : null,
      },
      meta,
    });
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------
  const moneyFmtCache = new Map();
  function money(n, currency) {
    if (!Number.isFinite(n)) return "";
    const whole = Number.isInteger(n) || currency === "JPY";
    const key = `${currency}|${whole}`;
    let fmt = moneyFmtCache.get(key);
    if (!fmt) {
      try {
        fmt = new Intl.NumberFormat(undefined, {
          style: "currency",
          currency,
          minimumFractionDigits: whole ? 0 : 2,
          maximumFractionDigits: whole ? 0 : 2,
        });
      } catch {
        fmt = { format: (v) => `${currency} ${v.toFixed(whole ? 0 : 2)}` };
      }
      moneyFmtCache.set(key, fmt);
    }
    return fmt.format(n);
  }

  const dateFmt = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
  const fmtDate = (d) => dateFmt.format(d);

  const DAY_MS = 86_400_000;
  function daysSince(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return 0;
    return Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
  }

  /** Neutral description of the price gap. Never implies which pick was better. */
  function priceGap(s) {
    if (!Number.isFinite(s.price)) return { headline: "Price gap: —", detail: "Add the price you paid." };
    if (!Number.isFinite(s.aiPrice)) return { headline: "Price gap: n/a", detail: "AI price not recorded." };
    const gap = Math.round((s.price - s.aiPrice) * 100) / 100;
    if (gap === 0) return { headline: "Price gap: none", detail: "Both picks cost the same.", gap };
    const abs = money(Math.abs(gap), s.currency);
    const pct = s.aiPrice > 0 ? ` (${Math.round((Math.abs(gap) / s.aiPrice) * 100)}%)` : "";
    return gap > 0
      ? { headline: `Price gap: +${abs}`, detail: `Human pick cost ${abs}${pct} more than the AI pick.`, gap }
      : { headline: `Price gap: −${abs}`, detail: `Human pick cost ${abs}${pct} less than the AI pick.`, gap };
  }

  // ---------------------------------------------------------------------------
  // Canvas card (1080×1080)
  // ---------------------------------------------------------------------------
  const font = (weight, size, style = "normal") => `${style} ${weight} ${size}px ${FONT}`;

  /** Greedy word wrap with hard breaks for long tokens and an ellipsis on overflow. */
  function wrapLines(text, maxWidth, maxLines) {
    const words = String(text).split(" ").filter(Boolean);
    const lines = [];
    let line = "";
    const fits = (t) => ctx.measureText(t).width <= maxWidth;

    for (let i = 0; i < words.length; i++) {
      let word = words[i];
      // Break tokens wider than the box (URLs, model numbers) by characters.
      while (!fits(word)) {
        let cut = word.length - 1;
        while (cut > 1 && !fits(word.slice(0, cut))) cut--;
        if (line) { lines.push(line); line = ""; }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const test = line ? `${line} ${word}` : word;
      if (fits(test)) {
        line = test;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);

    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      let last = kept[maxLines - 1];
      while (last.length && !fits(`${last}…`)) last = last.slice(0, -1);
      kept[maxLines - 1] = `${last.trimEnd()}…`;
      return kept;
    }
    return lines;
  }

  /** Draws wrapped text, shrinking the font until it fits within maxLines. Returns the height used. */
  function fitText(text, x, y, maxWidth, { weight = 800, size, minSize, maxLines, maxHeight = Infinity, lineHeight = 1.12, color, style }) {
    let s = size;
    let lines;
    const allowed = (sz) => Math.max(1, Math.min(maxLines, Math.floor(maxHeight / Math.round(sz * lineHeight))));
    for (; s >= minSize; s -= 2) {
      ctx.font = font(weight, s, style);
      lines = wrapLines(text, maxWidth, Infinity);
      if (lines.length <= allowed(s)) break;
    }
    if (s < minSize) {
      s = minSize;
      ctx.font = font(weight, s, style);
      lines = wrapLines(text, maxWidth, allowed(s));
    }
    ctx.fillStyle = color;
    ctx.textBaseline = "top";
    const lh = Math.round(s * lineHeight);
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
    return lines.length * lh;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }

  function tracked(text, x, y, spacing) {
    // Letter-spaced text that works in browsers without ctx.letterSpacing.
    if ("letterSpacing" in ctx) {
      ctx.letterSpacing = `${spacing}px`;
      ctx.fillText(text, x, y);
      ctx.letterSpacing = "0px";
      return;
    }
    let cx = x;
    for (const ch of text) {
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + spacing;
    }
  }

  function trackedWidth(text, spacing) {
    return ctx.measureText(text).width + spacing * Math.max(0, [...text].length - 1);
  }

  function pill(text, rightX, y, { bg, fg, size = 26, padX = 22, h = 52 }) {
    ctx.font = font(800, size);
    const w = trackedWidth(text, 2) + padX * 2;
    const x = rightX - w;
    roundRect(x, y, w, h, h / 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textBaseline = "middle";
    tracked(text, x + padX, y + h / 2 + 1, 2);
    return w;
  }

  function sideCard(x, y, w, h, { label, color, pick, price, currency, placeholder }) {
    roundRect(x, y, w, h, 28);
    ctx.fillStyle = COLORS.panel;
    ctx.fill();
    // Accent bar
    ctx.save();
    roundRect(x, y, w, h, 28);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, 10);
    ctx.restore();

    const pad = 36;
    const innerW = w - pad * 2;
    ctx.fillStyle = color;
    ctx.font = font(800, 26);
    ctx.textBaseline = "top";
    tracked(label, x + pad, y + 44, 4);

    fitText(pick || placeholder, x + pad, y + 96, innerW, {
      size: 50,
      minSize: 30,
      maxLines: 4,
      maxHeight: h - 96 - 104,
      color: pick ? COLORS.text : COLORS.muted,
    });

    ctx.textBaseline = "alphabetic";
    const priceText = Number.isFinite(price) ? money(price, currency) : "Price n/a";
    let s = 64;
    ctx.font = font(800, s);
    while (s > 34 && ctx.measureText(priceText).width > innerW) {
      s -= 2;
      ctx.font = font(800, s);
    }
    ctx.fillStyle = Number.isFinite(price) ? color : COLORS.muted;
    ctx.fillText(priceText, x + pad, y + h - 40);
  }

  function drawCard(s) {
    const W = CARD_SIZE;
    const M = 64;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);

    // Background with subtle split glow
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, W);
    const gl = ctx.createRadialGradient(140, 520, 0, 140, 520, 620);
    gl.addColorStop(0, "rgba(255,138,61,0.16)");
    gl.addColorStop(1, "rgba(255,138,61,0)");
    ctx.fillStyle = gl;
    ctx.fillRect(0, 0, W, W);
    const gr = ctx.createRadialGradient(940, 520, 0, 940, 520, 620);
    gr.addColorStop(0, "rgba(92,200,255,0.14)");
    gr.addColorStop(1, "rgba(92,200,255,0)");
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, W);

    // Header: title + category pill
    ctx.fillStyle = COLORS.text;
    ctx.font = font(900, 76);
    ctx.textBaseline = "alphabetic";
    tracked("BUYER DUEL", M, M + 66, 6);
    pill(CATEGORIES[s.category].label.toUpperCase(), W - M, M + 14, { bg: COLORS.text, fg: COLORS.bg });

    // Date + status line
    const isCheck = s.status === "7-day-check";
    const logged = meta.createdAt ? new Date(meta.createdAt) : new Date();
    const dateLine = isCheck
      ? `Logged ${fmtDate(logged)} · Checked ${fmtDate(new Date())}`
      : fmtDate(logged);
    ctx.font = font(600, 28);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(dateLine, M, M + 118);
    pill(STATUSES[s.status].label.toUpperCase(), W - M, M + 88, {
      bg: isCheck ? COLORS.human : COLORS.line,
      fg: isCheck ? COLORS.bg : COLORS.text,
      size: 20,
      padX: 18,
      h: 42,
    });

    // Two sides
    // Bottom-up layout: baseline small print, rule, judge line; duel cards take the rest.
    ctx.font = font(500, 19);
    const small = `${BASELINE.lines.join(" ")} ${BASELINE.source} ${BASELINE.caveat}`;
    const smallLines = wrapLines(small, W - M * 2, 5);
    const smallLH = 25;
    const smallY = W - M - smallLines.length * smallLH + 6;
    const ruleY = smallY - 18;
    const judgeY = ruleY - 26 - 44;
    const BAND_H = 84;
    const REASON_H = s.reason ? 112 : 0;

    const top = 230;
    const gap = 36;
    const cw = (W - M * 2 - gap) / 2;
    const ch = judgeY - 20 - REASON_H - 24 - BAND_H - 28 - top;
    sideCard(M, top, cw, ch, {
      label: "HUMAN PICK",
      color: COLORS.human,
      pick: s.product,
      price: s.price,
      currency: s.currency,
      placeholder: "What you bought",
    });
    sideCard(M + cw + gap, top, cw, ch, {
      label: "AI PICK",
      color: COLORS.ai,
      pick: s.aiPick,
      price: s.aiPrice,
      currency: s.currency,
      placeholder: "What the AI recommended",
    });

    // VS badge
    const vx = W / 2;
    const vy = top + ch / 2;
    ctx.beginPath();
    ctx.arc(vx, vy, 44, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.text;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = COLORS.bg;
    ctx.stroke();
    ctx.fillStyle = COLORS.bg;
    ctx.font = font(900, 32);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("VS", vx, vy + 2);
    ctx.textAlign = "left";

    // Price gap band
    const gapInfo = priceGap(s);
    let y = top + ch + 28;
    roundRect(M, y, W - M * 2, BAND_H, 22);
    ctx.fillStyle = COLORS.panel;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.line;
    ctx.stroke();
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLORS.text;
    ctx.font = font(800, 36);
    const headline = gapInfo.headline;
    ctx.fillText(headline, M + 32, y + BAND_H / 2);
    const hw = ctx.measureText(headline).width;
    ctx.fillStyle = COLORS.muted;
    let ds = 26;
    ctx.font = font(500, ds);
    const room = W - M * 2 - 32 - hw - 28 - 32;
    while (ds > 18 && ctx.measureText(gapInfo.detail).width > room) {
      ds -= 1;
      ctx.font = font(500, ds);
    }
    const detailLines = wrapLines(gapInfo.detail, room, 2);
    const dlh = ds * 1.2;
    detailLines.forEach((l, i) =>
      ctx.fillText(l, M + 32 + hw + 28, y + BAND_H / 2 + (i - (detailLines.length - 1) / 2) * dlh)
    );
    y += BAND_H + 24;

    // Override reason
    if (s.reason) {
      ctx.textBaseline = "top";
      ctx.fillStyle = COLORS.muted;
      ctx.font = font(700, 22);
      tracked("WHY I OVERRODE IT", M, y, 3);
      y += 32;
      fitText(`“${s.reason}”`, M, y, W - M * 2, {
        weight: 600,
        size: 28,
        minSize: 22,
        maxLines: 2,
        lineHeight: 1.2,
        color: COLORS.text,
        style: "italic",
      });
    }

    // Call to judge
    ctx.textBaseline = "top";
    ctx.fillStyle = COLORS.text;
    ctx.font = font(900, 40);
    ctx.fillText("Judge the outcome yourself.", M, judgeY);

    // Baseline small print
    ctx.fillStyle = COLORS.line;
    ctx.fillRect(M, ruleY, W - M * 2, 2);
    ctx.fillStyle = COLORS.muted;
    ctx.font = font(500, 19);
    ctx.textBaseline = "top";
    smallLines.forEach((l, i) => ctx.fillText(l, M, smallY + i * smallLH));

    ctx.restore();

    canvas.setAttribute(
      "aria-label",
      `Buyer Duel scorecard. Category ${CATEGORIES[s.category].label}. My pick: ${s.product || "not set"}` +
        `${Number.isFinite(s.price) ? `, ${money(s.price, s.currency)}` : ""}. AI pick: ${s.aiPick || "not set"}` +
        `${Number.isFinite(s.aiPrice) ? `, ${money(s.aiPrice, s.currency)}` : ""}. ${gapInfo.detail} ` +
        `Status: ${STATUSES[s.status].label}. Judge the outcome yourself.`
    );
  }

  // ---------------------------------------------------------------------------
  // Captions
  // ---------------------------------------------------------------------------

  /** X weighted length: most Latin text counts 1, CJK/emoji count 2. URLs are not auto-inserted here. */
  function xLength(text) {
    let n = 0;
    for (const ch of text) {
      const c = ch.codePointAt(0);
      const light =
        (c >= 0 && c <= 4351) ||
        (c >= 8192 && c <= 8205) ||
        (c >= 8208 && c <= 8223) ||
        (c >= 8242 && c <= 8247);
      n += light ? 1 : 2;
    }
    return n;
  }

  const truncate = (s, max) => {
    const chars = [...s];
    return chars.length <= max ? s : `${chars.slice(0, Math.max(1, max - 1)).join("").trimEnd()}…`;
  };

  const priceOr = (n, currency, fallback) => (Number.isFinite(n) ? money(n, currency) : fallback);

  function captionParts(s) {
    const cat = CATEGORIES[s.category];
    const mine = s.product || "my pick";
    const ai = s.aiPick || "the AI's pick";
    const myPrice = priceOr(s.price, s.currency, "price n/a");
    const aiPrice = priceOr(s.aiPrice, s.currency, "no price given");
    const gap = priceGap(s);
    const isCheck = s.status === "7-day-check";
    return { cat, mine, ai, myPrice, aiPrice, gap, isCheck };
  }

  function xShort(s) {
    const { cat, myPrice, aiPrice, isCheck } = captionParts(s);
    const build = (mine, ai, reason) =>
      [
        isCheck ? `Buyer Duel, 7-day check: ${cat.noun}.` : `Buyer Duel: ${cat.noun}.`,
        "",
        `Me: ${mine} (${myPrice})`,
        `AI: ${ai} (${aiPrice})`,
        reason ? `Why I overrode it: ${reason}` : null,
        "",
        isCheck ? "A week in. Not a verdict. You judge." : "Too early to call. Not a verdict. You judge.",
        "#BuyerDuel",
      ]
        .filter((l) => l !== null)
        .join("\n");

    const mine0 = s.product || "my pick";
    const ai0 = s.aiPick || "the AI's pick";
    let text = build(mine0, ai0, s.reason);
    if (xLength(text) <= 280) return text;
    // Shorten progressively: reason first, then the two product names.
    for (let r = [...s.reason].length - 1; r >= 20; r -= 5) {
      text = build(mine0, ai0, truncate(s.reason, r));
      if (xLength(text) <= 280) return text;
    }
    text = build(mine0, ai0, "");
    for (let p = 59; p >= 12; p -= 3) {
      text = build(truncate(mine0, p), truncate(ai0, p), "");
      if (xLength(text) <= 280) return text;
    }
    return text;
  }

  function xLong(s) {
    const { cat, mine, ai, myPrice, aiPrice, gap, isCheck } = captionParts(s);
    return [
      isCheck
        ? `7-day check on my Buyer Duel: ${cat.noun}.`
        : `I ran a Buyer Duel on ${cat.noun}: my pick vs the AI's pick.`,
      "",
      `My pick: ${mine} (${myPrice})`,
      `AI's pick: ${ai} (${aiPrice})`,
      Number.isFinite(gap.gap) ? gap.detail.replace("Human pick", "My pick").replace("the AI pick", "the AI's pick") : null,
      s.reason ? `Why I overrode the AI: ${s.reason}` : null,
      "",
      isCheck
        ? "It's been a week. I'm not calling a winner here. The card is a comparison, not a verdict."
        : "Too early to say how it turns out. I'll check back in 7 days.",
      "",
      `For context: ${BASELINE.lines[0]} ${BASELINE.lines[1]} (BCG consumer survey, 2026, 13,000+ people, 12 markets.) Those are adoption figures, not proof that this decision was right.`,
      "",
      "Would you have gone with the AI? Judge the outcome yourself.",
      "",
      "#BuyerDuel",
    ]
      .filter((l) => l !== null)
      .join("\n");
  }

  function instagram(s) {
    const { cat, mine, ai, myPrice, aiPrice, isCheck } = captionParts(s);
    return [
      isCheck ? `Buyer Duel · 7-day check · ${cat.label}` : `Buyer Duel · ${cat.label}`,
      "",
      `🟧 My pick: ${mine} — ${myPrice}`,
      `🟦 AI's pick: ${ai} — ${aiPrice}`,
      s.reason ? `Why I overrode it: ${s.reason}` : null,
      "",
      isCheck ? "One week later. Who called it? You decide." : "Too early to judge. Check back in 7 days.",
      "",
      "Comment HUMAN or AI 👇",
      "",
      "Stats on the card are adoption figures (BCG consumer survey, 2026), not a verdict on this purchase.",
      "",
      `#BuyerDuel #AIshopping #${cat.tag} #shoppingtips #humanvsai`,
    ]
      .filter((l) => l !== null)
      .join("\n");
  }

  function storyOverlay(s) {
    const shortCat = {
      headphones: "headphones",
      flights: "flights",
      insurance: "insurance",
      laptop: "laptops",
      skincare: "skincare",
      other: "this buy",
    }[s.category];
    return s.status === "7-day-check"
      ? `Day 7: me vs the AI on ${shortCat}. Verdict?`
      : `Me vs the AI on ${shortCat}. You judge.`;
  }

  const wordCount = (t) => t.trim().split(/\s+/).filter(Boolean).length;

  const CAPTION_DEFS = [
    { id: "x-short", title: "X / LinkedIn · short", limit: 280, count: "x", make: xShort, rows: 7 },
    { id: "x-long", title: "X / LinkedIn · long", count: "chars", make: xLong, rows: 10 },
    { id: "insta", title: "Instagram / TikTok", limit: 2200, count: "chars", make: instagram, rows: 10 },
    { id: "story", title: "Stories overlay", limit: 11, count: "words", make: storyOverlay, rows: 2 },
  ];

  const captionEls = new Map();
  const editedCaptions = new Set();

  function buildCaptionUI() {
    const root = $("captions");
    for (const def of CAPTION_DEFS) {
      const card = document.createElement("article");
      card.className = "caption";

      const head = document.createElement("div");
      head.className = "caption-head";
      const h = document.createElement("h3");
      h.id = `cap-${def.id}-title`;
      h.textContent = def.title;
      const metaEl = document.createElement("span");
      metaEl.className = "caption-meta";
      metaEl.id = `cap-${def.id}-meta`;
      head.append(h, metaEl);

      const ta = document.createElement("textarea");
      ta.id = `cap-${def.id}`;
      ta.rows = def.rows;
      ta.spellcheck = true;
      ta.setAttribute("aria-labelledby", h.id);
      ta.setAttribute("aria-describedby", metaEl.id);
      ta.addEventListener("input", () => {
        editedCaptions.add(def.id);
        updateMeta(def, ta, metaEl);
        autoSize(ta);
      });

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn";
      btn.textContent = "Copy";
      btn.addEventListener("click", async () => {
        const ok = await copyText(ta.value);
        if (ok) {
          btn.textContent = "Copied ✓";
          btn.classList.add("copied");
          toast(`${def.title} caption copied`);
          setTimeout(() => {
            btn.textContent = "Copy";
            btn.classList.remove("copied");
          }, 1800);
        } else {
          ta.focus();
          ta.select();
          toast("Copy blocked by the browser. Text is selected; press Ctrl/Cmd+C.");
        }
      });

      card.append(head, ta, btn);
      root.append(card);
      captionEls.set(def.id, { def, ta, metaEl });
    }
  }

  function updateMeta(def, ta, metaEl) {
    const v = ta.value;
    const used = def.count === "x" ? xLength(v) : def.count === "words" ? wordCount(v) : [...v].length;
    const unit = def.count === "words" ? " words" : def.count === "chars" ? " chars" : "";
    metaEl.textContent = def.limit ? `${used}/${def.limit}${unit}` : `${used}${unit}`;
    metaEl.classList.toggle("over", Boolean(def.limit) && used > def.limit);
  }

  function autoSize(ta) {
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight + 2}px`;
  }

  function renderCaptions(s, { force = false } = {}) {
    for (const { def, ta, metaEl } of captionEls.values()) {
      if (force || !editedCaptions.has(def.id)) ta.value = def.make(s);
      updateMeta(def, ta, metaEl);
      autoSize(ta);
    }
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* fall through to legacy path */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Validation, export, share
  // ---------------------------------------------------------------------------
  function setError(field, msg) {
    const el = $(`${field.id}-error`);
    if (msg) {
      field.setAttribute("aria-invalid", "true");
      if (el) {
        el.textContent = msg;
        el.hidden = false;
        field.setAttribute("aria-describedby", el.id);
      }
    } else {
      field.removeAttribute("aria-invalid");
      if (el) el.hidden = true;
      field.removeAttribute("aria-describedby");
    }
  }

  function validate(s, { show }) {
    const problems = [];
    if (!s.product) problems.push([fields.product, "Add what you bought."]);
    if (s.price === null || Number.isNaN(s.price)) problems.push([fields.price, "Enter the price you paid (0 or more)."]);
    if (!s.aiPick) problems.push([fields.aiPick, "Add what the AI recommended."]);
    if (Number.isNaN(s.aiPrice)) problems.push([fields.aiPrice, "Use a number of 0 or more, or leave it blank."]);
    if (show) {
      for (const f of [fields.product, fields.price, fields.aiPick, fields.aiPrice]) setError(f, null);
      for (const [f, m] of problems) setError(f, m);
      if (problems.length) problems[0][0].focus();
    }
    return problems.length === 0;
  }

  const slug = (t) =>
    t
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .slice(0, 32) || "duel";

  function fileName(s) {
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const suffix = s.status === "7-day-check" ? "-7day" : "";
    return `buyer-duel-${s.category}-${slug(s.product)}-${stamp}${suffix}.png`;
  }

  function cardBlob() {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png");
    });
  }

  const msgEl = $("form-msg");
  function setMsg(text, isError = false) {
    msgEl.textContent = text;
    msgEl.classList.toggle("is-error", isError);
  }

  async function exportPng() {
    const s = readState();
    if (!validate(s, { show: true })) {
      setMsg("Fill in the highlighted fields to export your card.", true);
      return;
    }
    const btn = $("download-btn");
    btn.disabled = true;
    try {
      persist(s);
      drawCard(s);
      const blob = await cardBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName(s);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMsg(`Saved ${a.download}. Post it with a caption below.`);
      toast("PNG downloaded");
    } catch (err) {
      setMsg(`Could not export the PNG (${err.message}). Try another browser.`, true);
    } finally {
      btn.disabled = false;
    }
  }

  let shareSupported = false;
  function detectShare() {
    try {
      const probe = new File([new Blob([""], { type: "image/png" })], "probe.png", { type: "image/png" });
      shareSupported = typeof navigator.share === "function" && navigator.canShare?.({ files: [probe] }) === true;
    } catch {
      shareSupported = false;
    }
    $("share-btn").hidden = !shareSupported;
  }

  async function sharePng() {
    const s = readState();
    if (!validate(s, { show: true })) {
      setMsg("Fill in the highlighted fields to share your card.", true);
      return;
    }
    try {
      persist(s);
      drawCard(s);
      const blob = await cardBlob();
      const file = new File([blob], fileName(s), { type: "image/png" });
      await navigator.share({ files: [file], text: captionEls.get("x-short").ta.value });
      setMsg("Shared.");
    } catch (err) {
      if (err?.name !== "AbortError") setMsg("Sharing failed. Use Download PNG instead.", true);
    }
  }

  // ---------------------------------------------------------------------------
  // Paid block, 7-day check, toast
  // ---------------------------------------------------------------------------
  const safeUrl = (u) => {
    try {
      const url = new URL(u);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
      return null;
    }
  };

  function updatePaidLinks(s) {
    const pay = $("payment-link");
    const aff = $("affiliate-link");
    const payUrl = safeUrl(CONFIG.PAYMENT_URL);
    const affUrl = safeUrl(CONFIG.AFFILIATE_URLS[s.category] || CONFIG.AFFILIATE_URL);
    if (payUrl) pay.href = payUrl;
    pay.hidden = !payUrl;
    if (affUrl) aff.href = affUrl;
    aff.hidden = !affUrl;
    $("affiliate-label").textContent =
      s.category === "other" ? "Compare options for your next purchase" : `Compare ${CATEGORIES[s.category].label.toLowerCase()} options`;
  }

  function updateCheckPanel(s) {
    const el = $("check-text");
    const markBtn = $("mark-due-btn");
    el.textContent = "";
    if (!meta.createdAt) {
      el.append(
        "Bookmark this page (Ctrl/Cmd+D). Your inputs stay in this browser, so in 7 days you can come back, switch the status to ",
        Object.assign(document.createElement("strong"), { textContent: "7-day check due" }),
        ", and export a second card."
      );
      markBtn.hidden = s.status === "7-day-check";
      return;
    }
    const days = daysSince(meta.createdAt);
    const started = fmtDate(new Date(meta.createdAt));
    if (s.status === "7-day-check") {
      el.append(`Duel logged ${started} (${days} day${days === 1 ? "" : "s"} ago). Your card now shows the 7-day check. Download it as your second card.`);
      markBtn.hidden = true;
    } else if (days >= 7) {
      el.append(
        Object.assign(document.createElement("strong"), { textContent: "Your 7-day check is due. " }),
        `Duel logged ${started}. Switch the status and export your second card.`
      );
      markBtn.hidden = false;
    } else {
      const left = 7 - days;
      el.append(
        `Duel logged ${started}. Check back in ${left} day${left === 1 ? "" : "s"}. Bookmark this page (Ctrl/Cmd+D); your inputs stay in this browser.`
      );
      markBtn.hidden = false;
    }
  }

  let toastTimer;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.hidden = true;
    }, 2200);
  }

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------
  let rafId = 0;
  function scheduleRender({ forceCaptions = false } = {}) {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      const s = readState();
      $("reason-count").textContent = String([...fields.reason.value].length);
      persist(s);
      drawCard(s);
      renderCaptions(s, { force: forceCaptions });
      updatePaidLinks(s);
      updateCheckPanel(s);
    });
  }

  function onInput(e) {
    // Any change to the duel regenerates captions (manual caption edits are replaced).
    editedCaptions.clear();
    if (e?.target?.getAttribute?.("aria-invalid") === "true") setError(e.target, null);
    if (msgEl.classList.contains("is-error")) setMsg("");
    scheduleRender();
  }

  function init() {
    const saved = storage.read();
    if (saved?.state) applyState(saved.state);
    if (saved?.meta) {
      meta = {
        createdAt: typeof saved.meta.createdAt === "string" ? saved.meta.createdAt : null,
        updatedAt: typeof saved.meta.updatedAt === "string" ? saved.meta.updatedAt : null,
      };
    }

    buildCaptionUI();
    detectShare();

    form.addEventListener("input", onInput);
    form.addEventListener("change", onInput);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      exportPng();
    });
    $("download-btn").addEventListener("click", exportPng);
    $("share-btn").addEventListener("click", sharePng);
    $("mark-due-btn").addEventListener("click", () => {
      $("status-due").checked = true;
      onInput();
      $("preview-title").scrollIntoView({ behavior: "smooth", block: "start" });
      toast("Status set to 7-day check due");
    });
    $("new-duel-btn").addEventListener("click", () => {
      // Two-tap confirm avoids a blocking dialog.
      const btn = $("new-duel-btn");
      if (btn.dataset.armed !== "1") {
        btn.dataset.armed = "1";
        btn.textContent = "Tap again to clear this duel";
        setTimeout(() => {
          btn.dataset.armed = "";
          btn.textContent = "Start a new duel";
        }, 3500);
        return;
      }
      btn.dataset.armed = "";
      btn.textContent = "Start a new duel";
      storage.clear();
      meta = { createdAt: null, updatedAt: null };
      form.reset();
      for (const f of [fields.product, fields.price, fields.aiPick, fields.aiPrice]) setError(f, null);
      setMsg("");
      editedCaptions.clear();
      scheduleRender({ forceCaptions: true });
      fields.product.focus();
      toast("Cleared. New duel started.");
    });

    // Redraw once web/system fonts settle so canvas metrics are correct.
    scheduleRender({ forceCaptions: true });
    document.fonts?.ready?.then(() => scheduleRender()).catch(() => {});
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) scheduleRender();
    });

    if (/example\.com/i.test(CONFIG.PAYMENT_URL) || /example\.com/i.test(CONFIG.AFFILIATE_URL)) {
      console.warn("[Buyer Duel] PAYMENT_URL / AFFILIATE_URL are still placeholders. Edit CONFIG at the top of app.js.");
    }
  }

  init();
})();
