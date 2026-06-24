// app.js — FINAL VERSION (local-date safe, no UTC, no 1-day shift)

// ===================== DATE HELPERS =====================

// Parse YYYY-MM-DD as a pure local date (no timezone conversion)
function parseDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Format a Date object back to YYYY-MM-DD (local)
function formatYMD(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Display date in UI
function formatDateDisplay(dateStr) {
  const d = parseDate(dateStr);
  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

// Days between today and target date
function daysBetween(dateStr) {
  const today = new Date();
  const target = parseDate(dateStr);
  const diff = target - today;
  return Math.ceil(diff / 86400000);
}

// ===================== GLOBALS =====================

let currentPayments = [];
let dayWindow = 4;

const UTILITY_NAMES = ["Hydro One", "Enbridge Gas"];
const LOC_NAMES = ["Scotia LOC Interest 1", "Scotia LOC Interest 2"];
const PROPERTY_TAX_NAMES = ["Bradford Property Tax", "Milton Property Tax"];

// ===================== LOAD BACKEND =====================

async function loadBackend() {
  const stored = localStorage.getItem("backendData");
  if (stored) return normalize(JSON.parse(stored));

  const res = await fetch("backend.json");
  const data = await res.json();
  return normalize(data.recurringPayments);
}

function normalize(payments) {
  return payments.map(p => ({
    name: p.name,
    history: (p.history || [])
      .map(h => ({ date: h.date, amount: h.amount }))
      .sort((a, b) => parseDate(a.date) - parseDate(b.date))
  }));
}

// ===================== NEXT DATE PREDICTION =====================

function predictNextDate(history) {
  if (history.length < 2) return null;

  const dates = history.map(h => parseDate(h.date)).sort((a, b) => a - b);

  const gaps = [];
  for (let i = 1; i < dates.length; i++) {
    const diff = (dates[i] - dates[i - 1]) / 86400000;
    gaps.push(Math.round(diff));
  }

  const freq = {};
  gaps.forEach(g => (freq[g] = (freq[g] || 0) + 1));

  const mostCommonGap = parseInt(
    Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
  );

  let next = new Date(dates[dates.length - 1]);
  next.setDate(next.getDate() + mostCommonGap);

  const today = new Date();
  while (next < today) next.setDate(next.getDate() + mostCommonGap);

  return formatYMD(next);
}

// ===================== AMOUNT PREDICTION =====================

// Seasonal utilities
function predictSeasonalAmount(history, nextDateStr) {
  const nextMonth = parseDate(nextDateStr).getMonth();
  const sameMonthAmounts = history
    .filter(h => parseDate(h.date).getMonth() === nextMonth)
    .map(h => h.amount);

  if (sameMonthAmounts.length === 0) return null;

  const avg =
    sameMonthAmounts.reduce((a, b) => a + b, 0) / sameMonthAmounts.length;
  return Math.round(avg * 100) / 100;
}

// Trend fallback
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

// LOC weighted trend
function predictLocAmount(history) {
  const n = history.length;
  const last = history[n - 1].amount;
  if (n === 1) return last;

  const second = history[n - 2].amount;
  if (n === 2) return Math.round((last * 0.7 + second * 0.3) * 100) / 100;

  const third = history[n - 3].amount;
  return Math.round((last * 0.6 + second * 0.3 + third * 0.1) * 100) / 100;
}

// Property tax average
function predictPropertyTaxAmount(history) {
  const n = history.length;
  if (n === 1) return history[0].amount;
  return Math.round(((history[n - 1].amount + history[n - 2].amount) / 2) * 100) / 100;
}

// Constant payees
function predictConstantAmount(history) {
  return history[history.length - 1].amount;
}

function predictNextAmount(name, history, nextDateStr) {
  if (UTILITY_NAMES.includes(name)) {
    const seasonal = predictSeasonalAmount(history, nextDateStr);
    return seasonal !== null ? seasonal : predictTrendAmount(history);
  }

  if (LOC_NAMES.includes(name)) return predictLocAmount(history);
  if (PROPERTY_TAX_NAMES.includes(name)) return predictPropertyTaxAmount(history);

  return predictConstantAmount(history);
}

// ===================== UPCOMING =====================

function buildUpcoming(payments) {
  return payments
    .map(p => {
      if (!p.history.length) return null;

      const nextDate = predictNextDate(p.history);
      if (!nextDate) return null;

      return {
        name: p.name,
        nextDate,
        predictedAmount: predictNextAmount(p.name, p.history, nextDate)
      };
    })
    .filter(Boolean);
}

// ===================== RENDER =====================

function renderUpcoming(upcoming) {
  const list = document.getElementById("upcoming-list");
  const totalEl = document.getElementById("total");

  list.innerHTML = "";
  let total = 0;
  let found = false;

  upcoming
    .sort((a, b) => parseDate(a.nextDate) - parseDate(b.nextDate))
    .forEach(p => {
      const days = daysBetween(p.nextDate);
      if (days < 0 || days > dayWindow) return;

      found = true;
      total += p.predictedAmount;

      const li = document.createElement("li");
      li.innerHTML = `
        <span class="name">${p.name}</span>
        <span class="amount">$${p.predictedAmount.toFixed(2)}</span><br>
        <span class="meta">${formatDateDisplay(p.nextDate)}</span>
      `;
      list.appendChild(li);
    });

  if (!found) {
    list.innerHTML = "<li>No payments detected.</li>";
    total = 0;
  }

  totalEl.textContent = "$" + total.toFixed(2);
}

// ===================== INIT =====================

function updateToday() {
  document.getElementById("today").textContent =
    new Date().toLocaleDateString("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
}

async function init() {
  updateToday();
  currentPayments = await loadBackend();
  renderUpcoming(buildUpcoming(currentPayments));
}

init();

// ===================== TOGGLES =====================

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

// ===================== ADMIN =====================

document.getElementById("admin-btn").onclick = () => {
  document.getElementById("main-screen").style.display = "none";
  document.getElementById("admin-screen").style.display = "block";
};

document.getElementById("back-btn").onclick = () => {
  document.getElementById("admin-screen").style.display = "none";
  document.getElementById("main-screen").style.display = "block";
};
