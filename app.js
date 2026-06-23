// =========================
// Load backend JSON
// =========================

async function loadBackend() {
  try {
    const response = await fetch("backend.json?v=" + Date.now());
    const backend = await response.json();
    return backend.recurringPayments;
  } catch (err) {
    console.error("Error loading backend:", err);
    return [];
  }
}

// =========================
// Format date helper
// =========================

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

// =========================
// Predict next date based on history
// =========================

function predictNextDate(historyDates) {
  if (!historyDates || historyDates.length < 2) {
    return null;
  }

  // Convert to Date objects
  const dates = historyDates.map(d => new Date(d)).sort((a, b) => a - b);

  // Calculate gaps
  const gaps = [];
  for (let i = 1; i < dates.length; i++) {
    const diff = (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24);
    gaps.push(Math.round(diff));
  }

  // Find most common gap (mode)
  const freq = {};
  gaps.forEach(g => freq[g] = (freq[g] || 0) + 1);

  const mostCommonGap = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
  const gapDays = parseInt(mostCommonGap);

  // Predict next date
  const lastDate = dates[dates.length - 1];
  const next = new Date(lastDate);
  next.setDate(next.getDate() + gapDays);

  return next.toISOString().split("T")[0];
}

// =========================
// Days between two dates
// =========================

function daysBetween(dateStr) {
  const today = new Date();
  const target = new Date(dateStr);
  const diff = target - today;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// =========================
// Render today's date
// =========================

function updateTodayDate() {
  const el = document.getElementById("today-date");
  const today = new Date();
  el.textContent = today.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

// =========================
// Render upcoming payments
// =========================

function renderUpcoming(payments) {
  const list = document.getElementById("upcoming-list");
  list.innerHTML = "";

  // Sort by predicted next date
  payments.sort((a, b) => new Date(a.nextDate) - new Date(b.nextDate));

  let found = false;

  payments.forEach(p => {
    const days = daysBetween(p.nextDate);

    if (days >= 0 && days <= 4) {
      found = true;

      const li = document.createElement("li");
      li.innerHTML = `
        <span class="name">${p.name}</span>
        <span class="amount">$${p.amount.toFixed(2)}</span>
        <br>
        <span style="font-size:0.8rem;color:#777;">${formatDate(p.nextDate)}</span>
      `;
      list.appendChild(li);
    }
  });

  if (!found) {
    list.innerHTML = `<li>No payments detected in the next 4 days.</li>`;
  }
}

// =========================
// MAIN INIT
// =========================

async function init() {
  updateTodayDate();

  let payments = await loadBackend();

  // Predict next dates dynamically
  payments = payments.map(p => {
    const next = predictNextDate(p.history || [p.lastDate]);
    return {
      ...p,
      nextDate: next || p.nextDate
    };
  });

  renderUpcoming(payments);
}

init();
