(() => {
  const API = "/api/v1";
  let token = localStorage.getItem("eklk_token") || "";
  let paymentTypes = [];
  let groupCode = localStorage.getItem("eklk_group") || "";
  let firmData = null; // { firm_id, firm_name, tax_identity, tax_variant, stores: [...] }
  let createAttempted = false; // contact error only after submit attempt

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  // Тема: light | dark | glass. localStorage = кэш; после login — GET /auth/settings.
  const THEME_KEY = "eklk_theme";
  const THEMES = ["light", "dark", "glass"];
  function getStoredTheme() {
    const t = localStorage.getItem(THEME_KEY) || "light";
    return THEMES.includes(t) ? t : "light";
  }
  function applyTheme(theme, persistServer) {
    const t = THEMES.includes(theme) ? theme : "light";
    document.body.setAttribute("data-theme", t === "light" ? "" : t);
    if (t === "light") document.body.removeAttribute("data-theme");
    else document.body.setAttribute("data-theme", t);
    localStorage.setItem(THEME_KEY, t);
    $$('input[name="eklk_theme"]').forEach((el) => {
      el.checked = el.value === t;
    });
    if (persistServer && token) {
      api("/auth/settings", {
        method: "PUT",
        body: JSON.stringify({ user: { theme: t } }),
      }).catch(() => {});
    }
  }
  applyTheme(getStoredTheme());

  /** Prefs с сервера (user + firm). Ошибка / degraded → localStorage, UI не падает. */
  async function loadServerSettings(preferredStoreHint) {
    try {
      const s = await api("/auth/settings");
      const u = (s && s.user) || {};
      const f = (s && s.firm) || {};
      // degraded: сервер отдал дефолты (БД недоступна) — не затираем локальный кэш
      if (s && s.degraded) {
        return {
          preferredStore: preferredStoreHint || localStorage.getItem("eklk_group") || null,
          user: u,
          firm: f,
          degraded: true,
        };
      }
      if (u.theme && THEMES.includes(u.theme)) {
        applyTheme(u.theme, false);
      }
      if (u.last_pay_type) {
        localStorage.setItem("eklk_last_pay_type", String(u.last_pay_type));
      }
      // selected_store_id — на логин (user); firm.legacy только как запасной кэш
      const fromUser =
        u.selected_store_id != null && u.selected_store_id !== ""
          ? String(u.selected_store_id)
          : null;
      const fromFirmLegacy =
        f.selected_store_id != null && f.selected_store_id !== ""
          ? String(f.selected_store_id)
          : null;
      const preferred =
        fromUser ||
        fromFirmLegacy ||
        preferredStoreHint ||
        localStorage.getItem("eklk_group") ||
        null;
      return { preferredStore: preferred, user: u, firm: f, degraded: false };
    } catch (e) {
      return {
        preferredStore: preferredStoreHint || localStorage.getItem("eklk_group") || null,
        user: null,
        firm: null,
        degraded: true,
      };
    }
  }

  function persistLastPayType(val) {
    if (!val) return;
    localStorage.setItem("eklk_last_pay_type", String(val));
    if (token) {
      api("/auth/settings", {
        method: "PUT",
        body: JSON.stringify({ user: { last_pay_type: String(val) } }),
      }).catch(() => {});
    }
  }

  const VAT_OPTS = `
    <option value="none" selected>Без НДС</option>
    <option value="vat0">НДС 0%</option>
    <option value="vat5">НДС 5%</option>
    <option value="vat7">НДС 7%</option>
    <option value="vat10">НДС 10%</option>
    <option value="vat22">НДС 22%</option>
    <option value="vat20">НДС 20% (старая)</option>
    <option value="vat105">НДС 5/105</option>
    <option value="vat107">НДС 7/107</option>
    <option value="vat110">НДС 10/110</option>
    <option value="vat122">НДС 22/122</option>
    <option value="vat120">НДС 20/120 (старая)</option>`;

  const OBJECT_OPTS = `
    <option value="1">Товар</option>
    <option value="4">Услуга</option>
    <option value="3">Работа</option>
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

  // Atol Online v5 / ФФД 1.2 measure (тег 2108). 0 = шт
  const MEASURE_OPTS = `
    <option value="0" selected>шт</option>
    <option value="10">г</option>
    <option value="11">кг</option>
    <option value="12">т</option>
    <option value="20">см</option>
    <option value="21">дм</option>
    <option value="22">м</option>
    <option value="40">мл</option>
    <option value="41">л</option>
    <option value="42">м³</option>
    <option value="50">кВт·ч</option>
    <option value="70">сутки</option>
    <option value="71">час</option>
    <option value="72">мин</option>
    <option value="255">иное</option>`;

  const FISCAL_PAY = `
    <option value="0">Наличными</option>
    <option value="1" selected>Безналичными</option>
    <option value="2">Предоплата (зачёт аванса)</option>
    <option value="3">Постоплата (кредит)</option>
    <option value="4">Встречное предоставление</option>`;

  const OP_LABELS = {
    sell: "Приход",
    sell_refund: "Возврат прихода",
    buy: "Расход",
    buy_refund: "Возврат расхода",
    sell_correction: "Коррекция прихода",
    buy_correction: "Коррекция расхода",
    sell_refund_correction: "Коррекция возврата прихода",
    buy_refund_correction: "Коррекция возврата расхода",
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
    if (!el) return;
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
    const detailMsg = (() => {
      const d = data && data.detail;
      if (typeof d === "string") return d;
      if (Array.isArray(d)) {
        return d.map((x) => (typeof x === "string" ? x : x.msg || x.message || JSON.stringify(x))).join("; ");
      }
      if (d && typeof d === "object") return d.message || d.msg || JSON.stringify(d);
      return data.error || data.message || res.statusText || "Ошибка запроса";
    })();
    // 401 on login itself must NOT call logout (no session yet)
    if (res.status === 401) {
      const isLogin = String(path).indexOf("/auth/login") !== -1;
      if (!isLogin) logout(false);
      throw new Error(detailMsg || "Сессия истекла. Войдите снова.");
    }
    if (!res.ok) {
      throw new Error(detailMsg);
    }
    return data;
  }

  function logout(clearStorage = true) {
    token = "";
    if (clearStorage) {
      localStorage.removeItem("eklk_token");
      // eklk_group (last store) intentionally kept across logout
    }
    try { document.documentElement.classList.remove("eklk-authed"); } catch (e) { /* ignore */ }
    if ($("#appScreen")) $("#appScreen").classList.add("hidden");
    if ($("#loginScreen")) $("#loginScreen").classList.remove("hidden");
    if ($("#appFooter")) $("#appFooter").classList.add("hidden");
  }

  function money(n) {
    return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  }

  /** Округление вверх до копейки (1 коп = 0.01 ₽). Дробь копейки → +1 коп. */
  function ceilMoney(n) {
    const x = Number(n) || 0;
    if (!isFinite(x) || x <= 0) return 0;
    return Math.ceil(x * 100 - 1e-9) / 100;
  }

  /**
   * Ограничение знаков после запятой при вводе (запятая → точка).
   * maxDec=2 цена/сумма, maxDec=3 количество.
   */
  function restrictDecimalInput(el, maxDec) {
    if (!el || el.dataset.decBound === "1") return;
    el.dataset.decBound = "1";
    el.addEventListener("input", () => {
      let v = String(el.value).replace(",", ".");
      // только цифры и одна точка
      v = v.replace(/[^\d.]/g, "");
      const firstDot = v.indexOf(".");
      if (firstDot !== -1) {
        v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
        const parts = v.split(".");
        if (parts[1] && parts[1].length > maxDec) {
          v = parts[0] + "." + parts[1].slice(0, maxDec);
        }
      }
      if (el.value !== v) el.value = v;
    });
    el.addEventListener("keydown", (e) => {
      // блок лишних знаков уже на input; e — для scientific notation / e
      if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") {
        e.preventDefault();
      }
    });
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
    const stores = (firmData && firmData.stores) || [];
    const pick = (id) => {
      if (id == null || id === "") return null;
      const sid = String(id);
      if (!stores.length) return sid;
      return stores.some((s) => String(s.store_id) === sid) ? sid : null;
    };
    let chosen =
      pick(selectedStoreId) ||
      pick(localStorage.getItem("eklk_group")) ||
      pick(groupCode) ||
      (stores.length ? String(stores[0].store_id) : "");
    if (chosen) {
      groupCode = chosen;
      localStorage.setItem("eklk_group", groupCode);
    }
    fillStoreSelects();
    applyFirmToSettings();
  }

  /** Quantity: Atol/FFD — не более 3 знаков после запятой (тысячные). */
  /**
   * Quantity: min 0.01, не мельче тысячной (max 3 знака после запятой).
   */
  function normalizeQty(raw) {
    if (raw === "" || raw == null) return null;
    const s = String(raw).replace(",", ".").trim();
    if (!/^\d+(\.\d{1,3})?$/.test(s) && !/^\d+\.$/.test(s)) {
      // отсекаем 1.0001 и мусор; промежуточное "1." на blur отвергаем
      const n0 = parseFloat(s);
      if (!isFinite(n0)) return null;
      if (Math.abs(n0 - Math.round(n0 * 1000) / 1000) > 1e-9) return null;
    }
    const n = parseFloat(s);
    if (!isFinite(n) || n < 0.01) return null;
    const rounded = Math.round(n * 1000) / 1000;
    if (Math.abs(n - rounded) > 1e-9) return null;
    return rounded;
  }

  function formatQty(n) {
    if (n == null || !isFinite(n)) return "";
    const r = Math.round(n * 1000) / 1000;
    if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
    return String(r);
  }

  /**
   * Price / money: min 0.01 ₽, строго 2 знака (копейки, без дробей копейки).
   * 1.001 → invalid (не нормализуем «тихо» при blur в normalize — для ввода режем на input).
   */
  function normalizePrice(raw) {
    if (raw === "" || raw == null) return null;
    const s = String(raw).replace(",", ".").trim();
    const n = parseFloat(s);
    if (!isFinite(n) || n < 0.01) return null;
    // не больше 2 знаков после запятой
    const rounded = Math.round(n * 100) / 100;
    if (Math.abs(n - rounded) > 1e-9) return null;
    return rounded;
  }

  function formatPrice(n) {
    if (n == null || !isFinite(n)) return "";
    return (Math.round(n * 100) / 100).toFixed(2);
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
      const raw = row.querySelector(".pay-sum").value;
      const n = normalizePrice(raw);
      // оплата тоже только до копейки; дробь копейки — вверх
      return s + (n != null ? n : ceilMoney(parseFloat(String(raw).replace(",", ".")) || 0));
    }, 0);
  }

  function setLoading(btn, loading, labelIdle, labelBusy) {
    if (!btn) return;
    btn.disabled = !!loading;
    btn.dataset.busy = loading ? "1" : "0";
    btn.textContent = loading ? (labelBusy || "Отправка…") : (labelIdle || btn.dataset.label || "Создать");
  }

  // Stable external_id per form attempt — retries return same check

  // --- FFD 1.2 / Atol Online 5: payment_method × payment_object ---
  // 1105 = признак способа расчёта; UI must block bad combos before API.
  // object: 1 товар, 3 услуга, 4 работа, 10 платёж, 11 агент.вознагр., 12 составной, 13 иной
  const OBJECT_BY_METHOD = {
    // FFD 1.2: 1=товар, 3=работа, 4=услуга, 10=платёж, ...
    full_payment:     [1, 3, 4, 10, 11, 12, 13],
    full_prepayment:  [1, 3, 4, 10, 11, 12, 13], // предоплата 100% — как полный расчёт
    prepayment:       [10, 12, 13],
    advance:          [10, 13],              // аванс — платёж
    partial_payment:  [1, 3, 4, 10, 11, 12, 13],
    credit:           [1, 3, 4, 10, 12, 13],
    credit_payment:   [10, 13],
  };
  const OBJECT_LABELS = {
    1: "Товар", 3: "Работа", 4: "Услуга", 10: "Платёж",
    11: "Агентское вознаграждение", 12: "Составной предмет", 13: "Иной предмет",
  };
  const METHOD_LABELS = {
    full_payment: "Полный расчёт",
    full_prepayment: "Предоплата 100%",
    prepayment: "Предоплата",
    advance: "Аванс",
    partial_payment: "Частичный расчёт",
    credit: "Передача в кредит",
    credit_payment: "Оплата кредита",
  };

  /** Rebuild .it-object options for a row based on .it-method */
  function syncObjectOptionsForRow(row) {
    if (!row) return;
    const methodEl = row.querySelector(".it-method");
    const objectEl = row.querySelector(".it-object");
    if (!methodEl || !objectEl) return;
    const method = methodEl.value || "full_payment";
    const allowed = OBJECT_BY_METHOD[method] || OBJECT_BY_METHOD.full_payment;
    let cur = parseInt(objectEl.value, 10);
    if (!allowed.includes(cur)) cur = allowed[0];
    objectEl.innerHTML = allowed
      .map((o) => `<option value="${o}" ${o === cur ? "selected" : ""}>${OBJECT_LABELS[o] || o}</option>`)
      .join("");
    markField(objectEl, true);
    markField(methodEl, true);
  }

  function syncAllItemConstraints(tbodyId) {
    $$(`#${tbodyId} .item-row`).forEach(syncObjectOptionsForRow);
  }

  /** Returns list of human issues for create-check form */
  function validateCreateCombinations() {
    const issues = [];
    $$("#c_items .item-row").forEach((row, idx) => {
      const n = idx + 1;
      const method = (row.querySelector(".it-method") && row.querySelector(".it-method").value) || "";
      const objectEl = row.querySelector(".it-object");
      const obj = objectEl ? parseInt(objectEl.value, 10) : 1;
      const allowed = OBJECT_BY_METHOD[method] || OBJECT_BY_METHOD.full_payment;
      if (!allowed.includes(obj)) {
        const msg =
          `Позиция ${n}: способ «${METHOD_LABELS[method] || method}» несовместим с предметом «${OBJECT_LABELS[obj] || obj}». ` +
          `Допустимо: ${allowed.map((o) => OBJECT_LABELS[o] || o).join(", ")}.`;
        issues.push(msg);
        markField(objectEl, false, msg);
        markField(row.querySelector(".it-method"), false, msg);
      } else {
        markField(objectEl, true);
        markField(row.querySelector(".it-method"), true);
      }
      const price = parseFloat(row.querySelector(".it-price").value) || 0;
      const qtyRaw = row.querySelector(".it-qty") && row.querySelector(".it-qty").value;
      const qty = normalizeQty(qtyRaw);
      if (price < 0) {
        issues.push(`Позиция ${n}: цена должна быть ≥ 0`);
        markField(row.querySelector(".it-price"), false);
      }
      if (qty == null) {
        issues.push(
          `Позиция ${n}: количество — минимум 0.01, точность не мельче тысячной`
        );
        markField(row.querySelector(".it-qty"), false, "Мин. 0.01");
      } else {
        markField(row.querySelector(".it-qty"), true);
      }
      if (price > 0 && price < 0.01) {
        issues.push(`Позиция ${n}: цена — минимум 0.01 ₽ (1 копейка)`);
        markField(row.querySelector(".it-price"), false, "Мин. 0.01");
      }
    });
    // payments sum vs items
    const total = itemsSum("c_items");
    const payTotal = paymentsSum("#c_payments");
    if (Math.abs(total - payTotal) > 0.009) {
      const diff = Math.round((payTotal - total) * 100) / 100;
      if (diff < 0) {
        issues.push(`Не хватает ${money(Math.abs(diff))} ₽`);
      } else {
        issues.push(`Переплата ${money(diff)} ₽`);
      }
    }
    // advance/prepayment often requires payment type 2 when settling advance — soft hint only for pure advance items
    const allAdvance = $$("#c_items .item-row").every((row) => {
      const m = row.querySelector(".it-method");
      return m && ["advance", "full_prepayment", "prepayment"].includes(m.value);
    });
    if (allAdvance && $$("#c_items .item-row").length) {
      // ok
    }
    return issues;
  }

  function friendlyApiError(msg) {
    const s = String(msg || "");
    if (/1105|способа расч|payment_method|признак способа/i.test(s)) {
      return {
        main: "Некорректные параметры расчёта. Выбранный способ расчёта несовместим с предметом расчёта. Измените один из параметров.",
        detail: s,
      };
    }
    if (/120\s*:/i.test(s)) {
      return {
        main: "Касса отклонила чек: некорректные реквизиты. Проверьте способ и предмет расчёта, оплаты и СНО.",
        detail: s,
      };
    }
    if (/quantity|количеств|0\.001|thousand|decimal|scale|precision/i.test(s)) {
      return {
        main: "Количество: допустима точность до тысячных (пример 1.000 или 1.001), не мельче.",
        detail: s,
      };
    }
    return { main: s || "Ошибка запроса", detail: "" };
  }

  // Clone-from-order state
  let sourceDocumentId = null; // orderId of source when «Редактировать»
  let sourceExternalId = null;

  function setCloneBanner() {
    let el = $("#cloneBanner");
    if (!sourceDocumentId) {
      if (el) el.classList.add("hidden");
      return;
    }
    if (!el) {
      const formHint = $("#tab-create .card");
      if (formHint) {
        el = document.createElement("div");
        el.id = "cloneBanner";
        el.className = "clone-banner";
        formHint.parentNode.insertBefore(el, formHint);
      }
    }
    if (el) {
      el.classList.remove("hidden");
      el.innerHTML =
        `<strong>Новый документ на основе чека № ${sourceDocumentId}</strong>` +
        (sourceExternalId ? ` <span class="hint">(исх. external_id: ${sourceExternalId})</span>` : "") +
        ` · исходный чек не изменится · будет новый external_id` +
        ` <button type="button" class="btn btn-secondary btn-sm" id="cloneCancelBtn">Сбросить</button>`;
      const btn = $("#cloneCancelBtn");
      if (btn) {
        btn.onclick = () => {
          sourceDocumentId = null;
          sourceExternalId = null;
          setCloneBanner();
        };
      }
    }
  }

  function mapAtolVat(v) {
    if (!v) return "none";
    if (typeof v === "string") return v;
    if (v.type) return v.type;
    return "none";
  }

  function mapAtolMethod(m) {
    if (!m) return "full_payment";
    const s = String(m).toLowerCase();
    if (METHOD_LABELS[s]) return s;
    // numeric legacy
    const map = {
      "1": "full_prepayment",
      "2": "prepayment",
      "3": "advance",
      "4": "full_payment",
      "5": "partial_payment",
      "6": "credit",
      "7": "credit_payment",
    };
    return map[s] || "full_payment";
  }

  function fillCreateFormFromOrder(detail) {
    const atol = detail.atol5 || {};
    // Atol5 may be {receipt: {...}} or the receipt itself
    const receipt = atol.receipt || atol;
    const summary = detail.summary || {};
    sourceDocumentId = summary.order_id || ordersSelectedId;
    sourceExternalId = summary.external_id || null;
    lastExternalId = null; // force new id on submit

    // Operation: sale -> sell, refund heuristics
    let op = "sell";
    if (summary.is_sale === false || /refund|возврат/i.test(String(summary.order_type || ""))) {
      op = "sell_refund";
    }
    // atol operation
    if (receipt.operation) {
      const o = String(receipt.operation).toLowerCase();
      if (["sell", "sell_refund", "buy", "buy_refund"].includes(o)) op = o;
    }
    if ($("#c_operation")) $("#c_operation").value = op;

    // SNO
    const sno = (receipt.company && receipt.company.sno) || (firmData && firmData.tax_variant) || "osn";
    if ($("#c_sno") && [...$("#c_sno").options].some((o) => o.value === sno)) {
      $("#c_sno").value = sno;
    }

    // Store
    if (summary.store_id) setSelectedStoreId(summary.store_id, true);

    // Client
    const client = receipt.client || {};
    if ($("#c_email")) $("#c_email").value = client.email || "";
    if ($("#c_phone")) $("#c_phone").value = client.phone || "";
    if (client.name && $("#c_name")) {
      $("#c_extraBuyer") && $("#c_extraBuyer").classList.remove("hidden");
      $("#c_name").value = client.name;
    }
    if (client.inn && $("#c_inn")) {
      $("#c_extraBuyer") && $("#c_extraBuyer").classList.remove("hidden");
      $("#c_inn").value = client.inn;
    }

    // Items
    const items = receipt.items || [];
    const tb = $("#c_items");
    if (tb) {
      tb.innerHTML = "";
      if (!items.length) {
        tb.insertAdjacentHTML("beforeend", itemRowHtml());
      } else {
        items.forEach((it) => {
          tb.insertAdjacentHTML("beforeend", itemRowHtml());
          const row = tb.querySelector(".item-row:last-child");
          if (!row) return;
          const name = it.name || it.text || "Товар";
          const price = it.price != null ? it.price : 0;
          const qty = it.quantity != null ? it.quantity : 1;
          row.querySelector(".it-name").value = name;
          row.querySelector(".it-price").value = money(price);
          row.querySelector(".it-qty").value = qty;
          const measEl = row.querySelector(".it-measure");
          if (measEl && it.measure != null) {
            const mv = String(it.measure);
            if ([...measEl.options].some((o) => o.value === mv)) measEl.value = mv;
          }
          const vat = mapAtolVat(it.vat || it.vat_type);
          const vatEl = row.querySelector(".it-vat");
          if (vatEl && [...vatEl.options].some((o) => o.value === vat)) vatEl.value = vat;
          const method = mapAtolMethod(it.payment_method);
          row.querySelector(".it-method").value = method;
          // Сначала ограничиваем допустимые предметы, затем ставим значение
          syncObjectOptionsForRow(row);
          let obj = parseInt(it.payment_object, 10);
          if (isNaN(obj)) obj = 1;
          const objEl = row.querySelector(".it-object");
          if (objEl && [...objEl.options].some((o) => parseInt(o.value, 10) === obj)) {
            objEl.value = String(obj);
          }
          // Агентская позиция
          const agentCb = row.querySelector(".it-agent");
          if (agentCb && (it.agent_info || it.supplier_info || it.is_agent)) {
            agentCb.checked = true;
          }
        });
      }
      bindItemTable("c_items", updateCreateSummary);
      syncAllItemConstraints("c_items");
      syncAgentBoxFromItems();
    }

    // Агентские реквизиты — берём из первой позиции с agent_info / supplier_info
    const agentSrc = (receipt.items || []).find((it) => it.agent_info || it.supplier_info);
    if (agentSrc) {
      const ai = agentSrc.agent_info || {};
      const si = agentSrc.supplier_info || {};
      if ($("#c_agent_type") && ai.type) {
        const tEl = $("#c_agent_type");
        if ([...tEl.options].some((o) => o.value === ai.type)) tEl.value = ai.type;
      }
      if ($("#c_sup_name") && si.name) $("#c_sup_name").value = si.name;
      if ($("#c_sup_inn") && si.inn) $("#c_sup_inn").value = String(si.inn);
      if ($("#c_sup_phones") && si.phones) {
        $("#c_sup_phones").value = Array.isArray(si.phones) ? si.phones.join(", ") : String(si.phones);
      }
      const pa = ai.paying_agent || {};
      if ($("#c_pa_op") && pa.operation) $("#c_pa_op").value = pa.operation;
      if ($("#c_pa_phones") && pa.phones) {
        $("#c_pa_phones").value = Array.isArray(pa.phones) ? pa.phones.join(", ") : String(pa.phones);
      }
      const recv = ai.receive_payments_operator || {};
      if ($("#c_recv_phones") && recv.phones) {
        $("#c_recv_phones").value = Array.isArray(recv.phones) ? recv.phones.join(", ") : String(recv.phones);
      }
      const mt = ai.money_transfer_operator || {};
      if ($("#c_mt_name") && mt.name) $("#c_mt_name").value = mt.name;
      if ($("#c_mt_addr") && mt.address) $("#c_mt_addr").value = mt.address;
      if ($("#c_mt_inn") && mt.inn) $("#c_mt_inn").value = String(mt.inn);
      if ($("#c_mt_phones") && mt.phones) {
        $("#c_mt_phones").value = Array.isArray(mt.phones) ? mt.phones.join(", ") : String(mt.phones);
      }
      if (typeof syncAgentTypeFields === "function") syncAgentTypeFields();
    }

    // Доп. реквизит пользователя (1084)
    const aup = receipt.additional_user_props;
    if (aup && aup.name && aup.value) {
      if ($("#c_addProp")) $("#c_addProp").checked = true;
      if ($("#c_addPropBox")) $("#c_addPropBox").classList.remove("hidden");
      if ($("#c_addPropName")) $("#c_addPropName").value = aup.name;
      if ($("#c_addPropVal")) $("#c_addPropVal").value = aup.value;
    }

    // Payments
    const pays = receipt.payments || [];
    const payBox = $("#c_payments");
    if (payBox) {
      payBox.innerHTML = "";
      if (!pays.length) {
        payBox.insertAdjacentHTML("beforeend", payRowHtml(true));
      } else {
        pays.forEach((p) => {
          payBox.insertAdjacentHTML("beforeend", payRowHtml(true));
          const row = payBox.querySelector(".pay-row:last-child");
          if (!row) return;
          let t = parseInt(p.type, 10);
          // map legacy UI values if any
          if (t === 14) t = 2;
          if (t === 15) t = 3;
          if (t === 16) t = 4;
          if (![0, 1, 2, 3, 4].includes(t)) t = 1;
          row.querySelector(".pay-type").value = String(t);
          row.querySelector(".pay-sum").value = money(p.sum != null ? p.sum : 0);
        });
      }
      bindPays();
    }

    setCloneBanner();
    updateCreateSummary();
    // switch to create tab (URL /create)
    if (typeof showTab === "function") showTab("create", true);
    showAlert(
      "Форма заполнена из чека № " + sourceDocumentId + ". Исходный документ не изменится — будет создан новый.",
      "success"
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function editOrderAsNew(orderId) {
    try {
      const data = await api("/orders/" + encodeURIComponent(orderId));
      if (!data.atol5 && !data.raw_summary) {
        showAlert("Не удалось загрузить состав чека для редактирования");
        return;
      }
      fillCreateFormFromOrder(data);
    } catch (e) {
      const f = friendlyApiError(e.message);
      showAlert(f.main + (f.detail ? " — " + f.detail : ""));
    }
  }

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
      <td><input class="it-price" type="number" step="0.01" min="0.01" inputmode="decimal" value="1.00" /></td>
      <td><input class="it-qty" type="number" step="0.001" min="0.01" inputmode="decimal" value="1" /></td>
      <td><select class="it-measure">${MEASURE_OPTS}</select></td>
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
        <input class="pay-sum" type="number" step="0.01" min="0" inputmode="decimal" value="0.00" />
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
        if (el.classList.contains("it-method")) {
          syncObjectOptionsForRow(el.closest("tr"));
        }
        onChange && onChange();
        if (el.classList.contains("it-agent")) {
          if (tbodyId === "c_items") syncAgentBoxFromItems();
          if (tbodyId === "p_items") syncPayAgentBoxFromItems();
        }
      };
      // количество: max 3 знака (тысячные); цена/сумма: max 2 (копейки)
      if (el.classList.contains("it-qty")) {
        restrictDecimalInput(el, 3);
        el.addEventListener("blur", () => {
          const n = normalizeQty(el.value);
          if (n == null) {
            markField(el, false, "Мин. 0.01, не мельче тысячной");
          } else {
            el.value = formatQty(n);
            markField(el, true);
            onChange && onChange();
          }
        });
      }
      if (el.classList.contains("it-price")) {
        restrictDecimalInput(el, 2);
        el.addEventListener("blur", () => {
          const n = normalizePrice(el.value);
          if (n == null) {
            markField(el, false, "Мин. 0.01 ₽, только копейки (2 знака)");
          } else {
            el.value = formatPrice(n);
            markField(el, true);
            onChange && onChange();
          }
        });
      }
    });
    // initial constraint sync
    tb.querySelectorAll(".item-row").forEach(syncObjectOptionsForRow);
  }

  function syncAgentBoxFromItems() {
    const on = anyItemAgent("c_items");
    if ($("#c_agentBox")) $("#c_agentBox").classList.toggle("hidden", !on);
    if (on) syncAgentTypeFields();
    updateCreateSummary();
  }

  function syncPayAgentBoxFromItems() {
    const on = anyItemAgent("p_items");
    if ($("#p_agentBox")) $("#p_agentBox").classList.toggle("hidden", !on);
    if (on) syncPayAgentTypeFields();
    updatePaySummary();
  }

  function syncPayAgentTypeFields() {
    const type = ($("#p_agent_type") && $("#p_agent_type").value) || "another";
    const paying = ["paying_agent", "paying_subagent", "bank_paying_agent", "bank_paying_subagent"].includes(type);
    const transfer = ["bank_paying_agent", "bank_paying_subagent"].includes(type);
    if ($("#p_agentPaying")) $("#p_agentPaying").classList.toggle("hidden", !paying);
    if ($("#p_agentTransfer")) $("#p_agentTransfer").classList.toggle("hidden", !transfer);
  }

  function collectItems(tbodyId) {
    return $$(`#${tbodyId} .item-row`).map((row) => {
      const priceRaw = normalizePrice(row.querySelector(".it-price").value);
      const price = priceRaw != null ? priceRaw : 0;
      const quantity = normalizeQty(row.querySelector(".it-qty").value) || 1;
      const agentCb = row.querySelector(".it-agent");
      // цена × кол-во: любая дробь копейки → округление ВВЕРХ до 1 коп.
      const sum = ceilMoney(price * quantity);
      return {
        name: (row.querySelector(".it-name").value || "").trim() || "Товар",
        price,
        quantity,
        sum,
        vat_type: row.querySelector(".it-vat").value,
        measure: parseInt((row.querySelector(".it-measure") || {}).value, 10) || 0,
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
    const op = ($("#c_operation") && $("#c_operation").value) || "sell";
    const sno = ($("#c_sno") && $("#c_sno").value) || "osn";
    {
      const st = storesList().find((s) => String(s.store_id) === String(getSelectedStoreId()));
      if ($("#sum_shop"))
        $("#sum_shop").textContent = st
          ? `${st.store_name} (ID ${st.store_id})`
          : `ID ${getSelectedStoreId() || "—"}`;
    }
    if ($("#sum_op")) $("#sum_op").textContent = OP_LABELS[op] || op;
    if ($("#sum_sno")) $("#sum_sno").textContent = SNO_LABELS[sno] || sno;
    if ($("#sum_email")) $("#sum_email").textContent = emailVal || phoneRaw || "—";
    if ($("#sum_items")) $("#sum_items").textContent = String($$("#c_items .item-row").length);
    if ($("#sum_pay")) $("#sum_pay").textContent = money(total) + " ₽";
    if ($("#sum_total")) $("#sum_total").textContent = money(total) + " ₽";
    if ($("#c_payHint")) $("#c_payHint").textContent = "Автоподсчёт суммы товарных позиций: " + money(total);
    if ($("#c_total")) $("#c_total").value = money(total);

    const pays = $$("#c_payments .pay-row");
    if (pays.length === 1) {
      pays[0].querySelector(".pay-sum").value = money(total);
    }

    const payTotal = paymentsSum("#c_payments");
    const warn = $("#sum_warn");
    const issues = [];

    const hasContact = !!(emailVal || phoneRaw);
    // Показывать ошибку контакта только после попытки создания (createAttempted)
    if (!hasContact) {
      if (createAttempted) {
        issues.push("Укажите email или телефон покупателя");
        markField($("#c_email"), false, "Нужен email или телефон");
        markField($("#c_phone"), false, "Нужен email или телефон");
      } else {
        markField($("#c_email"), true);
        markField($("#c_phone"), true);
      }
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

    // FFD combination rules (method × object, sums)
    try {
      const combo = validateCreateCombinations();
      issues.push(...combo);
    } catch (e) {
      console.warn("validateCreateCombinations", e);
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
    if ($("#p_sum_items")) $("#p_sum_items").textContent = String($$("#p_items .item-row").length);
    $("#p_sum_total").textContent = money(total) + " ₽";
    const provEl = $("#p_sum_provider");
    if (provEl) {
      const lbl = typeof selectedProviderLabel === "function" ? selectedProviderLabel() : "";
      provEl.textContent = lbl || "—";
    }
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
    try { document.documentElement.classList.add("eklk-authed"); } catch (e) { /* ignore */ }
    if ($("#loginScreen")) $("#loginScreen").classList.add("hidden");
    if ($("#appScreen")) $("#appScreen").classList.remove("hidden");
    if ($("#appFooter")) $("#appFooter").classList.remove("hidden");
    try {
      // Сначала prefs из БД (тема, магазин firm, last_pay_type)
      const hint =
        (loginPayload && loginPayload.selected_store_id) ||
        localStorage.getItem("eklk_group") ||
        null;
      const srv = await loadServerSettings(hint);

      if (loginPayload && loginPayload.firm) {
        const preferred =
          srv.preferredStore ||
          localStorage.getItem("eklk_group") ||
          loginPayload.selected_store_id;
        ingestFirm(loginPayload.firm, preferred);
      } else {
        const me = await api("/auth/me");
        if ($("#userName")) $("#userName").textContent = me.username || me.email || "";
        const preferred =
          srv.preferredStore ||
          localStorage.getItem("eklk_group") ||
          me.selected_store_id;
        ingestFirm(me.firm, preferred);
      }
      const me2 = await api("/auth/me").catch(() => null);
      if (me2 && $("#userName")) $("#userName").textContent = me2.username || me2.email || "";
      if (me2) {
        try { sessionStorage.setItem("eklk_me", JSON.stringify(me2)); } catch (e) { /* ignore */ }
      }
      await loadPaymentTypes();
      ensureItem("c_items", updateCreateSummary);
      ensureItem("p_items", updatePaySummary);
      if ($("#c_payments") && !$("#c_payments .pay-row")) {
        $("#c_payments").insertAdjacentHTML("beforeend", payRowHtml(true));
        bindPays();
      }
      ["c_store", "p_store"].forEach((sid) => {
        const el = document.getElementById(sid);
        if (!el) return;
        el.onchange = () => {
          setSelectedStoreId(el.value, true);
          updateCreateSummary();
        };
      });
      updateCreateSummary();
      updatePaySummary();
      // После явного логина — всегда дашборд; при F5 — раздел из URL (/ → home)
      if (typeof showTab === "function") {
        let tab;
        if (loginPayload) {
          tab = "home";
          history.replaceState({ tab: "home" }, "", "/home");
        } else {
          tab = pathToTab(location.pathname);
          if (location.pathname === "/" || location.pathname === "" || location.pathname === "/home") {
            tab = "home";
            history.replaceState({ tab: "home" }, "", "/home");
          }
        }
        showTab(tab, false);
      }
    } catch (e) {
      console.error("afterLogin", e);
      showAlert(e.message || String(e));
      throw e;
    }
  }

  async function loadPaymentTypes() {
    const sel = $("#p_type");
    const lastType = localStorage.getItem("eklk_last_pay_type") || "";
    try {
      const data = await api("/ecom/payment-types");
      paymentTypes = data.items || [];
      const providers = paymentTypes.filter((t) => t.id >= 100);
      if (sel) {
        sel.innerHTML = providers.length
          ? providers.map((t) => `<option value="${t.id}">${t.id} — ${t.description}</option>`).join("")
          : `<option value="103">103 — Сбербанк</option>`;
        if (lastType && [...sel.options].some((o) => o.value === lastType)) {
          sel.value = lastType;
        }
        sel.onchange = () => {
          if (sel.value) persistLastPayType(sel.value);
          updatePaySummary();
        };
      }
    } catch (e) {
      if (sel) {
        sel.innerHTML = `<option value="103">103 — Сбербанк</option>`;
        if (lastType === "103") sel.value = "103";
      }
    }
  }

  function selectedProviderLabel() {
    const sel = $("#p_type");
    if (!sel || !sel.value) return "";
    const opt = sel.options[sel.selectedIndex];
    return opt ? opt.textContent : sel.value;
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
      if (el.classList.contains("pay-sum")) {
        restrictDecimalInput(el, 2);
        el.addEventListener("blur", () => {
          const n = normalizePrice(el.value);
          if (n != null) el.value = formatPrice(n);
          else if (el.value !== "" && el.value !== "0") {
            const c = ceilMoney(parseFloat(String(el.value).replace(",", ".")) || 0);
            if (c >= 0.01) el.value = formatPrice(c);
          }
          updateCreateSummary();
        });
      }
      el.oninput = el.onchange = updateCreateSummary;
    });
  }

  function renderResult(el, data) {
    if (!el) return;
    el.classList.remove("hidden");
    const link = (data.invoice_payload && data.invoice_payload.link) || "";
    const provider = (data.invoice_payload && data.invoice_payload.provider) || "";
    // Компактный служебный блок (не UI ссылки)
    let html = `<div class="result-box">
      <span class="badge badge-invoice">${escHtml(data.kind || "—")}</span>
      <div style="margin-top:8px"><b>uuid:</b> ${escHtml(data.uuid || "—")}</div>
      <div><b>status:</b> ${escHtml(data.status || "—")}</div>
      <div><b>external_id:</b> ${escHtml(data.external_id || "—")}</div>`;
    if (data.error) {
      const errT = typeof data.error === "object" ? JSON.stringify(data.error) : String(data.error);
      html += `<div class="mt-2" style="color:#fca5a5"><b>error:</b> ${escHtml(errT)}</div>`;
    }
    if (provider) html += `<p class="hint" style="margin-top:8px">Провайдер: ${escHtml(provider)}</p>`;
    if (data.permalink) {
      html += `<p class="mt-2"><a href="${escHtml(data.permalink)}" target="_blank" rel="noopener">Ссылка на предчек</a></p>`;
    }
    if (data.payload) {
      html += `<p class="hint mt-2">ФД: ${escHtml(data.payload.fiscal_document_number ?? "—")} · ФП: ${escHtml(data.payload.fiscal_document_attribute ?? "—")} · сумма: ${escHtml(data.payload.total ?? "—")}</p>`;
    }
    html += `</div>`;
    el.innerHTML = html;
    if (link) openPayLinkModal(link, data);
  }

  function openPayLinkModal(link, data) {
    const modal = $("#payLinkModal");
    if (!modal) return;
    const input = $("#pay_link_input");
    if (input) input.value = link;
    const meta = $("#pay_modal_meta");
    if (meta) {
      const parts = [];
      const provUi = selectedProviderLabel();
      if (provUi) parts.push("платёжка: " + provUi);
      if (data && data.invoice_payload && data.invoice_payload.provider) {
        parts.push("провайдер: " + data.invoice_payload.provider);
      }
      if (data && data.uuid) parts.push("uuid: " + data.uuid);
      meta.textContent = parts.join(" · ");
    }
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    bindPayLinkActions(link);
  }

  function closePayLinkModal() {
    const modal = $("#payLinkModal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }

  function bindPayLinkActions(link) {
    const copyBtn = $("#pay_link_copy");
    const input = $("#pay_link_input");
    if (copyBtn && input) {
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(link);
          copyBtn.textContent = "Скопировано";
          setTimeout(() => { copyBtn.textContent = "Копировать"; }, 1500);
        } catch (e) {
          input.select();
          document.execCommand("copy");
          copyBtn.textContent = "Скопировано";
          setTimeout(() => { copyBtn.textContent = "Копировать"; }, 1500);
        }
      };
      input.onclick = () => { input.select(); };
    }
    const goBtn = $("#pay_go_link");
    if (goBtn) {
      goBtn.onclick = () => {
        if (link) window.open(link, "_blank", "noopener");
      };
    }
    const repeatBtn = $("#pay_repeat");
    if (repeatBtn) {
      repeatBtn.onclick = () => {
        closePayLinkModal();
        const createBtn = $("#p_create");
        if (createBtn) createBtn.click();
      };
    }
    const maxBtn = $("#pay_share_max");
    if (maxBtn) {
      maxBtn.onclick = async () => {
        const text = "Ссылка на оплату: " + link;
        if (navigator.share) {
          try {
            await navigator.share({ title: "Ссылка на оплату", text, url: link });
            return;
          } catch (e) { /* cancel */ }
        }
        try {
          await navigator.clipboard.writeText(link);
          showAlert("Ссылка скопирована — вставьте в чат Макс", "success");
        } catch (e) {
          showAlert("Скопируйте ссылку вручную");
        }
        window.open("https://web.max.ru/", "_blank", "noopener");
      };
    }
    const vkBtn = $("#pay_share_vk");
    if (vkBtn) {
      vkBtn.onclick = () => {
        const u = "https://vk.com/share.php?url=" + encodeURIComponent(link) +
          "&title=" + encodeURIComponent("Ссылка на оплату");
        window.open(u, "_blank", "noopener,width=600,height=500");
      };
    }
    const canvas = $("#pay_qr_canvas");
    if (canvas && typeof QRCode !== "undefined") {
      // clear previous
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      QRCode.toCanvas(canvas, link, {
        width: 180,
        margin: 2,
        color: { dark: "#0f172a", light: "#ffffff" },
      }, (err) => {
        if (err) console.warn("QR error", err);
      });
    } else if (canvas) {
      let img = $("#pay_qr_img");
      if (!img) {
        img = document.createElement("img");
        img.id = "pay_qr_img";
        img.alt = "QR";
        img.width = 180;
        img.height = 180;
        canvas.replaceWith(img);
      }
      img.src = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encodeURIComponent(link);
    }
    const dl = $("#pay_qr_download");
    if (dl) {
      dl.onclick = () => {
        const c = $("#pay_qr_canvas");
        const im = $("#pay_qr_img");
        let href = "";
        if (c && c.toDataURL) href = c.toDataURL("image/png");
        else if (im) href = im.src;
        if (!href) return;
        const a = document.createElement("a");
        a.href = href;
        a.download = "payment-qr.png";
        a.click();
      };
    }
    const qrShare = $("#pay_qr_share");
    if (qrShare) {
      qrShare.onclick = async () => {
        const c = $("#pay_qr_canvas");
        try {
          if (c && navigator.share && c.toBlob) {
            c.toBlob(async (blob) => {
              if (!blob) return;
              const file = new File([blob], "payment-qr.png", { type: "image/png" });
              try {
                await navigator.share({ title: "QR оплаты", text: link, files: [file] });
              } catch (e) {
                try {
                  await navigator.share({ title: "QR оплаты", text: link, url: link });
                } catch (e2) {
                  showAlert("Скопируйте ссылку или скачайте QR");
                }
              }
            });
          } else if (navigator.share) {
            await navigator.share({ title: "Ссылка на оплату", text: link, url: link });
          } else {
            await navigator.clipboard.writeText(link);
            showAlert("Ссылка скопирована", "success");
          }
        } catch (e) {
          showAlert("Не удалось поделиться");
        }
      };
    }
    // close handlers
    $$("[data-close-pay-modal]").forEach((el) => {
      el.onclick = () => closePayLinkModal();
    });
    document.addEventListener("keydown", function onEsc(e) {
      if (e.key === "Escape") {
        closePayLinkModal();
        document.removeEventListener("keydown", onEsc);
      }
    });
  }

  // Events
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const errEl = $("#loginError");
    if (errEl) errEl.classList.add("hidden");
    try {
      const userEl = $("#loginUser");
      const passEl = $("#loginPass");
      if (!userEl || !passEl) {
        throw new Error("Форма входа не загружена. Обновите страницу (Ctrl+F5).");
      }
      // Логин EcomKassa: регистр букв сохраняем (не email-normalize)
      const loginRaw = (userEl.value || "").trim();
      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: loginRaw,
          password: passEl.value || "",
        }),
      });
      token = data.access_token;
      localStorage.setItem("eklk_token", token);
      await afterLogin(data);
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || String(err);
        errEl.classList.remove("hidden");
      } else {
        alert(err.message || String(err));
      }
    }
  };

  $("#logoutBtn").onclick = () => logout(true);


  // --- Модалка результата создания чека ---
  let lastCheckModalCtx = null; // { uuid, externalId, orderId }

  function closeCheckResultModal() {
    const modal = $("#checkResultModal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }

  function openCheckResultModal(createData) {
    const modal = $("#checkResultModal");
    if (!modal) return;
    lastCheckModalCtx = {
      uuid: (createData && createData.uuid) || null,
      externalId: (createData && createData.external_id) || null,
      orderId: null,
    };
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    $$("[data-close-check-modal]").forEach((el) => {
      el.onclick = () => closeCheckResultModal();
    });
    const refreshBtn = $("#check_modal_refresh");
    if (refreshBtn) {
      refreshBtn.onclick = () => loadCheckResultModal();
    }
    // ESC closes (share with pay modal pattern)
    const onEsc = (e) => {
      if (e.key === "Escape") {
        closeCheckResultModal();
        document.removeEventListener("keydown", onEsc);
      }
    };
    document.addEventListener("keydown", onEsc);
    loadCheckResultModal();
  }

  function buildReportFallbackHtml(report) {
    if (!report) {
      return `<p class="hint">Чек принят кассой. Нажмите «Обновить», чтобы загрузить состав.</p>`;
    }
    const payload = report.payload || {};
    let html = `<div class="receipt-view">`;
    html += `<div class="r-head">
      <div class="r-title">Кассовый чек</div>
      <div class="r-meta">${statusBadge(report.status || "")} · ${escHtml(kindLabel(report.kind) || report.kind || "—")}</div>
      ${report.external_id ? `<div class="r-meta">Внешний ID: ${escHtml(report.external_id)}</div>` : ""}
      ${report.uuid ? `<div class="r-meta">UUID: ${escHtml(report.uuid)}</div>` : ""}
      ${report.timestamp ? `<div class="r-meta">${escHtml(report.timestamp)}</div>` : ""}
    </div>`;
    if (report.status) {
      html += `<div class="r-section-title">Статус</div>`;
      html += `<div class="r-line"><span>Статус ФН</span><span>${escHtml(fiscalStatusLabel(report.status))}</span></div>`;
    }
    if (payload.fiscal_document_number != null || payload.fn_number || payload.total != null) {
      html += `<div class="r-section-title">Фискальные данные</div>`;
      if (payload.total != null) html += `<div class="r-line"><span>Сумма (ФД)</span><span>${formatMoney(payload.total)}</span></div>`;
      if (payload.fn_number) html += `<div class="r-line"><span>Номер ФН</span><span>${escHtml(payload.fn_number)}</span></div>`;
      if (payload.fiscal_document_number != null) html += `<div class="r-line"><span>Номер ФД</span><span>${escHtml(payload.fiscal_document_number)}</span></div>`;
      if (payload.fiscal_document_attribute != null) html += `<div class="r-line"><span>ФПД (ФП)</span><span>${escHtml(payload.fiscal_document_attribute)}</span></div>`;
      if (payload.receipt_datetime) html += `<div class="r-line"><span>Дата/время чека</span><span>${escHtml(payload.receipt_datetime)}</span></div>`;
    }
    if (report.error) {
      const errT = typeof report.error === "object"
        ? (report.error.text || report.error.message || JSON.stringify(report.error))
        : String(report.error);
      html += `<div class="r-line r-error"><span>Ошибка</span><span>${escHtml(errT)}</span></div>`;
    }
    const links = [];
    if (payload.ofd_receipt_url) links.push({ label: "Ссылка на чек ОФД", href: payload.ofd_receipt_url });
    if (report.permalink) links.push({ label: "Ссылка на предчек", href: report.permalink });
    if (links.length) {
      html += `<div class="r-section-title">Дополнительно</div>`;
      links.forEach((L) => {
        html += `<div class="r-link-row"><a href="${escHtml(L.href)}" target="_blank" rel="noopener">${escHtml(L.label)} →</a></div>`;
      });
    }
    html += `<p class="hint mt-2">Полный состав появится после обработки на кассе — нажмите «Обновить».</p>`;
    html += `<details class="r-json"><summary class="hint">Служебный JSON (report)</summary>
      <div class="result-box">${escHtml(JSON.stringify(report || {}, null, 2))}</div>
    </details>`;
    html += `</div>`;
    return html;
  }

  async function loadCheckResultModal() {
    const body = $("#check_modal_body");
    if (!body) return;
    const ctx = lastCheckModalCtx || {};
    body.innerHTML = `<p class="hint">Загрузка чека…</p>`;
    const refreshBtn = $("#check_modal_refresh");
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Обновление…";
    }
    try {
      // 1) report by uuid (метод report)
      let report = null;
      if (ctx.uuid) {
        try {
          report = await api("/ecom/checks/" + encodeURIComponent(ctx.uuid));
        } catch (e) {
          console.warn("check report failed", e);
        }
      }

      // 2) найти order_id: numeric uuid или поиск по external_id
      let orderId = ctx.orderId || null;
      if (!orderId && ctx.uuid && /^\d+$/.test(String(ctx.uuid))) {
        orderId = ctx.uuid;
      }
      if (!orderId && ctx.externalId) {
        try {
          const search = await api("/orders/search", {
            method: "POST",
            body: JSON.stringify({ external_id: ctx.externalId, limit: 10, offset: 0 }),
          });
          const rows = search.result || [];
          const match =
            rows.find((r) => String(r.external_id || "") === String(ctx.externalId)) ||
            rows[0];
          if (match && match.order_id != null) orderId = match.order_id;
        } catch (e) {
          console.warn("orders search after create failed", e);
        }
      }

      if (orderId) {
        lastCheckModalCtx.orderId = orderId;
        try {
          const detail = await api("/orders/" + encodeURIComponent(orderId));
          const fiscal = detail.fiscal || report;
          // Тот же markup, что справа в «Списке чеков»
          body.innerHTML =
            `<div class="receipt-view">` +
            buildReceiptHtml(detail.atol5, detail.summary || {
              order_id: orderId,
              external_id: ctx.externalId,
              status: (report && report.status) || (detail.summary && detail.summary.status),
              total: detail.summary && detail.summary.total,
            }, fiscal, { hideEdit: true }) +
            `</div>`;
          return;
        } catch (e) {
          console.warn("order detail after create failed", e);
        }
      }

      // 3) fallback: report в том же receipt-view
      body.innerHTML = buildReportFallbackHtml(report || {
        uuid: ctx.uuid,
        external_id: ctx.externalId,
        status: "wait",
      });
    } catch (e) {
      body.innerHTML = `<p class="hint" style="color:#fca5a5">${escHtml(e.message || String(e))}</p>`;
    } finally {
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.textContent = "Обновить";
      }
    }
  }

  // --- Клиентский роутинг (папки в URL) ---
  // Разделы: /create | /payment | /orders | /settings
  // В дальнейшем: URL-параметры (например /orders?external_id=…, /create?from=123).
  // Вкладка «Статус» (/status) удалена — статус чека в списке/деталки.

  // ── ИИ-кассир (iikassa.ru partner-embed, api-docs) ─────────────────
  let aiCashierLoading = null;

  function setAiCashierDebug(obj) {
    const el = $("#ai_cashier_debug");
    if (!el) return;
    try {
      el.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
    } catch (e) {
      el.textContent = String(obj);
    }
  }

  function openAiCashierEmbedUrl(embedUrl) {
    // Свой overlay (как у widget.js), без зависимости от AiCashier.open
    let overlay = document.querySelector("[data-ai-cashier-overlay]");
    if (overlay) overlay.remove();
    overlay = document.createElement("div");
    overlay.setAttribute("data-ai-cashier-overlay", "");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;background:rgba(15,15,20,0.55);" +
      "display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box";
    const panel = document.createElement("div");
    panel.style.cssText =
      "position:relative;width:100%;max-width:440px;height:680px;max-height:92vh;" +
      "background:#0f0f14;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.4)";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Закрыть");
    closeBtn.innerHTML = "&times;";
    closeBtn.style.cssText =
      "position:absolute;top:8px;right:8px;z-index:2;width:32px;height:32px;border-radius:8px;" +
      "border:0;background:rgba(255,255,255,0.08);color:#fff;font-size:20px;line-height:1;cursor:pointer";
    closeBtn.onclick = () => overlay.remove();
    const iframe = document.createElement("iframe");
    iframe.title = "ИИ-кассир";
    iframe.style.cssText = "width:100%;height:100%;border:0;display:block";
    iframe.src = embedUrl;
    panel.appendChild(closeBtn);
    panel.appendChild(iframe);
    overlay.appendChild(panel);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  async function ensureAiCashier() {
    const status = $("#ai_cashier_status");
    const btn = $("#ai_cashier_open");
    if (status) status.textContent = "Запрос embed у iikassa (через наш backend)…";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Открытие…";
    }
    if (aiCashierLoading) return aiCashierLoading;

    aiCashierLoading = (async () => {
      try {
        // debug=1 — полный request/response в ответе (временно)
        const data = await api("/ai-cashier/embed?debug=1", { method: "POST" });
        setAiCashierDebug(data);
        if (!data || !data.ok || !data.embed_url) {
          const err =
            (data && data.error) ||
            "Не удалось получить embed_path (см. отладку ниже)";
          throw new Error(typeof err === "string" ? err : JSON.stringify(err));
        }
        openAiCashierEmbedUrl(data.embed_url);
        if (status) {
          status.textContent =
            "Чат открыт (mode=" +
            (data.mode || "?") +
            "). Если пусто — смотрите блок отладки.";
        }
      } catch (e) {
        const msg = (e && e.message) || String(e);
        console.error("ensureAiCashier", e);
        if (status) status.textContent = "Ошибка: " + msg;
        if (typeof showAlert === "function") showAlert(msg);
        // если api() кинул до JSON — debug может быть пустым
        throw e;
      } finally {
        aiCashierLoading = null;
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Открыть чат";
        }
      }
    })();
    return aiCashierLoading;
  }

  function bindAiCashierUI() {
    const btn = $("#ai_cashier_open");
    if (!btn) return;
    btn.onclick = (ev) => {
      if (ev) ev.preventDefault();
      ensureAiCashier().catch(() => {});
    };
  }
  bindAiCashierUI();

  const APP_TABS = ["home", "create", "payment", "templates", "orders", "catalog", "reports", "ai-cashier", "settings"]; // CORE: home/catalog/reports — sections/*.js

  function pathToTab(pathname) {
    const p = String(pathname || "/").replace(/\/+$/, "") || "/";
    if (p === "/" || p === "/home") return "home";
    const seg = p.split("/").filter(Boolean)[0];
    return APP_TABS.includes(seg) ? seg : "home";
  }

  function tabToPath(tab) {
    return "/" + (APP_TABS.includes(tab) ? tab : "home");
  }

  /** Показать раздел ЛК. push=true → history.pushState */
  function showTab(tab, push) {
    if (!APP_TABS.includes(tab)) tab = "home";
    $$(".nav button[data-tab]").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    $$(".tab-panel").forEach((p) => p.classList.add("hidden"));
    const panel = $("#tab-" + tab);
    if (panel) panel.classList.remove("hidden");
    if (tab === "orders") {
      // Не запоминаем последний выбранный чек при входе в список
      clearOrderSelection();
      if (typeof loadOrders === "function") {
        try { loadOrders(); } catch (e) { console.warn(e); }
      }
    }
    if (tab === "templates" && typeof loadTemplates === "function") {
      try { loadTemplates(); } catch (e) { console.warn(e); }
    }
    // CORE: hooks for section modules (do not expand core logic here)
    if (tab === "catalog" && window.EKLK_CATALOG && typeof window.EKLK_CATALOG.onShow === "function") {
      try { window.EKLK_CATALOG.onShow(); } catch (e) { console.warn(e); }
    }
    if (tab === "reports" && window.EKLK_REPORTS && typeof window.EKLK_REPORTS.onShow === "function") {
      try { window.EKLK_REPORTS.onShow(); } catch (e) { console.warn(e); }
    }
    if (tab === "home" && window.EKLK_HOME && typeof window.EKLK_HOME.onShow === "function") {
      try { window.EKLK_HOME.onShow(); } catch (e) { console.warn(e); }
    }
    if (tab === "ai-cashier") {
      bindAiCashierUI();
      ensureAiCashier().catch((e) => console.warn("ai-cashier", e));
    }
    if (push) {
      const path = tabToPath(tab);
      if (location.pathname !== path) {
        history.pushState({ tab }, "", path);
      }
    }
  }

  // Клик по логотипу → дашборд
  const logoEl = document.querySelector(".header .logo");
  if (logoEl) {
    logoEl.addEventListener("click", () => showTab("home", true));
    logoEl.setAttribute("role", "link");
    logoEl.setAttribute("title", "На главную");
    logoEl.style.cursor = "pointer";
  }

  $$(".nav button[data-tab]").forEach((btn) => {
    btn.onclick = () => {
      const tab = btn.dataset.tab;
      if (!APP_TABS.includes(tab)) return;
      showTab(tab, true);
    };
  });

  window.addEventListener("popstate", (ev) => {
    const tab = (ev.state && ev.state.tab) || pathToTab(location.pathname);
    showTab(tab, false);
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

  if ($("#p_toggleExtra")) {
    $("#p_toggleExtra").onclick = () => {
      const box = $("#p_extraBuyer");
      if (!box) return;
      box.classList.toggle("hidden");
      $("#p_toggleExtra").textContent = box.classList.contains("hidden") ? "Ещё данные ▾" : "Скрыть ▴";
    };
  }
  if ($("#p_addProp")) {
    $("#p_addProp").onchange = () => {
      if ($("#p_addPropBox")) $("#p_addPropBox").classList.toggle("hidden", !$("#p_addProp").checked);
    };
  }
  if ($("#p_agent_type")) {
    $("#p_agent_type").addEventListener("change", () => {
      syncPayAgentTypeFields();
      updatePaySummary();
    });
  }

  ["p_email", "p_phone", "p_name", "p_inn"].forEach((id) => {
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

  function isCorrectionOp(op) {
    return String(op || "").includes("correction");
  }

  function syncCorrectionFields() {
    const op = ($("#c_operation") && $("#c_operation").value) || "sell";
    const card = $("#c_correction_card");
    if (card) card.classList.toggle("hidden", !isCorrectionOp(op));
    const ctype = ($("#c_corr_type") && $("#c_corr_type").value) || "self";
    const numWrap = $("#c_corr_number_wrap");
    if (numWrap) numWrap.classList.toggle("hidden", ctype !== "instruction");
  }

  if ($("#c_operation")) {
    $("#c_operation").addEventListener("change", () => {
      syncCorrectionFields();
      updateCreateSummary();
    });
  }
  if ($("#c_corr_type")) {
    $("#c_corr_type").addEventListener("change", syncCorrectionFields);
  }
  syncCorrectionFields();

  function defaultProfileEmail() {
    // Логин EcomKassa часто email; иначе username из UI
    const u = ($("#userName") && $("#userName").textContent) || "";
    if (u && u.includes("@")) return u.trim();
    try {
      const me = JSON.parse(sessionStorage.getItem("eklk_me") || "null");
      if (me && me.email && String(me.email).includes("@")) return me.email;
      if (me && me.username && String(me.username).includes("@")) return me.username;
    } catch (e) { /* ignore */ }
    return "";
  }

  if ($("#c_email_default")) {
    $("#c_email_default").onclick = () => {
      const em = defaultProfileEmail();
      if (!em) {
        showAlert("В профиле нет email (логин не похож на почту)");
        return;
      }
      if ($("#c_email")) {
        $("#c_email").value = em;
        updateCreateSummary();
      }
    };
  }
  if ($("#p_email_default")) {
    $("#p_email_default").onclick = () => {
      const em = defaultProfileEmail();
      if (!em) {
        showAlert("В профиле нет email (логин не похож на почту)");
        return;
      }
      if ($("#p_email")) {
        $("#p_email").value = em;
        updatePaySummary();
      }
    };
  }

  $("#c_reset").onclick = () => {
    $("#c_result").classList.add("hidden");
    $("#c_email").value = "";
    createAttempted = false;
    updateCreateSummary();
  };

  $("#c_submit").onclick = async () => {
    const btn = $("#c_submit");
    if (btn.dataset.busy === "1") return; // already sending
    btn.dataset.label = sourceDocumentId ? "Создать новый документ" : "Создать чек";

    createAttempted = true; // now show contact / required-field errors
    // Final UI validation before send
    updateCreateSummary();
    const comboIssues = validateCreateCombinations();
    const emailVal = ($("#c_email") && $("#c_email").value.trim()) || "";
    const phoneRaw = ($("#c_phone") && $("#c_phone").value.trim()) || "";
    if (!emailVal && !phoneRaw) {
      comboIssues.unshift("Укажите email или телефон покупателя");
    }
    if (comboIssues.length) {
      showAlert(comboIssues.join(" "));
      return;
    }

    if (sourceDocumentId) {
      const ok = window.confirm(
        "Будет создан новый документ. Исходный чек № " +
          sourceDocumentId +
          " останется без изменений.\n\nСоздать новый документ?"
      );
      if (!ok) return;
    }

    const items = collectItems("c_items");
    const total = items.reduce((s, i) => s + i.sum, 0);
    let payments = $$("#c_payments .pay-row").map((row) => {
      const raw = row.querySelector(".pay-sum").value;
      const n = normalizePrice(raw);
      return {
        type: parseInt(row.querySelector(".pay-type").value, 10),
        sum: n != null ? n : ceilMoney(parseFloat(String(raw).replace(",", ".")) || 0),
      };
    }).filter((p) => p.sum > 0);
    if (!payments.length) {
      payments = [{ type: 1, sum: total }];
    }

    // Pre-validate before API
    const issues = [];
    if (!$("#c_email").value.trim() && !($("#c_phone") && $("#c_phone").value.trim())) {
      issues.push("Укажите email или телефон покупателя");
    }
    $$("#c_items .item-row").forEach((row, idx) => {
      const qEl = row.querySelector(".it-qty");
      if (!qEl) return;
      const n = normalizeQty(qEl.value);
      if (n == null) {
        issues.push(
          `Позиция ${idx + 1}: количество — минимум 0.01, точность не мельче тысячной`
        );
        markField(qEl, false, "Мин. 0.01");
      } else {
        qEl.value = formatQty(n);
      }
    });
    if (total <= 0) issues.push("Сумма товаров должна быть больше 0");
    const payTotal = payments.reduce((s, p) => s + p.sum, 0);
    if (Math.abs(payTotal - total) > 0.009) {
      const diff = Math.round((payTotal - total) * 100) / 100;
      if (diff < 0) {
        issues.push("Не хватает " + money(Math.abs(diff)) + " ₽");
      } else {
        issues.push("Переплата " + money(diff) + " ₽");
      }
    }
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
      // Always new external_id (never reuse source)
      const external_id = nextExternalId(sourceDocumentId ? "EKLK-FROM-" + sourceDocumentId : "EKLK");
      const opVal = ($("#c_operation") && $("#c_operation").value) || "sell";
      const body = {
        external_id,
        operation: opVal,
        source_document_id: sourceDocumentId ? String(sourceDocumentId) : undefined,
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
      if (isCorrectionOp(opVal)) {
        const ctype = ($("#c_corr_type") && $("#c_corr_type").value) || "self";
        const cdate = ($("#c_corr_date") && $("#c_corr_date").value) || "";
        if (!cdate) {
          showAlert("Укажите дату корректируемого расчёта");
          setLoading(btn, false, "Создать чек");
          return;
        }
        // Atol expects dd.mm.yyyy in some builds; ISO date is accepted by gateway as YYYY-MM-DD
        const parts = cdate.split("-");
        const baseDate =
          parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : cdate;
        body.correction_info = {
          type: ctype,
          base_date: baseDate,
        };
        if (ctype === "instruction") {
          const num = ($("#c_corr_number") && $("#c_corr_number").value.trim()) || "";
          if (!num) {
            showAlert("Укажите номер предписания");
            setLoading(btn, false, "Создать чек");
            return;
          }
          body.correction_info.base_number = num;
        }
      }

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
        // sell / buy / buy_refund / *_correction → /ecom/checks (operation в body)
        data = await api("/ecom/checks", { method: "POST", body: JSON.stringify(body) });
      }
      const payLink = (data.invoice_payload && data.invoice_payload.link) || "";
      if (payLink) {
        // Ссылка на оплату — прежнее поведение (модалка оплаты)
        renderResult($("#c_result"), data);
      } else {
        // Обычный чек — красивая модалка с report / составом
        const cRes = $("#c_result");
        if (cRes) {
          cRes.classList.add("hidden");
          cRes.innerHTML = "";
        }
        if (data.uuid) {
          openCheckResultModal(data);
        } else {
          renderResult($("#c_result"), data);
        }
      }
      const srcNote = sourceDocumentId ? " (на основе № " + sourceDocumentId + ")" : "";
      showAlert("Чек принят кассой (uuid: " + (data.uuid || "—") + ")" + srcNote, "success");
      lastExternalId = null;
      sourceDocumentId = null;
      sourceExternalId = null;
      setCloneBanner();
    } catch (e) {
      console.error("create check failed", e);
      const raw = (e && e.message) ? e.message : String(e || "Неизвестная ошибка");
      const f = friendlyApiError(raw);
      const text = (f.main || raw) + (f.detail ? " Подробнее: " + f.detail : "");
      showAlert(text || "Ошибка создания чека");
      const warn = $("#sum_warn");
      if (warn) {
        warn.className = "warn-box error";
        warn.textContent = text || "Ошибка создания чека";
      }
    } finally {
      setLoading(btn, false, sourceDocumentId ? "Создать новый документ" : "Создать чек");
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
    // qty precision
    for (let i = 0; i < items.length; i++) {
      const row = $$("#p_items .item-row")[i];
      if (!row) continue;
      const qEl = row.querySelector(".it-qty");
      const n = normalizeQty(qEl && qEl.value);
      if (n == null) {
        return showAlert("Позиция " + (i + 1) + ": количество — минимум 0.01");
      }
      qEl.value = formatQty(n);
      items[i].quantity = n;
      items[i].sum = Math.round(items[i].price * n * 100) / 100;
    }

    setLoading(btn, true, "Создать ссылку", "Создание ссылки…");
    try {
      const payTypeId = parseInt($("#p_type").value, 10);
      if ($("#p_type") && $("#p_type").value) {
        persistLastPayType($("#p_type").value);
      }
      const body = {
        external_id: nextExternalId("PAY"),
        items,
        payments: [{ type: payTypeId, sum: total }],
        client: {
          email: emailP || undefined,
          phone: phoneNorm,
          name: ($("#p_name") && $("#p_name").value.trim()) || undefined,
          inn: ($("#p_inn") && $("#p_inn").value.trim()) || undefined,
        },
        sno: $("#p_sno").value,
        success_url: ($("#p_success") && $("#p_success").value.trim()) || undefined,
        group_code: String(($("#p_store") && $("#p_store").value) || getSelectedStoreId() || ""),
      };

      if ($("#p_addProp") && $("#p_addProp").checked) {
        const n = ($("#p_addPropName") && $("#p_addPropName").value.trim()) || "";
        const v = ($("#p_addPropVal") && $("#p_addPropVal").value.trim()) || "";
        if (!n || !v) {
          showAlert("Доп. реквизит: укажите наименование и значение");
          setLoading(btn, false, "Создать ссылку");
          return;
        }
        body.additional_user_props = { name: n, value: v };
      }

      if (items.some((it) => it.is_agent)) {
        const atype = ($("#p_agent_type") && $("#p_agent_type").value) || "another";
        const supName = ($("#p_sup_name") && $("#p_sup_name").value.trim()) || "";
        const supInn = ($("#p_sup_inn") && $("#p_sup_inn").value.trim()) || "";
        const supPhones = ($("#p_sup_phones") && $("#p_sup_phones").value.trim()) || "";
        if (!supName || !supInn || !supPhones) {
          showAlert("Для агента обязательны: наименование, ИНН и телефон поставщика");
          setLoading(btn, false, "Создать ссылку");
          return;
        }
        const innCheck = validateInnValue(supInn);
        if (!innCheck.ok) {
          showAlert(innCheck.msg);
          setLoading(btn, false, "Создать ссылку");
          return;
        }
        const supPhoneNorm = normalizePhoneUI(supPhones);
        if (!supPhoneNorm) {
          showAlert("Телефон поставщика: формат +79001234567");
          setLoading(btn, false, "Создать ссылку");
          return;
        }
        body.agent = {
          type: atype,
          supplier_name: supName,
          supplier_inn: innCheck.digits,
          supplier_phones: supPhoneNorm,
        };
        if (["paying_agent", "paying_subagent", "bank_paying_agent", "bank_paying_subagent"].includes(atype)) {
          body.agent.paying_operation = ($("#p_pa_op") && $("#p_pa_op").value.trim()) || undefined;
          body.agent.paying_phones = ($("#p_pa_phones") && $("#p_pa_phones").value.trim()) || undefined;
          body.agent.receive_phones = ($("#p_recv_phones") && $("#p_recv_phones").value.trim()) || undefined;
        }
        if (["bank_paying_agent", "bank_paying_subagent"].includes(atype)) {
          body.agent.transfer_name = ($("#p_mt_name") && $("#p_mt_name").value.trim()) || undefined;
          body.agent.transfer_address = ($("#p_mt_addr") && $("#p_mt_addr").value.trim()) || undefined;
          body.agent.transfer_inn = ($("#p_mt_inn") && $("#p_mt_inn").value.trim()) || undefined;
          body.agent.transfer_phones = ($("#p_mt_phones") && $("#p_mt_phones").value.trim()) || undefined;
        }
      }

      const data = await api("/ecom/checks", { method: "POST", body: JSON.stringify(body) });
      renderResult($("#p_result"), data);
      showAlert("Ссылка создана", "success");
    } catch (e) {
      showAlert(e.message);
    } finally {
      setLoading(btn, false, "Создать ссылку");
    }
  };

  // tab-status удалён — проверка UUID через список чеков / API


  // ---- Orders list ----
  let ordersOffset = 0;
  let ordersLimit = 25;
  let ordersSelectedId = null;
  let ordersSortKey = null; // id | date | type | status | total | store
  let ordersSortDir = "desc";
  let ordersRawRows = [];

  function clearOrderSelection() {
    ordersSelectedId = null;
    const el = $("#o_detail");
    const ph = $("#o_detail_placeholder");
    if (el) {
      el.classList.add("hidden");
      el.innerHTML = "";
    }
    if (ph) {
      ph.classList.remove("hidden");
      ph.textContent = "Выберите чек в списке слева";
    }
    $$(".orders-table tr.active").forEach((tr) => tr.classList.remove("active"));
  }

  function toIsoLocal(val) {
    if (!val) return undefined;
    // datetime-local -> ISO-ish UTC guess: treat as local, append Z-less; API wants ISO 8601
    // Convert: 2026-08-17T10:00 -> 2026-08-17T10:00:00Z (user enters as filter approx)
    if (val.length === 16) return val + ":00Z";
    return val;
  }

  // Статусы EcomKassa / Atol (fiscal + invoice) → русский UI
  const STATUS_LABELS = {
    // ожидание оплаты / обработки
    wait: "Ожидает",
    waiting: "Ожидает оплаты",
    pending: "Ожидает",
    created: "Создан",
    new: "Новый",
    draft: "Черновик",
    // в работе
    process: "В обработке",
    processing: "В обработке",
    in_progress: "В обработке",
    // оплата / фискализация
    paid: "Фискализация",
    payment: "Оплата",
    // успешное завершение
    done: "Завершён",
    completed: "Завершён",
    complete: "Завершён",
    success: "Успешно",
    ok: "Успешно",
    ready: "Готов",
    print: "Печать",
    printed: "Напечатан",
    // ошибки и отмены
    fail: "Ошибка",
    failed: "Ошибка",
    error: "Ошибка",
    canceled: "Отменён",
    cancelled: "Отменён",
    expired: "Истёк",
    timeout: "Истёк",
  };

  function statusBadge(st) {
    const raw = (st == null || st === "") ? "—" : String(st);
    const key = raw.toLowerCase().trim();
    const label = STATUS_LABELS[key] || raw;
    let tone = "wait";
    // зелёный — завершён / успешно
    if (["done", "completed", "complete", "ready", "printed", "success", "ok"].includes(key)) {
      tone = "done";
    }
    // синий — фискализация / оплачен
    else if (["paid", "payment"].includes(key)) {
      tone = "paid";
    }
    // красный — ошибки
    else if (["fail", "failed", "error", "canceled", "cancelled", "expired", "timeout"].includes(key)) {
      tone = "fail";
    }
    // жёлтый — ожидание / обработка
    else if (["wait", "waiting", "pending", "process", "processing", "in_progress", "created", "new", "draft"].includes(key)) {
      tone = "wait";
    }
    return `<span class="badge badge-status-${tone}" title="${raw}">${label}</span>`;
  }

  function typeLabel(t) {
    const map = {
      VCHR: "Чек",
      INVC: "Счёт на оплату",
      CORD: "Курьер",
      sell: "Приход",
      sell_refund: "Возврат прихода",
      buy: "Расход",
      buy_refund: "Возврат расхода",
      sell_correction: "Коррекция прихода",
      buy_correction: "Коррекция расхода",
      sell_refund_correction: "Коррекция возврата прихода",
      buy_refund_correction: "Коррекция возврата расхода",
    };
    return map[t] || t || "—";
  }

  /**
   * Тип в списке: orderType часто VCHR и для коррекции;
   * признак — is_correction (API: isCorrection).
   */
  function orderTypeLabel(row) {
    if (!row) return "—";
    const raw = row.raw || {};
    const op = String(
      raw.operation || raw.operationType || raw.receiptOperation || raw.atolOperation || ""
    ).toLowerCase();
    if (op.includes("correction")) {
      return typeLabel(op);
    }
    if (row.is_correction === true || raw.isCorrection === true) {
      if (row.is_sale === false || raw.isSale === false) {
        return "Чек коррекции (возврат)";
      }
      return "Чек коррекции";
    }
    return typeLabel(row.order_type);
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

  function statusFilterMatch(st, filter) {
    if (!filter) return true;
    const key = String(st || "").toLowerCase().trim();
    const groups = {
      done: ["done", "completed", "complete", "ready", "printed", "success", "ok"],
      wait: ["wait", "waiting", "pending", "process", "processing", "in_progress", "created", "new", "draft"],
      paid: ["paid", "payment"],
      fail: ["fail", "failed", "error"],
      canceled: ["canceled", "cancelled", "expired", "timeout"],
    };
    const list = groups[filter] || [filter];
    return list.includes(key);
  }

  function sortOrdersRows(rows) {
    if (!ordersSortKey) return rows;
    const dir = ordersSortDir === "asc" ? 1 : -1;
    const key = ordersSortKey;
    return [...rows].sort((a, b) => {
      let va;
      let vb;
      if (key === "id") {
        va = Number(a.order_id) || 0;
        vb = Number(b.order_id) || 0;
      } else if (key === "date") {
        va = a.updated ? new Date(a.updated).getTime() : 0;
        vb = b.updated ? new Date(b.updated).getTime() : 0;
      } else if (key === "type") {
        va = String(a.order_type || "");
        vb = String(b.order_type || "");
      } else if (key === "status") {
        va = String(a.status || "").toLowerCase();
        vb = String(b.status || "").toLowerCase();
      } else if (key === "total") {
        va = Number(a.total) || 0;
        vb = Number(b.total) || 0;
      } else if (key === "store") {
        va = String(a.store_name || a.store_id || "");
        vb = String(b.store_name || b.store_id || "");
      } else {
        return 0;
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }

  function renderOrdersTable(rows) {
    const list = $("#o_list");
    if (!list) return;
    if (!rows.length) {
      list.innerHTML = `<p class="hint">Чеков не найдено</p>`;
      return;
    }
    const sorted = sortOrdersRows(rows);
    const th = (key, label) => {
      let cls = "sortable";
      if (ordersSortKey === key) cls += ordersSortDir === "asc" ? " sort-asc" : " sort-desc";
      return `<th class="${cls}" data-sort="${key}">${label}</th>`;
    };
    list.innerHTML = `<table class="orders-table">
      <thead><tr>
        ${th("id", "ID")}${th("date", "Дата")}${th("type", "Тип")}${th("status", "Статус")}${th("total", "Сумма")}${th("store", "Магазин")}<th></th>
      </tr></thead>
      <tbody>
        ${sorted
          .map((r) => {
            const id = r.order_id;
            const active = String(id) === String(ordersSelectedId) ? "active" : "";
            return `<tr class="${active}" data-order-id="${id}">
              <td><code>${id ?? "—"}</code></td>
              <td>${formatDt(r.updated)}</td>
              <td>${escHtml(orderTypeLabel(r))}</td>
              <td>${statusBadge(r.status)}</td>
              <td>${formatMoney(r.total)}</td>
              <td>${r.store_name || r.store_id || "—"}</td>
              <td><button type="button" class="btn btn-sm btn-secondary o-edit-btn" data-order-id="${id}" title="Действия с документом">Действие</button></td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>`;
    list.querySelectorAll("th[data-sort]").forEach((thEl) => {
      thEl.onclick = (ev) => {
        ev.preventDefault();
        const k = thEl.dataset.sort;
        if (ordersSortKey === k) {
          ordersSortDir = ordersSortDir === "asc" ? "desc" : "asc";
        } else {
          ordersSortKey = k;
          ordersSortDir = k === "date" || k === "id" ? "desc" : "asc";
        }
        renderOrdersTable(ordersRawRows);
      };
    });
    list.querySelectorAll("tr[data-order-id]").forEach((tr) => {
      tr.onclick = (ev) => {
        if (ev.target && ev.target.closest && ev.target.closest(".o-edit-btn")) return;
        openOrderDetail(tr.dataset.orderId);
      };
    });
    list.querySelectorAll(".o-edit-btn").forEach((btn) => {
      btn.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        editOrderAsNew(btn.dataset.orderId);
      };
    });
  }

  async function loadOrders() {
    const list = $("#o_list");
    if (!list) return;
    list.innerHTML = `<p class="hint">Загрузка…</p>`;
    // Новый поиск / обновление — сбрасываем сортировку
    ordersSortKey = null;
    ordersSortDir = "desc";
    ordersLimit = parseInt(($("#o_limit") && $("#o_limit").value) || "25", 10);
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
      let rows = data.result || [];
      const statusFilter = ($("#o_status") && $("#o_status").value) || "";
      if (statusFilter) {
        rows = rows.filter((r) => statusFilterMatch(r.status, statusFilter));
      }
      ordersRawRows = rows;
      renderOrdersTable(rows);
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
      2: "Предварительная оплата (аванс)",
      3: "Последующая оплата (кредит)",
      4: "Иная форма оплаты (встречное предоставление)",
    };
    return map[t] != null ? map[t] : ("Тип " + t);
  }

  function snoLabel(s) {
    const map = {
      osn: "ОСН",
      usn_income: "УСН доход",
      usn_income_outcome: "УСН доход − расход",
      esn: "ЕСХН",
      patent: "ПСН",
    };
    return map[s] || s || "—";
  }

  function vatLabel(v) {
    if (!v) return "—";
    const t = typeof v === "string" ? v : (v.type || "");
    const map = {
      none: "Без НДС",
      vat0: "НДС 0%",
      vat10: "НДС 10%",
      vat20: "НДС 20%",
      vat22: "НДС 22%",
      vat5: "НДС 5%",
      vat7: "НДС 7%",
      vat105: "НДС 10/110",
      vat120: "НДС 20/120",
      vat122: "НДС 22/122",
      vat110: "НДС 10/110",
      calculated: "НДС расчётная",
    };
    return map[t] || t || "—";
  }

  function measureLabel(m) {
    const map = {
      0: "шт", 10: "г", 11: "кг", 12: "т",
      20: "см", 21: "дм", 22: "м",
      30: "кв. см", 31: "кв. дм", 32: "кв. м",
      40: "мл", 41: "л", 42: "м³",
      50: "кВт·ч", 51: "Гкал",
      70: "сутки", 71: "час", 72: "мин", 73: "с",
      80: "Кбайт", 81: "Мбайт", 82: "Гбайт", 83: "Тбайт",
      255: "иное",
    };
    if (m == null || m === "") return "";
    return map[m] != null ? map[m] : ("ед. " + m);
  }

  function paymentMethodLabel(m) {
    const map = {
      full_payment: "Полный расчёт",
      full_prepayment: "Предоплата 100%",
      prepayment: "Предоплата",
      advance: "Аванс",
      partial_payment: "Частичный расчёт и кредит",
      credit: "Передача в кредит",
      credit_payment: "Оплата кредита",
    };
    return map[m] || m || "—";
  }

  function paymentObjectLabel(o) {
    const map = {
      1: "Товар", 2: "Подакцизный товар", 3: "Работа", 4: "Услуга",
      5: "Ставка азартной игры", 6: "Выигрыш азартной игры",
      7: "Лотерейный билет", 8: "Выигрыш лотереи", 9: "Предоставление РИД",
      10: "Платёж", 11: "Агентское вознаграждение", 12: "Выплата",
      13: "Иной предмет расчёта", 14: "Имущественное право",
      15: "Внереализационный доход", 16: "Страховые взносы",
      17: "Торговый сбор", 18: "Курортный сбор", 19: "Залог", 20: "Расход",
      21: "Взносы на ОПС ИП", 22: "Взносы на ОПС", 23: "Взносы на ОМС ИП",
      24: "Взносы на ОМС", 25: "Взносы на ОСС", 26: "Платёж казино",
      27: "Выдача ДС", 30: "АТНМ", 31: "АТМ", 32: "ТНМ", 33: "ТМ",
    };
    if (o == null || o === "") return "—";
    return map[o] != null ? map[o] : ("Код " + o);
  }


  function kindLabel(k) {
    const map = {
      CASH_VOUCHER_V3: "Кассовый чек",
      CASH_VOUCHER: "Кассовый чек",
      INVOICE: "Счёт / ссылка на оплату",
    };
    return map[k] || k || "—";
  }

  function fiscalStatusLabel(s) {
    const map = {
      done: "Фискализирован",
      fail: "Ошибка фискализации",
      wait: "Ожидает фискализации",
      wait_for_callback: "Ожидает callback",
    };
    return map[s] || s || "—";
  }

  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buildReceiptHtml(atol5, summary, fiscal, opts) {
    opts = opts || {};
    const receipt = (atol5 && atol5.receipt) || {};
    const company = receipt.company || {};
    const client = receipt.client || {};
    const items = receipt.items || [];
    const payments = receipt.payments || [];
    const total = receipt.total != null ? receipt.total : summary && summary.total;
    const fiscalPayload = (fiscal && fiscal.payload) || {};
    const oid = summary && summary.order_id != null ? summary.order_id : ordersSelectedId;

    const isCorr = !!(summary && (summary.is_correction || (summary.raw && summary.raw.isCorrection)));
    let html = `<div class="r-head">
      <div class="r-title">${isCorr ? "Чек коррекции" : "Кассовый чек"}</div>
      <div class="r-meta">№ ${escHtml(summary?.order_id ?? "—")} · ${escHtml(orderTypeLabel(summary || {}))} · ${statusBadge(summary?.status || "")}</div>
      <div class="r-meta">${escHtml(formatDt(summary?.updated))}</div>
      ${(atol5 && atol5.external_id) ? `<div class="r-meta">Внешний ID: ${escHtml(atol5.external_id)}</div>` : (summary?.external_id ? `<div class="r-meta">Внешний ID: ${escHtml(summary.external_id)}</div>` : "")}`;
    if (!opts.hideEdit) {
      html += `
      <div class="r-head-actions">
        <button type="button" class="btn btn-sm btn-secondary" id="o_detail_edit" data-order-id="${oid}">Действие</button>
      </div>`;
    }
    html += `
    </div>`;

    html += `<div class="r-section-title">Организация</div>`;
    html += `<div class="r-line"><span>Магазин</span><span>${escHtml(summary?.store_name || company.payment_address || "—")}</span></div>`;
    if (summary?.store_id != null) {
      html += `<div class="r-line"><span>Код магазина</span><span>${escHtml(summary.store_id)}</span></div>`;
    }
    html += `<div class="r-line"><span>ИНН</span><span>${escHtml(company.inn || "—")}</span></div>`;
    html += `<div class="r-line"><span>СНО</span><span>${escHtml(snoLabel(company.sno))}</span></div>`;
    if (company.email) {
      html += `<div class="r-line"><span>Email организации</span><span>${escHtml(company.email)}</span></div>`;
    }
    if (company.payment_address) {
      html += `<div class="r-line"><span>Место расчётов</span><span>${escHtml(company.payment_address)}</span></div>`;
    }
    if (receipt.cashier || summary?.cashier_name) {
      html += `<div class="r-line"><span>Кассир</span><span>${escHtml(receipt.cashier || summary.cashier_name)}</span></div>`;
    }

    if (client.email || client.phone || client.name || client.inn) {
      html += `<div class="r-section-title">Покупатель</div>`;
      if (client.name) html += `<div class="r-line"><span>ФИО</span><span>${escHtml(client.name)}</span></div>`;
      if (client.email) html += `<div class="r-line"><span>Email</span><span>${escHtml(client.email)}</span></div>`;
      if (client.phone) html += `<div class="r-line"><span>Телефон</span><span>${escHtml(client.phone)}</span></div>`;
      if (client.inn) html += `<div class="r-line"><span>ИНН покупателя</span><span>${escHtml(client.inn)}</span></div>`;
    }

    html += `<div class="r-section-title">Позиции</div>`;
    if (!items.length) {
      html += `<p class="hint">Нет позиций (или формат Atol 5 недоступен)</p>`;
    } else {
      items.forEach((it) => {
        const meas = measureLabel(it.measure);
        const qtyStr = (it.quantity != null ? it.quantity : 1) + (meas ? " " + meas : "");
        html += `<div class="r-item">
          <div class="r-item-name">${escHtml(it.name || "—")}</div>
          <div class="r-item-sub">${escHtml(qtyStr)} × ${formatMoney(it.price)}</div>
          <div class="r-item-sub">${escHtml(paymentMethodLabel(it.payment_method))} · ${escHtml(paymentObjectLabel(it.payment_object))} · ${escHtml(vatLabel(it.vat))}</div>
          <div class="r-line"><span></span><span>${formatMoney(it.sum)}</span></div>
        </div>`;
      });
    }

    html += `<div class="r-total"><span>Итого</span><span>${formatMoney(total)}</span></div>`;
    if (payments.length) {
      html += `<div class="r-section-title">Оплата</div>`;
      payments.forEach((pay) => {
        html += `<div class="r-line"><span>${escHtml(paymentTypeLabel(pay.type))}</span><span>${formatMoney(pay.sum)}</span></div>`;
      });
    }

    const hasFiscal =
      fiscal &&
      (fiscal.status ||
        fiscalPayload.fn_number ||
        fiscalPayload.fiscal_document_number ||
        fiscalPayload.ofd_receipt_url);
    if (hasFiscal) {
      html += `<div class="r-section-title">Фискальные данные</div>`;
      if (fiscal.status) {
        html += `<div class="r-line"><span>Статус ФН</span><span>${escHtml(fiscalStatusLabel(fiscal.status))}</span></div>`;
      }
      if (fiscal.kind) {
        html += `<div class="r-line"><span>Тип документа</span><span>${escHtml(kindLabel(fiscal.kind))}</span></div>`;
      }
      if (fiscal.uuid || oid) {
        html += `<div class="r-line"><span>UUID</span><span>${escHtml(fiscal.uuid || oid)}</span></div>`;
      }
      if (fiscal.group_code) {
        html += `<div class="r-line"><span>Код группы</span><span>${escHtml(fiscal.group_code)}</span></div>`;
      }
      if (fiscal.timestamp) {
        html += `<div class="r-line"><span>Время ответа API</span><span>${escHtml(fiscal.timestamp)}</span></div>`;
      }
      if (fiscalPayload.receipt_datetime) {
        html += `<div class="r-line"><span>Дата/время чека</span><span>${escHtml(fiscalPayload.receipt_datetime)}</span></div>`;
      }
      if (fiscalPayload.total != null) {
        html += `<div class="r-line"><span>Сумма (ФД)</span><span>${formatMoney(fiscalPayload.total)}</span></div>`;
      }
      if (fiscalPayload.fn_number) {
        html += `<div class="r-line"><span>Номер ФН</span><span>${escHtml(fiscalPayload.fn_number)}</span></div>`;
      }
      if (fiscalPayload.fiscal_document_number != null) {
        html += `<div class="r-line"><span>Номер ФД</span><span>${escHtml(fiscalPayload.fiscal_document_number)}</span></div>`;
      }
      if (fiscalPayload.fiscal_document_attribute != null) {
        html += `<div class="r-line"><span>ФПД (ФП)</span><span>${escHtml(fiscalPayload.fiscal_document_attribute)}</span></div>`;
      }
      if (fiscalPayload.fiscal_receipt_number != null) {
        html += `<div class="r-line"><span>Номер чека в смене</span><span>${escHtml(fiscalPayload.fiscal_receipt_number)}</span></div>`;
      }
      if (fiscalPayload.shift_number != null) {
        html += `<div class="r-line"><span>Номер смены</span><span>${escHtml(fiscalPayload.shift_number)}</span></div>`;
      }
      if (fiscalPayload.ecr_registration_number) {
        html += `<div class="r-line"><span>РН ККТ</span><span>${escHtml(fiscalPayload.ecr_registration_number)}</span></div>`;
      }
      if (fiscalPayload.ofd_inn) {
        html += `<div class="r-line"><span>ИНН ОФД</span><span>${escHtml(fiscalPayload.ofd_inn)}</span></div>`;
      }
      if (fiscalPayload.fns_site) {
        html += `<div class="r-line"><span>Сайт ФНС</span><span>${escHtml(fiscalPayload.fns_site)}</span></div>`;
      }
      if (fiscal.error) {
        const errText =
          typeof fiscal.error === "object"
            ? (fiscal.error.text || fiscal.error.message || JSON.stringify(fiscal.error))
            : String(fiscal.error);
        html += `<div class="r-line r-error"><span>Ошибка ФН</span><span>${escHtml(errText)}</span></div>`;
      }
    }

    const links = [];
    if (fiscalPayload.ofd_receipt_url) {
      links.push({ label: "Ссылка на чек ОФД", href: fiscalPayload.ofd_receipt_url });
    }
    if (fiscal && fiscal.permalink) {
      links.push({ label: "Ссылка на предчек", href: fiscal.permalink });
    }
    if (links.length) {
      html += `<div class="r-section-title">Дополнительно</div>`;
      links.forEach((L) => {
        html += `<div class="r-link-row"><a href="${escHtml(L.href)}" target="_blank" rel="noopener">${escHtml(L.label)} →</a></div>`;
      });
    }

    html += `<details class="r-json"><summary class="hint">Служебный JSON (Atol 5)</summary>
      <div class="result-box">${escHtml(JSON.stringify(atol5 || {}, null, 2))}</div>
    </details>`;
    if (fiscal) {
      html += `<details class="r-json"><summary class="hint">Служебный JSON (фискальный отчёт)</summary>
        <div class="result-box">${escHtml(JSON.stringify(fiscal || {}, null, 2))}</div>
      </details>`;
    }

    return html;
  }

  function renderReceipt(atol5, summary, fiscal) {
    const el = $("#o_detail");
    const ph = $("#o_detail_placeholder");
    if (!el) return;
    if (ph) ph.classList.add("hidden");
    el.classList.remove("hidden");
    const oid = summary && summary.order_id != null ? summary.order_id : ordersSelectedId;
    el.innerHTML = buildReceiptHtml(atol5, summary, fiscal, { hideEdit: false });
    const editBtn = $("#o_detail_edit");
    if (editBtn) {
      editBtn.onclick = () => editOrderAsNew(editBtn.dataset.orderId || oid);
    }
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
      renderReceipt(data.atol5, data.summary, data.fiscal);
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
        if ($("#o_status")) $("#o_status").value = "";
        if ($("#o_since")) $("#o_since").value = "";
        if ($("#o_until")) $("#o_until").value = "";
        if ($("#o_limit")) $("#o_limit").value = "25";
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
    bindOrdersScrollZones();
  }

  /**
   * Скролл: наведение на список → страница; наведение на превью → скролл чека.
   * Клик по области фиксирует «зону» (fallback, если hover нестабилен).
   */
  function bindOrdersScrollZones() {
    const layout = document.querySelector(".orders-layout");
    const detail = document.querySelector(".orders-detail-pane");
    const list = document.querySelector(".orders-list-pane");
    if (!layout || !detail || detail.dataset.scrollBound === "1") return;
    detail.dataset.scrollBound = "1";

    let zone = "page"; // "page" | "detail"

    function setZone(z) {
      zone = z;
      detail.classList.toggle("is-scroll-active", z === "detail");
    }

    detail.addEventListener("mouseenter", () => setZone("detail"));
    detail.addEventListener("mouseleave", () => setZone("page"));
    detail.addEventListener("click", () => setZone("detail"), true);
    if (list) {
      list.addEventListener("mouseenter", () => setZone("page"));
      list.addEventListener("click", () => setZone("page"), true);
    }

    // Скроллим ВНЕШНЮЮ панель превью (чек внутри на всю высоту, без inner scroll)
    layout.addEventListener(
      "wheel",
      (e) => {
        const overDetail =
          zone === "detail" || (e.target && detail.contains(e.target));
        if (!overDetail) return;
        const el = detail;
        const canUp = el.scrollTop > 0;
        const canDown = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
        if ((e.deltaY < 0 && canUp) || (e.deltaY > 0 && canDown)) {
          e.preventDefault();
          el.scrollTop += e.deltaY;
        } else if (el.scrollHeight > el.clientHeight + 2) {
          e.preventDefault();
        }
      },
      { passive: false }
    );
  }


  // Settings sub-tabs
  $$(".settings-tab").forEach((btn) => {
    btn.onclick = () => {
      $$(".settings-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const name = btn.dataset.settingsTab;
      $("#settings-org") && $("#settings-org").classList.toggle("hidden", name !== "org");
      $("#settings-stores") && $("#settings-stores").classList.toggle("hidden", name !== "stores");
      $("#settings-appearance") && $("#settings-appearance").classList.toggle("hidden", name !== "appearance");
    };
  });

  // Theme picker → localStorage + server user_settings
  $$('input[name="eklk_theme"]').forEach((el) => {
    el.addEventListener("change", () => {
      if (el.checked) applyTheme(el.value, true);
    });
  });
  applyTheme(getStoredTheme());

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


  // ── Templates / reusable QR Pay ─────────────────────────────────────
  // Маппинг id платёжного типа → код провайдера для qrPay.allowedProviders
  const PROVIDER_CODE_BY_ID = {
    101: "YOOKASSA",
    102: "TINKOFF_BANK",
    103: "SBERBANK",
    104: "RBK_MONEY",
    105: "TINKOFF_BANK",
    106: "INVOICE_SU",
    108: "TOCHKA_SBP",
    109: "ROBOKASSA",
    110: "RAIFFEISEN",
    111: "TINKOFF_BANK_SBP",
    112: "TINKOFF_BANK_CREDIT",
    113: "TOCHKA_BANK",
    114: "ALFABANK",
    115: "ALFABANK_SBP",
    116: "GAZPROMBANK",
    117: "GAZPROMBANK_SBP",
    118: "ECOMKASSA",
    119: "PODELI",
    120: "DOLYAME",
    121: "SBERBANK_SBP",
    122: "PLAIT",
  };

  function providerCodeFromType(t) {
    if (!t) return null;
    if (t.provider) return String(t.provider).toUpperCase();
    if (t.code && typeof t.code === "string" && /[A-Z_]/.test(t.code)) {
      return t.code.toUpperCase();
    }
    if (PROVIDER_CODE_BY_ID[t.id]) return PROVIDER_CODE_BY_ID[t.id];
    // fallback: пытаемся вытащить из description
    const d = (t.description || "").toLowerCase();
    if (d.includes("юkassa") || d.includes("юкасса") || d.includes("yookassa") || d.includes("я.касс")) return "YOOKASSA";
    if (d.includes("сбер") && d.includes("сбп")) return "SBERBANK_SBP";
    if (d.includes("сбер")) return "SBERBANK";
    if (d.includes("тинькофф") && d.includes("сбп")) return "TINKOFF_BANK_SBP";
    if (d.includes("тинькофф") && (d.includes("рассроч") || d.includes("кредит"))) return "TINKOFF_BANK_CREDIT";
    if (d.includes("тинькофф") || d.includes("т-банк") || d.includes("tinkoff")) return "TINKOFF_BANK";
    if (d.includes("точка") && d.includes("сбп")) return "TOCHKA_SBP";
    if (d.includes("точка")) return "TOCHKA_BANK";
    if (d.includes("альфа") && d.includes("сбп")) return "ALFABANK_SBP";
    if (d.includes("альфа")) return "ALFABANK";
    if (d.includes("газпром") && d.includes("сбп")) return "GAZPROMBANK_SBP";
    if (d.includes("газпром")) return "GAZPROMBANK";
    if (d.includes("райф")) return "RAIFFEISEN";
    if (d.includes("robokassa") || d.includes("робокасс")) return "ROBOKASSA";
    if (d.includes("invoice")) return "INVOICE_SU";
    if (d.includes("подели")) return "PODELI";
    if (d.includes("долями")) return "DOLYAME";
    if (d.includes("plait") || d.includes("плайт")) return "PLAIT";
    if (d.includes("ecomkassa") || d.includes("екомкасс")) return "ECOMKASSA";
    return null;
  }

  function qrUrlForTemplate(tpl) {
    if (tpl.qrpay_url) return tpl.qrpay_url;
    const id = tpl.templateId || tpl.template_id;
    return id ? "https://app.ecomkassa.ru/public/qrpay/" + id : "";
  }

  /** Человекочитаемое имя провайдера по коду (без CODE — …). */
  function providerLabel(code) {
    const c = String(code || "").toUpperCase();
    if (!c) return "";
    const types = paymentTypes || [];
    for (const t of types) {
      if (providerCodeFromType(t) === c) {
        const d = (t.description || "").trim();
        if (d) return d;
      }
    }
    // fallback: убираем подчёркивания
    return c.replace(/_/g, " ");
  }

  function providerLabelsList(codes) {
    const arr = (codes || []).map(providerLabel).filter(Boolean);
    return arr.length ? arr.join(", ") : "не заданы";
  }

  async function loadTemplates() {
    const box = $("#t_list");
    if (!box) return;
    box.innerHTML = '<p class="hint">Загрузка…</p>';
    try {
      // paymentTypes нужны для подписей провайдеров
      if (!paymentTypes || !paymentTypes.length) {
        try { await loadPaymentTypes(); } catch (e) { /* ignore */ }
      }
      const items = await api("/templates");
      const list = Array.isArray(items) ? items : [];
      if (!list.length) {
        box.innerHTML = '<p class="hint">Шаблонов пока нет. Нажмите «Создать шаблон».</p>';
        return;
      }
      box.innerHTML = list.map(renderTemplateCard).join("");
      bindTemplateCardActions();
      // Очередь QR — по одному, иначе при большом списке часть не успевает отрисоваться
      queueTemplateQRs();
    } catch (e) {
      box.innerHTML = '<p class="hint" style="color:#fca5a5">' + escHtml(e.message || String(e)) + "</p>";
    }
  }

  // Кэш data-URL QR по ссылке — повторная отрисовка мгновенная
  const _tplQrCache = new Map();
  let _tplQrGen = 0; // поколение списка: отменяет старую очередь при reload

  function queueTemplateQRs() {
    const gen = ++_tplQrGen;
    const nodes = $$(".tpl-qr-img[data-link]:not([data-qr-ready])");
    if (!nodes.length) return;

    // Сначала раздаём из кэша (синхронно)
    const pending = [];
    nodes.forEach((img) => {
      const link = img.dataset.link;
      if (!link) return;
      const cached = _tplQrCache.get(link);
      if (cached) {
        img.src = cached;
        img.dataset.qrReady = "1";
        img.classList.remove("tpl-qr-pending");
      } else {
        pending.push(img);
      }
    });

    // Остальное — строго по одному через toDataURL (надёжнее toCanvas при N>>1)
    let i = 0;
    function step() {
      if (gen !== _tplQrGen) return; // список уже перерисован
      if (i >= pending.length) return;
      const img = pending[i++];
      if (!img.isConnected) {
        setTimeout(step, 0);
        return;
      }
      const link = img.dataset.link;
      makeTplQrDataUrl(link)
        .then((dataUrl) => {
          if (gen !== _tplQrGen) return;
          if (dataUrl) {
            _tplQrCache.set(link, dataUrl);
            if (img.isConnected) {
              img.src = dataUrl;
              img.dataset.qrReady = "1";
              img.classList.remove("tpl-qr-pending");
            }
          } else if (img.isConnected) {
            // последний fallback — внешний сервис
            img.src =
              "https://api.qrserver.com/v1/create-qr-code/?size=96x96&margin=4&data=" +
              encodeURIComponent(link);
            img.dataset.qrReady = "1";
            img.classList.remove("tpl-qr-pending");
          }
        })
        .finally(() => {
          // пауза 16–30ms между генерациями, UI не фризится
          setTimeout(step, 20);
        });
    }
    step();
  }

  function makeTplQrDataUrl(link) {
    return new Promise((resolve) => {
      if (!link) return resolve(null);
      if (_tplQrCache.has(link)) return resolve(_tplQrCache.get(link));
      if (typeof QRCode === "undefined" || !QRCode.toDataURL) {
        return resolve(null);
      }
      try {
        QRCode.toDataURL(
          link,
          {
            width: 96,
            margin: 1,
            errorCorrectionLevel: "M",
            color: { dark: "#0f172a", light: "#ffffff" },
          },
          (err, url) => {
            if (err || !url) {
              console.warn("QR toDataURL error", err);
              resolve(null);
            } else {
              resolve(url);
            }
          }
        );
      } catch (e) {
        console.warn("QR toDataURL exception", e);
        resolve(null);
      }
    });
  }

  function renderTemplateCard(tpl) {
    const id = tpl.templateId || "";
    const name = escHtml(tpl.name || "Без названия");
    const product = escHtml(tpl.product || "—");
    const price = tpl.price != null ? Number(tpl.price).toFixed(2) : "—";
    const count = tpl.count != null ? tpl.count : 1;
    const link = qrUrlForTemplate(tpl);
    const providers = (tpl.qrPay && tpl.qrPay.allowedProviders) || [];
    const provLabel = providerLabelsList(providers);
    const storeId = (tpl.qrPay && tpl.qrPay.storeId) || "—";
    const qrCell = link
      ? '<div class="tpl-qr-cell"><img class="tpl-qr-img tpl-qr-pending" data-link="' + escHtml(link) + '" width="96" height="96" alt="QR" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" /></div>'
      : '<div class="tpl-qr-cell tpl-qr-empty">нет QR</div>';
    return (
      '<div class="tpl-card" data-id="' + escHtml(id) + '">' +
        qrCell +
        '<div class="tpl-card-body">' +
          '<div class="tpl-card-head">' +
            '<div>' +
              '<div class="tpl-card-title">' + name + '</div>' +
              '<div class="tpl-card-meta">' + product + ' · <b>' + price + ' ₽</b> × ' + count +
                ' · ' + escHtml(tpl.vat || "none") +
                ' · ' + escHtml(tpl.paymentMethod || "") +
              '</div>' +
              '<div class="tpl-card-meta">Магазин: ' + escHtml(String(storeId)) +
                (providers.length ? ' · ' + escHtml(provLabel) : '') +
              '</div>' +
            '</div>' +
            '<div class="tpl-card-actions">' +
              '<button type="button" class="btn btn-sm btn-secondary tpl-edit" data-id="' + escHtml(id) + '">Изменить</button>' +
              '<button type="button" class="btn btn-sm btn-secondary tpl-del" data-id="' + escHtml(id) + '">Удалить</button>' +
            '</div>' +
          '</div>' +
          (link
            ? '<div class="tpl-link-row">' +
                '<input type="text" readonly value="' + escHtml(link) + '" class="tpl-link-input" />' +
                '<button type="button" class="btn btn-sm tpl-copy" data-link="' + escHtml(link) + '">Копировать</button>' +
                '<a class="btn btn-sm btn-secondary" href="' + escHtml(link) + '" target="_blank" rel="noopener">Открыть</a>' +
              '</div>'
            : '<p class="hint" style="margin:6px 0 0">Ссылка появится после настройки QR Pay.</p>') +
        '</div>' +
      '</div>'
    );
  }

  function bindTemplateCardActions() {
    $$(".tpl-copy").forEach((btn) => {
      btn.onclick = async () => {
        const link = btn.dataset.link;
        try {
          await navigator.clipboard.writeText(link);
          btn.textContent = "Скопировано";
          setTimeout(() => { btn.textContent = "Копировать"; }, 1500);
        } catch (e) {
          const input = btn.closest(".tpl-card").querySelector(".tpl-link-input");
          if (input) { input.select(); document.execCommand("copy"); }
        }
      };
    });
    $$(".tpl-edit").forEach((btn) => {
      btn.onclick = () => openTplModal(btn.dataset.id);
    });
    $$(".tpl-del").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("Удалить шаблон? Многоразовая ссылка перестанет работать.")) return;
        try {
          await api("/templates/" + encodeURIComponent(btn.dataset.id), { method: "DELETE" });
          showAlert("Шаблон удалён", "success");
          loadTemplates();
        } catch (e) {
          showAlert(e.message || String(e));
        }
      };
    });
    // QR рисуются очередью в queueTemplateQRs() после loadTemplates
  }

  function fillTplProviders(selected) {
    const box = $("#tpl_providers");
    if (!box) return;
    const selectedSet = new Set((selected || []).map(String));
    const providers = (paymentTypes || []).filter((t) => t.id >= 100);
    const seen = new Set();
    const rows = [];
    providers.forEach((t) => {
      const code = providerCodeFromType(t);
      if (!code || seen.has(code)) return;
      seen.add(code);
      const checked = selectedSet.has(code) ? " checked" : "";
      const label = (t.description || "").trim() || code.replace(/_/g, " ");
      rows.push(
        '<label><input type="checkbox" class="tpl-prov" value="' + escHtml(code) + '"' + checked + " /> " +
        escHtml(label) + "</label>"
      );
    });
    // Добавить выбранные, которых нет в paymentTypes — только человекочитаемое имя
    (selected || []).forEach((code) => {
      if (seen.has(code)) return;
      seen.add(code);
      rows.push(
        '<label><input type="checkbox" class="tpl-prov" value="' + escHtml(code) + '" checked /> ' +
        escHtml(providerLabel(code)) + "</label>"
      );
    });
    box.innerHTML = rows.length
      ? rows.join("")
      : '<p class="hint">Нет доступных платёжных систем. Проверьте интеграции в EcomKassa.</p>';
  }

  function fillTplStoreSelect(selected) {
    const el = $("#tpl_store");
    if (!el) return;
    const stores = storesList();
    const cur = selected != null ? String(selected) : String(getSelectedStoreId() || "");
    if (!stores.length) {
      el.innerHTML = '<option value="' + escHtml(cur || "990") + '">' + escHtml(cur || "990") + "</option>";
      return;
    }
    el.innerHTML = stores
      .map((s) => {
        const id = String(s.store_id);
        const sel = id === cur ? " selected" : "";
        return '<option value="' + escHtml(id) + '"' + sel + ">" + escHtml(s.store_name || id) + " (" + id + ")</option>";
      })
      .join("");
  }

  function resetTplForm() {
    $("#tpl_id").value = "";
    if ($("#tpl_user_id")) $("#tpl_user_id").value = "";
    $("#tpl_name").value = "";
    $("#tpl_product").value = "";
    $("#tpl_price").value = "";
    $("#tpl_count").value = "1";
    $("#tpl_vat").value = "none";
    $("#tpl_method").value = "full_prepayment";
    $("#tpl_object").value = "service";
    $("#tpl_operation").value = "sell";
    $("#tpl_agent").value = "non_agent";
    $("#tpl_req_email").checked = true;
    $("#tpl_req_phone").checked = false;
    const err = $("#tpl_form_error");
    if (err) { err.classList.add("hidden"); err.textContent = ""; }
    fillTplStoreSelect();
    fillTplProviders([]);
  }

  function isUuid(s) {
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(s || "").trim());
  }

  /** userId для qrPay: firmId (UUID фирмы) или из существующих шаблонов. */
  async function findKnownCashierUserId() {
    if (firmData && isUuid(firmData.firm_id)) {
      return String(firmData.firm_id).trim();
    }
    try {
      const items = await api("/templates");
      const list = Array.isArray(items) ? items : [];
      for (const tpl of list) {
        const uid = tpl && tpl.qrPay && tpl.qrPay.userId;
        if (isUuid(uid)) return String(uid).trim();
      }
    } catch (e) { /* ignore */ }
    return "";
  }

  function openTplModal(templateId) {
    const modal = $("#tplModal");
    if (!modal) return;
    resetTplForm();
    $("#tpl_modal_title").textContent = templateId ? "Редактировать шаблон" : "Новый шаблон";
    if (templateId) {
      api("/templates/" + encodeURIComponent(templateId))
        .then((tpl) => {
          $("#tpl_id").value = tpl.templateId || templateId;
          $("#tpl_name").value = tpl.name || "";
          $("#tpl_product").value = tpl.product || "";
          $("#tpl_price").value = tpl.price != null ? tpl.price : "";
          $("#tpl_count").value = tpl.count != null ? tpl.count : 1;
          if (tpl.vat) $("#tpl_vat").value = tpl.vat;
          if (tpl.paymentMethod) $("#tpl_method").value = tpl.paymentMethod;
          if (tpl.paymentObject) $("#tpl_object").value = tpl.paymentObject;
          if (tpl.operationType) $("#tpl_operation").value = tpl.operationType;
          if (tpl.agentType) $("#tpl_agent").value = tpl.agentType;
          $("#tpl_req_email").checked = !!tpl.requireClientEmail;
          $("#tpl_req_phone").checked = !!tpl.requireClientPhone;
          const qp = tpl.qrPay || {};
          if ($("#tpl_user_id") && qp.userId) $("#tpl_user_id").value = qp.userId;
          fillTplStoreSelect(qp.storeId);
          fillTplProviders(qp.allowedProviders || []);
        })
        .catch((e) => showAlert(e.message || String(e)));
    } else {
      fillTplStoreSelect();
      fillTplProviders([]);
      // для создания: заранее подтянуть UUID кассира из существующих шаблонов
      findKnownCashierUserId().then((uid) => {
        if (uid && $("#tpl_user_id") && !$("#tpl_user_id").value) {
          $("#tpl_user_id").value = uid;
        }
      });
    }
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }

  function closeTplModal() {
    const modal = $("#tplModal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }

  function collectTplBody() {
    const name = ($("#tpl_name").value || "").trim();
    const product = ($("#tpl_product").value || "").trim();
    const price = parseFloat($("#tpl_price").value);
    const count = parseFloat($("#tpl_count").value) || 1;
    if (!name) throw new Error("Укажите наименование шаблона");
    if (!product) throw new Error("Укажите наименование товара/услуги");
    if (!(price >= 0) || isNaN(price)) throw new Error("Укажите корректную цену");
    const storeId = parseInt($("#tpl_store").value, 10);
    if (!storeId) throw new Error("Выберите магазин");
    const allowedProviders = $$(".tpl-prov")
      .filter((el) => el.checked)
      .map((el) => el.value);
    if (!allowedProviders.length) {
      throw new Error("Выберите хотя бы один способ оплаты (QR Pay)");
    }
    const qrPay = {
      allowedProviders,
      storeId,
    };
    // userId = firmId (UUID) — иначе EcomKassa: error.expected.uuid
    const hid = $("#tpl_user_id");
    if (hid && isUuid(hid.value)) {
      qrPay.userId = hid.value.trim();
    } else if (firmData && isUuid(firmData.firm_id)) {
      qrPay.userId = String(firmData.firm_id).trim();
    }
    return {
      name,
      product,
      price,
      count,
      vat: $("#tpl_vat").value || "none",
      paymentMethod: $("#tpl_method").value || "full_prepayment",
      paymentObject: $("#tpl_object").value || "service",
      operationType: $("#tpl_operation").value || "sell",
      agentType: $("#tpl_agent").value || "non_agent",
      requireClientEmail: !!$("#tpl_req_email").checked,
      requireClientPhone: !!$("#tpl_req_phone").checked,
      requireClientData: true,
      qrPay,
    };
  }

  async function saveTpl() {
    const errEl = $("#tpl_form_error");
    if (errEl) { errEl.classList.add("hidden"); errEl.textContent = ""; }
    try {
      const body = collectTplBody();
      const id = ($("#tpl_id").value || "").trim();
      if (id) {
        await api("/templates/" + encodeURIComponent(id), {
          method: "PUT",
          body: JSON.stringify(body),
        });
        showAlert("Шаблон обновлён", "success");
      } else {
        await api("/templates", {
          method: "POST",
          body: JSON.stringify(body),
        });
        showAlert("Шаблон создан", "success");
      }
      closeTplModal();
      loadTemplates();
    } catch (e) {
      const msg = e.message || String(e);
      if (errEl) {
        errEl.textContent = msg;
        errEl.classList.remove("hidden");
      } else {
        showAlert(msg);
      }
    }
  }

  function bindTemplatesUI() {
    if ($("#t_refresh")) $("#t_refresh").onclick = () => loadTemplates();
    if ($("#t_create")) $("#t_create").onclick = () => openTplModal(null);
    if ($("#tpl_save")) $("#tpl_save").onclick = () => saveTpl();
    $$("[data-close-tpl]").forEach((el) => {
      el.onclick = () => closeTplModal();
    });
  }

  bindTemplatesUI();

  bindOrdersUI();

  // Enter in filter fields triggers search
  ["o_ext", "o_since", "o_until"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        ordersOffset = 0;
        loadOrders();
      }
    });
  });
  if ($("#o_types")) {
    $("#o_types").onchange = () => { ordersOffset = 0; loadOrders(); };
  }
  if ($("#o_limit")) {
    $("#o_limit").onchange = () => { ordersOffset = 0; loadOrders(); };
  }

  if (token) afterLogin().catch(() => logout(true));

  // CORE: minimal public API for section modules (catalog, reports, …)
  window.EKLK = {
    get token() { return token; },
    api,
    showAlert,
    showTab,
    get firmData() { return firmData; },
    get groupCode() { return groupCode; },
    API,
  };
})();
