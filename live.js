
const DATA = __DATA__;
const P = DATA.P;
const stage = document.querySelector(".eu-stage");
const plate = stage.closest(".iso-plate");
const readout = plate.querySelector("[data-readout]");
const status = stage.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const $ = (sel) => stage.querySelector(sel);

// Two clocks: the source runs about 100,000 times slower than life, the stages about 4 times.
const SRC_PERIOD = 2.0; // display seconds per 20 µs droplet cycle
const STAGE_SLOW = 4;
const SCAN = (FIELD_SCAN_MS / 1000) * STAGE_SLOW; // display seconds per field scan
const STEP = 0.1 * STAGE_SLOW; // display seconds per step between fields
const SWAP = 2.4; // display seconds for the chucks to trade places

const drops = [...stage.querySelectorAll(".eu-drop")];
const laser = $(".eu-laser");
const halo = $(".eu-plasma-halo");
const core = $(".eu-plasma-core");
const pulses = ["src", "ill", "po"].map((id) => stage.querySelector(`[data-pulse="${id}"]`));
const lights = [...stage.querySelectorAll("[data-light]")];
const ifGlow = $(".eu-if");
const amps = [...stage.querySelectorAll("[data-amp]")];
const carriage = $("[data-part=reticle-stage]");
const chucks = { a: $("[data-part=chuck-a]"), b: $("[data-part=chuck-b]") };
const fieldEls = (id) => [...stage.querySelectorAll(`[data-fields="${id}"] .eu-field`)];
const fields = { a: fieldEls("a"), b: fieldEls("b") };
const slit = $("[data-part=slit]");
const rema = ["a", "b"].map((id) => stage.querySelector(`[data-name="illum.rema.${id}"]`));
const poLight = stage.querySelector('[data-light="po"]');
const levelBeams = $("[data-part=level-beams]");
const pulseLengths = pulses.map((p) => p.getTotalLength());
const pulseStarts = pulseLengths.map((_, i) => pulseLengths.slice(0, i).reduce((a, b) => a + b, 0));
const pulseTotal = pulseLengths.reduce((a, b) => a + b, 0);
pulses.forEach((p, i) => { p.style.strokeDasharray = `26 ${pulseLengths[i] + 60}`; });

// ------------------------------------------------------------------ taking it apart
// One spring per assembly (0 home, 1 apart), staggered in DATA.stagger order on the way out and the reverse
// on the way back; every wrapper is moved by its assembly's share and re-sorted by key + lift x share.
const machine = stage.querySelector(".eu-machine");
const nodes = [...machine.children].map((el) => ({ el, piece: el.dataset.piece, key: Number(el.dataset.k), lift: Number(el.dataset.l), shown: "" }));
let order = nodes.map((_, i) => i);
const STAGGER = DATA.stagger;
const SPRING = DATA.spring;
const pieces = Object.fromEntries(Object.keys(DATA.moves).map((id) => [id, { x: 0, v: 0, target: 0, pending: null }]));
const apartButton = document.querySelector("[data-apart]");
let apart = false;
function setApart(on) {
  if (apart === on) return;
  apart = on;
  const goal = on ? 1 : 0;
  let index = 0;
  for (const id of on ? STAGGER : [...STAGGER].reverse()) {
    if (pieces[id].target === goal && !pieces[id].pending) continue;
    if (pieces[id].target === goal) pieces[id].pending = null;
    else pieces[id].pending = { value: goal, at: springClock + (still.matches ? 0 : index++ * SPRING.stagger) };
  }
  apartButton.textContent = on ? "Put together" : "Take apart";
  apartButton.toggleAttribute("data-on", on);
  status.textContent = on ? "taking apart: the machine stops first" : "putting it back together";
  run();
}
function steer(state, dt, calm) {
  if (state.pending && springClock >= state.pending.at) {
    state.target = state.pending.value;
    state.pending = null;
  }
  if (calm) {
    state.x = state.target;
    state.v = 0;
    return false;
  }
  for (let i = 0; i < SPRING.substeps; i++) {
    const h = dt / SPRING.substeps;
    state.v += ((state.target - state.x) * SPRING.stiffness - state.v * SPRING.damping) * h;
    state.x += state.v * h;
  }
  if (Math.abs(state.target - state.x) < 2e-4 && Math.abs(state.v) < 2e-4) {
    state.x = state.target;
    state.v = 0;
    return state.pending !== null;
  }
  return true;
}
function placePieces() {
  for (const node of nodes) {
    const share = pieces[node.piece].x;
    const [mx, my] = DATA.moves[node.piece];
    const text = share === 0 ? "" : `translate(${(mx * share).toFixed(2)} ${(my * share).toFixed(2)})`;
    if (text !== node.shown) {
      node.shown = text;
      if (text) node.el.setAttribute("transform", text);
      else node.el.removeAttribute("transform");
    }
  }
  const next = nodes.map((_, i) => i).sort((a, b) => nodes[a].key + nodes[a].lift * pieces[nodes[a].piece].x - (nodes[b].key + nodes[b].lift * pieces[nodes[b].piece].x));
  if (next.some((index, at) => index !== order[at])) {
    const fragment = document.createDocumentFragment();
    for (const index of next) fragment.appendChild(nodes[index].el);
    machine.appendChild(fragment);
    order = next;
  }
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const burst = (age, rise, fall) => (age <= 0 ? 0 : smooth(0, rise, age) * Math.exp(-Math.max(0, age - rise) / fall));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

const SYSTEMS = ["laser", "tin", "source", "if", "illum", "reticle", "po", "stages", "metro", "vac", "handler", "control"];
const items = Object.fromEntries(SYSTEMS.map((id) => [id, [...stage.querySelectorAll(`.it[data-sys="${id}"]`)]]));
const buttons = [...document.querySelectorAll("[data-pick]")];

// ------------------------------------------------------------------ stage plan: serpentine fields, then a swap
const FIELD_COUNT = DATA.fields.length;
const PER_FIELD = SCAN + STEP;
const WAFER_TIME = FIELD_COUNT * PER_FIELD;
const CYCLE_TIME = WAFER_TIME + SWAP;
const mmU = DATA.wafer.mm;
const half = (FIELD_MM.scan / 2) * mmU;

function exposeAt(t) {
  // Offsets of the exposing chuck (world units) and the reticle, at time t within one wafer.
  const i = Math.min(FIELD_COUNT - 1, Math.floor(t / PER_FIELD));
  const local = t - i * PER_FIELD;
  const f = DATA.fields[i];
  const dir = i % 2 ? -1 : 1;
  const centre = [-f.cx * mmU, -f.cy * mmU];
  if (local < SCAN) {
    const s = local / SCAN; // constant speed under the slit
    const x = centre[0] + dir * half - 2 * dir * half * s;
    return { i, scanning: true, s, x, y: centre[1], ret: -4 * (x - centre[0]) };
  }
  const n = Math.min(FIELD_COUNT - 1, i + 1);
  const g = DATA.fields[n];
  const ndir = n % 2 ? -1 : 1;
  const from = [centre[0] - dir * half, centre[1]];
  const to = [-g.cx * mmU + ndir * half, -g.cy * mmU];
  const e = ease((local - SCAN) / STEP);
  return { i, scanning: false, s: 1, x: from[0] + (to[0] - from[0]) * e, y: from[1] + (to[1] - from[1]) * e, ret: 4 * dir * half };
}
function measureAt(t) {
  // The measuring chuck rasters its wafer under the level sensor in the same time.
  const rows = 9;
  const u = Math.min(1, t / WAFER_TIME) * rows;
  const row = Math.min(rows - 1, Math.floor(u));
  const s = u - row;
  const span = 26;
  const x = (row % 2 ? 1 : -1) * span * (1 - 2 * ease(s));
  const y = -26 + (52 * (row + ease(Math.max(0, s - 0.85) / 0.15))) / rows;
  return { x, y, frac: Math.min(1, t / WAFER_TIME) };
}

// ------------------------------------------------------------------ selection and tour
let picked = null;
let touring = true;
let quietTimer = 0;
function pick(id, { fromUser = false } = {}) {
  if (picked === id) return;
  if (picked) for (const el of items[picked]) el.removeAttribute("data-on");
  picked = id;
  if (id) {
    for (const el of items[id]) el.setAttribute("data-on", "");
    stage.setAttribute("data-focus", id);
  } else stage.removeAttribute("data-focus");
  for (const b of buttons) b.toggleAttribute("data-on", b.dataset.pick === id);
  if (fromUser && id) status.textContent = NAMES[id];
}
const NAMES = {
  laser: "Drive laser", tin: "Tin droplets", source: "Source and collector", if: "Intermediate focus", illum: "Illuminator",
  reticle: "Reticle stage", po: "Projection optics", stages: "Wafer stages", metro: "Metrology", vac: "Vacuum and hydrogen", handler: "Handlers", control: "Control racks",
};
function hold() {
  touring = false;
  clearTimeout(quietTimer);
  quietTimer = setTimeout(() => { touring = true; tourClock = 0; }, 3600);
}
stage.addEventListener("pointerover", (e) => {
  const it = e.target.closest(".it[data-sys]");
  const id = it && SYSTEMS.includes(it.dataset.sys) ? it.dataset.sys : null;
  if (id) { hold(); pick(id, { fromUser: true }); }
});
stage.addEventListener("pointerleave", () => { hold(); });
for (const b of buttons) {
  b.addEventListener("pointerenter", () => { hold(); pick(b.dataset.pick, { fromUser: true }); });
  b.addEventListener("focus", () => { hold(); pick(b.dataset.pick, { fromUser: true }); });
  b.addEventListener("click", () => { hold(); pick(b.dataset.pick, { fromUser: true }); });
}
let paused = false;
stage.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const i = picked ? SYSTEMS.indexOf(picked) : -1;
    const n = (i + (e.key === "ArrowRight" ? 1 : SYSTEMS.length - 1) + (i < 0 && e.key === "ArrowLeft" ? 1 : 0)) % SYSTEMS.length;
    hold();
    pick(SYSTEMS[n], { fromUser: true });
    e.preventDefault();
  } else if (e.key === " " || e.key === "Enter") {
    hold();
    tourOpened = false;
    setApart(!apart);
    e.preventDefault();
  } else if (e.key === "p" || e.key === "P") {
    paused = !paused;
    status.textContent = paused ? "paused" : "running";
    hold();
    run();
  } else if (e.key === "Escape") {
    hold();
    pick(null);
  }
});
stage.addEventListener("focus", () => { status.textContent = picked ? NAMES[picked] : apart ? "apart" : "running"; });
apartButton.addEventListener("click", () => { hold(); tourOpened = false; setApart(!apart); });

// ------------------------------------------------------------------ the frame
// start part way through a wafer (or at ?t=seconds, for checking a moment)
const startAt = Number(new URLSearchParams(location.search).get("t"));
let clock = Number.isFinite(startAt) && startAt > 0 ? startAt : 0.4 * (DATA.fields.length * ((FIELD_SCAN_MS / 1000) * STAGE_SLOW + 0.1 * STAGE_SLOW));
let srcClock = 0;
let tourClock = 0;
let springClock = 0;
let power = 1;
let tourOpened = false;
const TOUR_STEP = 4.5;
const fmt1 = (v, d = 0) => fmt(v, d);

function readoutFor(id, src, exp, meas, field, swapping) {
  const phase = src.phase < CYCLE.main ? (src.phase < 0.02 ? "pre-pulse" : "disc forming") : src.phase < CYCLE.main + 0.06 ? "main pulse · plasma" : "next droplet";
  const scan = swapping ? "chucks swapping" : `field ${field} of ${FIELD_COUNT}`;
  switch (id) {
    case "laser": return `CO2 ${CO2_UM} µm · ${fmt1(PULSE_J, 1)} J a pulse · ${LASER_KW} kW`;
    case "tin": return `droplet ${DROPLET_UM} µm · ${fmt1(SPACING_MM, 1)} mm apart · ${DROPLET_MS} m/s`;
    case "source": return `${phase} · ${fmt1(EUV_MJ)} mJ of 13.5 nm per pulse`;
    case "if": return `${P_IF} W of 13.5 nm at the focus`;
    case "illum": return `${ILLUMINATOR.length} mirrors · ${fmt1(P_RETICLE)} W reaches the mask`;
    case "reticle": return `reticle ${exp.dirSign > 0 ? "→" : "←"} ${fmt1(RETICLE_SPEED, 2)} m/s · 4× the wafer`;
    case "po": return `6 mirrors · 4:1 · NA ${NA} · ${fmt1(P_WAFER, 1)} W on the wafer`;
    case "stages": return `${scan} · wafer ${exp.dirSign > 0 ? "←" : "→"} ${fmt1(WAFER_SPEED, 2)} m/s`;
    case "metro": return `next wafer · height map ${Math.round(meas.frac * 100)}%`;
    case "vac": return "vacuum · a few Pa of H2 keeps tin off the optics";
    case "control": return `dose loop · ${fmt1(PULSES_PER_FIELD)} pulses a field`;
    case "handler": return `${WPH} wafers an hour · one every ${fmt1(3600 / WPH, 1)} s`;
    default: return `${scan} · ${phase}`;
  }
}

let last = 0;
let frame = 0;
let visible = false;
function tick(now) {
  const real = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (touring && !calm) {
    // the tour visits every subsystem, rests on the whole machine, then takes it apart once
    tourClock += real;
    const n = Math.floor(tourClock / TOUR_STEP) % (SYSTEMS.length + 2);
    pick(n < SYSTEMS.length ? SYSTEMS[n] : null);
    // the tour only closes what it opened: a machine the reader took apart stays apart
    if (n === SYSTEMS.length + 1 && !apart) { setApart(true); tourOpened = true; }
    else if (n !== SYSTEMS.length + 1 && tourOpened) { setApart(false); tourOpened = false; }
  }
  // springs run on real time, so they can move while the machine is paused or stopped
  springClock += real;
  let moving = false;
  for (const id of Object.keys(pieces)) if (steer(pieces[id], real, calm)) moving = true;
  placePieces();
  // armed: the machine only runs while every assembly is home; it slows to a stop before anything moves
  const home = Object.values(pieces).every((s) => s.x < 0.002 && s.target === 0 && !s.pending);
  power = calm ? (home ? 1 : 0) : power + ((home ? 1 : 0) - power) * (1 - Math.exp(-real / 0.25));
  if (power < 1e-3) power = 0;
  const dt = paused || calm ? 0 : real * power;
  clock += dt;
  srcClock += dt;

  // source: droplets march in; the one at the focus is flattened, then flashed to plasma
  const cycles = calm ? 0.35 : srcClock / SRC_PERIOD;
  const phase = cycles - Math.floor(cycles);
  const SP = 10;
  drops.forEach((el, i) => {
    const age = phase + i; // droplets waiting upstream
    let y = DATA.drop.y + (phase - i) * SP;
    if (i === 0 && phase > 0) y = DATA.drop.y; // the one being hit stays at the focus
    let rx = 1.1, ry = 1.1, op = 1;
    if (i === 0) {
      const g = smooth(0, CYCLE.main, phase);
      rx = 1.1 + 2.6 * g;
      ry = 1.1 - 0.75 * g;
      op = phase < CYCLE.main ? 1 : 0;
    }
    if (y < DATA.drop.y0) op = 0;
    const [sx, sy] = iso([DATA.drop.x, y, DATA.drop.z], P);
    el.setAttribute("cx", sx.toFixed(2));
    el.setAttribute("cy", sy.toFixed(2));
    el.setAttribute("rx", (rx * 1.2).toFixed(2));
    el.setAttribute("ry", (ry * 1.2).toFixed(2));
    el.setAttribute("opacity", op);
  });
  const ageSec = phase * SRC_PERIOD;
  const mainAge = (phase - CYCLE.main) * SRC_PERIOD;
  const pre = calm ? 0 : burst(ageSec, 0.04, 0.08) * 0.55 * power;
  const main = calm ? 0 : burst(mainAge, 0.05, 0.12) * power;
  const plasma = calm ? 0 : burst(mainAge - 0.02, 0.06, 0.32) * power;
  laser.style.opacity = Math.max(pre, main).toFixed(3);
  for (const a of amps) a.style.fillOpacity = (0.12 + 0.75 * Math.max(pre, main)).toFixed(3);
  halo.style.opacity = plasma.toFixed(3);
  core.style.opacity = Math.min(1, plasma * 1.4).toFixed(3);
  halo.setAttribute("r", (10 + 14 * plasma).toFixed(2));
  // the 13.5 nm burst runs down the light path
  const travel = calm ? 0 : smooth(0, 1.1, mainAge);
  const pulseOn = calm ? 0 : smooth(0, 0.08, mainAge) * (1 - smooth(0.95, 1.25, mainAge));
  pulses.forEach((p, i) => {
    p.style.opacity = (0.9 * pulseOn * power).toFixed(3);
    p.style.strokeDashoffset = (pulseStarts[i] - travel * pulseTotal).toFixed(1);
  });
  for (const l of lights) if (l !== poLight) l.style.opacity = ((0.7 + 0.3 * plasma) * power).toFixed(3);
  ifGlow.style.opacity = ((0.45 + 0.55 * burst(mainAge - 0.08, 0.06, 0.3)) * power).toFixed(3);

  // stages: one wafer of fields, then the chucks trade places
  const t = calm ? WAFER_TIME * 0.45 : clock % CYCLE_TIME;
  const turn = Math.floor((calm ? 0 : clock) / CYCLE_TIME) % 2; // which chuck is under the lens
  const expose = turn ? "b" : "a";
  const measure = turn ? "a" : "b";
  let swapping = false;
  let exp;
  let meas;
  let homeX = { a: 0, b: 0 }; // chuck a rests under the lens, b under the bridge
  const dx = DATA.wafer.meas - DATA.wafer.x;
  if (t < WAFER_TIME) {
    exp = exposeAt(t);
    meas = measureAt(t);
  } else {
    swapping = true;
    exp = exposeAt(WAFER_TIME - 1e-3);
    meas = measureAt(WAFER_TIME);
  }
  exp.dirSign = exp.scanning ? (exp.i % 2 ? -1 : 1) : 0;
  // each chuck is drawn at its home (a under the lens, b under the bridge) and moved to where it is now
  const homeOf = { a: 0, b: dx };
  const place = (id, x, y) => chucks[id].setAttribute("transform", translateAlong(P, [x - homeOf[id], y, 0]));
  if (!swapping) {
    place(expose, exp.x, exp.y);
    place(measure, dx + meas.x, meas.y);
  } else {
    // the exposed wafer leaves for the bridge along the front lane, the measured one comes in behind it
    const s = ease((t - WAFER_TIME) / SWAP);
    const lane = Math.sin(Math.PI * s) * 30;
    place(expose, exp.x + (dx - exp.x) * s, exp.y * (1 - s) + lane);
    place(measure, dx + meas.x - (dx + meas.x) * s, meas.y * (1 - s) - lane);
    if (chucks[expose].parentNode.lastElementChild !== chucks[expose] && chucks[measure].nextElementSibling !== chucks[expose]) chucks[measure].after(chucks[expose]);
  }
  carriage.setAttribute("transform", translateAlong(P, [exp.ret, 0, 0]));
  // masking blades: open for the scan, shut while the stage steps so no light reaches the next field early
  const local = swapping ? STEP : (t % PER_FIELD);
  const shut = swapping ? 1 : 1 - smooth(0, 0.06, local) * (1 - smooth(SCAN - 0.06, SCAN, local));
  rema[0].setAttribute("transform", translateAlong(P, [2.4 * shut, 0, 0]));
  rema[1].setAttribute("transform", translateAlong(P, [-2.4 * shut, 0, 0]));
  poLight.style.opacity = ((0.7 + 0.3 * plasma) * (1 - 0.85 * shut) * power).toFixed(3);
  slit.style.opacity = ((1 - shut) * power).toFixed(3);
  // the level sensor goes dark while the chucks trade places, and lights again on the new wafer
  levelBeams.style.opacity = ((swapping ? 1 - Math.sin(Math.PI * Math.min(1, (t - WAFER_TIME) / SWAP)) : 1) * power).toFixed(3);

  // fields: done, now, waiting
  const fe = fields[expose];
  const fm = fields[measure];
  for (let i = 0; i < fe.length; i++) {
    const el = fe[i];
    const done = swapping || i < exp.i || (i === exp.i && !exp.scanning);
    el.toggleAttribute("data-done", done);
    el.toggleAttribute("data-now", !swapping && i === exp.i && exp.scanning);
    el.removeAttribute("data-measured");
  }
  for (let i = 0; i < fm.length; i++) {
    const el = fm[i];
    el.removeAttribute("data-done");
    el.removeAttribute("data-now");
    el.toggleAttribute("data-measured", i / fm.length < meas.frac);
  }

  const src = { phase };
  const moved = Object.values(pieces).filter((s) => s.x > 0.5).length;
  readout.textContent = moving
    ? apart ? "taking apart" : "closing up · arming"
    : !home ? (picked ? readoutFor(picked, src, exp, meas, exp.i + 1, swapping) + " · stopped" : `apart · ${moved} assemblies off · stopped`)
    : readoutFor(picked, src, exp, meas, exp.i + 1, swapping);
  frame = visible && ((!paused && !calm) || moving) ? requestAnimationFrame(tick) : 0;
}
function run() {
  if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); }
}
new IntersectionObserver((entries) => {
  visible = entries[entries.length - 1].isIntersecting;
  if (visible) run();
}, { rootMargin: "120px 0px" }).observe(stage);
still.addEventListener("change", () => { last = 0; frame = 0; run(); });
