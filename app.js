// =========================
// GLOBAL STATE
// =========================

let currentPayments = [];

// =========================
// LOAD BACKEND (with normalization)
// =========================

async function loadBackend() {
  try {
    const stored = localStorage.getItem("backendData");
    if (stored) {
      const parsed = JSON.parse(stored);
      return normalizePayments(parsed);
    }

    const response = await fetch("backend.json");
    const backend = await response.json();
    return normalizePayments(backend.recurringPayments || backend);

  } catch (err) {
    console.error("ERROR loading backend:", err);
    return [];
  }
}

// Normalize history to [{date, amount}]
function normalizePayments(payments) {
  return payments.map(p => {
    const history = (p.history || []).map(h => {
      if (typeof h === "string") {
        return { date: h, amount: p.amount };
      } else if (h && typeof h === "object") {
        return {
          date: h.date,
          amount: typeof h.amount === "number" ? h.amount : p.amount
        };
      } else {
        return null;
      }
    }).filter(Boolean);

    return {
      name: p.name,
      amount: p.amount,
      category: p.category || "Imported",
      history
    };
  });
}

// =========================
// DATE HELPERS
// =========================

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function daysBetween(dateStr) {
  if (!dateStr) return 9999;
  const today = new Date();
  const target = new Date(dateStr + "T00:00:00Z");
  const diff = target - today;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function updateTodayDate() {
  const el = document.getElementById("today");
  const today = new Date();
  el.textContent = today.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

// =========================
// PREDICT NEXT DATE
// =========================

function predictNextDate(history) {
  if (!history || history.length < 2) return null;

  const dates = history
    .map(h => new Date(h.date + "T00:00:00Z"))
    .filter(d => !isNaN(d.getTime()))
    .sort((a, b) => a - b);

  if (dates.length < 2) return null;

  const gaps = [];
  for (let i = 1; i < dates.length; i++) {
    const diff = (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24);
    gaps.push(Math.round(diff));
  }

  const freq = {};
  gaps.forEach(g => freq[g] = (freq[g] || 0) + 1);

  const mostCommonGap = parseInt(
    Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0],
    10
  );

  let next = new Date(dates[dates.length - 1].getTime());
  next.setUTCDate(next.getUTCDate() + mostCommonGap);

  let nextDateStr = next.toISOString().split("T")[0];

  const today = new Date();
  while (new Date(nextDateStr + "T00:00:00Z") < today) {
    next.setUTCDate(next.getUTCDate() + mostCommonGap);
    nextDateStr = next.toISOString().split("T")[0];
  }

  return nextDateStr;
}

// =========================
// PREDICT NEXT AMOUNT (Hybrid trend D3)
// =========================

function predictNextAmount(history) {
  if (!history || history.length === 0) return null;

  const amounts = history.map(h => h.amount).filter(a => typeof a === "number");
  if (amounts.length === 0) return null;

  const lastAmount = amounts[amounts.length - 1];

  // If all amounts are (almost) equal, treat as fixed
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  if (Math.abs(max - min) < 0.01) {
    return lastAmount;
  }

  const n = amounts.length;
  const xs = [];
  const ys = [];
  for (let i = 0; i < n; i++) {
    xs.push(i);
    ys.push(amounts[i]);
  }

  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
  const sumX2 = xs.reduce((acc, x) => acc + x * x, 0);

  const denom = (n * sumX2 - sumX * sumX);
  let m = 0;
  let b = lastAmount;

  if (Math.abs(denom) > 1e-6) {
    m = (n * sumXY - sumX * sumY) / denom;
    b = (sumY - m * sumX) / n;
  }

  const nextIndex = n;
  const regPred = m * nextIndex + b;

  // Hybrid: blend regression with last amount (recent boost)
  const blended = (regPred + lastAmount * 2) / 3;

  return Math.round(blended * 100) / 100;
}

// =========================
// BUILD UPCOMING STRUCTURE
// =========================

function buildUpcoming(payments) {
  return payments.map(p => {
    const history = p.history || [];
    const nextDate = predictNextDate(history);
    const lastEntry = history.length ? history[history.length - 1] : null;
    const lastActualAmount = lastEntry ? lastEntry.amount : p.amount;
    const predictedAmount = predictNextAmount(history);

    return {
      name: p.name,
      category: p.category,
      nextDate,
      lastActualAmount,
      predictedAmount
    };
  }).filter(p => p.nextDate);
}

// =========================
// RENDER UPCOMING
// =========================

function renderUpcoming(upcoming) {
  const list = document.getElementById("upcoming-list");
  const totalEl = document.getElementById("total");

  list.innerHTML = "";
  let found = false;
  let total = 0;

  upcoming.sort((a, b) =>
    new Date(a.nextDate + "T00:00:00Z") - new Date(b.nextDate + "T00:00:00Z")
  );

  upcoming.forEach(p => {
    const days = daysBetween(p.nextDate);
    if (days >= 0 && days <= 4) {
      found = true;

      const usePredicted =
        p.predictedAmount != null &&
        Math.abs(p.predictedAmount - p.lastActualAmount) > 0.01;

      const displayAmount = usePredicted
        ? `$${p.lastActualAmount.toFixed(2)} ➝ $${p.predictedAmount.toFixed(2)}`
        : `$${p.lastActualAmount.toFixed(2)}`;

      const amountForTotal = usePredicted ? p.predictedAmount : p.lastActualAmount;
      total += amountForTotal;

      const li = document.createElement("li");
      li.innerHTML =
        `<span class="name">${p.name}</span>` +
        `<span class="amount">${displayAmount}</span><br>` +
        `<span class="meta">${formatDate(p.nextDate)}</span>`;
      list.appendChild(li);
    }
  });

  totalEl.textContent = "$" + total.toFixed(2);

  if (!found) {
    list.innerHTML = "<li>No payments detected in the next 4 days.</li>";
    totalEl.textContent = "$0.00";
  }
}

// =========================
// MAIN INIT
// =========================

async function init() {
  updateTodayDate();

  currentPayments = await loadBackend();
  const upcoming = buildUpcoming(currentPayments);
  renderUpcoming(upcoming);
}

init();

// =========================
// ADMIN SCREEN SWITCHING
// =========================

document.getElementById("admin-btn").addEventListener("click", function () {
  document.getElementById("main-screen").style.display = "none";
  document.getElementById("admin-screen").style.display = "block";
});

document.getElementById("back-btn").addEventListener("click", function () {
  document.getElementById("admin-screen").style.display = "none";
  document.getElementById("main-screen").style.display = "block";
});

// =========================
// CSV PARSING & MERGE
// =========================

function mapCsvRowToPayee(type, desc, amountAbs) {
  desc = desc || "";
  if (type === "AFT_OUT") {
    if (desc.includes("BNS MTGE DEPT")) return "Scotia Mortgage";
    if (desc.includes("2600740RBC PYT")) return "RBC Mortgage";
    if (desc.includes("Enbridge Gas")) return "Enbridge Gas";
    if (desc.includes("BNS PREAUTH PMT")) return "Scotia Home & Auto Insurance";
  }

  if (type === "TRFOUT") {
    if (Math.abs(amountAbs - 65) < 0.5) return "RRSP";
    if (Math.abs(amountAbs - 100) < 0.5) return "TFSA";
    if (Math.abs(amountAbs - 25) < 0.5) return "Crypto";
  }

  if (type === "P2P_SENT") {
    return "Shakira TFSA/RRSP";
  }

  return null;
}

function mergeCsvEntriesIntoPayments(payments, entries) {
  const byName = {};
  payments.forEach(p => {
    if (!byName[p.name]) byName[p.name] = [];
    byName[p.name].push(p);
  });

  entries.forEach(e => {
    const list = byName[e.name];
    if (!list || list.length === 0) {
      const newPayment = {
        name: e.name,
        amount: e.amount,
        category: "Imported",
        history: [{ date: e.date, amount: e.amount }]
      };
      payments.push(newPayment);
      if (!byName[e.name]) byName[e.name] = [];
      byName[e.name].push(newPayment);
    } else {
      // For names with multiple entries (e.g., insurance), add to all
      list.forEach(p => {
        const exists = p.history.some(
          h => h.date === e.date && Math.abs(h.amount - e.amount) < 0.01
        );
        if (!exists) {
          p.history.push({ date: e.date, amount: e.amount });
        }
      });
    }
  });

  return payments;
}

// =========================
// CSV UPLOAD HANDLER
// =========================

document.getElementById("csv-input").addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = async function (event) {
    const csvText = event.target.result;
    const lines = csvText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length <= 1) {
      alert("CSV appears empty.");
      return;
    }

    const header = lines[0].split(",");
    const dateIdx = header.indexOf("date");
    const typeIdx = header.indexOf("transaction");
    const descIdx = header.indexOf("description");
    const amountIdx = header.indexOf("amount");

    if (dateIdx === -1 || typeIdx === -1 || descIdx === -1 || amountIdx === -1) {
      alert("CSV format not recognized.");
      return;
    }

    const entries = [];

    for (let i = 1; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw) continue;

      const parts = raw.split(",");
      if (parts.length < 4) continue;

      const date = parts[dateIdx].replace(/"/g, "").trim();
      const type = parts[typeIdx].replace(/"/g, "").trim();
      const desc = parts[descIdx].replace(/"/g, "").trim();
      const amtStr = parts[amountIdx].replace(/"/g, "").trim();
      const amount = parseFloat(amtStr);

      if (!date || isNaN(amount)) continue;

      // Only outgoing payments
      if (amount >= 0) continue;

      const amountAbs = Math.abs(amount);
      const name = mapCsvRowToPayee(type, desc, amountAbs);
      if (!name) continue;

      entries.push({
        name,
        date,
        amount: amountAbs
      });
    }

    if (entries.length === 0) {
      alert("No matching recurring payments found in CSV.");
      return;
    }

    // Ensure currentPayments is loaded
    if (!currentPayments || currentPayments.length === 0) {
      currentPayments = await loadBackend();
    }

    const merged = mergeCsvEntriesIntoPayments(currentPayments, entries);
    localStorage.setItem("backendData", JSON.stringify(merged));

    alert("Transactions imported and merged successfully. Reloading...");
    location.reload();
  };

  reader.readAsText(file);
});
