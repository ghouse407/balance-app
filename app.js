let currentPayments = [];
let dayWindow = 4;

// =========================
// LOAD BACKEND + NORMALIZE
// =========================

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
    amount: p.amount,
    category: p.category || "Imported",
    history: (p.history || []).map(h =>
      typeof h === "string"
        ? { date: h, amount: p.amount }
        : { date: h.date, amount: h.amount ?? p.amount }
    )
  }));
}

// =========================
// DATE HELPERS
// =========================

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

// =========================
// PREDICT NEXT DATE
// =========================

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

// =========================
// PREDICT NEXT AMOUNT (D3)
// =========================

function predictNextAmount(history) {
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

// =========================
// BUILD UPCOMING
// =========================

function buildUpcoming(payments) {
  return payments
    .map(p => {
      const nextDate = predictNextDate(p.history);
      if (!nextDate) return null;

      const last = p.history[p.history.length - 1].amount;
      const predicted = predictNextAmount(p.history);

      return {
        name: p.name,
        nextDate,
        lastAmount: last,
        predictedAmount: predicted
      };
    })
    .filter(Boolean);
}

// =========================
// RENDER
// =========================

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

      const variable =
        Math.abs(p.predictedAmount - p.lastAmount) > 0.01;

      const displayAmount = variable
        ? `$${p.lastAmount.toFixed(2)} ➝ $${p.predictedAmount.toFixed(2)}`
        : `$${p.lastAmount.toFixed(2)}`;

      total += variable ? p.predictedAmount : p.lastAmount;

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

// =========================
// INIT
// =========================

async function init() {
  updateToday();
  currentPayments = await loadBackend();
  renderUpcoming(buildUpcoming(currentPayments));
}

init();

// =========================
// TOGGLE HANDLERS
// =========================

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

// =========================
// ADMIN SCREEN
// =========================

document.getElementById("admin-btn").onclick = () => {
  document.getElementById("main-screen").style.display = "none";
  document.getElementById("admin-screen").style.display = "block";
};

document.getElementById("back-btn").onclick = () => {
  document.getElementById("admin-screen").style.display = "none";
  document.getElementById("main-screen").style.display = "block";
};

// =========================
// CSV IMPORT
// =========================

function mapCsvRowToPayee(type, desc, amountAbs) {
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

  if (type === "P2P_SENT") return "Shakira TFSA/RRSP";

  return null;
}

function mergeCsv(payments, entries) {
  const byName = {};
  payments.forEach(p => {
    if (!byName[p.name]) byName[p.name] = [];
    byName[p.name].push(p);
  });

  entries.forEach(e => {
    const matches = byName[e.name];

    if (!matches) {
      const newP = {
        name: e.name,
        amount: e.amount,
        category: "Imported",
        history: [{ date: e.date, amount: e.amount }]
      };
      payments.push(newP);
      byName[e.name] = [newP];
      return;
    }

    matches.forEach(p => {
      const exists = p.history.some(
        h => h.date === e.date && Math.abs(h.amount - e.amount) < 0.01
      );
      if (!exists) p.history.push({ date: e.date, amount: e.amount });
    });
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
