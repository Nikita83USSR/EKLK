(() => {
  const API = "/api/v1";
  let token = localStorage.getItem("eklk_token") || "";
  let paymentTypes = [];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function showAlert(msg, type = "error") {
    const el = $("#globalAlert");
    el.className = `alert alert-${type}`;
    el.textContent = msg;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 6000);
  }

  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(API + path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      logout();
      throw new Error("Сессия истекла. Войдите снова.");
    }
    if (!res.ok) {
      const detail = data.detail;
      const msg = typeof detail === "string" ? detail : detail?.message || JSON.stringify(detail) || res.statusText;
      throw new Error(msg);
    }
    return data;
  }

  function logout() {
    token = "";
    localStorage.removeItem("eklk_token");
    $("#appScreen").classList.add("hidden");
    $("#loginScreen").classList.remove("hidden");
  }

  async function afterLogin() {
    $("#loginScreen").classList.add("hidden");
    $("#appScreen").classList.remove("hidden");
    try {
      const me = await api("/auth/me");
      $("#userName").textContent = me.full_name || me.username;
    } catch (e) {
      showAlert(e.message);
    }
    await loadPaymentTypes();
    ensureItems("c_items", 1);
    ensureItems("p_items", 1);
    ensureItems("r_items", 1);
  }

  async function loadPaymentTypes() {
    try {
      const data = await api("/ecom/payment-types");
      paymentTypes = data.items || [];
      const sel = $("#p_type");
      sel.innerHTML = paymentTypes
        .filter((t) => t.id >= 100)
        .map((t) => `<option value="${t.id}">${t.id} — ${t.description}</option>`)
        .join("");
      if (!sel.innerHTML) {
        sel.innerHTML = `<option value="103">103 — Сбербанк</option>`;
      }
    } catch (e) {
      $("#p_type").innerHTML = `<option value="103">103 — Сбербанк</option>`;
    }
  }

  function itemHtml(prefix, idx) {
    return `
      <div class="item-row" data-idx="${idx}">
        <div><label>Наименование</label><input class="it-name" value="Тестовый товар ${idx + 1}" /></div>
        <div><label>Цена</label><input class="it-price" type="number" step="0.01" value="10.00" /></div>
        <div><label>Кол-во</label><input class="it-qty" type="number" step="0.001" value="1" /></div>
        <div><label>НДС</label>
          <select class="it-vat">
            <option value="vat20">НДС 20%</option>
            <option value="vat10">НДС 10%</option>
            <option value="vat0">НДС 0%</option>
            <option value="none">Без НДС</option>
          </select>
        </div>
        <div><label>&nbsp;</label><button type="button" class="btn btn-secondary it-rm" style="padding:8px 10px">×</button></div>
      </div>`;
  }

  function ensureItems(containerId, min) {
    const box = $(`#${containerId}`);
    if (box.children.length < min) {
      box.insertAdjacentHTML("beforeend", itemHtml(containerId, box.children.length));
    }
    box.querySelectorAll(".it-rm").forEach((btn) => {
      btn.onclick = () => {
        if (box.children.length > 1) btn.closest(".item-row").remove();
      };
    });
  }

  function collectItems(containerId) {
    return [...$(`#${containerId}`).querySelectorAll(".item-row")].map((row) => {
      const price = parseFloat(row.querySelector(".it-price").value) || 0;
      const quantity = parseFloat(row.querySelector(".it-qty").value) || 1;
      return {
        name: row.querySelector(".it-name").value.trim(),
        price,
        quantity,
        sum: Math.round(price * quantity * 100) / 100,
        vat_type: row.querySelector(".it-vat").value,
        payment_method: "full_payment",
        payment_object: 1,
      };
    });
  }

  function renderResult(el, data) {
    el.classList.remove("hidden");
    const status = data.status || "—";
    const kind = data.kind || "—";
    let badge = "badge-wait";
    if (status === "done") badge = "badge-done";
    if (status === "fail") badge = "badge-fail";
    if (kind === "INVOICE") badge += " badge-invoice";

    let html = `
      <div class="flex" style="margin-bottom:12px">
        <span class="badge ${badge}">${status}</span>
        <span class="badge badge-invoice">${kind}</span>
        ${data.uuid ? `<code style="color:var(--muted)">uuid: ${data.uuid}</code>` : ""}
      </div>`;

    if (data.invoice_payload?.link) {
      html += `<a class="link-pay" href="${data.invoice_payload.link}" target="_blank" rel="noopener">Открыть страницу оплаты →</a>`;
      html += `<p style="margin-top:8px;color:var(--muted);font-size:0.85rem">provider: ${data.invoice_payload.provider || "—"} · invoice_id: ${data.invoice_payload.invoice_id || "—"}</p>`;
    }
    if (data.permalink) {
      html += `<p class="mt-2"><a href="${data.permalink}" target="_blank">Permalink чека</a></p>`;
    }
    if (data.payload) {
      html += `<p class="mt-2" style="color:var(--muted);font-size:0.85rem">ФД: ${data.payload.fiscal_document_number || "—"} · ФП: ${data.payload.fiscal_document_attribute || "—"} · сумма: ${data.payload.total ?? "—"}</p>`;
    }
    html += `<div class="result-box mt-2">${JSON.stringify(data.raw || data, null, 2)}</div>`;
    el.innerHTML = html;
  }

  // Login
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    $("#loginError").classList.add("hidden");
    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: $("#loginUser").value.trim(),
          password: $("#loginPass").value,
        }),
      });
      token = data.access_token;
      localStorage.setItem("eklk_token", token);
      await afterLogin();
    } catch (err) {
      $("#loginError").textContent = err.message;
      $("#loginError").classList.remove("hidden");
    }
  };

  $("#logoutBtn").onclick = logout;

  // Tabs
  $$(".nav button[data-tab]").forEach((btn) => {
    btn.onclick = () => {
      $$(".nav button[data-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".tab-panel").forEach((p) => p.classList.add("hidden"));
      $(`#tab-${btn.dataset.tab}`).classList.remove("hidden");
    };
  });

  // Items add
  $("#c_addItem").onclick = () => {
    const box = $("#c_items");
    box.insertAdjacentHTML("beforeend", itemHtml("c", box.children.length));
    ensureItems("c_items", 0);
  };
  $("#p_addItem").onclick = () => {
    const box = $("#p_items");
    box.insertAdjacentHTML("beforeend", itemHtml("p", box.children.length));
    ensureItems("p_items", 0);
  };
  $("#r_addItem").onclick = () => {
    const box = $("#r_items");
    box.insertAdjacentHTML("beforeend", itemHtml("r", box.children.length));
    ensureItems("r_items", 0);
  };

  // Create check
  $("#c_submit").onclick = async () => {
    const btn = $("#c_submit");
    btn.disabled = true;
    try {
      const items = collectItems("c_items");
      const total = items.reduce((s, i) => s + i.sum, 0);
      const body = {
        items,
        payments: [{ type: 1, sum: total }],
        client: {
          name: $("#c_name").value || undefined,
          email: $("#c_email").value || undefined,
          phone: $("#c_phone").value || undefined,
        },
        sno: $("#c_sno").value,
      };
      const data = await api("/ecom/checks", { method: "POST", body: JSON.stringify(body) });
      renderResult($("#c_result"), data);
      showAlert("Чек создан", "success");
    } catch (e) {
      showAlert(e.message);
    } finally {
      btn.disabled = false;
    }
  };

  // Payment link
  $("#p_submit").onclick = async () => {
    const btn = $("#p_submit");
    btn.disabled = true;
    try {
      const items = collectItems("p_items");
      const total = items.reduce((s, i) => s + i.sum, 0);
      const body = {
        items,
        payments: [{ type: parseInt($("#p_type").value, 10), sum: total }],
        client: {
          name: $("#p_name").value || undefined,
          email: $("#p_email").value || undefined,
          phone: $("#p_phone").value || undefined,
        },
        success_url: $("#p_success").value || undefined,
        sno: "osn",
      };
      const data = await api("/ecom/checks", { method: "POST", body: JSON.stringify(body) });
      renderResult($("#p_result"), data);
      showAlert("Ссылка на оплату создана", "success");
    } catch (e) {
      showAlert(e.message);
    } finally {
      btn.disabled = false;
    }
  };

  // Status
  $("#s_submit").onclick = async () => {
    const uuid = $("#s_uuid").value.trim();
    if (!uuid) return showAlert("Укажите UUID");
    try {
      const data = await api(`/ecom/checks/${encodeURIComponent(uuid)}`);
      renderResult($("#s_result"), data);
    } catch (e) {
      showAlert(e.message);
    }
  };

  // Refund
  $("#r_submit").onclick = async () => {
    const btn = $("#r_submit");
    btn.disabled = true;
    try {
      const items = collectItems("r_items");
      const total = items.reduce((s, i) => s + i.sum, 0);
      const body = {
        items,
        payments: [{ type: 1, sum: total }],
        client: {
          email: $("#r_email").value || undefined,
          phone: $("#r_phone").value || undefined,
        },
        original_uuid: $("#r_orig").value || undefined,
      };
      const data = await api("/ecom/refunds", { method: "POST", body: JSON.stringify(body) });
      renderResult($("#r_result"), data);
      showAlert("Возврат создан", "success");
    } catch (e) {
      showAlert(e.message);
    } finally {
      btn.disabled = false;
    }
  };

  // Auto-login if token present
  if (token) {
    afterLogin().catch(() => logout());
  }
})();
