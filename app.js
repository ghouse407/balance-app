// =========================
// Load backend JSON
// =========================

async function loadBackend() {
  try {
    const response = await fetch("backend.json?v=" + Date.now());
    const backend = await response.json();
    return backend.recurringPayments; // NEW STRUCTURE
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
// Calculate next date based on frequency
// =========================

function calculateNextDate(lastDate, frequency) {
  const d = new Date(lastDate);

  switch (frequency) {
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;

    case "bi-weekly":
      d.setDate(d.getDate() + 14);
      break;

    case "monthly":
      d.setMonth(d.getMonth() + 1);
      break;

    case "quarterly":
      d.setMonth(d.getMonth() + 3);
      break;

    case "semi-annual":
      d.setMonth(d.getMonth() + 6);
      break;
  }

  return d.toISOString().split("T")[0];
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
// Render balance (placeholder)
// =========================

function updateBalance() {
  const el = document.getElementById("balance-amount");
  el.textContent = "$0.00"; // You can update this later
}

// =========================
// Render today's date (NO LABEL)
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
// Render upcoming payments (next 4 days)
// =========================

function renderUpcoming(payments) {
  const list = document.getElementById("upcoming-list");
  list.innerHTML = "";

  const today = new Date();

  // Sort by nextDate ascending
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
  updateBalance();
  updateTodayDate();

  let payments = await loadBackend();

  // Ensure nextDate exists (backend already has it, but just in case)
  payments = payments.map(p => {
    return {
      ...p,
      nextDate: p.nextDate || calculateNextDate(p.lastDate, p.frequency)
    };
  });

  renderUpcoming(payments);
}

init();
