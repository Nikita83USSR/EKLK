/**
 * EKLK Home dashboard — отдельный модуль (не ядро).
 * Период по умолчанию: день. Данные: GET /api/v1/dashboard/summary
 */
(() => {
  const $ = (s) => document.querySelector(s);
  let gaugeChart = null;
  let bound = false;
  let lastStores = [];

  function api(path, opts) {
    if (window.EKLK && typeof window.EKLK.api === "function") return window.EKLK.api(path, opts);
    throw new Error("EKLK core not ready");
  }
  function alert(msg, type) {
    if (window.EKLK && window.EKLK.showAlert) window.EKLK.showAlert(msg, type);
    else window.alert(msg);
  }
  function money(n) {
    const v = Number(n);
    if (Number.isNaN(v)) return "—";
    return v.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " ₽";
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }
  function deltaHtml(pct) {
    if (pct == null || Number.isNaN(Number(pct))) return `<span class="dash-delta flat">—</span>`;
    const v = Number(pct);
    const cls = v > 0 ? "up" : v < 0 ? "down" : "flat";
    const sign = v > 0 ? "+" : "";
    return `<span class="dash-delta ${cls}">${sign}${v.toFixed(2)}%</span>`;
  }

  function fillStores(stores, keep) {
    const sel = $("#dash_store");
    if (!sel) return;
    const prev = keep !== undefined ? keep : sel.value;
    const map = new Map();
    lastStores.forEach((s) => { if (s?.storeId != null) map.set(String(s.storeId), s); });
    (stores || []).forEach((s) => { if (s?.storeId != null) map.set(String(s.storeId), s); });
    lastStores = Array.from(map.values()).sort((a, b) =>
      String(a.storeName || "").localeCompare(String(b.storeName || ""), "ru")
    );
    sel.innerHTML =
      `<option value="">Все точки продаж</option>` +
      lastStores
        .map(
          (s) =>
            `<option value="${escapeHtml(String(s.storeId))}">${escapeHtml(
              s.storeName || String(s.storeId)
            )}</option>`
        )
        .join("");
    if (prev && map.has(String(prev))) sel.value = String(prev);
  }

  function renderGauge(profit, gaugePct) {
    const canvas = $("#dash_gauge");
    if (!canvas || typeof Chart === "undefined") return;
    if (gaugeChart) {
      try { gaugeChart.destroy(); } catch (_) {}
      gaugeChart = null;
    }
    const pct = Math.max(0, Math.min(100, Number(gaugePct) || 0));
    gaugeChart = new Chart(canvas, {
      type: "doughnut",
      data: {
        datasets: [{
          data: [pct, 100 - pct],
          backgroundColor: ["#60a5fa", "#e2e8f0"],
          borderWidth: 0,
          circumference: 180,
          rotation: 270,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: "75%",
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    });
  }

  function render(data) {
    if ($("#dash_firm")) {
      $("#dash_firm").textContent = data.firmName
        ? `${data.firmName} · ${data.period_label || data.date || ""}`
        : data.period_label || data.date || "";
    }
    if ($("#dash_invoices")) $("#dash_invoices").textContent = money(data.by_invoices);
    if ($("#dash_checks")) $("#dash_checks").textContent = money(data.by_checks);
    if ($("#dash_profit")) $("#dash_profit").textContent = money(data.profit);
    const ch = data.changes || {};
    if ($("#dash_profit_pct")) {
      $("#dash_profit_pct").outerHTML = deltaHtml(ch.profit_pct).replace(
        "dash-delta",
        "dash-delta\" id=\"dash_profit_pct"
      );
      // simpler:
      const el = $("#dash_profit_pct");
      if (el) {
        const v = ch.profit_pct;
        el.className = "dash-delta " + (v > 0 ? "up" : v < 0 ? "down" : "flat");
        el.textContent = v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`;
      }
    }
    if ($("#dash_sales_count")) $("#dash_sales_count").textContent = String(data.sales_count ?? "—");
    if ($("#dash_sales_pct")) {
      const v = ch.sales_count_pct;
      const el = $("#dash_sales_pct");
      el.className = "dash-delta " + (v > 0 ? "up" : v < 0 ? "down" : "flat");
      el.textContent = v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`;
    }
    if ($("#dash_avg_check")) $("#dash_avg_check").textContent = money(data.avg_check);
    if ($("#dash_avg_pct")) {
      const v = ch.avg_check_pct;
      const el = $("#dash_avg_pct");
      el.className = "dash-delta " + (v > 0 ? "up" : v < 0 ? "down" : "flat");
      el.textContent = v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`;
    }
    if ($("#dash_total")) $("#dash_total").textContent = money(data.total_checks);
    if ($("#dash_total_pct")) {
      const v = ch.total_checks_pct;
      const el = $("#dash_total_pct");
      el.className = "dash-delta " + (v > 0 ? "up" : v < 0 ? "down" : "flat");
      el.textContent = v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`;
    }
    if ($("#dash_cash")) $("#dash_cash").textContent = money(data.cash_balance);

    const labels = data.payment_labels || {};
    const byPt = data.by_payment_type || {};
    const box = $("#dash_pay_types");
    if (box) {
      const keys = Object.keys(byPt);
      if (!keys.length) {
        box.innerHTML = `<span class="hint">Нет данных за период</span>`;
      } else {
        box.innerHTML = keys
          .map(
            (k) =>
              `<div class="dash-pay-item"><span>${escapeHtml(labels[k] || k)}</span><strong>${money(
                byPt[k]
              )}</strong></div>`
          )
          .join("");
      }
    }

    fillStores(data.stores || []);
    renderGauge(data.profit, data.gauge_pct);
  }

  async function load() {
    const date = $("#dash_date")?.value || todayISO();
    const storeId = $("#dash_store")?.value || "";
    const qs = new URLSearchParams({ date, period: "daily" });
    if (storeId) qs.set("store_id", storeId);
    try {
      const data = await api("/dashboard/summary?" + qs.toString());
      render(data);
    } catch (e) {
      alert(e.message || String(e), "error");
    }
  }

  function bind() {
    if ($("#dash_date") && !$("#dash_date").value) $("#dash_date").value = todayISO();
    $("#dash_refresh")?.addEventListener("click", load);
    $("#dash_date")?.addEventListener("change", load);
    $("#dash_store")?.addEventListener("change", load);
    document.querySelectorAll("[data-dash-tab]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        const tab = el.getAttribute("data-dash-tab");
        if (tab && window.EKLK && typeof window.EKLK.showTab === "function") {
          window.EKLK.showTab(tab, true);
        } else if (tab) {
          location.href = "/" + tab;
        }
      });
    });
  }

  window.EKLK_HOME = {
    onShow() {
      if (!bound) {
        bind();
        bound = true;
      }
      load();
    },
  };
})();
