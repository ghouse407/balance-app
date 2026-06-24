// app.js — final version (predicted-only, LOC split, seasonal utilities, updated totals)

let currentPayments = [];
let dayWindow = 4;

const UTILITY_NAMES = ["Hydro One", "Enbridge Gas"];
const LOC_NAMES = ["Scotia LOC Interest 1", "Scotia LOC Interest 2"];
const PROPERTY_TAX_NAMES = ["Bradford Property Tax", "Milton Property Tax"];

// ========== LOAD BACKEND ==========

async function loadBackend() {
  const stored = localStorage.getItem("backendData");
  if (stored) return normalize(JSON.parse(stored));

  const res = await fetch("backend.json");
  const data = await res.json();
  const payments = Array.isArray(data.recurringPayments) ? data.recurringPayments : data;
  return normalize(payments);
}

function normalize(payments) {
  return payments.map(p => ({
    name: p.name,
    history: (p.history || [])
      .map(h => ({ date: h.date, amount: h.amount }))
      .sort((a, b) => new Date(a.date) - new Date(b.date))
  }));
}

// ========== DATE HELPERS ==========

function formatDate(d) {
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function daysBetween(dateStr) {
  const today = new Date();
  const target = new Date(dateStr + "T00:00:00Z");
  return Math.ceil((target - today) / 86400000);
}

function updateToday() {
  document.getElementById("today").textContent =
    new Date().toLocaleDateString("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
}

// ========== NEXT DATE PREDICTION ==========

function predictNextDate(history) {
  if (history.length < 2) return null;

  const dates = history
    .map(h => new Date(h.date + "T00:00:00Z"))
    .sort((a, b) => a - b);

  const gaps = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push(Math.round((dates[i] - dates[i - 1]) / 86400000));
  }

  const freq = {};
  gaps.forEach(g => (freq[g] = (freq[g] || 0) + 1));
  const mostCommonGap = parseInt(
    Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
  );

  let next = new Date(dates[dates.length - 1]);
  next.setUTCDate(next.getUTCDate() + mostCommonGap);

  const today = new Date();
  while (next < today) next.setUTCDate(next.getUTCDate() + mostCommonGap);

  return next.toISOString().split("T")[0];
}

// ========== AMOUNT PREDICTION MODELS ==========

// Seasonal prediction for utilities: average of same month
function predictSeasonalAmount(history, nextDateStr) {
  const nextMonth = new Date(nextDateStr + "T00:00:00Z").getUTCMonth(); // 0-11
  const sameMonthAmounts = history
    .filter(h => new Date(h.date + "T00:00:00Z").getUTCMonth() === nextMonth)
    .map(h => h.amount);

  if (sameMonthAmounts.length === 0) return null;

  const avg =
    sameMonthAmounts.reduce((a, b) => a + b, 0) / sameMonthAmounts.length;
  return Math.round(avg * 100) / 100;
}

// Generic trend fallback (simple regression blended with last)
function predictTrendAmount(history) {
  const amounts = history.map(h => h.amount);
  const last = amounts[amounts.length - 1];

  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  if (Math.abs(max - min) < 0.01) return last;

  const n = amounts.length;
  const xs = [...Array(n).keys()];
  const ys = amounts;

  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
  const sumX2 = xs.reduce((acc, x) => acc + x * x, 0);

  const denom = n * sumX2 - sumX * sumX;
  let m = 0,
    b = last;

  if (Math.abs(denom) > 1e-6) {
    m = (n * sumXY - sumX * sumY) / denom;
    b = (sumY - m * sumX) / n;
  }

  const reg = m * n + b;
  const blended = (reg + last * 2) / 3;

  return Math.round(blended * 100) / 100;
}

// Weighted recent trend for LOC
function predictLocAmount(history) {
  const n = history.length;
  if (n === 0) return 0;

  const last = history[n - 1].amount;
  if (n === 1) return last;

  const secondLast = history[n - 2].amount;
  if (n === 2) {
    const val = last * 0.7 + secondLast * 0.3;
    return Math.round(val * 100) / 100;
  }

  const thirdLast = history[n - 3].amount;
  const val = last * 0.6 + secondLast * 0.3 + thirdLast * 0.1;
  return Math.round(val * 100) / 100;
}

// Property tax: average of last 2
function predictPropertyTaxAmount(history) {
  const n = history.length;
  if (n === 0) return 0;
  if (n === 1) return history[0].amount;

  const last = history[n - 1].amount;
  const secondLast = history[n - 2].amount;
  const val = (last + secondLast) / 2;
  return Math.round(val * 100) / 100;
}

// Constant payees: use last amount as "predicted"
function predictConstantAmount(history) {
  if (!history.length) return 0;
  return history[history.length - 1].amount;
}

function predictNextAmount(payeeName, history, nextDateStr) {
  if (UTILITY_NAMES.includes(payeeName)) {
    const seasonal = predictSeasonalAmount(history, nextDateStr);
    if (seasonal !== null) return seasonal;
    return predictTrendAmount(history);
  }

  if (LOC_NAMES.includes(payeeName)) {
    return predictLocAmount(history);
  }

  if (PROPERTY_TAX_NAMES.includes(payeeName)) {
    return predictPropertyTaxAmount(history);
  }

  // Insurance, RRSP, TFSA, Crypto, Shakira → treat as constant or simple trend
  return predictConstantAmount(history);
}

// ========== BUILD UPCOMING ==========

function buildUpcoming(payments) {
  return payments
    .map(p => {
      if (!p.history || p.history.length === 0) return null;

      const nextDate = predictNextDate(p.history);
      if (!nextDate) return null;

      const predicted = predictNextAmount(p.name, p.history, nextDate);

      return {
        name: p.name,
        nextDate,
        predictedAmount: predicted
      };
    })
    .filter(Boolean);
}

// ========== RENDER ==========

function renderUpcoming(upcoming) {
  const list = document.getElementById("upcoming-list");
  const totalEl = document.getElementById("total");

  list.innerHTML = "";
  let total = 0;
  let found = false;

  upcoming
    .sort(
      (a, b) =>
        new Date(a.nextDate + "T00:00:00Z") -
        new Date(b.nextDate + "T00:00:00Z")
    )
    .forEach(p => {
      const days = daysBetween(p.nextDate);
      if (days < 0 || days > dayWindow) return;

      found = true;

      const contribution = p.predictedAmount;
      total += contribution;

      const li = document.createElement("li");
      li.innerHTML = `
        <span class="name">${p.name}</span>
        <span class="amount">$${p.predictedAmount.toFixed(2)}</span><br>
        <span class="meta">${formatDate(p.nextDate)}</span>
      `;
      list.appendChild(li);
    });

  if (!found) {
    list.innerHTML = "<li>No payments detected.</li>";
    total = 0;
  }

  totalEl.textContent = "$" + total.toFixed(2);
}

// ========== INIT ==========

async function init() {
  updateToday();
  currentPayments = await loadBackend();
  renderUpcoming(buildUpcoming(currentPayments));
}

init();

// ========== TOGGLE HANDLERS ==========

function updateToggleUI() {
  document.getElementById("toggle-4").classList.toggle("active", dayWindow === 4);
  document.getElementById("toggle-30").classList.toggle("active", dayWindow === 30);
}

document.getElementById("toggle-4").onclick = () => {
  dayWindow = 4;
  updateToggleUI();
  renderUpcoming(buildUpcoming(currentPayments));
};

document.getElementById("toggle-30").onclick = () => {
  dayWindow = 30;
  updateToggleUI();
  renderUpcoming(buildUpcoming(currentPayments));
};

// ========== ADMIN SCREEN ==========

document.getElementById("admin-btn").onclick = () => {
  document.getElementById("main-screen").style.display = "none";
  document.getElementById("admin-screen").style.display = "block";
};

document.getElementById("back-btn").onclick = () => {
  document.getElementById("admin-screen").style.display = "none";
  document.getElementById("main-screen").style.display = "block";
};
