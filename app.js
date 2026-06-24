let currentPayments = [];
let dayWindow = 4;

const UTILITY_NAMES = ["Hydro One", "Enbridge Gas"];

// ========== LOAD BACKEND ==========

async function loadBackend() {
  const stored = localStorage.getItem("backendData");
  if (stored) return normalize(JSON.parse(stored));

  const res = await fetch("backend.json");
  const data = await res.json();
  return normalize(data.recurringPayments || data);
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

// ========== AMOUNT PREDICTION ==========

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

// Linear + blended fallback
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

function predictNextAmount(payeeName, history, nextDateStr) {
  const last = history[history.length - 1].amount;

  if (UTILITY_NAMES.includes(payeeName)) {
    const seasonal = predictSeasonalAmount(history, nextDateStr);
    if (seasonal !== null) return seasonal;
  }

  return predictTrendAmount(history);
}

// ========== BUILD UPCOMING ==========

function buildUpcoming(payments) {
  return payments
    .map(p => {
      if (!p.history || p.history.length === 0) return null;

      const nextDate = predictNextDate(p.history);
      if (!nextDate) return null;

      const last = p.history[p.history.length - 1].amount;
      const predicted = predictNextAmount(p.name, p.history, nextDate);

      return {
        name: p.name,
        nextDate,
        lastAmount: last,
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

      const isUtility = UTILITY_NAMES.includes(p.name);
      const variable =
        Math.abs(p.predictedAmount - p.lastAmount) > 0.01;

      let displayAmount;
      let contribution;

      if (isUtility) {
        // Always use predicted for utilities
        displayAmount = `$${p.predictedAmount.toFixed(2)}`;
        contribution = p.predictedAmount;
      } else if (variable) {
        // Rule B for non-utilities
        displayAmount = `$${p.lastAmount.toFixed(2)} ➝ $${p.predictedAmount.toFixed(2)}`;
        contribution = p.predictedAmount;
      } else {
        displayAmount = `$${p.lastAmount.toFixed(2)}`;
        contribution = p.lastAmount;
      }

      total += contribution;

      const li = document.createElement("li");
      li.innerHTML = `
        <span class="name">${p.name}</span>
        <span class="amount">${displayAmount}</span><br>
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

// ========== CSV IMPORT (with Scotia LOC Interest mapping) ==========

function mapCsvRowToPayee(type, desc, amountAbs) {
  if (type === "AFT_OUT") {
    if (desc.includes("BNS MTGE DEPT")) return "Scotia Mortgage";
    if (desc.includes("RBC PYT")) return "RBC Mortgage";
    if (desc.includes("Enbridge Gas")) return "Enbridge Gas";
    if (desc.includes("Hydro One")) return "Hydro One";
    if (desc.includes("SCOTIA H&A INS.")) {
      if (Math.abs(amountAbs - 196.83) < 1) return "Scotia Home Insurance";
      if (Math.abs(amountAbs - 90.89) < 1) return "Scotia Auto Insurance";
    }
    if (desc.includes("BNS PREAUTH PMT")) return "Scotia LOC Interest";
  }

  if (type === "TRFOUT") {
    if (desc.toLowerCase().includes("rrsp") || Math.abs(amountAbs - 65) < 0.5)
      return "RRSP";
    if (desc.toLowerCase().includes("tfsa") || Math.abs(amountAbs - 100) < 0.5)
      return "TFSA";
    if (desc.toLowerCase().includes("crypto") || Math.abs(amountAbs - 25) < 0.5)
      return "Crypto";
  }

  if (type === "P2P_SENT") return "Shakira TFSA/RRSP";

  if (type === "OBP_OUT") {
    if (desc.includes("BRADFORD WEST GWILLIMBURY")) return "Bradford Property Tax";
    if (desc.includes("MILTON ONTARIO")) return "Milton Property Tax";
  }

  return null;
}

function mergeCsv(payments, entries) {
  const byName = {};
  payments.forEach(p => {
    if (!byName[p.name]) byName[p.name] = p;
  });

  entries.forEach(e => {
    let p = byName[e.name];
    if (!p) {
      p = { name: e.name, history: [] };
      payments.push(p);
      byName[e.name] = p;
    }

    const exists = p.history.some(
      h => h.date === e.date && Math.abs(h.amount - e.amount) < 0.01
    );
    if (!exists) p.history.push({ date: e.date, amount: e.amount });

    p.history.sort((a, b) => new Date(a.date) - new Date(b.date));
  });

  return payments;
}

document.getElementById("csv-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;

  const text = await file.text();
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length <= 1) return alert("CSV empty");

  const header = lines[0].split(",");
  const dateIdx = header.indexOf("date");
  const typeIdx = header.indexOf("transaction");
  const descIdx = header.indexOf("description");
  const amountIdx = header.indexOf("amount");

  const entries = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const date = cols[dateIdx].replace(/"/g, "");
    const type = cols[typeIdx].replace(/"/g, "");
    const desc = cols[descIdx].replace(/"/g, "");
    const amt = parseFloat(cols[amountIdx]);

    if (isNaN(amt) || amt >= 0) continue;

    const amountAbs = Math.abs(amt);
    const name = mapCsvRowToPayee(type, desc, amountAbs);
    if (!name) continue;

    entries.push({ name, date, amount: amountAbs });
  }

  currentPayments = mergeCsv(currentPayments, entries);
  localStorage.setItem("backendData", JSON.stringify(currentPayments));

  alert("CSV imported. Reloading...");
  location.reload();
});
