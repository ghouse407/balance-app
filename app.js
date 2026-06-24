// =========================
// Load backend JSON
// =========================

async function loadBackend() {
  try {
    const stored = localStorage.getItem("backendData");
    if (stored) {
      // console.log("Using backend from localStorage");
      return JSON.parse(stored);
    }

    const response = await fetch("backend.json");
    const backend = await response.json();
    // console.log("Loaded backend.json:", backend.recurringPayments);
    return backend.recurringPayments;

  } catch (err) {
    console.error("ERROR loading backend:", err);
    return [];
  }
}

// =========================
// Format date helper
// =========================

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

// =========================
// Predict next date (future-safe)
// =========================

function predictNextDate(historyDates) {
  // console.log("Predicting next date for:", historyDates);

  if (!historyDates || historyDates.length < 2) {
    return null;
  }

  const dates = historyDates
    .map(d => new Date(d + "T00:00:00Z"))
    .filter(d => !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

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
function daysBetween(dateStr) {
  if (!dateStr) return 9999;

  const today = new Date();
  const target = new Date(dateStr + "T00:00:00Z");

  const diff = target - today;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// =========================

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

function renderUpcoming(payments) {
  const list = document.getElementById("upcoming-list");
  const totalEl = document.getElementById("total");

  list.innerHTML = "";
  let found = false;
  let total = 0;

  payments.sort((a, b) =>
    new Date(a.nextDate + "T00:00:00Z") - new Date(b.nextDate + "T00:00:00Z")
  );

  payments.forEach(p => {
    const days = daysBetween(p.nextDate);

    if (days >= 0 && days <= 4) {
      found = true;
      total += p.amount;

      const li = document.createElement("li");
      li.innerHTML =
        '<span class="name">' + p.name + '</span>' +
        '<span class="amount">$' + p.amount.toFixed(2) + '</span><br>' +
        '<span style="font-size:0.8rem;color:#777;">' + formatDate(p.nextDate) + '</span>';
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

  let payments = await loadBackend();

  payments = payments.map(p => {
    const next = predictNextDate(p.history);
    return {
      name: p.name,
      amount: p.amount,
      category: p.category,
      history: p.history,
      nextDate: next
    };
  });

  renderUpcoming(payments);
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
// CSV UPLOAD HANDLER
// =========================

document.getElementById("csv-input").addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = function (event) {
    const csvText = event.target.result;

    const lines = csvText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    const newPayments = {};

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      if (parts.length < 3) continue;

      const name = parts[0].trim();
      const amount = parseFloat(parts[1].trim());
      const date = parts[2].trim();

      if (!newPayments[name]) {
        newPayments[name] = {
          name: name,
          amount: amount,
          category: "Imported",
          history: []
        };
      }

      newPayments[name].history.push(date);
    }

    const finalArray = Object.values(newPayments);

    localStorage.setItem("backendData", JSON.stringify(finalArray));

    alert("Transactions imported successfully. Reloading...");
    location.reload();
  };

  reader.readAsText(file);
});
