/* @ds-bundle: {"format":4,"namespace":"CodecLab","components":[{"name":"Panel"},{"name":"TabBar"},{"name":"StageLabel"},{"name":"StatGrid"},{"name":"Legend"},{"name":"LcdScreen"}]} */
/* RPR1 / YLK1 Codec Lab — hand-written from the repository's own CSS.
   The repository ships no component library: these six are the patterns its
   six demo pages repeat, lifted class for class. Sources are named in each
   component's README. */
(function () {
  "use strict";

  var React = window.React;
  var h = React.createElement;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i]) out.push(arguments[i]);
    }
    return out.join(" ");
  }

  /* Panel — the surface every demo section sits on. */
  function Panel(props) {
    var p = props || {};
    return h(
      "div",
      { className: cx("cl-panel", p.flush && "cl-panel--flush", p.className) },
      p.children
    );
  }

  /* TabBar — the shared page switcher from nav.js. */
  function TabBar(props) {
    var p = props || {};
    var items = p.items || [];
    return h(
      "nav",
      { className: cx("cl-tabs", p.className), "aria-label": p.label || "demos" },
      items.map(function (item, i) {
        var current = item.href === p.current || item.label === p.current;
        return h(
          "a",
          {
            key: item.href || item.label || i,
            className: "cl-tabs__tab",
            href: item.href || "#",
            "aria-current": current ? "page" : null,
            onClick: current ? function (e) { e.preventDefault(); } : p.onSelect && function () { p.onSelect(item); }
          },
          h("span", { className: "cl-tabs__label" }, item.label),
          item.note ? h("span", { className: "cl-tabs__note" }, item.note) : null
        );
      })
    );
  }

  /* StageLabel — the numbered pixel-face label above a section. */
  function StageLabel(props) {
    var p = props || {};
    return h(
      "div",
      { className: cx("cl-stage", p.className) },
      p.num != null ? h("span", { className: "cl-stage__num" }, p.num) : null,
      h("span", { className: "cl-stage__text" }, p.children),
      p.hint ? h("span", { className: "cl-stage__hint" }, p.hint) : null
    );
  }

  /* StatGrid — the key / value / note readout grid. */
  function StatGrid(props) {
    var p = props || {};
    var stats = p.stats || [];
    return h(
      "div",
      { className: cx("cl-stats", p.className) },
      stats.map(function (stat, i) {
        return h(
          "div",
          { className: "cl-stats__stat", key: stat.k || i },
          h("div", { className: "cl-stats__k" }, stat.k),
          h(
            "div",
            { className: cx("cl-stats__v", stat.tone && "cl-stats__v--" + stat.tone) },
            stat.v
          ),
          stat.n ? h("div", { className: "cl-stats__n" }, stat.n) : null
        );
      })
    );
  }

  /* Legend — what each colour in a strip, chart or marked text means. */
  function Legend(props) {
    var p = props || {};
    var items = p.items || [];
    return h(
      "div",
      { className: cx("cl-legend", p.className) },
      items.map(function (item, i) {
        var style = {};
        var kind = "";
        if (item.ramp) {
          kind = "cl-legend__swatch--ramp";
          style.background = "linear-gradient(to right, " + item.ramp[0] + ", " + item.ramp[1] + ")";
        } else if (item.marker) {
          kind = "cl-legend__swatch--marker";
          style.boxShadow = "inset 0 -2px " + item.marker;
        } else {
          style.background = item.color;
        }
        return h(
          "span",
          { className: "cl-legend__item", key: item.label || i },
          h("i", { className: cx("cl-legend__swatch", kind), style: style }),
          item.strong ? h("b", null, item.label) : item.label
        );
      })
    );
  }

  /* LcdScreen — the emulator's case, frame and glass around fixed lines of text. */
  function LcdScreen(props) {
    var p = props || {};
    var lines = p.lines || [];
    return h(
      "div",
      { className: cx("cl-lcd", p.className) },
      h(
        "div",
        { className: "cl-lcd__frame" },
        h(
          "div",
          { className: "cl-lcd__glass", style: p.width ? { maxWidth: p.width } : null },
          lines.map(function (line, i) {
            var text = typeof line === "string" ? line : line.text;
            var dim = typeof line === "string" ? false : line.dim;
            return h(
              "div",
              { className: cx("cl-lcd__line", dim && "cl-lcd__line--dim"), key: i },
              text
            );
          }),
          h("div", { className: "cl-lcd__glow" })
        )
      ),
      p.label ? h("div", { className: "cl-lcd__label" }, p.label) : null
    );
  }

  window.CodecLab = {
    Panel: Panel,
    TabBar: TabBar,
    StageLabel: StageLabel,
    StatGrid: StatGrid,
    Legend: Legend,
    LcdScreen: LcdScreen
  };
})();
