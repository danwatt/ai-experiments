/* @ds-bundle: {"format":4,"namespace":"Bluebonnet","components":[{"name":"Button"},{"name":"Field"},{"name":"Choice"},{"name":"Badge"},{"name":"Alert"},{"name":"Tabs"},{"name":"Table"}]} */
(function () {
  var R = window.React, h = R.createElement;
  var uid = 0;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(" "); }
  function rest(props, keys) {
    var out = {};
    for (var k in props) if (Object.prototype.hasOwnProperty.call(props, k) && keys.indexOf(k) < 0) out[k] = props[k];
    return out;
  }
  function useId(given) {
    var ref = R.useRef(null);
    if (ref.current === null) ref.current = given || "bb-" + (++uid);
    return ref.current;
  }
  var ICONS = {
    info: "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2ZM11.2 14H8.8v-1.4h.6V10h-.6V8.8h1.8v3.8h.6Z",
    success: "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-1.2 11.4L5.4 10l1.1-1.1 2.3 2.3 4.7-4.7 1.1 1.1Z",
    warning: "M10 2.2 1.6 17h16.8ZM10.9 14.6H9.1v-1.8h1.8Zm0-3H9.1V7.4h1.8Z",
    danger: "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.9 12.6H9.1v-1.8h1.8Zm0-3.2H9.1V5.6h1.8Z"
  };
  function Icon(p) {
    return h("svg", { className: p.className, viewBox: "0 0 20 20", width: 20, height: 20, "aria-hidden": "true", fill: "currentColor" },
      h("path", { d: ICONS[p.name] }));
  }

  function Button(p) {
    var variant = p.variant || "primary", size = p.size || "md";
    return h("button", Object.assign({ type: "button" }, rest(p, ["variant", "size", "className", "children"]), {
      className: cx("bb-btn", "bb-btn--" + variant, size === "sm" && "bb-btn--sm", p.className)
    }), p.children);
  }

  function Field(p) {
    var id = useId(p.id);
    var hintId = id + "-hint", errId = id + "-err";
    var described = [p.hint && hintId, p.error && errId].filter(Boolean).join(" ") || undefined;
    var control = h(p.multiline ? "textarea" : "input", Object.assign(
      rest(p, ["label", "hint", "error", "multiline", "id", "className"]),
      { id: id, className: "bb-field__control", "aria-invalid": p.error ? "true" : undefined, "aria-describedby": described }
    ));
    return h("div", { className: cx("bb-field", p.error && "bb-field--invalid", p.className) },
      h("label", { className: "bb-field__label", htmlFor: id }, p.label),
      control,
      p.hint ? h("p", { className: "bb-field__hint", id: hintId }, p.hint) : null,
      p.error ? h("p", { className: "bb-field__error", id: errId }, h(Icon, { name: "danger" }), p.error) : null
    );
  }

  function Choice(p) {
    var type = p.type === "radio" ? "radio" : "checkbox";
    return h("label", { className: cx("bb-choice", p.className) },
      h("input", Object.assign(rest(p, ["label", "hint", "type", "className"]), { type: type })),
      h("span", { className: "bb-choice__text" }, p.label),
      p.hint ? h("span", { className: "bb-choice__hint" }, p.hint) : null
    );
  }

  function Badge(p) {
    var tone = p.tone || "neutral";
    return h("span", Object.assign(rest(p, ["tone", "dot", "className", "children"]), { className: cx("bb-badge", "bb-badge--" + tone, p.className) }),
      p.dot ? h("span", { className: "bb-badge__dot", "aria-hidden": "true" }) : null, p.children);
  }

  function Alert(p) {
    var tone = p.tone || "info";
    var role = tone === "danger" || tone === "warning" ? "alert" : "status";
    return h("div", Object.assign({ role: role }, rest(p, ["tone", "title", "className", "children"]), { className: cx("bb-alert", "bb-alert--" + tone, p.className) }),
      h(Icon, { name: tone, className: "bb-alert__icon" }),
      h("div", null,
        p.title ? h("p", { className: "bb-alert__title" }, p.title) : null,
        p.children ? h("div", { className: "bb-alert__body" }, p.children) : null));
  }

  function Tabs(p) {
    var items = p.items || [];
    var base = useId(p.id);
    var st = R.useState(p.defaultId || (items[0] && items[0].id));
    var active = p.value !== undefined ? p.value : st[0];
    function select(id) { if (p.value === undefined) st[1](id); if (p.onChange) p.onChange(id); }
    function onKey(e) {
      var i = items.findIndex(function (t) { return t.id === active; });
      var next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
      if (next === null) return;
      e.preventDefault();
      next = (next + items.length) % items.length;
      select(items[next].id);
      var el = document.getElementById(base + "-tab-" + items[next].id);
      if (el) el.focus();
    }
    var current = items.find(function (t) { return t.id === active; });
    return h("div", { className: cx("bb-tabs", p.className) },
      h("div", { className: "bb-tabs__list", role: "tablist", "aria-label": p.label, onKeyDown: onKey },
        items.map(function (t) {
          var on = t.id === active;
          return h("button", {
            key: t.id, type: "button", role: "tab", id: base + "-tab-" + t.id, className: "bb-tabs__tab",
            "aria-selected": on ? "true" : "false", "aria-controls": base + "-panel", tabIndex: on ? 0 : -1,
            onClick: function () { select(t.id); }
          }, t.label);
        })),
      h("div", { className: "bb-tabs__panel", role: "tabpanel", id: base + "-panel", "aria-labelledby": current ? base + "-tab-" + current.id : undefined },
        current ? current.content : null));
  }

  function Table(p) {
    var cols = p.columns || [], rows = p.rows || [];
    return h("div", { className: cx("bb-table-wrap", p.className) },
      h("table", { className: "bb-table" },
        p.caption ? h("caption", null, p.caption) : null,
        h("thead", null, h("tr", null, cols.map(function (c) {
          return h("th", { key: c.key, scope: "col", className: c.numeric ? "bb-num" : undefined }, c.label);
        }))),
        h("tbody", null, rows.map(function (r, i) {
          return h("tr", { key: r.id || i }, cols.map(function (c) {
            var v = c.render ? c.render(r) : r[c.key];
            return h("td", { key: c.key, className: c.numeric ? "bb-num" : undefined }, v);
          }));
        }))));
  }

  window.Bluebonnet = { Button: Button, Field: Field, Choice: Choice, Badge: Badge, Alert: Alert, Tabs: Tabs, Table: Table };
})();
