// ===== CONFIG =====
const LOCAL_STORAGE_KEY = "balanceAppBackend";

// ===== UTILITIES =====
function formatCurrency(amount) {
  return "$" + amount.toFixed(2);
}

function parseISODate(str) {
  return new Date(str + "T00:00:00");
}

function toISODateString(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function daysBetween(a, b) {
  const ms = parseISODate(b) - parseISODate(a);
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

// ===== BACKEND LOAD/SAVE =====
async function loadInitialBackendFromFile() {
  try {
    const response = await fetch("payments.json");
    if (!response.ok) throw new Error("Cannot load payments.json");
    const data = await response.json();
    return data;
  } catch (e) {
    console.error(e);
    return [];
  }
}

function loadBackendFromLocalStorage() {
  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveBackendToLocalStorage(backend) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(backend));
}

// ===== PREDICTION LOGIC =====
function predictNextDateForPayment(payment) {
  const dates = payment.last_dates || [];
  if (!dates.length) return null;

  // If interval_days exists, use it; otherwise infer from last_dates
  let interval = payment.interval_days;
  if (!interval && dates.length >= 2) {
    const intervals = [];
    for (let i = 1; i < dates.length; i++) {
      intervals.push(daysBetween(dates[i - 1], dates[i]));
    }
    interval = median(intervals);
  }
  if (!interval) return null;

  const lastDate = parseISODate(dates[dates.length - 1]);
  const nextDate = addDays(lastDate, interval);
  return toISODateString(nextDate);
}

function buildUpcomingPayments(backend, todayISO, lookaheadDays = 4) {
  const today = parseISODate(todayISO);
  const cutoff = addDays(today, lookaheadDays);
  const upcoming = [];

  backend.forEach((p) => {
    const nextDateISO = predictNextDateForPayment(p);
    if (!nextDateISO) return;

    const nextDate = parseISODate(nextDateISO);
    if (nextDate >= today && nextDate <= cutoff) {
      upcoming.push({
        name: p.name,
        amount: p.amount,
        next_date: nextDateISO
      });
    }
  });

  upcoming.sort((a, b) => parseISODate(a.next_date) - parseISODate(b.next_date));
  return upcoming;
}

function autoAdvanceBackend(backend, todayISO) {
  const today = parseISODate(todayISO);
  const updated = backend.map((p) => {
    const nextDateISO = predictNextDateForPayment(p);
    if (!nextDateISO) return p;

    const nextDate = parseISODate(nextDateISO);
    // If nextDate is in the past or today, treat it as occurred and advance
    if (nextDate <= today) {
      const newLastDates = [...(p.last_dates || []), nextDateISO];
      // Keep only last 6 dates
      while (newLastDates.length > 6) newLastDates.shift();

      // Recalculate interval_days from newLastDates
      let newInterval = p.interval_days;
      if (newLastDates.length >= 2) {
        const intervals = [];
        for (let i = 1; i < newLastDates.length; i++) {
          intervals.push(daysBetween(newLastDates[i - 1], newLastDates[i]));
        }
        const med = median(intervals);
        if (med) newInterval = med;
      }

      return {
        ...p,
        last_dates: newLastDates,
        interval_days: newInterval
      };
    }
    return p;
  });

  return updated;
}

// ===== MAIN UI RENDER =====
function renderMainScreen(backend) {
  const today = new Date();
  const todayISO = toISODateString(today);

  document.getElementById("today-date").textContent =
    "Today: " + today.toLocaleDateString();

  // Auto-advance backend based on today
  const advancedBackend = autoAdvanceBackend(backend, todayISO);
  saveBackendToLocalStorage(advancedBackend);

  const upcoming = buildUpcomingPayments(advancedBackend, todayISO, 4);
  const total = upcoming.reduce((sum, p) => sum + p.amount, 0);

  document.getElementById("balance-amount").textContent = formatCurrency(total);

  const listEl = document.getElementById("upcoming-list");
  listEl.innerHTML = "";

  if (!upcoming.length) {
    const li = document.createElement("li");
    li.textContent = "No payments detected in the next 4 days.";
    listEl.appendChild(li);
  } else {
    upcoming.forEach((p) => {
      const li = document.createElement("li");
      const dateStr = new Date(p.next_date + "T00:00:00").toLocaleDateString();
      li.innerHTML =
        `<span class="name">${dateStr} — ${p.name}</span>` +
        `<span class="amount">${formatCurrency(p.amount)}</span>`;
      listEl.appendChild(li);
    });
  }
}

// ===== ADMIN PANEL =====
function showMainView() {
  document.getElementById("main-view").style.display = "block";
  document.getElementById("admin-view").classList.remove("active");
}

function showAdminView() {
  document.getElementById("main-view").style.display = "none";
  document.getElementById("admin-view").classList.add("active");
}

function renderBackendPreview(backend) {
  const previewEl = document.getElementById("backend-preview");
  if (!backend || !backend.length) {
    previewEl.textContent = "No backend loaded yet.";
    return;
  }
  previewEl.textContent = JSON.stringify(backend, null, 2);
}

// Simple CSV parser (assumes headers and comma-separated)
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];

  const headers = lines[0].split(",");
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length !== headers.length) continue;
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = cols[idx].trim();
    });
    rows.push(row);
  }
  return rows;
}

// Build backend from CSV transactions
function buildBackendFromCSV(rows) {
  // You’ll adapt these field names to your actual CSV:
  // Assume headers: Date, Description, Amount, Type (DEBIT/CREDIT)
  const map = new Map();

  rows.forEach((r) => {
    const desc = (r.Description || "").trim();
    const amount = parseFloat(r.Amount || "0");
    const type = (r.Type || "").toUpperCase();
    const date = (r.Date || "").trim();

    if (!desc || !date || isNaN(amount)) return;
    if (type !== "DEBIT") return; // only outgoing payments

    if (!map.has(desc)) {
      map.set(desc, []);
    }
    map.get(desc).push({ date, amount });
  });

  const backend = [];

  for (const [name, txs] of map.entries()) {
    if (txs.length < 2) continue; // need at least 2 to detect recurring

    // Sort by date
    txs.sort((a, b) => parseISODate(a.date) - parseISODate(b.date));

    const dates = txs.map((t) => t.date);
    const amounts = txs.map((t) => t.amount);

    const intervals = [];
    for (let i = 1; i < dates.length; i++) {
      intervals.push(daysBetween(dates[i - 1], dates[i]));
    }
    const intervalDays = median(intervals);
    if (!intervalDays) continue;

    // Use median amount
    const sortedAmounts = [...amounts].sort((a, b) => a - b);
    const mid = Math.floor(sortedAmounts.length / 2);
    const medianAmount =
      sortedAmounts.length % 2 === 0
        ? (sortedAmounts[mid - 1] + sortedAmounts[mid]) / 2
        : sortedAmounts[mid];

    // Keep last up to 6 dates
    const lastDates = dates.slice(-6);

    backend.push({
      name,
      amount: medianAmount,
      last_dates: lastDates,
      interval_days: intervalDays
    });
  }

  return backend;
}

// ===== INIT =====
document.addEventListener("DOMContentLoaded", async () => {
  // Routing between main and admin
  function handleHash() {
    if (window.location.hash === "#admin") {
      showAdminView();
      const backend = loadBackendFromLocalStorage();
      renderBackendPreview(backend || []);
    } else {
      showMainView();
      const backendLocal = loadBackendFromLocalStorage();
      if (backendLocal) {
        renderMainScreen(backendLocal);
      } else {
        // First run: load from payments.json
        loadInitialBackendFromFile().then((backendFile) => {
          saveBackendToLocalStorage(backendFile);
          renderMainScreen(backendFile);
        });
      }
    }
  }

  window.addEventListener("hashchange", handleHash);
  handleHash();

  // Admin: process CSV
  const csvInput = document.getElementById("csv-input");
  const processBtn = document.getElementById("process-csv-btn");
  processBtn.addEventListener("click", () => {
    if (!csvInput.files || !csvInput.files[0]) {
      alert("Please select a CSV file first.");
      return;
    }
    const file = csvInput.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const rows = parseCSV(text);
      const backend = buildBackendFromCSV(rows);
      saveBackendToLocalStorage(backend);
      renderBackendPreview(backend);
      alert("Backend rebuilt from CSV.");
    };
    reader.readAsText(file);
  });

  // Admin: export backend
  const exportBtn = document.getElementById("export-backend-btn");
  exportBtn.addEventListener("click", () => {
    const backend = loadBackendFromLocalStorage();
    if (!backend) {
      alert("No backend in local storage.");
      return;
    }
    const blob = new Blob([JSON.stringify(backend, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "payments-backend.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // Admin: reset backend
  const resetBtn = document.getElementById("reset-backend-btn");
  resetBtn.addEventListener("click", () => {
    if (!confirm("Clear backend from local storage?")) return;
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    document.getElementById("backend-preview").textContent =
      "Backend cleared. It will reload from payments.json on next visit to main screen.";
  });
});
