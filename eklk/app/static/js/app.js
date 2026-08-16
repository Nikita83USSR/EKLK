(() => {
  const API = "/api/v1";
  let token = localStorage.getItem("eklk_token") || "";
  let paymentTypes = [];
  let groupCode = localStorage.getItem("eklk_group") || "";
  let firmData = null; // { firm_id, firm_name, tax_identity, tax_variant, stores: [...] }

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const VAT_OPTS = `
    <option value="none">Без НДС</option>
    <option value="vat0">НДС 0%</option>
    <option value="vat5">НДС 5%</option>
    <option value="vat7">НДС 7%</option>
    <option value="vat10">НДС 10%</option>
    <option value="vat22" selected>НДС 22%</option>
    <option value="vat20">НДС 20% (старая)</option>
    <option value="vat105">НДС 5/105</option>
    <option value="vat107">НДС 7/107</option>
    <option value="vat110">НДС 10/110</option>
    <option value="vat122">НДС 22/122</option>
    <option value="vat120">НДС 20/120 (старая)</option>`;

  const OBJECT_OPTS = `
    <option value="1">Товар</option>
    <option value="3">Услуга</option>
    <option value="4">Работа</option>
    <option value="10">Платёж</option>
    <option value="11">Агентское вознаграждение</option>
    <option value="12">Составной предмет расчёта</option>
    <option value="13">Иной предмет расчёта</option>`;

  const METHOD_OPTS = `
    <option value="full_payment">Полный расчёт</option>
    <option value="full_prepayment">Предоплата 100%</option>
    <option value="prepayment">Предоплата</option>
    <option value="advance">Аванс</option>
    <option value="partial_payment">Частичный расчёт</option>
    <option value="credit">Передача в кредит</option>
    <option value="credit_payment">Оплата кредита</option>`;

  const FISCAL_PAY = `
    <option value="1">Наличными</option>
    <option value="2">Безналичными</option>
    <option value="14">Предоплата (зачёт аванса)</option>
    <option value="15">Постоплата (кредит)</option>
    <option value="16">Встречное предоставление</option>`;

  const OP_LABELS = {
    sell: "Приход",
    sell_refund: "Возврат прихода",
    buy: "Расход",
    buy_refund: "Возврат расхода",
  };
  const SNO_LABELS = {
    osn: "ОСН",
    usn_income: "УСН доходы",
    usn_income_outcome: "УСН доходы-расходы",
    esn: "ЕСН",
    patent: "Патент",
  };

  function showAlert(msg, type = "error") {
    const el = $("#globalAlert");
    el.className = `alert alert-${type}`;
    el.textContent = msg;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 7000);
  }

  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(API + path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      logout(false);
      throw new Error(data.detail || "Сессия истекла. Войдите снова.");
    }
    if (!res.ok) {
      const d = data.detail;
      const msg = typeof d === "string" ? d : d?.message || JSON.stringify(d) || res.statusText;
      throw new Error(msg);
    }
    return data;
  }

  function logout(clearStorage = true) {
    token = "";
    if (clearStorage) localStorage.removeItem("eklk_token");
    $("#appScreen").classList.add("hidden");
    $("#loginScreen").classList.remove("hidden");
    if ($("#appFooter")) $("#appFooter").classList.add("hidden");
  }

  function money(n) {
    return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  }

  function storesList() {
    return (firmData && firmData.stores) || [];
  }

  function getSelectedStoreId() {
    const fromLs = localStorage.getItem("eklk_group");
    const stores = storesList();
    if (fromLs && stores.some((s) => String(s.store_id) === String(fromLs))) return String(fromLs);
    if (groupCode && stores.some((s) => String(s.store_id) === String(groupCode))) return String(groupCode);
    if (stores.length) return String(stores[0].store_id);
    return fromLs || groupCode || "";
  }

  function setSelectedStoreId(id, persistServer) {
    groupCode = String(id);
    localStorage.setItem("eklk_group", groupCode);
    ["c_store", "p_store", "r_store"].forEach((sid) => {
      const el = document.getElementById(sid);
      if (el && String(el.value) !== groupCode) el.value = groupCode;
    });
    if ($("#sum_shop")) {
      const st = storesList().find((s) => String(s.store_id) === groupCode);
      $("#sum_shop").textContent = st
        ? `${st.store_name} (ID ${st.store_id})`
        : `ID ${groupCode}`;
    }
    if (persistServer && token) {
      api("/auth/select-store", {
        method: "POST",
        body: JSON.stringify({ store_id: id }),
      }).catch(() => {});
    }
  }

  function fillStoreSelects() {
    const stores = storesList();
    const selected = getSelectedStoreId();
    const opts = stores.length
      ? stores
          .map(
            (s) =>
              `<option value="${s.store_id}">${s.store_name} (ID ${s.store_id})</option>`
          )
          .join("")
      : `<option value="${selected || ""}">${selected ? "ID " + selected : "Нет магазинов"}</option>`;
    ["c_store", "p_store", "r_store"].forEach((sid) => {
      const el = document.getElementById(sid);
      if (!el) return;
      el.innerHTML = opts;
      if (selected) el.value = selected;
    });
    setSelectedStoreId(selected || groupCode, false);
  }

  function applyFirmToSettings() {
    if (!firmData) {
      ["set_firm_name", "set_firm_id", "set_firm_inn", "set_firm_sno"].forEach((id) => {
        if ($("#" + id)) $("#" + id).textContent = "—";
      });
      if ($("#set_stores_list")) $("#set_stores_list").innerHTML = "<p class=\"hint\">Нет данных</p>";
      return;
    }
    if ($("#set_firm_name")) $("#set_firm_name").textContent = firmData.firm_name || "—";
    if ($("#set_firm_id")) $("#set_firm_id").textContent = firmData.firm_id || "—";
    if ($("#set_firm_inn")) $("#set_firm_inn").textContent = firmData.tax_identity || "—";
    if ($("#set_firm_sno")) $("#set_firm_sno").textContent = firmData.tax_variant || "—";
    // Preselect SNO from firm if present
    if (firmData.tax_variant) {
      if ($("#c_sno")) $("#c_sno").value = firmData.tax_variant;
      if ($("#p_sno")) $("#p_sno").value = firmData.tax_variant;
    }
    const stores = storesList();
    const selected = getSelectedStoreId();
    if ($("#set_stores_list")) {
      if (!stores.length) {
        $("#set_stores_list").innerHTML = "<p class=\"hint\">Магазины не найдены</p>";
      } else {
        $("#set_stores_list").innerHTML = stores
          .map((s) => {
            const active = String(s.store_id) === String(selected);
            return `<div class="store-card ${active ? "active" : ""}" data-store-id="${s.store_id}">
              <div class="store-card-title">${s.store_name || "—"} ${active ? "<span class=\"badge badge-done\">текущий</span>" : ""}</div>
              <div class="store-card-meta">ID: <code>${s.store_id}</code></div>
              <div class="store-card-meta">${s.store_address || "—"}</div>
              ${active ? "" : `<button type="button" class="btn btn-sm mt-2 store-pick" data-store-id="${s.store_id}">Выбрать</button>`}
            </div>`;
          })
          .join("");
        $$("#set_stores_list .store-pick").forEach((btn) => {
          btn.onclick = () => {
            setSelectedStoreId(btn.dataset.storeId, true);
            applyFirmToSettings();
            fillStoreSelects();
            updateCreateSummary();
            showAlert("Магазин выбран: " + btn.dataset.storeId, "success");
          };
        });
      }
    }
  }

  function ingestFirm(firm, selectedStoreId) {
    if (firm) firmData = firm;
    if (selectedStoreId != null && selectedStoreId !== "") {
      groupCode = String(selectedStoreId);
      localStorage.setItem("eklk_group", groupCode);
    } else if (firmData && firmData.stores && firmData.stores.length) {
      const ls = localStorage.getItem("eklk_group");
      const ok = ls && firmData.stores.some((s) => String(s.store_id) === String(ls));
      if (!ok) {
        groupCode = String(firmData.stores[0].store_id);
        localStorage.setItem("eklk_group", groupCode);
      } else {
        groupCode = String(ls);
      }
    }
    fillStoreSelects();
    applyFirmToSettings();
  }

  /** Normalize phone in UI the same way as backend: +7XXXXXXXXXX */
  function normalizePhoneUI(phone) {
    if (!phone) return "";
    let d = String(phone).replace(/\D/g, "");
    if (d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1);
    if (d.length === 10 && d[0] === "9") d = "7" + d;
    if (d.length === 11 && d.startsWith("7")) return "+" + d;
    return null; // invalid
  }

  function paymentsSum(containerSel) {
    return $$(containerSel + " .pay-row").reduce((s, row) => {
      return s + (parseFloat(row.querySelector(".pay-sum").value) || 0);
    }, 0);
  }

  function setLoading(btn, loading, labelIdle, labelBusy) {
    if (!btn) return;
    btn.disabled = !!loading;
    btn.dataset.busy = loading ? "1" : "0";
    btn.textContent = loading ? (labelBusy || "Отправка…") : (labelIdle || btn.dataset.label || "Создать");
  }

  // Stable external_id per form attempt — retries return same check
  let lastExternalId = null;
  function nextExternalId(prefix) {
    lastExternalId = prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2, 10);
    return lastExternalId;
  }

  // --- Strict fiscal field helpers ---
  function markField(el, ok, msg) {
    if (!el) return;
    el.classList.toggle("invalid", !ok);
    el.title = ok ? "" : (msg || "Некорректное значение");
  }

  function validateInnValue(raw) {
    if (!raw || !String(raw).trim()) return { ok: false, digits: "", msg: "ИНН обязателен" };
    const digits = String(raw).replace(/\D/g, "");
    if (digits.length === 10 || digits.length === 12) return { ok: true, digits, msg: "" };
    return {
      ok: false,
      digits,
      msg: "ИНН: ровно 10 (юрлицо) или 12 (ИП) цифр, сейчас " + digits.length,
    };
  }

  // Phones: normalize on blur; red if cannot normalize
  ["c_phone", "p_phone", "r_phone", "c_sup_phones", "c_pa_phones", "c_recv_phones", "c_mt_phones"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("blur", () => {
      const v = el.value.trim();
      if (!v) {
        markField(el, true);
        return;
      }
      const n = normalizePhoneUI(v);
      if (n) {
        el.value = n;
        markField(el, true);
      } else {
        markField(el, false, "Нужен формат +79001234567");
      }
    });
    el.addEventListener("input", () => {
      // clear error while typing
      if (el.classList.contains("invalid") && el.value.trim()) {
        const n = normalizePhoneUI(el.value);
        if (n) markField(el, true);
      }
    });
  });

  // INN: only digits, length 10 or 12 — live check
  ["c_inn", "c_sup_inn", "c_mt_inn"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute("inputmode", "numeric");
    el.setAttribute("maxlength", "12");
    el.addEventListener("input", () => {
      // strip non-digits immediately
      const cleaned = el.value.replace(/\D/g, "").slice(0, 12);
      if (el.value !== cleaned) el.value = cleaned;
      if (!cleaned) {
        markField(el, true);
        return;
      }
      const r = validateInnValue(cleaned);
      markField(el, r.ok, r.msg);
    });
    el.addEventListener("blur", () => {
      const r = validateInnValue(el.value);
      if (el.value.trim()) markField(el, r.ok, r.msg);
    });
  });



  function itemRowHtml() {
    return `<tr class="item-row">
      <td><input class="it-name" placeholder="Товар или услуга" value="Товар" /></td>
      <td><input class="it-price" type="number" step="0.01" min="0" value="0.00" /></td>
      <td><input class="it-qty" type="number" step="0.001" min="0.001" value="1.000" /></td>
      <td><select class="it-vat">${VAT_OPTS}</select></td>
      <td><select class="it-object">${OBJECT_OPTS}</select></td>
      <td><select class="it-method">${METHOD_OPTS}</select></td>
      <td style="text-align:center"><input type="checkbox" class="it-agent" title="Агент по этой позиции" /></td>
      <td><button type="button" class="btn btn-secondary btn-sm it-rm">🗑</button></td>
    </tr>`;
  }

  function payRowHtml(fiscal = true) {
    const opts = fiscal ? FISCAL_PAY : "";
    return `<div class="pay-row">
      <div>
        <label>Вид оплаты</label>
        <select class="pay-type">${opts}</select>
      </div>
      <div>
        <label>Сумма, руб</label>
        <input class="pay-sum" type="number" step="0.01" min="0" value="0.00" />
      </div>
      <div>
        <label>&nbsp;</label>
        <button type="button" class="btn btn-danger btn-sm pay-rm">×</button>
      </div>
    </div>`;
  }

  function bindItemTable(tbodyId, onChange) {
    const tb = $(`#${tbodyId}`);
    tb.querySelectorAll(".it-rm").forEach((btn) => {
      btn.onclick = () => {
        if (tb.querySelectorAll(".item-row").length > 1) {
          btn.closest("tr").remove();
          onChange && onChange();
          if (tbodyId === "c_items") syncAgentBoxFromItems();
        }
      };
    });
    tb.querySelectorAll("input, select").forEach((el) => {
      el.oninput = el.onchange = () => {
        onChange && onChange();
        if (tbodyId === "c_items" && el.classList.contains("it-agent")) {
          syncAgentBoxFromItems();
        }
      };
    });
  }

  function syncAgentBoxFromItems() {
    const on = anyItemAgent("c_items");
    $("#c_agentBox").classList.toggle("hidden", !on);
    if (on) syncAgentTypeFields();
    updateCreateSummary();
  }

  function collectItems(tbodyId) {
    return $$(`#${tbodyId} .item-row`).map((row) => {
      const price = parseFloat(row.querySelector(".it-price").value) || 0;
      const quantity = parseFloat(row.querySelector(".it-qty").value) || 1;
      const agentCb = row.querySelector(".it-agent");
      return {
        name: (row.querySelector(".it-name").value || "").trim() || "Товар",
        price,
        quantity,
        sum: Math.round(price * quantity * 100) / 100,
        vat_type: row.querySelector(".it-vat").value,
        payment_object: parseInt(row.querySelector(".it-object").value, 10) || 1,
        payment_method: row.querySelector(".it-method").value,
        is_agent: !!(agentCb && agentCb.checked),
      };
    });
  }

  function anyItemAgent(tbodyId) {
    return $$(`#${tbodyId} .item-row .it-agent`).some((cb) => cb.checked);
  }

  function itemsSum(tbodyId) {
    return collectItems(tbodyId).reduce((s, i) => s + i.sum, 0);
  }

  function ensureItem(tbodyId, onChange) {
    const tb = $(`#${tbodyId}`);
    if (!tb.querySelector(".item-row")) {
      tb.insertAdjacentHTML("beforeend", itemRowHtml());
      bindItemTable(tbodyId, onChange);
    }
  }

  // ---- Summary ----
  function updateCreateSummary() {
    const total = itemsSum("c_items");
    const emailVal = ($("#c_email") && $("#c_email").value.trim()) || "";
    const phoneRaw = ($("#c_phone") && $("#c_phone").value.trim()) || "";
    const op = $("#c_operation").value;
    const sno = $("#c_sno").value;
    {
      const st = storesList().find((s) => String(s.store_id) === String(getSelectedStoreId()));
      $("#sum_shop").textContent = st
        ? `${st.store_name} (ID ${st.store_id})`
        : `ID ${getSelectedStoreId() || "—"}`;
    }
    $("#sum_op").textContent = OP_LABELS[op] || op;
    $("#sum_sno").textContent = SNO_LABELS[sno] || sno;
    $("#sum_email").textContent = emailVal || phoneRaw || "—";
    $("#sum_items").textContent = String($$("#c_items .item-row").length);
    $("#sum_pay").textContent = money(total) + " ₽";
    $("#sum_total").textContent = money(total) + " ₽";
    $("#c_payHint").textContent = "Автоподсчёт суммы товарных позиций: " + money(total);
    $("#c_total").value = money(total);

    const pays = $$("#c_payments .pay-row");
    if (pays.length === 1) {
      pays[0].querySelector(".pay-sum").value = money(total);
    }

    const payTotal = paymentsSum("#c_payments");
    const warn = $("#sum_warn");
    const issues = [];

    const hasContact = !!(emailVal || phoneRaw);
    if (!hasContact) {
      issues.push("Укажите email или телефон покупателя");
      markField($("#c_email"), false, "Нужен email или телефон");
      markField($("#c_phone"), false, "Нужен email или телефон");
    } else {
      if (emailVal && (emailVal.indexOf("@") < 1 || !emailVal.split("@")[1] || emailVal.split("@")[1].indexOf(".") < 0)) {
        issues.push("Некорректный email");
        markField($("#c_email"), false, "Некорректный email");
      } else {
        markField($("#c_email"), true);
      }
      if (phoneRaw) {
        const norm = normalizePhoneUI(phoneRaw);
        if (!norm) {
          issues.push("Телефон: формат +79001234567");
          markField($("#c_phone"), false, "Формат +79001234567");
        } else {
          markField($("#c_phone"), true);
        }
      } else {
        markField($("#c_phone"), true);
      }
    }

    if (total <= 0) issues.push("Добавьте товары с ненулевой суммой");

    const hasManualPay = $$("#c_payments .pay-row").some(
      (r) => (parseFloat(r.querySelector(".pay-sum").value) || 0) > 0
    );
    if (hasManualPay && Math.abs(payTotal - total) > 0.009) {
      issues.push(
        "Сумма оплат (" + money(payTotal) + ") ≠ сумме товаров (" + money(total) + ")"
      );
    }

    // Agent panel live
    if ($("#c_agentBox") && !$("#c_agentBox").classList.contains("hidden")) {
      const supInn = ($("#c_sup_inn") && $("#c_sup_inn").value.trim()) || "";
      const supPh = ($("#c_sup_phones") && $("#c_sup_phones").value.trim()) || "";
      const supName = ($("#c_sup_name") && $("#c_sup_name").value.trim()) || "";
      if (!supName) {
        issues.push("Наименование поставщика");
        markField($("#c_sup_name"), false);
      } else markField($("#c_sup_name"), true);
      const innR = validateInnValue(supInn);
      if (!innR.ok) {
        issues.push(innR.msg || "ИНН поставщика");
        markField($("#c_sup_inn"), false, innR.msg);
      } else markField($("#c_sup_inn"), true);
      if (!supPh) {
        issues.push("Телефон поставщика");
        markField($("#c_sup_phones"), false);
      } else if (!normalizePhoneUI(supPh)) {
        issues.push("Телефон поставщика: +79001234567");
        markField($("#c_sup_phones"), false);
      } else markField($("#c_sup_phones"), true);
    }

    if (issues.length) {
      warn.className = "warn-box error";
      warn.textContent = issues.join(". ");
      if ($("#c_submit")) $("#c_submit").disabled = true;
    } else {
      warn.className = "warn-box";
      warn.textContent = "✓ Ошибок нет";
      if ($("#c_submit") && $("#c_submit").dataset.busy !== "1") $("#c_submit").disabled = false;
    }
  }

  function updatePaySummary() {
    const total = itemsSum("p_items");
    $("#p_sum_total").textContent = money(total) + " ₽";
    const warn = $("#p_sum_warn");
    if (!warn) return;
    const issues = [];
    const em = ($("#p_email") && $("#p_email").value.trim()) || "";
    const ph = ($("#p_phone") && $("#p_phone").value.trim()) || "";
    if (!em && !ph) issues.push("Укажите email или телефон покупателя");
    if (total <= 0) issues.push("Добавьте товары с ненулевой суммой");
    if (issues.length) {
      warn.className = "warn-box error";
      warn.textContent = issues.join(". ");
    } else {
      warn.className = "warn-box";
      warn.textContent = "✓ Ошибок нет";
    }
  }

  // ---- Auth ----
  async function afterLogin(loginPayload) {
    $("#loginScreen").classList.add("hidden");
    $("#appScreen").classList.remove("hidden");
    if ($("#appFooter")) $("#appFooter").classList.remove("hidden");
    try {
      if (loginPayload && loginPayload.firm) {
        ingestFirm(loginPayload.firm, loginPayload.selected_store_id);
      } else {
        const me = await api("/auth/me");
        $("#userName").textContent = me.username || me.email || "";
        ingestFirm(me.firm, me.selected_store_id);
      }
      const me2 = await api("/auth/me").catch(() => null);
      if (me2) $("#userName").textContent = me2.username || me2.email || "";
    } catch (e) {
      showAlert(e.message);
    }
    await loadPaymentTypes();
    ensureItem("c_items", updateCreateSummary);
    ensureItem("p_items", updatePaySummary);
    if (!$("#c_payments .pay-row")) {
      $("#c_payments").insertAdjacentHTML("beforeend", payRowHtml(true));
      bindPays();
    }
    // bind store change
    ["c_store", "p_store", "r_store"].forEach((sid) => {
      const el = document.getElementById(sid);
      if (!el) return;
      el.onchange = () => {
        setSelectedStoreId(el.value, true);
        updateCreateSummary();
      };
    });
    updateCreateSummary();
    updatePaySummary();
  }

  async function loadPaymentTypes() {
    try {
      const data = await api("/ecom/payment-types");
      paymentTypes = data.items || [];
      const sel = $("#p_type");
      const providers = paymentTypes.filter((t) => t.id >= 100);
      sel.innerHTML = providers.length
        ? providers.map((t) => `<option value="${t.id}">${t.id} — ${t.description}</option>`).join("")
        : `<option value="103">103 — Сбербанк</option>`;
    } catch (e) {
      $("#p_type").innerHTML = `<option value="103">103 — Сбербанк</option>`;
    }
  }

  function bindPays() {
    $$("#c_payments .pay-rm").forEach((btn) => {
      btn.onclick = () => {
        if ($$("#c_payments .pay-row").length > 1) {
          btn.closest(".pay-row").remove();
          updateCreateSummary();
        }
      };
    });
    $$("#c_payments .pay-sum, #c_payments .pay-type").forEach((el) => {
      el.oninput = el.onchange = updateCreateSummary;
    });
  }

  function renderResult(el, data) {
    el.classList.remove("hidden");
    const status = data.status || "—";
    let badge = "badge-wait";
    if (status === "done") badge = "badge-done";
    if (status === "fail") badge = "badge-fail";
    let html = `<div class="flex" style="margin-bottom:10px">
      <span class="badge ${badge}">${status}</span>
      <span class="badge badge-invoice">${data.kind || "—"}</span>
      ${data.uuid ? `<code style="color:var(--muted);font-size:0.85rem">${data.uuid}</code>` : ""}
    </div>`;
    if (data.invoice_payload?.link) {
      html += `<a class="link-pay" href="${data.invoice_payload.link}" target="_blank" rel="noopener">Открыть страницу оплаты →</a>`;
      html += `<p class="hint" style="margin-top:8px">provider: ${data.invoice_payload.provider || "—"}</p>`;
    }
    if (data.permalink) html += `<p class="mt-2"><a href="${data.permalink}" target="_blank">Permalink чека</a></p>`;
    if (data.payload) {
      html += `<p class="hint mt-2">ФД: ${data.payload.fiscal_document_number ?? "—"} · ФП: ${data.payload.fiscal_document_attribute ?? "—"} · сумма: ${data.payload.total ?? "—"}</p>`;
    }
    html += `<div class="result-box">${JSON.stringify(data.raw || data, null, 2)}</div>`;
    el.innerHTML = html;
  }

  // Events
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
      await afterLogin(data);
    } catch (err) {
      $("#loginError").textContent = err.message;
      $("#loginError").classList.remove("hidden");
    }
  };

  $("#logoutBtn").onclick = () => logout(true);

  $$(".nav button[data-tab]").forEach((btn) => {
    btn.onclick = () => {
      $$(".nav button[data-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".tab-panel").forEach((p) => p.classList.add("hidden"));
      $(`#tab-${btn.dataset.tab}`).classList.remove("hidden");
      if (btn.dataset.tab === "orders") loadOrders();
    };
  });

  $("#c_toggleExtra").onclick = () => {
    $("#c_extraBuyer").classList.toggle("hidden");
  };
  $("#c_addProp").onchange = () => {
    $("#c_addPropBox").classList.toggle("hidden", !$("#c_addProp").checked);
  };

  /**
   * ФФД 1.2 / письмо ФНС:
   * - тег 1223 (данные агента) только для платёжных и банковских агентов
   * - supplier_info обязателен для ВСЕХ типов агента
   *
   * bank_paying_*  → paying + transfer (+ receive optional)
   * paying_*       → paying + receive
   * attorney / commission_agent / another → только supplier
   */
  const AGENT_UI = {
    bank_paying_agent:    { paying: true,  receive: false, transfer: true,  hint: "Банковский платёжный агент: операция, телефоны агента и данные оператора перевода + поставщик." },
    bank_paying_subagent: { paying: true,  receive: false, transfer: true,  hint: "Банковский платёжный субагент: операция, телефоны агента и данные оператора перевода + поставщик." },
    paying_agent:         { paying: true,  receive: true,  transfer: false, hint: "Платёжный агент: операция, телефоны агента и оператора по приёму платежей + поставщик." },
    paying_subagent:      { paying: true,  receive: true,  transfer: false, hint: "Платёжный субагент: операция, телефоны агента и оператора по приёму платежей + поставщик." },
    attorney:             { paying: false, receive: false, transfer: false, hint: "Поверенный: укажите только данные поставщика (принципала)." },
    commission_agent:     { paying: false, receive: false, transfer: false, hint: "Комиссионер: укажите только данные поставщика (комитента)." },
    another:              { paying: false, receive: false, transfer: false, hint: "Иной агент: укажите только данные поставщика." },
  };

  function syncAgentBox() {
    // legacy no-op; visibility from per-item checkboxes
    syncAgentBoxFromItems();
  }

  function syncAgentTypeFields() {
    const type = ($("#c_agent_type") && $("#c_agent_type").value) || "another";
    const cfg = AGENT_UI[type] || AGENT_UI.another;
    $("#c_agent_paying").classList.toggle("hidden", !cfg.paying);
    $("#c_agent_receive").classList.toggle("hidden", !cfg.receive);
    $("#c_agent_transfer").classList.toggle("hidden", !cfg.transfer);
    if ($("#c_agent_hint")) $("#c_agent_hint").textContent = cfg.hint;
  }

  document.querySelectorAll('input[name="c_agent"]').forEach((r) => {
    r.addEventListener("change", syncAgentBox);
  });
  if ($("#c_agent_type")) {
    $("#c_agent_type").addEventListener("change", () => {
      syncAgentTypeFields();
      updateCreateSummary();
    });
  }
  ["c_sup_name", "c_sup_inn", "c_sup_phones", "c_pa_op", "c_pa_phones", "c_recv_phones", "c_mt_name", "c_mt_addr", "c_mt_inn", "c_mt_phones"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", updateCreateSummary);
    el.addEventListener("blur", updateCreateSummary);
  });

  $("#c_addItem").onclick = () => {
    $("#c_items").insertAdjacentHTML("beforeend", itemRowHtml());
    bindItemTable("c_items", updateCreateSummary);
    updateCreateSummary();
  };
  $("#c_addPay").onclick = () => {
    $("#c_payments").insertAdjacentHTML("beforeend", payRowHtml(true));
    bindPays();
  };
  $("#p_addItem").onclick = () => {
    $("#p_items").insertAdjacentHTML("beforeend", itemRowHtml());
    bindItemTable("p_items", updatePaySummary);
    updatePaySummary();
  };

  ["p_email", "p_phone"].forEach((id) => {
    const el = $("#" + id);
    if (el) el.oninput = el.onchange = updatePaySummary;
  });

  ["c_sup_name", "c_sup_inn", "c_sup_phones", "c_pa_phones", "c_recv_phones", "c_mt_phones", "c_mt_inn"].forEach((id) => {
    const el = $("#" + id);
    if (el) {
      el.addEventListener("input", updateCreateSummary);
      el.addEventListener("change", updateCreateSummary);
    }
  });

  ["c_email", "c_phone", "c_operation", "c_sno"].forEach((id) => {
    const el = $("#" + id);
    if (el) el.oninput = el.onchange = updateCreateSummary;
  });

  $("#c_reset").onclick = () => {
    $("#c_result").classList.add("hidden");
    $("#c_email").value = "";
    updateCreateSummary();
  };

  $("#c_submit").onclick = async () => {
    const btn = $("#c_submit");
    if (btn.dataset.busy === "1") return; // already sending
    btn.dataset.label = "Создать чек";

    const items = collectItems("c_items");
    const total = items.reduce((s, i) => s + i.sum, 0);
    let payments = $$("#c_payments .pay-row").map((row) => ({
      type: parseInt(row.querySelector(".pay-type").value, 10),
      sum: parseFloat(row.querySelector(".pay-sum").value) || 0,
    })).filter((p) => p.sum > 0);
    if (!payments.length) {
      payments = [{ type: 1, sum: total }];
    }

    // Pre-validate before API
    const issues = [];
    if (!$("#c_email").value.trim() && !($("#c_phone") && $("#c_phone").value.trim())) {
      issues.push("Укажите email или телефон покупателя");
    }
    if (total <= 0) issues.push("Сумма товаров должна быть больше 0");
    const payTotal = payments.reduce((s, p) => s + p.sum, 0);
    if (Math.abs(payTotal - total) > 0.009) {
      issues.push(
        "Сумма оплат (" + money(payTotal) + ") не равна сумме товаров (" + money(total) + ")"
      );
    }
    const phoneRaw = ($("#c_phone") && $("#c_phone").value.trim()) || "";
    let phoneNorm = undefined;
    if (phoneRaw) {
      phoneNorm = normalizePhoneUI(phoneRaw);
      if (!phoneNorm) {
        issues.push("Телефон: нужен формат +79001234567, сейчас «" + phoneRaw + "»");
      }
    }
    if (issues.length) {
      updateCreateSummary();
      showAlert(issues.join(". "));
      return;
    }

    setLoading(btn, true, "Создать чек", "Отправка на кассу…");
    try {
      // Same external_id on retry within this "attempt" after error? 
      // New attempt gets new id; double-click blocked by busy flag.
      const external_id = nextExternalId("EKLK");
      const body = {
        external_id,
        items,
        payments,
        client: {
          email: $("#c_email").value.trim() || undefined,
          name: ($("#c_name") && $("#c_name").value.trim()) || undefined,
          phone: phoneNorm,
          inn: ($("#c_inn") && $("#c_inn").value.trim()) || undefined,
        },
        sno: $("#c_sno").value,
        group_code: String(($("#c_store") && $("#c_store").value) || getSelectedStoreId() || ""),
      };

      // Additional user props (name + value)
      if ($("#c_addProp") && $("#c_addProp").checked) {
        const n = ($("#c_addPropName") && $("#c_addPropName").value.trim()) || "";
        const v = ($("#c_addPropVal") && $("#c_addPropVal").value.trim()) || "";
        if (!n || !v) {
          showAlert("Доп. реквизит: укажите и наименование, и значение");
          setLoading(btn, false, "Создать чек");
          return;
        }
        body.additional_user_props = { name: n, value: v };
      }

      // Agent — только если отмечен хотя бы на одной позиции
      if (items.some((it) => it.is_agent)) {
        const atype = $("#c_agent_type").value;
        const cfg = AGENT_UI[atype] || AGENT_UI.another;
        const supName = ($("#c_sup_name") && $("#c_sup_name").value.trim()) || "";
        const supInn = ($("#c_sup_inn") && $("#c_sup_inn").value.trim()) || "";
        const supPhones = ($("#c_sup_phones") && $("#c_sup_phones").value.trim()) || "";
        if (!supName || !supInn || !supPhones) {
          showAlert("Для агента обязательны: наименование, ИНН и телефон поставщика");
          setLoading(btn, false, "Создать чек");
          return;
        }
        const innCheck = validateInnValue(supInn);
        if (!innCheck.ok) {
          markField($("#c_sup_inn"), false, innCheck.msg);
          showAlert(innCheck.msg + " («" + supInn + "»)");
          setLoading(btn, false, "Создать чек");
          return;
        }
        const innDigits = innCheck.digits;
        const supPhoneNorm = normalizePhoneUI(supPhones);
        if (!supPhoneNorm) {
          markField($("#c_sup_phones"), false, "Нужен формат +79001234567");
          showAlert(
            "Телефон поставщика: нужен формат +79001234567. Сейчас: «" + supPhones + "»"
          );
          setLoading(btn, false, "Создать чек");
          return;
        }
        if ($("#c_sup_phones")) $("#c_sup_phones").value = supPhoneNorm;
        if ($("#c_sup_inn")) $("#c_sup_inn").value = innDigits;
        body.agent = {
          type: atype,
          supplier_name: supName,
          supplier_inn: innDigits,
          supplier_phones: supPhoneNorm,
        };
        if (cfg.paying) {
          body.agent.paying_operation = ($("#c_pa_op") && $("#c_pa_op").value.trim()) || undefined;
          body.agent.paying_phones = ($("#c_pa_phones") && $("#c_pa_phones").value.trim()) || undefined;
        }
        if (cfg.receive) {
          body.agent.receive_phones = ($("#c_recv_phones") && $("#c_recv_phones").value.trim()) || undefined;
        }
        if (cfg.transfer) {
          body.agent.transfer_name = ($("#c_mt_name") && $("#c_mt_name").value.trim()) || undefined;
          body.agent.transfer_address = ($("#c_mt_addr") && $("#c_mt_addr").value.trim()) || undefined;
          body.agent.transfer_inn = ($("#c_mt_inn") && $("#c_mt_inn").value.trim()) || undefined;
          body.agent.transfer_phones = ($("#c_mt_phones") && $("#c_mt_phones").value.trim()) || undefined;
        }
      }
      const op = $("#c_operation").value;
      let data;
      if (op === "sell_refund") {
        data = await api("/ecom/refunds", { method: "POST", body: JSON.stringify(body) });
      } else {
        data = await api("/ecom/checks", { method: "POST", body: JSON.stringify(body) });
      }
      renderResult($("#c_result"), data);
      showAlert("Чек принят кассой (uuid: " + (data.uuid || "—") + ")", "success");
      lastExternalId = null; // next create = new id
    } catch (e) {
      showAlert(e.message);
      // keep lastExternalId so user can retry same id if needed — actually we generate new each time
      // EcomKassa dedup is by external_id; busy flag already prevents triple-click
    } finally {
      setLoading(btn, false, "Создать чек");
    }
  };

  $("#p_submit").onclick = async () => {
    const btn = $("#p_submit");
    if (btn.dataset.busy === "1") return;
    const items = collectItems("p_items");
    const total = items.reduce((s, i) => s + i.sum, 0);
    if (total <= 0) return showAlert("Сумма товаров должна быть больше 0");
    const emailP = ($("#p_email") && $("#p_email").value.trim()) || "";
    const phoneRaw = ($("#p_phone") && $("#p_phone").value.trim()) || "";
    if (!emailP && !phoneRaw) {
      return showAlert("Укажите email или телефон покупателя (требование ФНС)");
    }
    let phoneNorm = undefined;
    if (phoneRaw) {
      phoneNorm = normalizePhoneUI(phoneRaw);
      if (!phoneNorm) return showAlert("Телефон: нужен формат +79001234567");
    }
    setLoading(btn, true, "Создать ссылку", "Создание ссылки…");
    try {
      const body = {
        external_id: nextExternalId("PAY"),
        items,
        payments: [{ type: parseInt($("#p_type").value, 10), sum: total }],
        client: {
          email: $("#p_email").value || undefined,
          phone: phoneNorm,
          name: $("#p_name").value || undefined,
        },
        sno: $("#p_sno").value,
        success_url: $("#p_success").value || undefined,
        group_code: String(($("#p_store") && $("#p_store").value) || getSelectedStoreId() || ""),
      };
      const data = await api("/ecom/checks", { method: "POST", body: JSON.stringify(body) });
      renderResult($("#p_result"), data);
      showAlert("Ссылка создана", "success");
    } catch (e) {
      showAlert(e.message);
    } finally {
      setLoading(btn, false, "Создать ссылку");
    }
  };

  $("#s_submit").onclick = async () => {
    const uuid = $("#s_uuid").value.trim();
    if (!uuid) return showAlert("Укажите UUID");
    try {
      renderResult($("#s_result"), await api(`/ecom/checks/${encodeURIComponent(uuid)}`));
    } catch (e) {
      showAlert(e.message);
    }
  };




  // ---- Orders list ----
  let ordersOffset = 0;
  let ordersLimit = 30;
  let ordersSelectedId = null;

  function toIsoLocal(val) {
    if (!val) return undefined;
    // datetime-local -> ISO-ish UTC guess: treat as local, append Z-less; API wants ISO 8601
    // Convert: 2026-08-17T10:00 -> 2026-08-17T10:00:00Z (user enters as filter approx)
    if (val.length === 16) return val + ":00Z";
    return val;
  }

  function statusBadge(st) {
    const s = (st || "—").toString();
    const cls = "badge badge-status-" + s.replace(/\s+/g, "_");
    return `<span class="${cls}">${s}</span>`;
  }

  function typeLabel(t) {
    return { VCHR: "Чек", INVC: "Счёт", CORD: "Курьер" }[t] || t || "—";
  }

  function formatMoney(n) {
    if (n == null || n === "") return "—";
    return money(n) + " ₽";
  }

  function formatDt(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return iso;
    }
  }

  async function loadOrders() {
    const list = $("#o_list");
    if (!list) return;
    list.innerHTML = `<p class="hint">Загрузка…</p>`;
    ordersLimit = parseInt(($("#o_limit") && $("#o_limit").value) || "30", 10);
    const body = {
      offset: ordersOffset,
      limit: ordersLimit,
    };
    const ext = ($("#o_ext") && $("#o_ext").value.trim()) || "";
    if (ext) body.external_id = ext;
    const types = ($("#o_types") && $("#o_types").value) || "";
    if (types) body.order_types = types.split(",").map((x) => x.trim()).filter(Boolean);
    const since = toIsoLocal($("#o_since") && $("#o_since").value);
    const until = toIsoLocal($("#o_until") && $("#o_until").value);
    if (since) body.since = since;
    if (until) body.until = until;

    try {
      const data = await api("/orders/search", { method: "POST", body: JSON.stringify(body) });
      const rows = data.result || [];
      if (!rows.length) {
        list.innerHTML = `<p class="hint">Чеков не найдено</p>`;
      } else {
        list.innerHTML = `<table class="orders-table">
          <thead><tr>
            <th>ID</th><th>Дата</th><th>Тип</th><th>Статус</th><th>Сумма</th><th>Магазин</th>
          </tr></thead>
          <tbody>
            ${rows
              .map((r) => {
                const id = r.order_id;
                const active = String(id) === String(ordersSelectedId) ? "active" : "";
                return `<tr class="${active}" data-order-id="${id}">
                  <td><code>${id ?? "—"}</code></td>
                  <td>${formatDt(r.updated)}</td>
                  <td>${typeLabel(r.order_type)}</td>
                  <td>${statusBadge(r.status)}</td>
                  <td>${formatMoney(r.total)}</td>
                  <td>${r.store_name || r.store_id || "—"}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>`;
        list.querySelectorAll("tr[data-order-id]").forEach((tr) => {
          tr.onclick = () => openOrderDetail(tr.dataset.orderId);
        });
      }
      const info = $("#o_page_info");
      if (info) {
        info.textContent = `показано ${rows.length} · смещение ${ordersOffset}`;
      }
      if ($("#o_prev")) $("#o_prev").disabled = ordersOffset <= 0;
      if ($("#o_next")) $("#o_next").disabled = rows.length < ordersLimit;
    } catch (e) {
      list.innerHTML = `<p class="hint" style="color:var(--danger)">${e.message}</p>`;
      showAlert(e.message);
    }
  }

  function paymentTypeLabel(t) {
    const map = {
      0: "Наличные",
      1: "Безналичные",
      2: "Предоплата (аванс)",
      3: "Постоплата (кредит)",
      4: "Встречное предоставление",
    };
    return map[t] || ("Тип " + t);
  }

  function renderReceipt(atol5, summary) {
    const el = $("#o_detail");
    const ph = $("#o_detail_placeholder");
    if (!el) return;
    if (ph) ph.classList.add("hidden");
    el.classList.remove("hidden");

    const receipt = (atol5 && atol5.receipt) || {};
    const company = receipt.company || {};
    const client = receipt.client || {};
    const items = receipt.items || [];
    const payments = receipt.payments || [];
    const total = receipt.total != null ? receipt.total : summary && summary.total;

    let html = `<div class="r-head">
      <div class="r-title">Кассовый чек</div>
      <div class="r-meta">ID ${summary?.order_id ?? "—"} · ${typeLabel(summary?.order_type)} · ${statusBadge(summary?.status || "")}</div>
      <div class="r-meta">${formatDt(summary?.updated)}</div>
      ${atol5?.external_id ? `<div class="r-meta">ext: ${atol5.external_id}</div>` : ""}
    </div>`;

    html += `<div class="r-line"><span>Магазин</span><span>${summary?.store_name || company.payment_address || "—"}</span></div>`;
    html += `<div class="r-line"><span>ИНН</span><span>${company.inn || "—"}</span></div>`;
    html += `<div class="r-line"><span>СНО</span><span>${company.sno || "—"}</span></div>`;
    if (client.email || client.phone || client.name) {
      html += `<div class="r-line"><span>Покупатель</span><span>${[client.name, client.email, client.phone].filter(Boolean).join(" · ") || "—"}</span></div>`;
    }
    if (receipt.cashier) {
      html += `<div class="r-line"><span>Кассир</span><span>${receipt.cashier}</span></div>`;
    }

    html += `<div style="margin:12px 0 4px;font-weight:600;font-size:0.8rem;color:var(--muted)">Позиции</div>`;
    if (!items.length) {
      html += `<p class="hint">Нет позиций (или формат Atol 5 недоступен)</p>`;
    } else {
      items.forEach((it) => {
        const vat = (it.vat && it.vat.type) || "—";
        html += `<div class="r-item">
          <div class="r-item-name">${it.name || "—"}</div>
          <div class="r-item-sub">${it.quantity ?? 1} × ${formatMoney(it.price)} · ${it.payment_method || ""} · НДС ${vat}</div>
          <div class="r-line"><span></span><span>${formatMoney(it.sum)}</span></div>
        </div>`;
      });
    }

    html += `<div class="r-total"><span>Итого</span><span>${formatMoney(total)}</span></div>`;
    if (payments.length) {
      html += `<div class="r-pay">Оплата: ${payments
        .map((p) => paymentTypeLabel(p.type) + " " + formatMoney(p.sum))
        .join("; ")}</div>`;
    }

    html += `<details style="margin-top:14px"><summary class="hint" style="cursor:pointer">JSON Atol 5</summary>
      <div class="result-box" style="max-height:240px">${JSON.stringify(atol5 || {}, null, 2)}</div>
    </details>`;

    el.innerHTML = html;
  }

  async function openOrderDetail(orderId) {
    ordersSelectedId = orderId;
    $$("#o_list tr[data-order-id]").forEach((tr) => {
      tr.classList.toggle("active", String(tr.dataset.orderId) === String(orderId));
    });
    const el = $("#o_detail");
    const ph = $("#o_detail_placeholder");
    if (ph) {
      ph.classList.remove("hidden");
      ph.textContent = "Загрузка чека…";
    }
    if (el) el.classList.add("hidden");
    try {
      const data = await api("/orders/" + encodeURIComponent(orderId));
      renderReceipt(data.atol5, data.summary);
    } catch (e) {
      if (ph) ph.textContent = e.message;
      showAlert(e.message);
    }
  }

  function bindOrdersUI() {
    if ($("#o_search")) $("#o_search").onclick = () => { ordersOffset = 0; loadOrders(); };
    if ($("#o_refresh")) $("#o_refresh").onclick = () => loadOrders();
    if ($("#o_reset")) {
      $("#o_reset").onclick = () => {
        if ($("#o_ext")) $("#o_ext").value = "";
        if ($("#o_types")) $("#o_types").value = "";
        if ($("#o_since")) $("#o_since").value = "";
        if ($("#o_until")) $("#o_until").value = "";
        if ($("#o_limit")) $("#o_limit").value = "30";
        ordersOffset = 0;
        loadOrders();
      };
    }
    if ($("#o_prev")) {
      $("#o_prev").onclick = () => {
        ordersOffset = Math.max(0, ordersOffset - ordersLimit);
        loadOrders();
      };
    }
    if ($("#o_next")) {
      $("#o_next").onclick = () => {
        ordersOffset += ordersLimit;
        loadOrders();
      };
    }
  }


  // Settings sub-tabs
  $$(".settings-tab").forEach((btn) => {
    btn.onclick = () => {
      $$(".settings-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const name = btn.dataset.settingsTab;
      $("#settings-org").classList.toggle("hidden", name !== "org");
      $("#settings-stores").classList.toggle("hidden", name !== "stores");
    };
  });

  if ($("#set_refresh")) {
    $("#set_refresh").onclick = async () => {
      try {
        const firm = await api("/auth/firm");
        ingestFirm(firm, getSelectedStoreId());
        showAlert("Профиль обновлён", "success");
      } catch (e) {
        showAlert(e.message);
      }
    };
  }

  if (token) afterLogin().catch(() => logout(true));
})();
