(() => {
  "use strict";

  const PHASES = [
    "2 sets of 3",
    "1 set of 3 + 1 run of 4",
    "1 set of 4 + 1 run of 4",
    "1 run of 7",
    "1 run of 8",
    "1 run of 9",
    "2 sets of 4",
    "7 cards of one color",
    "1 set of 5 + 1 set of 2",
    "1 set of 5 + 1 set of 3",
  ];
  const LAST = PHASES.length;     // 10
  const DONE = LAST + 1;          // 11 = finished phase 10
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 8;
  const KEY = "phase10-tracker-v1";

  const $ = (id) => document.getElementById(id);

  // State: { players: [{name, phase, score}], round, history: [{players, round}] }
  let state = load();

  /* ---------- persistence ---------- */

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s && Array.isArray(s.players) ? s : null;
    } catch {
      return null;
    }
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  /* ---------- helpers ---------- */

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) node.append(c);
    return node;
  }

  function phaseOptions(selected) {
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= LAST; n++) {
      frag.append(el("option", { value: n, text: `Phase ${n}`, ...(n === selected ? { selected: "" } : {}) }));
    }
    return frag;
  }

  function phaseLabel(n) {
    if (n >= DONE) return "Finished";
    return `Phase ${n}`;
  }

  function leaderScore(players) {
    return Math.min(...players.map((p) => p.score));
  }

  function gameOver() {
    return state.players.some((p) => p.phase >= DONE);
  }

  /* ---------- setup ---------- */

  function setupRow(name = "", phase = 1, score = 0) {
    const nameInput = el("input", { type: "text", maxlength: "20", class: "name", placeholder: "Name", value: name, autocomplete: "off" });
    const phaseSelect = el("select", { class: "phase", "aria-label": "Current phase" }, [phaseOptions(phase)]);
    const scoreInput = el("input", { type: "number", class: "score", min: "0", step: "1", value: String(score), "aria-label": "Points so far", inputmode: "numeric" });
    const remove = el("button", { type: "button", class: "remove", title: "Remove player", "aria-label": "Remove player", text: "×", onclick: () => row.remove() });
    const row = el("div", { class: "setup-row" }, [nameInput, phaseSelect, scoreInput, remove]);
    return row;
  }

  function renderSetup(seedPlayers) {
    const rows = $("setup-rows");
    rows.replaceChildren();
    const seed = seedPlayers && seedPlayers.length ? seedPlayers : [{}, {}, {}];
    seed.forEach((p, i) => rows.append(setupRow(p.name ?? "", p.phase ?? 1, p.score ?? 0)));
    updateAddButton();
  }

  function updateAddButton() {
    $("add-player").disabled = $("setup-rows").children.length >= MAX_PLAYERS;
  }

  function startGame() {
    const rows = [...$("setup-rows").children];
    const errorEl = $("setup-error");
    const players = [];

    for (const [i, row] of rows.entries()) {
      const name = row.querySelector(".name").value.trim() || `Player ${i + 1}`;
      const phase = Number(row.querySelector(".phase").value);
      const score = Number(row.querySelector(".score").value || 0);
      if (!Number.isInteger(score) || score < 0) {
        showError(errorEl, "Points so far must be whole numbers, 0 or more.");
        return;
      }
      players.push({ name, phase, score });
    }

    if (players.length < MIN_PLAYERS) {
      showError(errorEl, `Need at least ${MIN_PLAYERS} players.`);
      return;
    }
    const names = players.map((p) => p.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      showError(errorEl, "Each player needs a different name.");
      return;
    }

    errorEl.hidden = true;
    state = { players, round: 1, history: [] };
    save();
    showGame();
  }

  function showError(node, msg) {
    node.textContent = msg;
    node.hidden = false;
  }

  /* ---------- game view ---------- */

  function showSetup() {
    $("game").hidden = true;
    $("setup").hidden = false;
    renderSetup(state ? state.players : null);
  }

  function showGame() {
    $("setup").hidden = true;
    $("game").hidden = false;
    render();
  }

  function render() {
    const over = gameOver();
    $("round-label").textContent = over ? "Game over" : `Round ${state.round}`;

    const banner = $("game-banner");
    if (over) {
      const lead = leaderScore(state.players);
      const winners = state.players.filter((p) => p.score === lead).map((p) => p.name);
      banner.textContent = `${winners.join(" & ")} ${winners.length > 1 ? "tie" : "wins"} with ${lead} points.`;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
    $("end-round").disabled = over;
    $("undo").disabled = state.history.length === 0;

    renderScores();
    renderPhaseRef();
  }

  function renderScores() {
    const tbody = $("score-body");
    tbody.replaceChildren();
    const lead = leaderScore(state.players);
    const highest = Math.max(...state.players.map((p) => p.score));
    // Highlight the leader only once scores differ, so a fresh game has no favourite.
    const showLeader = lead !== highest;

    state.players.forEach((p) => {
      const select = el("select", {
        "aria-label": `${p.name} phase`,
        onchange: (e) => {
          p.phase = Number(e.target.value);
          save();
          render();
        },
      }, [
        ...[...Array(LAST)].map((_, k) => el("option", { value: k + 1, text: `Phase ${k + 1}: ${PHASES[k]}`, ...(k + 1 === p.phase ? { selected: "" } : {}) })),
        el("option", { value: DONE, text: "Finished", ...(p.phase === DONE ? { selected: "" } : {}) }),
      ]);
      const phaseCell = el("td", {}, [select]);

      const tr = el("tr", { class: showLeader && p.score === lead ? "leader" : "" }, [
        el("td", {}, [el("span", { class: "pname", text: p.name })]),
        phaseCell,
        el("td", { class: "num", text: String(p.score) }),
      ]);
      tbody.append(tr);
    });
  }

  function renderPhaseRef() {
    const ol = $("phase-ref");
    ol.replaceChildren();
    PHASES.forEach((desc, idx) => {
      const n = idx + 1;
      const here = state.players.filter((p) => p.phase === n).map((p) => p.name);
      const li = el("li", { class: here.length ? "active" : "" }, [
        el("span", { class: "n", text: String(n) }),
        el("div", {}, [
          el("div", { class: "desc", text: desc }),
          here.length
            ? el("div", { class: "who" }, here.map((name) => el("span", { class: "chip", text: name })))
            : null,
        ].filter(Boolean)),
      ]);
      ol.append(li);
    });
  }

  /* ---------- end of round ---------- */

  function openRoundDialog() {
    if (gameOver()) return;
    $("dialog-round").textContent = `${state.round}`;
    const rows = $("round-rows");
    rows.replaceChildren();

    state.players.forEach((p, i) => {
      const pts = el("input", { type: "number", min: "0", step: "1", value: "0", required: "", "aria-label": `${p.name} points this round`, inputmode: "numeric", name: `pts-${i}` });
      const done = el("input", { type: "checkbox", name: `done-${i}` });
      rows.append(el("div", { class: "round-row" }, [
        el("div", {}, [
          el("div", { class: "rname", text: p.name }),
          el("div", { class: "rphase", text: p.phase >= DONE ? "Finished" : `Phase ${p.phase}: ${PHASES[p.phase - 1]}` }),
        ]),
        pts,
        el("label", { class: "done" }, [
          done,
          document.createTextNode(p.phase >= LAST ? "Completed phase 10 (ends the game)" : `Completed phase ${p.phase}`),
        ]),
      ]));
    });

    $("round-dialog").showModal();
    const firstPts = rows.querySelector("input[type=number]");
    if (firstPts) firstPts.focus();
  }

  function applyRound(form) {
    const snapshot = JSON.parse(JSON.stringify({ players: state.players, round: state.round }));

    state.players.forEach((p, i) => {
      const pts = Number(form.elements[`pts-${i}`].value || 0);
      p.score += pts;
      if (form.elements[`done-${i}`].checked && p.phase < DONE) {
        p.phase += 1;
      }
    });

    state.history.push(snapshot);
    state.round += 1;
    save();
    render();
  }

  function undo() {
    const prev = state.history.pop();
    if (!prev) return;
    state.players = prev.players;
    state.round = prev.round;
    save();
    render();
  }

  /* ---------- wire up ---------- */

  $("add-player").addEventListener("click", () => {
    if ($("setup-rows").children.length < MAX_PLAYERS) {
      $("setup-rows").append(setupRow());
      updateAddButton();
    }
  });

  $("start-game").addEventListener("click", startGame);

  $("end-round").addEventListener("click", openRoundDialog);
  $("round-cancel").addEventListener("click", () => $("round-dialog").close());
  $("round-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    $("round-dialog").close();
    applyRound(form);
  });

  $("undo").addEventListener("click", () => {
    if (confirm("Undo the last round? Points and phases go back to before it.")) undo();
  });

  $("new-game").addEventListener("click", () => {
    if (confirm("Start a new game? The current scores will be cleared.")) {
      state = null;
      localStorage.removeItem(KEY);
      showSetup();
    }
  });

  if (state) showGame();
  else showSetup();
})();
