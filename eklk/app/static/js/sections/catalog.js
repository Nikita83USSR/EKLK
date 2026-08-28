/**
 * EKLK Catalog section — отдельный модуль (не трогает ядро app.js).
 * Данные только через /api/v1/catalog → EcomKassa API.
 */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  let page = 1;
  let totalPages = 1;
  let loading = false;
  let selected = new Set();

  function api(path, opts) {
    if (window.EKLK && typeof window.EKLK.api === "function") {
      return window.EKLK.api(path, opts);
    }
    throw new Error("EKLK core not ready");
  }
  function alert(msg, type) {
    if (window.EKLK && window.EKLK.showAlert) window.EKLK.showAlert(msg, type);
    else window.alert(msg);
  }

  const VAT_LABELS = {
    VAT_NONE: "Без НДС", none: "Без НДС",
    VAT_0PCT: "0%", vat0: "0%",
    VAT_10PCT: "10%", vat10: "10%",
    VAT_110PCT: "10/110", vat110: "10/110",
    VAT_20PCT: "20%", vat20: "20%",
    VAT_120PCT: "20/120", vat120: "20/120",
    vat5: "5%", vat7: "7%", vat22: "22%",
  };
  const PO_LABELS = {
    COMMODITY: "Товар", commodity: "Товар",
    SERVICE: "Услуга", service: "Услуга",
    JOB: "Работа", job: "Работа",
    EXCISE: "Подакцизный", excise: "Подакцизный",
    PAYMENT: "Платёж", payment: "Платёж",
    ANOTHER: "Иное", another: "Иное",
    identified_item_marked: "Маркир. товар",
    identified_item_no_mark: "Товар без марки",
    excise_item_marked: "Подакцизн. маркир.",
  };

  function money(n) {
    const v = Number(n);
    if (Number.isNaN(v)) return "—";
    return v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  let busyTimer = null;
  let busyStartedAt = 0;
  let importAbort = null;

  function clearBusyTimer() {
    if (busyTimer) {
      clearInterval(busyTimer);
      busyTimer = null;
    }
  }

  function setCatalogBusy(on, msg, opts) {
    opts = opts || {};
    loading = !!on;
    const overlay = $("#cat_busy");
    const text = $("#cat_busy_text");
    const stopBtn = $("#cat_busy_stop");
    const progWrap = $("#cat_busy_progress_wrap");
    const progFill = $("#cat_busy_progress_fill");
    const progLabel = $("#cat_busy_progress_label");
    if (overlay) {
      overlay.classList.toggle("is-on", !!on);
      overlay.setAttribute("aria-hidden", on ? "false" : "true");
    }
    if (text && msg) text.textContent = msg;
    if (stopBtn) {
      const showStop = !!on && !!opts.cancellable;
      stopBtn.classList.toggle("hidden", !showStop);
      stopBtn.onclick = showStop && typeof opts.onStop === "function" ? opts.onStop : null;
    }
    if (progWrap) {
      const showProg = !!on && !!opts.progress;
      progWrap.hidden = !showProg;
      if (showProg && progFill) {
        if (opts.progress === "indeterminate") {
          progFill.classList.add("is-indeterminate");
          progFill.style.width = "40%";
        } else {
          progFill.classList.remove("is-indeterminate");
          const pct = Math.max(0, Math.min(100, Number(opts.progress) || 0));
          progFill.style.width = pct + "%";
        }
      }
    }
    if (progLabel) {
      progLabel.textContent = opts.progressLabel || "";
    }
    if (on && opts.elapsed) {
      busyStartedAt = Date.now();
      clearBusyTimer();
      const tick = () => {
        const sec = Math.floor((Date.now() - busyStartedAt) / 1000);
        const m = Math.floor(sec / 60);
        const s = String(sec % 60).padStart(2, "0");
        const base = msg || (text && text.textContent) || "Подождите…";
        if (text) text.textContent = base.replace(/\s*·\s*\d+:\d{2}$/, "") + " · " + m + ":" + s;
        if (progLabel && opts.progress === "indeterminate") {
          progLabel.textContent = opts.progressLabel || "Идёт обработка на сервере…";
        }
      };
      tick();
      busyTimer = setInterval(tick, 1000);
    } else if (!on) {
      clearBusyTimer();
      if (progFill) {
        progFill.classList.remove("is-indeterminate");
        progFill.style.width = "0%";
      }
      if (progLabel) progLabel.textContent = "";
      if (progWrap) progWrap.hidden = true;
      if (stopBtn) {
        stopBtn.classList.add("hidden");
        stopBtn.onclick = null;
      }
    }
    ["cat_refresh", "cat_create", "cat_search", "cat_bulk_delete", "cat_delete_all", "cat_prev", "cat_next"].forEach((id) => {
      const el = $("#" + id);
      if (el) el.disabled = !!on;
    });
    const impLabel = document.querySelector('label[for="cat_import"], label.cat-import-label');
    const imp = $("#cat_import");
    if (imp) imp.disabled = !!on;
    if (impLabel) impLabel.classList.toggle("is-disabled", !!on);
  }

  function applyCatalogCompact(on) {
    const wrap = $("#cat_table_wrap") || document.querySelector("#tab-catalog .orders-table-wrap");
    if (wrap) wrap.classList.toggle("orders-compact", !!on);
    try { localStorage.setItem("eklk_catalog_compact", on ? "1" : "0"); } catch (e) {}
  }

  async function load(opts) {
    opts = opts || {};
    if (loading && !opts.force) return;
    setCatalogBusy(true, "Подождите, каталог загружается…");
    const tbody = $("#cat_tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="hint">Загрузка…</td></tr>`;
    const name = ($("#cat_q_name") && $("#cat_q_name").value.trim()) || "";
    const sku = ($("#cat_q_sku") && $("#cat_q_sku").value.trim()) || "";
    const qs = new URLSearchParams({ page: String(page), size: "50" });
    if (name) qs.set("name", name);
    if (sku) qs.set("sku", sku);
    try {
      const data = await api("/catalog/items?" + qs.toString());
      const items = data.items || [];
      totalPages = data.totalPages || 1;
      page = data.currentPage || page;
      selected.clear();
      updateBulkBtn();
      if ($("#cat_check_all")) $("#cat_check_all").checked = false;
      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="hint">Товаров нет</td></tr>`;
      } else {
        tbody.innerHTML = items
          .map((it) => {
            const id = it.itemId;
            return `<tr data-id="${id}">
              <td><input type="checkbox" class="cat-check" data-id="${id}" /></td>
              <td>${escapeHtml(it.name || "")}</td>
              <td><code>${escapeHtml(it.sku || "")}</code></td>
              <td>${money(it.price)}</td>
              <td>${VAT_LABELS[it.vatType] || it.vatType || "—"}</td>
              <td>${PO_LABELS[it.paymentObject] || it.paymentObject || "—"}</td>
              <td style="white-space:nowrap">
                <button type="button" class="btn btn-sm btn-secondary cat-edit" data-id="${id}">✎</button>
                <button type="button" class="btn btn-sm btn-secondary cat-del" data-id="${id}">✕</button>
              </td>
            </tr>`;
          })
          .join("");
        window.__CAT_ITEMS = Object.fromEntries(items.map((i) => [String(i.itemId), i]));
      }
      const info = $("#cat_page_info");
      if (info) info.textContent = `Стр. ${page} из ${totalPages} · ${items.length} на стр.`;
      if ($("#cat_prev")) $("#cat_prev").disabled = page <= 1;
      if ($("#cat_next")) $("#cat_next").disabled = page >= totalPages;
    } catch (e) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="hint">Ошибка: ${escapeHtml(e.message || e)}</td></tr>`;
      alert(e.message || String(e), "error");
    } finally {
      setCatalogBusy(false);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateBulkBtn() {
    const btn = $("#cat_bulk_delete");
    if (btn) btn.disabled = selected.size === 0;
  }

  function openModal(item) {
    const modal = $("#catModal");
    if (!modal) return;
    $("#cat_modal_title").textContent = item ? "Редактировать товар" : "Новый товар";
    $("#cat_item_id").value = item ? item.itemId : "";
    $("#cat_name").value = item ? item.name || "" : "";
    $("#cat_sku").value = item ? item.sku || "" : "";
    $("#cat_price").value = item ? item.price ?? 0 : 0;
    const vatRaw = item ? (item.vatType || "VAT_NONE") : "VAT_NONE";
    const poRaw = item ? (item.paymentObject || "COMMODITY") : "COMMODITY";
    const vatSel = $("#cat_vat");
    const poSel = $("#cat_po");
    const vatMap = {none:"VAT_NONE",vat0:"VAT_0PCT",vat10:"VAT_10PCT",vat110:"VAT_110PCT",vat20:"VAT_20PCT",vat120:"VAT_120PCT"};
    const poMap = {commodity:"COMMODITY",service:"SERVICE",job:"JOB",excise:"EXCISE",payment:"PAYMENT",another:"ANOTHER"};
    if (vatSel) vatSel.value = vatMap[String(vatRaw).toLowerCase()] || (String(vatRaw).toUpperCase().startsWith("VAT_") ? String(vatRaw).toUpperCase() : "VAT_NONE");
    if (poSel) poSel.value = poMap[String(poRaw).toLowerCase()] || (["COMMODITY","SERVICE","JOB","EXCISE","PAYMENT","ANOTHER"].includes(String(poRaw).toUpperCase()) ? String(poRaw).toUpperCase() : "COMMODITY");
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    const modal = $("#catModal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }

  async function save() {
    const id = $("#cat_item_id").value;
    const body = {
      name: $("#cat_name").value.trim(),
      sku: ($("#cat_sku").value || "").trim(),
      price: parseFloat($("#cat_price").value) || 0,
      vatType: $("#cat_vat").value,
      paymentObject: $("#cat_po").value,
    };
    if (!body.name) {
      alert("Укажите наименование", "error");
      return;
    }
    // пустой SKU — сервер сгенерирует уникальный
    try {
      if (id) {
        await api("/catalog/items/" + encodeURIComponent(id), {
          method: "PUT",
          body: JSON.stringify(body),
        });
        alert("Товар обновлён", "success");
      } else {
        await api("/catalog/items", { method: "POST", body: JSON.stringify(body) });
        alert("Товар создан", "success");
      }
      closeModal();
      await load();
    } catch (e) {
      alert(e.message || String(e), "error");
    }
  }

  function bind() {
    $("#cat_refresh")?.addEventListener("click", () => {
      page = 1;
      load();
    });
    $("#cat_search")?.addEventListener("click", () => {
      page = 1;
      load();
    });
    $("#cat_prev")?.addEventListener("click", () => {
      if (page > 1) {
        page--;
        load();
      }
    });
    $("#cat_next")?.addEventListener("click", () => {
      if (page < totalPages) {
        page++;
        load();
      }
    });
    $("#cat_create")?.addEventListener("click", () => openModal(null));
    $("#cat_save")?.addEventListener("click", save);
    $$("[data-close-cat]").forEach((el) => el.addEventListener("click", closeModal));

    $("#cat_check_all")?.addEventListener("change", (e) => {
      const on = e.target.checked;
      $$(".cat-check").forEach((cb) => {
        cb.checked = on;
        const id = cb.dataset.id;
        if (on) selected.add(id);
        else selected.delete(id);
      });
      updateBulkBtn();
    });

    document.addEventListener("change", (e) => {
      if (e.target.classList?.contains("cat-check")) {
        const id = e.target.dataset.id;
        if (e.target.checked) selected.add(id);
        else selected.delete(id);
        updateBulkBtn();
      }
    });

    document.addEventListener("click", async (e) => {
      const edit = e.target.closest(".cat-edit");
      if (edit) {
        const it = (window.__CAT_ITEMS || {})[edit.dataset.id];
        openModal(it || { itemId: edit.dataset.id });
        return;
      }
      const del = e.target.closest(".cat-del");
      if (del) {
        if (!confirm("Удалить товар #" + del.dataset.id + "?")) return;
        try {
          await api("/catalog/items/" + encodeURIComponent(del.dataset.id), { method: "DELETE" });
          alert("Удалено", "success");
          await load();
        } catch (err) {
          alert(err.message || String(err), "error");
        }
      }
    });

    $("#cat_bulk_delete")?.addEventListener("click", async () => {
      if (!selected.size) return;
      if (!confirm("Удалить выбранные товары: " + selected.size + "?")) return;
      try {
        const res = await api("/catalog/items/bulk-delete", {
          method: "POST",
          body: JSON.stringify({ item_ids: [...selected].map(Number) }),
        });
        alert(`Удалено: ${res.deleted}` + (res.errors?.length ? `; ошибок: ${res.errors.length}` : ""), "success");
        await load();
      } catch (err) {
        alert(err.message || String(err), "error");
      }
    });

    $("#cat_delete_all")?.addEventListener("click", async () => {
      const word = prompt('Для удаления ВСЕХ товаров каталога введите слово «удалить»:');
      if (word == null) return;
      if (word.trim().toLowerCase() !== "удалить") {
        alert("Подтверждение не принято", "error");
        return;
      }
      try {
        const res = await api("/catalog/items/delete-all?confirm=" + encodeURIComponent("удалить"), {
          method: "POST",
        });
        alert(`Удалено: ${res.deleted}` + (res.errors?.length ? `; ошибок: ${res.errors.length}` : ""), "success");
        page = 1;
        await load();
      } catch (err) {
        alert(err.message || String(err), "error");
      }
    });

    $("#cat_import")?.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      const fd = new FormData();
      fd.append("file", file);

      if (importAbort) {
        try { importAbort.abort(); } catch (e) {}
      }
      importAbort = typeof AbortController !== "undefined" ? new AbortController() : null;

      setCatalogBusy(true, "Подождите, идёт импорт каталога…", {
        cancellable: true,
        progress: "indeterminate",
        progressLabel: "Разбор файла и создание позиций на сервере…",
        elapsed: true,
        onStop: () => {
          if (importAbort) {
            try { importAbort.abort(); } catch (e) {}
          }
          setCatalogBusy(false);
          alert("Импорт остановлен. Уже созданные позиции остаются в каталоге.", "error");
        },
      });

      try {
        const headers = {};
        if (window.EKLK?.token) headers["Authorization"] = "Bearer " + window.EKLK.token;
        const res = await fetch((window.EKLK?.API || "/api/v1") + "/catalog/import/commerceml", {
          method: "POST",
          headers,
          body: fd,
          signal: importAbort ? importAbort.signal : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = data.detail;
          const msg =
            typeof detail === "string"
              ? detail
              : detail && detail.message
                ? detail.message
              : data.error || res.statusText;
          throw new Error(msg || "Ошибка импорта");
        }
        const r = data.report || data;
        const errList = (data.errors || []).slice(0, 8).join("\n");
        // Сначала снимаем оверлей — иначе load() не стартует (loading=true)
        setCatalogBusy(false);
        alert(
          `Импорт завершён\n` +
            `Всего в файле: ${r.total ?? data.total ?? "—"}\n` +
            `Создано: ${data.created ?? 0}\n` +
            `Обновлено: ${data.updated ?? 0}\n` +
            `Пропущено: ${data.skipped ?? 0}\n` +
            `Ошибок: ${data.errors_count ?? (data.errors || []).length}\n` +
            `Сгенерировано артикулов: ${data.generated_sku ?? 0}` +
            (errList ? `\n\nПримеры ошибок:\n${errList}` : ""),
          (data.errors_count || (data.errors || []).length) ? "error" : "success"
        );
        page = 1;
        await load({ force: true });
      } catch (err) {
        if (err && (err.name === "AbortError" || /abort/i.test(String(err.message || "")))) {
          // already handled by onStop or cancel
          setCatalogBusy(false);
          return;
        }
        setCatalogBusy(false);
        alert(err.message || String(err), "error");
      } finally {
        importAbort = null;
        setCatalogBusy(false);
      }
    });

    // Сжато
    const compactCb = $("#cat_compact");
    if (compactCb) {
      let saved = false;
      try { saved = localStorage.getItem("eklk_catalog_compact") === "1"; } catch (e) {}
      compactCb.checked = saved;
      applyCatalogCompact(saved);
      compactCb.onchange = () => applyCatalogCompact(compactCb.checked);
    }
  }

  let bound = false;
  window.EKLK_CATALOG = {
    onShow() {
      if (!bound) {
        bind();
        bound = true;
      }
      load();
    },
  };
})();
