// Dialogs built into the page (no alert/confirm/prompt): a message with buttons,
// or a message with one text field. Each returns a promise.
//
//   await choose({ title, body, buttons: [{ label, value, kind }] })   -> value, or null for Esc / click outside
//   await confirmDialog({ title, body, ok, danger })                    -> true / false
//   await askText({ title, body, value, ok })                           -> the text, or null

import { escapeHtml } from "./edits.js";

let open = null; // the dialog on screen, so a second one replaces it

function mount(html, onKey) {
  if (open) open.close(null);
  const wrap = document.createElement("div");
  wrap.className = "dlg-back";
  wrap.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  const previous = document.activeElement;
  return new Promise((resolve) => {
    const close = (value) => {
      wrap.remove();
      document.removeEventListener("keydown", keys, true);
      open = null;
      previous?.focus?.();
      resolve(value);
    };
    const keys = (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(null); }
      else onKey?.(e, close, wrap);
    };
    document.addEventListener("keydown", keys, true);
    wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(null); });
    open = { close };
    wrap._close = close;
    const first = wrap.querySelector("[data-focus]");
    first?.focus();
    first?.select?.(); // a text field starts selected, so typing replaces it
    wrap.querySelectorAll("[data-value]").forEach((b) => b.addEventListener("click", () => close(JSON.parse(b.dataset.value))));
    wrap.querySelector("[data-submit]")?.addEventListener("click", () => close(wrap.querySelector("input").value.trim() || null));
  });
}

const head = (title, body) => `<h4>${escapeHtml(title)}</h4>${body ? `<div class="dlg-body">${body}</div>` : ""}`;

export function choose({ title, body = "", buttons }) {
  const row = buttons.map((b, i) => `<button class="btn ${b.kind || ""}" ${i === 0 ? "data-focus" : ""} data-value='${escapeHtml(JSON.stringify(b.value))}'>${escapeHtml(b.label)}</button>`).join("");
  return mount(`${head(title, body)}<div class="dlg-acts">${row}</div>`);
}

export function confirmDialog({ title, body = "", ok = "OK", cancel = "Cancel", danger = false }) {
  return choose({
    title, body,
    buttons: [{ label: ok, value: true, kind: danger ? "danger" : "primary" }, { label: cancel, value: false, kind: "quiet" }],
  }).then((v) => v === true);
}

export function askText({ title, body = "", value = "", ok = "OK", placeholder = "" }) {
  return mount(
    `${head(title, body)}<input class="fld wide" data-focus value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" spellcheck="false">` +
      `<div class="dlg-acts"><button class="btn primary" data-submit>${escapeHtml(ok)}</button><button class="btn quiet" data-value="null">Cancel</button></div>`,
    (e, close, wrap) => { if (e.key === "Enter") { e.preventDefault(); close(wrap.querySelector("input").value.trim() || null); } },
  );
}

// A short message at the bottom of the page that goes away by itself.
export function flash(text, tone = "") {
  let el = document.getElementById("flash");
  if (!el) {
    el = document.createElement("div");
    el.id = "flash";
    document.body.appendChild(el);
  }
  el.className = `flash ${tone}`;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { el.hidden = true; }, tone === "bad" ? 6000 : 2600);
}
