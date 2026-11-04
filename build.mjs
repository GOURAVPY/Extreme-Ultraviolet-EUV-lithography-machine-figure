import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./kit/iso-kit.mjs";
import * as G from "./kit/lathe.mjs";
import { tubePieces, tubeSvg } from "./kit/tube.mjs";
import * as A from "./kit/audit.mjs";
import * as M from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = process.argv.includes("--light") ? "light" : "dark";
const strip = (file) => readFileSync(join(HERE, file), "utf8").replace(/^import .*$/gm, "").replace(/^export /gm, "");

const W = 1200;
const H = 1000;
const AZIMUTH = 58;
const ELEVATION = 28;

// World: about 5 mm per unit at the wafer, z up, fab floor at z = 0, subfab floor at z = -130.
// The light runs in the plane y = Y0; every housing has its front panel off (y = its front face).
const Y0 = -35;
const FAB = { x: -490, y: -125, w: 1140, d: 170, r: 4 };
const SUB = { x: -490, y: -125, w: 1140, d: 245, r: 6 };
const SUB_Z = -130;
const LAS_Y = 82; // drive laser beam line in the subfab
const LAS_Z = -98;

// Housings [x0, x1, y0, y1, z0, z1]
const VESSEL = [-262, -140, -100, 25, 0, 146];
const ILLUM = [-235, 94, -85, 0, 146, 324];
const PO = [96, 205, -85, 0, 86, 324];
const BASE = { x: 96, y: -100, w: 234, d: 127, r: 3 };
const BASE_H = 26;

// The light path in the plane y = Y0: [x, z] of every optical surface, source to wafer.
const PL = [-200, 60]; // primary focus: droplet meets laser
const IFP = [-200, 150]; // intermediate focus
const WZ = BASE_H + 27.5; // wafer top
const RZ = 324.7; // reticle face, patterned side down
const RX = 95;
const CR = (M.CHIEF_RAY_DEG * Math.PI) / 180;
const LEG = 139.4; // reticle to grazing mirror and to M1
const OPT = [
  { id: "ffm", at: [-175, 295], r: 16, t: 5, w: 11, sys: "illum", label: "Field facet mirror" },
  { id: "pfm", at: [-70, 180], r: 14, t: 5, w: 9, sys: "illum", label: "Pupil facet mirror" },
  { id: "mc", at: [45, 160], r: 10, t: 4, w: 6, sys: "illum", label: "Condenser mirror" },
  { id: "mg", at: [RX - LEG * Math.sin(CR), RZ - LEG * Math.cos(CR)], r: 7, t: 3, w: 4, sys: "illum", label: "Grazing mirror" },
  { id: "ret", at: [RX, RZ], r: 0, w: 1, sys: "reticle" },
  { id: "m1", at: [RX + LEG * Math.sin(CR), RZ - LEG * Math.cos(CR)], r: 7, t: 4, w: 4.5, sys: "po" },
  { id: "m2", at: [170, 285], r: 9, t: 4, w: 6, sys: "po" },
  { id: "m3", at: [150, 162], r: 7, t: 4, w: 4, sys: "po" },
  { id: "m4", at: [190, 207], r: 10, t: 4, w: 7, sys: "po" },
  { id: "m5", at: [178, 100], r: 8, t: 4, w: 6, sys: "po" },
  { id: "m6", at: [140, WZ + 86], r: 30, t: 6, w: 27, sys: "po" },
  { id: "wafer", at: [140, WZ], r: 0, w: 0.3, sys: "stages" },
];
const WX = 140;
const MEAS_X = 270;

const P = k.fitProjection(
  [...k.boxCorners(SUB, SUB_Z - 10, SUB_Z), ...k.boxCorners(FAB, -10, 0), [-262, -100, 146], [-235, -85, 324], [205, -85, 350], [205, 0, 350], [400, 30, 120], [400, -100, 120],
    // the apart pose: illuminator up 40, reticle stage up 55
    [-235, -85, 368], [-235, 0, 368], [94, -85, 368], [30, -85, 402], [205, -85, 402], [30, 0, 402], [205, 0, 402],
    // the outside: service platform and railings, top tier, ports, duct and the right-hand module
    [-484, -118, 292], [-484, 22, 292], [-262, -119, 488], [-70, -118, 488], [70, -118, 488], [-330, -51, 448], [500, -51, 448], [650, 10, 160], [631, -119, 422], [631, 21, 422], [631, 21, 0]],
  W,
  H,
  { pad: 26, azimuth: AZIMUTH, elevation: ELEVATION },
);
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const f2 = (v) => Math.round(v * 100) / 100;
const xz = ([x, z], y = Y0) => [x, y, z];

// Taking it apart: the reticle stage lifts off first, then the illuminator and the projection optics rise off
// their columns and frame, the metrology bridge lifts off its posts, and the source chamber slides out to the left.
// The floors, the laser in the subfab, the stage base and its chucks, the frames and the racks stay put.
const PIECES = { stand: [0, 0, 0], reticle: [0, 0, 55], illum: [0, 0, 40], po: [0, 0, 25], metro: [0, 0, 30], source: [-32, 0, 0] };
const STAGGER = ["reticle", "illum", "po", "metro", "source"];
const SPRING = { stagger: 0.035, stiffness: 64, damping: 14.2, substeps: 4 };
function pieceOf(name) {
  if (/^(po\.(leg|airmount|crossbeam)|metro\.leg|illum\.column)/.test(name)) return "stand";
  if (/^reticle\./.test(name)) return "reticle";
  if (/^(illum\.|if\.|vac\.turbo\.illum)/.test(name)) return "illum";
  if (/^(po\.|stages\.grid|handler\.reticle)/.test(name)) return "po";
  if (/^metro\./.test(name)) return "metro";
  if (/^(vessel\.|collector|final\.focus|tin\.|source\.|vac\.(h2\.line|h2\.inlet|turbo\.source|foreline\.source|floor\.port))/.test(name)) return "source";
  return "stand";
}

const R = A.recorder(P, { order: STAGGER, spring: SPRING });
const record = R.solid;
let SYS = "frame";
function put(name, ref, svg, shapes = [], { bias = 0, sys = SYS, ...rest } = {}) {
  const piece = pieceOf(name);
  return R.put({ name, at: ref, where: ref, bias, svg, shapes, piece, move: PIECES[piece], sys, ...rest });
}
function box(name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.6, steps = 2, bevel = 0, extra = "", inner = "", bias = 0, ground = false, sys, owner } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const shape = record(A.slab(plan, z0, z1 - z0, { name, ...(ground ? { ground: true } : {}), ...(owner ? { owner } : {}) }, steps));
  put(name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, sys });
  return shape;
}
function turned(name, F, profile, style = {}, { extra = "", inner = "", bias = 0, smooth, steps, rims, bevel = 0, owner, sys, hole } = {}) {
  const opts = { bevel, ...(smooth !== undefined ? { smooth } : {}), ...(steps ? { steps } : {}), ...(rims ? { rims } : {}) };
  const paths = G.solidOf(profile, F, P, opts);
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  const shape = record(A.solid(F, profile, { name, owner }));
  put(name, G.add3(F.o, G.mul3(F.a, mid)), S(paths, { tone: "mid", ...style, inner }) + extra, [shape], { bias, sys });
  return shape;
}
const disc = (name, F, s0, s1, r, style = {}, options = {}) => turned(name, F, [[s0, r], [s1, r]], style, options);
function ball(name, c, r, style = {}, { bias = 0, extra = "", sys } = {}) {
  const shape = record(A.ball(c, r, { name }));
  put(name, c, S(G.sphereOf(c, r, P, { steps: 32 }), { tone: "mid", ...style }) + extra, [shape], { bias, sys });
  return shape;
}
const zF = (x, y, z) => G.frameOf([x, y, z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const yF = (x, y, z) => G.frameOf([x, y, z], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
const xF = (x, y, z) => G.frameOf([x, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);

const PIPES = [];
const ARM_X = [];
// Looked at 8x: the floor slab counts as a rod, but these lines end on blocks standing well inside it.
// The manifold risers stand on valves on the manifold block, so their feet sit on its outline and the floor's by design.
// The tray cables lie between the tray's rails, and the hose loops hang behind the bay's X braces and posts: looked at 4x.
// The first water riser segment ends on its valve just above the floor's front edge.
const CROWD_OK = [["vac.h2.line", "stand.fab"], ["cool.left.riser*", "stand.fab"], ["cool.left.riser*", "cool.left.manifold"],
  ["power.tray.cable*", "power.tray.rail"], ["cool.loop*", "cool.bay.brace"], ["cool.loop*", "deck.right.post"], ["cool.right.header*", "stand.fab"]];
function pipe(name, points, r, { tone = "mid", bend = 0, flanges = [true, true], maxLength = 18, rings, limp = false, bias = 0.02, sys, free = [false, false], bundle, className } = {}) {
  const route = G.fillet(points, Math.max(bend || r * 2.6, 3), 10, { P, tube: r });
  const total = G.pathLength(route);
  const FL = Math.max(1.2, r * 0.6);
  const gaps = [...(flanges[0] ? [[0, FL]] : []), ...(flanges[1] ? [[total - FL, total]] : [])];
  const piece = pieceOf(name);
  R.route(name, route, r, { gaps, limp, piece, move: PIECES[piece], free, ...(bundle ? { bundle } : {}) });
  PIPES.push(name);
  const skin = (svg) => (className ? `<g class="${className}">${svg}</g>` : svg);
  tubePieces(route, r, P, { maxLength, spacing: Math.max(0.6, Math.min(1.6, r)), gaps, ...(rings ? { rings } : {}) }).forEach((piece, index) =>
    put(`${name}:${index}`, piece.mid, skin(tubeSvg(piece, { tone })), [A.tube(piece.points, piece.radii, bundle ? { bundle } : {})], { bias, sys, route: name }),
  );
  [0, 1].forEach((end) => {
    if (!flanges[end]) return;
    const p = end ? route[route.length - 1] : route[0];
    const tangent = G.tangentAlong(route, end ? total : 0);
    const F = G.frameAlong(p, tangent);
    const [s0, s1] = end ? [-FL, 0] : [0, FL];
    const shape = record(A.disc(F, s0, s1, r * 1.7, { name: `${name}.flange${end}`, owner: name }));
    const face = G.dot3(tangent, V) * (end ? 1 : -1) > 0.12 ? Dots(G.dotsOf(F, end ? 0 : 0, r * 1.35, 6, P, { all: true }), { size: 0.35, tone: "lo" }) : "";
    put(`${name}.flange${end}`, G.add3(p, G.mul3(tangent, (s0 + s1) / 2)), S(G.disc(s0, s1, r * 1.7, F, P, { steps: 28 }), { tone: "mid" }) + face, [shape], { bias: bias + 0.1, sys });
  });
  return route;
}

const back = [];
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

// ---------------------------------------------------------------- building: subfab floor, pedestals, fab floor
back.push(`<path class="iso-halo" d="${k.haloOf(SUB, SUB_Z - 10, 10, P)}"/>`);
back.push(S(k.slabOf(SUB, SUB_Z - 10, 10, P, 6, 1.2), { tone: "lo", inner: Ln(k.sideSeam(SUB, SUB_Z - 4, P, 6), { tone: "faint" }) }));
back.push(Ln(k.planOutline(k.insetPlan(SUB, 5), SUB_Z, P), { tone: "faint" }));
record(A.slab(SUB, SUB_Z - 10, 10, { name: "stand.subfab", ground: true }, 6));
SYS = "frame";
for (const x of [-460, -370, -280, -160, -40, 80, 200, 320, 400, 500, 620]) {
  disc("stand.pedestal", zF(x, 33, SUB_Z), 0, 3, 5, { tone: "lo" });
  disc("stand.pedestal", zF(x, 33, SUB_Z), 3, 120, 2.6, { tone: "mid" }, { inner: Ln(G.arcOf(zF(x, 33, SUB_Z), 60, 2.6, P), { tone: "faint" }) });
}
box("stand.fab", [FAB.x, FAB.y, -10], [FAB.x + FAB.w, FAB.y + FAB.d, 0], { tone: "mid" }, { r: 4, steps: 6, bevel: 1, ground: true,
  inner: Ln(k.sideSeam(FAB, -4, P, 6), { tone: "faint" }),
  extra: Ln(
    [
      ...Array.from({ length: Math.floor(FAB.w / 20) - 1 }, (_, i) => path3([[FAB.x + 20 + i * 20, FAB.y, 0], [FAB.x + 20 + i * 20, FAB.y + FAB.d, 0]])),
      ...Array.from({ length: 7 }, (_, i) => path3([[FAB.x, FAB.y + 25 + i * 20, 0], [FAB.x + FAB.w, FAB.y + 25 + i * 20, 0]])),
    ].join(""),
    { tone: "faint" },
  ) +
  // every other raised-floor tile is perforated, as in the fab: the clean air falls through them to the subfab
  Dots(Array.from({ length: (Math.floor(FAB.w / 20) - 2) * 6 }, (_, n) => [FAB.x + 30 + (n % (Math.floor(FAB.w / 20) - 2)) * 20, FAB.y + 35 + Math.floor(n / (Math.floor(FAB.w / 20) - 2)) * 20])
    .filter(([x, y]) => (Math.round((x - FAB.x - 30) / 20) + Math.round((y - FAB.y - 35) / 20)) % 2 === 0)
    .flatMap(([x, y]) => [-5, 0, 5].flatMap((dx) => [-5, 0, 5].map((dy) => at([x + dx, y + dy, 0])))), { size: 0.45, tone: "faint" }),
});

// ---------------------------------------------------------------- 01 drive laser in the subfab
SYS = "laser";
const AMP = [
  { id: "seed", x0: 262, x1: 318, h: 36, label: "seed" },
  { id: "pa1", x0: 172, x1: 244, h: 44 },
  { id: "pa2", x0: 82, x1: 154, h: 44 },
  { id: "pa3", x0: -8, x1: 64, h: 44 },
  { id: "pa4", x0: -98, x1: -26, h: 44 },
];
const ampFoot = (a) => ({ x: a.x0, y: LAS_Y - 22, w: a.x1 - a.x0, d: 44, r: 2 });
for (const a of AMP) {
  const plan = ampFoot(a);
  const z0 = SUB_Z + 4;
  for (const [x, y] of k.corners(plan, 5)) box(`laser.${a.id}.foot`, [x - 3, y - 3, SUB_Z], [x + 3, y + 3, z0], { tone: "lo" }, { sys: "laser" });
  // cooling vents on the front face: closed slots, so they have no loose ends
  const yf = plan.y + plan.d + 0.05;
  const ribs = Array.from({ length: Math.floor((a.x1 - a.x0 - 12) / 6) }, (_, i) => path3([[a.x0 + 7 + i * 6, yf, z0 + 6], [a.x0 + 9 + i * 6, yf, z0 + 6], [a.x0 + 9 + i * 6, yf, z0 + a.h - 20], [a.x0 + 7 + i * 6, yf, z0 + a.h - 20]], true));
  box(`laser.${a.id}`, [a.x0, plan.y, z0], [a.x1, plan.y + plan.d, z0 + a.h], { tone: a.id === "seed" ? "hi" : "mid" }, {
    r: 2,
    steps: 3,
    bevel: 0.6,
    inner: Ln(k.sideSeam(plan, z0 + a.h - 4, P, 3), { tone: "faint" }),
    extra: (a.id === "seed" ? "" : Ln(ribs.join(""), { tone: "faint" })) + Dots(k.corners(plan, 2.4).map(([x, y]) => at([x, y, z0 + a.h])), { size: 0.45 }),
  });
  if (a.id !== "seed") {
    // two radial blowers on top drive the CO2 gas through the discharge tubes
    for (const bx of [a.x0 + 18, a.x1 - 18]) {
      const F = zF(bx, LAS_Y - 4, z0 + a.h);
      turned(`laser.${a.id}.blower`, F, [[0, 11], [3, 11], [9, 9, 1], [12, 5, 1], [13, 0]], { tone: "hi" }, { inner: Ln(G.arcOf(F, 3, 11, P), { tone: "faint" }) });
    }
    // RF window on the front: a closed slot
    put(`laser.${a.id}.window`, [(a.x0 + a.x1) / 2, plan.y + plan.d, z0 + a.h / 2], `<path class="eu-glow-slot" data-amp="${a.id}" d="${path3([[a.x0 + 10, plan.y + plan.d + 0.05, z0 + a.h - 15], [a.x1 - 10, plan.y + plan.d + 0.05, z0 + a.h - 15], [a.x1 - 10, plan.y + plan.d + 0.05, z0 + a.h - 11], [a.x0 + 10, plan.y + plan.d + 0.05, z0 + a.h - 11]], true)}"/>`, [record(A.box([a.x0 + 10, plan.y + plan.d, z0 + a.h - 15], [a.x1 - 10, plan.y + plan.d + 0.1, z0 + a.h - 11], { name: `laser.${a.id}.window` }))], { bias: 0.2 });
  } else {
    put("laser.seed.panel", [290, plan.y + plan.d, z0 + 15], `<path class="eu-glow-slot" data-amp="seed" d="${path3([[268, plan.y + plan.d + 0.05, z0 + 18], [278, plan.y + plan.d + 0.05, z0 + 18], [278, plan.y + plan.d + 0.05, z0 + 22], [268, plan.y + plan.d + 0.05, z0 + 22]], true)}"/>` + Dots([at([284, plan.y + plan.d + 0.05, z0 + 20]), at([289, plan.y + plan.d + 0.05, z0 + 20]), at([294, plan.y + plan.d + 0.05, z0 + 20])], { size: 0.7, tone: "hi" }), [record(A.box([268, plan.y + plan.d, z0 + 18], [296, plan.y + plan.d + 0.1, z0 + 22], { name: "laser.seed.panel" }))], { bias: 0.2 });
  }
}
{
  const seed = AMP[0];
  const top = SUB_Z + 4 + seed.h;
  const plan = { x: seed.x0 + 10, y: LAS_Y - 14, w: 30, d: 20, r: 1.2 };
  box("laser.prepulse", [plan.x, plan.y, top], [plan.x + plan.w, plan.y + plan.d, top + 9], { tone: "hi" }, { sys: "laser", r: 1.2, steps: 3, bevel: 0.4,
    inner: Ln(k.sideSeam(plan, top + 4, P, 3), { tone: "faint" }),
    extra: Dots(k.corners(plan, 2).map(([x, y]) => at([x, y, top + 9])), { size: 0.4 }) });
}
// Beam tubes between the stages, at the beam height, then to the turning box under the source.
for (let i = 0; i < AMP.length - 1; i++) pipe(`laser.tube.${i}`, [[AMP[i].x0, LAS_Y, LAS_Z], [AMP[i + 1].x1, LAS_Y, LAS_Z]], 3, { sys: "laser", tone: "mid" });
const TURN = { x: -200, y: LAS_Y, z: LAS_Z };
box("laser.turn", [TURN.x - 7, TURN.y - 7, TURN.z - 7], [TURN.x + 7, TURN.y + 7, TURN.z + 7], { tone: "hi" }, { r: 1, bevel: 0.4, extra: Dots([[-5, -5], [5, -5], [-5, 5], [5, 5]].map(([dx, dy]) => at([TURN.x + dx, TURN.y + dy, TURN.z + 7])), { size: 0.4 }) });
for (const [x, y] of [[TURN.x - 4, TURN.y - 4], [TURN.x + 4, TURN.y - 4], [TURN.x - 4, TURN.y + 4], [TURN.x + 4, TURN.y + 4]]) box("laser.turn.leg", [x - 1.2, y - 1.2, SUB_Z], [x + 1.2, y + 1.2, TURN.z - 7], { tone: "lo" });
pipe("laser.tube.out", [[AMP[4].x0, LAS_Y, LAS_Z], [TURN.x + 7, LAS_Y, LAS_Z]], 3, { sys: "laser" });
// From the turning box under the floor and up through it into the source vessel.
pipe("laser.riser", [[TURN.x, TURN.y - 7, LAS_Z], [TURN.x, Y0, LAS_Z], [TURN.x, Y0, -10]], 3.4, { sys: "laser", bend: 10 });

// ---------------------------------------------------------------- housings with their front panels off
function housing(id, [x0, x1, y0, y1, z0, z1], { t = 4, bar = 10, sys, right = "full", left = "full", floor = true } = {}) {
  if (floor) box(`${id}.floor`, [x0, y0, z0], [x1, y1, z0 + t], { tone: "lo" }, { sys, r: 1 });
  box(`${id}.back`, [x0, y0, z0 + t], [x1, y0 + t, z1 - t], { tone: "mid" }, { sys, r: 0.4, bias: -1 });
  if (left === "full") box(`${id}.left`, [x0, y0 + t, z0 + t], [x0 + t, y1, z1 - t], { tone: "mid" }, { sys, r: 0.4 });
  if (right === "full") box(`${id}.right`, [x1 - t, y0 + t, z0 + t], [x1, y1, z1 - t], { tone: "mid" }, { sys, r: 0.4 });
  else {
    box(`${id}.post`, [x1 - t, y0 + t, z0 + t], [x1, y0 + 2 * t, z1 - t], { tone: "mid" }, { sys, r: 0.4 });
  }
  if (right !== "full") box(`${id}.post`, [x1 - t, y1 - t, z0 + t], [x1, y1, z1 - t], { tone: "mid" }, { sys, r: 0.4 });
  if (left !== "full") box(`${id}.post`, [x0, y1 - t, z0 + t], [x0 + t, y1, z1 - t], { tone: "mid" }, { sys, r: 0.4 });
  // top frame: four bars round an open top
  const screws = (pts) => Dots(pts.map((p) => at(p)), { size: 0.45 });
  box(`${id}.top.back`, [x0, y0, z1 - t], [x1, y0 + bar, z1], { tone: "mid" }, { sys, r: 0.6, extra: screws([[x0 + 5, y0 + bar / 2, z1], [x1 - 5, y0 + bar / 2, z1]]) });
  box(`${id}.top.front`, [x0, y1 - 6, z1 - t], [x1, y1, z1], { tone: "mid" }, { sys, r: 0.6, extra: screws([[x0 + 5, y1 - 3, z1], [x1 - 5, y1 - 3, z1]]) });
  box(`${id}.top.left`, [x0, y0 + bar, z1 - t], [x0 + bar, y1 - 6, z1], { tone: "mid" }, { sys, r: 0.6 });
  box(`${id}.top.right`, [x1 - bar, y0 + bar, z1 - t], [x1, y1 - 6, z1], { tone: "mid" }, { sys, r: 0.6 });
}

// ---------------------------------------------------------------- 03 source vessel, collector, final focus
SYS = "source";
housing("vessel", VESSEL, { sys: "source" });
ribs("vessel", VESSEL, [-200, -160, -236, -170], { pitch: 24 });
const PLASMA = xz(PL);
const CF = zF(PL[0], Y0, PL[1]); // s = z - plasma height
const SAG = (r) => (r * r) / 72 - 18; // paraboloid with its focus on the plasma
const COLL_R = 32;
const COLL_HOLE = 5;
{
  const front = Array.from({ length: 14 }, (_, i) => COLL_HOLE + ((COLL_R - COLL_HOLE) * i) / 13).map((r) => [SAG(r), r]);
  const meridian = [...front, [SAG(COLL_R) - 4, COLL_R], ...front.slice().reverse().map(([s, r]) => [s - 4, r])];
  const paths = G.lathe(meridian, CF, P, { fill: "hull", hole: null });
  const shape = record(A.lathe(CF, meridian, { name: "collector" }));
  const rings = [12, 20, 27].map((r) => G.arcOf(CF, SAG(r) + 0.05, r, P, { slope: r / 36, inward: true, least: -1 })).join("");
  put("collector", [PL[0], Y0, PL[1] - 12], S(paths, { tone: "hi", inner: Ln(rings, { tone: "faint" }) }), [shape], { sys: "source" });
}
// collector cooling cradle: three struts from the floor to the collector back
for (const ang of [0.6, 2.7, 4.8]) {
  const r = 22;
  const x = PL[0] + r * Math.cos(ang);
  const y = Y0 + r * Math.sin(ang);
  // the strut's top touches the collector's back at its innermost corner
  const inner = Math.min(...[[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]].map(([dx, dy]) => Math.hypot(x + dx - PL[0], y + dy - Y0)));
  const zTop = PL[1] + SAG(inner) - 4;
  box("collector.strut", [x - 1.5, y - 1.5, VESSEL[4] + 4], [x + 1.5, y + 1.5, zTop], { tone: "lo" }, { sys: "source" });
}
// final focus: the CO2 beam comes up through the floor, through the collector's hole, onto the droplet
const FFOC = { z0: VESSEL[4] + 4, z1: 22 };
turned("final.focus", zF(PL[0], Y0, FFOC.z0), [[0, 7], [10, 7], [12, 5], [FFOC.z1 - FFOC.z0, 4]], { tone: "hi" }, { sys: "laser", inner: Ln(G.arcOf(zF(PL[0], Y0, FFOC.z0), 10, 7, P), { tone: "faint" }) });
// tin droplet generator through the back wall, catcher at the front
SYS = "tin";
const DG = { y0: VESSEL[2] + 4, y1: -74 };
{
  const F = yF(PL[0], DG.y0, PL[1]);
  turned("tin.generator", F, [[0, 7], [6, 7], [6, 5.5], [18, 5.5], [22, 3, 1], [DG.y1 - DG.y0, 1.2]], { tone: "hi" }, {
    inner: Ln(G.arcOf(F, 6, 5.5, P) + G.arcOf(F, 12, 5.5, P), { tone: "faint" }),
    extra: k.fadedSvg(G.ribsOf(F, 6.4, 11.6, 5.5, 18, P, { fade: [0.1, 0.55] }), { tone: "lo" }),
  });
  const shroud = yF(PL[0], DG.y0, PL[1] - 10);
  box("tin.bracket", [PL[0] - 2, DG.y0, VESSEL[4] + 4], [PL[0] + 2, DG.y0 + 8, PL[1] - 7], { tone: "lo" });
}
const CATCH = { y0: 6, y1: 18, r: 6 };
{
  const F = yF(PL[0], CATCH.y0, PL[1]);
  turned("tin.catcher", F, [[0, 3.2], [0, CATCH.r], [CATCH.y1 - CATCH.y0, CATCH.r]], { tone: "mid" }, { extra: S(G.disc(-0.01, 0.01, 3.2, F, P), { tone: "lo", flat: true }) });
  box("tin.catcher.post", [PL[0] - 2, CATCH.y0 + 2, VESSEL[4] + 4], [PL[0] + 2, CATCH.y0 + 6, PL[1] - CATCH.r], { tone: "lo" });
}

// ---------------------------------------------------------------- 04 intermediate focus cone under the illuminator floor
SYS = "if";
{
  const F = zF(IFP[0], Y0, 112);
  turned("if.cone", F, [[0, 18], [1.5, 18], [30, 7], [30, 13], [34, 13]], { tone: "hi" }, { inner: Ln(G.arcOf(F, 1.5, 18, P), { tone: "faint" }), extra: Dots(G.dotsOf(F, 34, 11, 10, P, { fade: [0.04, 0.42] }), { size: 0.4 }) });
}

// ---------------------------------------------------------------- 05 illuminator
SYS = "illum";
housing("illum", ILLUM, { sys: "illum", right: "open" });
for (const x of [-60, 68]) for (const y of [ILLUM[2] + 4, ILLUM[3] - 4]) {
  disc("illum.column", zF(x, y, 0), 0, 3, 6, { tone: "lo" }, { sys: "illum" });
  disc("illum.column", zF(x, y, 0), 3, ILLUM[4], 3.4, { tone: "mid" }, { sys: "illum" });
}

// mirrors: a disc on its normal, a cell ring round it and an arm back to the wall
const unit2 = ([x, z]) => { const l = Math.hypot(x, z); return [x / l, z / l]; };

const LIGHT = [{ id: "collector", at: [PL[0], PL[1] + SAG(0)], w: COLL_R }, { id: "if", at: IFP, w: 0.6 }, ...OPT];
for (let i = 0; i < OPT.length; i++) {
  const o = OPT[i];
  if (!o.r) continue;
  const prev = i === 0 ? IFP : OPT[i - 1].at;
  const next = OPT[i + 1].at;
  const din = unit2([o.at[0] - prev[0], o.at[1] - prev[1]]);
  const dout = unit2([next[0] - o.at[0], next[1] - o.at[1]]);
  const n = unit2([dout[0] - din[0], dout[1] - din[1]]);
  o.n = [n[0], 0, n[1]];
  const c = xz(o.at);
  const F = G.frameOf(c, o.n, [0, 1, 0], G.cross3(o.n, [0, 1, 0]));
  const faceUp = G.dot3(o.n, V) > 0;
  const facets = o.id === "ffm" || o.id === "pfm";
  let extra = "";
  if (faceUp && facets) {
    const pts = [];
    for (let u = -o.r + 2; u <= o.r - 2; u += 2.4) for (let v = -o.r + 2; v <= o.r - 2; v += o.id === "ffm" ? 1.2 : 2.4) if (Math.hypot(u, v) < o.r - 1.6) pts.push(at(G.add3(c, G.add3(G.mul3(F.u, u), G.mul3(F.v, v)))));
    extra = Dots(pts, { size: 0.32, tone: "lo" });
  } else if (faceUp) extra = Ln(G.circleOf(F, 0.02, o.r * 0.72, P, 48), { tone: "faint" });
  const tone = "hi";
  // the mirror stands 0.6 proud of its cell ring: one turned part, so it orders as one
  const CELL = 1.4;
  const cellDots = Dots(G.dotsOf(F, faceUp ? -0.6 : -o.t, o.r + CELL / 2, 12, P, { fade: [0.04, 0.42] }), { size: 0.3 });
  turned(`${o.sys}.${o.id}`, F, [[-o.t, o.r + CELL], [-0.6, o.r + CELL], [-0.6, o.r], [0, o.r]], { tone }, { sys: o.sys, extra: extra + cellDots, inner: Ln(G.arcOf(F, -o.t / 2, o.r + CELL, P), { tone: "faint" }) });
  // arm along -y from the mirror's far rim to the housing back wall
  const back0 = (o.sys === "illum" ? ILLUM : PO)[2] + 4;
  const mid = G.add3(c, G.mul3(o.n, -o.t / 2));
  const rimY = Y0 - o.r - CELL;
  ARM_X.push(mid[0]);
  box(`${o.sys}.${o.id}.arm`, [mid[0] - 1.8, back0, mid[2] - 1.8], [mid[0] + 1.8, rimY, mid[2] + 1.8], { tone: "lo" }, { sys: o.sys, extra: Dots([at([mid[0], back0 + 3, mid[2] + 1.8])], { size: 0.4 }) });
}

// stiffening ribs on the inside of the back walls, clear of the mirror arms
function ribs(id, [x0, x1, y0, , z0, z1], keep = [], { t = 4, pitch = 30 } = {}) {
  for (let x = x0 + pitch; x < x1 - 8; x += pitch) {
    if ([...ARM_X, ...keep].some((ax) => Math.abs(ax - x) < 7)) continue;
    box(`${id}.rib`, [x - 1.4, y0 + t, z0 + t], [x + 1.4, y0 + t + 2.4, z1 - t], { tone: "mid" }, { sys: SYS, r: 0.3 });
  }
}
SYS = "illum";
ribs("illum", ILLUM, [62, 76, 88]);

// ---------------------------------------------------------------- 07 projection optics box and its metrology frame
SYS = "po";
housing("po", PO, { sys: "po", right: "open", floor: true });
ribs("po", PO, [], { pitch: 18 });
const PO_POST_Y = [-110, 34];
for (const x of [100, 201]) {
  for (const y of PO_POST_Y) {
    disc("po.leg", zF(x, y, 0), 0, 3, 6, { tone: "lo" }, { sys: "po" });
    disc("po.leg", zF(x, y, 0), 3, 71, 3.4, { tone: "mid" }, { sys: "po" });
    turned("po.airmount", zF(x, y, 80 - 9), [[0, 4.6], [9, 4.6]], { tone: "hi" }, { sys: "po" });
  }
  box("po.crossbeam", [x - 4, PO_POST_Y[0] - 4, 80], [x + 4, PO_POST_Y[1] + 4, PO[4]], { tone: "mid" }, { sys: "po", bevel: 0.3 });
}
// dynamic gas lock at the bottom of the PO: hydrogen flows down and out so the resist's vapour stays off M6
{
  const F = zF(WX, Y0, PO[4] - 6);
  turned("po.dgl", F, [[0, 6], [6, 9]], { tone: "hi" }, { sys: "po" });
}

// ---------------------------------------------------------------- 06 reticle stage on top
SYS = "reticle";
const RAIL_Y = [PO[2] + 2, PO[3] - 6];
for (const y of RAIL_Y) box("reticle.rail", [30, y, PO[5]], [205, y + 4, PO[5] + 6], { tone: "mid" }, { sys: "reticle", bevel: 0.3, extra: Ln(k.topTicks(34, 200, 4, 5, y + 4, PO[5] + 6, [1.2, 2.2], P).minor, { tone: "lo" }) });
for (const x of [34, 201]) box("reticle.stop", [x - 2, RAIL_Y[0] - 1, PO[5] + 6], [x + 2, RAIL_Y[1] + 5, PO[5] + 10], { tone: "lo" }, { sys: "reticle" });

// ---------------------------------------------------------------- 08 wafer stages base and 09 metrology
SYS = "stages";
box("stages.base", [BASE.x, BASE.y, 0], [BASE.x + BASE.w, BASE.y + BASE.d, BASE_H], { tone: "mid" }, {
  r: 3, steps: 4, bevel: 1, sys: "stages",
  inner: Ln(k.sideSeam(BASE, 8, P, 4), { tone: "faint" }),
  // the planar motor's coil tiles under the chucks
  extra: Ln(Array.from({ length: 22 * 12 }, (_, i) => k.planOutline({ x: BASE.x + 4 + (i % 22) * 10.3, y: BASE.y + 4 + Math.floor(i / 22) * 10.1, w: 9.3, d: 9.1, r: 0.8 }, BASE_H, P, 2)).join(""), { tone: "faint" }),
});
SYS = "metro";
for (const y of PO_POST_Y) {
  disc("metro.leg", zF(MEAS_X, y, 0), 0, 3, 6, { tone: "lo" }, { sys: "metro" });
  disc("metro.leg", zF(MEAS_X, y, 0), 3, 104, 3.4, { tone: "mid" }, { sys: "metro" });
}
box("metro.bridge", [MEAS_X - 6, PO_POST_Y[0] - 4, 104], [MEAS_X + 6, PO_POST_Y[1] + 4, 114], { tone: "mid" }, { sys: "metro", bevel: 0.4 });
// sensor plate under the bridge: level sensor projector and detector either side, alignment sensor between
const SPLATE = { x: MEAS_X - 34, y: Y0 - 12, w: 68, d: 24, r: 1.5 };
box("metro.plate", [SPLATE.x, SPLATE.y, 100], [SPLATE.x + SPLATE.w, SPLATE.y + SPLATE.d, 104], { tone: "mid" }, { sys: "metro", r: 1.5, steps: 3, extra: Dots(k.corners(SPLATE, 2.4).map(([x, y]) => at([x, y, 104])), { size: 0.45 }) });
const LS = { pro: MEAS_X - 26, det: MEAS_X + 26, z: 88 };
for (const [name, x] of [["metro.level.projector", LS.pro], ["metro.level.detector", LS.det]]) {
  box(name, [x - 6, Y0 - 7, LS.z], [x + 6, Y0 + 7, 100], { tone: "hi" }, { sys: "metro", r: 1, steps: 2, bevel: 0.3, inner: Ln(k.sideSeam({ x: x - 6, y: Y0 - 7, w: 12, d: 14, r: 1 }, 96, P, 2), { tone: "faint" }) });
}
{
  const F = zF(MEAS_X, Y0, 76);
  turned("metro.align", F, [[0, 2.6], [3, 4.4, 1], [5, 5], [24, 5]], { tone: "hi" }, { sys: "metro", inner: Ln(G.arcOf(F, 12, 5, P) + G.arcOf(F, 18, 5, P), { tone: "faint" }) });
}

// ---------------------------------------------------------------- 10 vacuum and hydrogen
SYS = "vac";
const H2C = { x: -290, y: 56, w: 44, d: 44, r: 1.5 };
const H2C_H = 62;
{
  const zf = H2C.y + H2C.d + 0.05;
  const door = path3([[H2C.x + 4, zf, SUB_Z + 6], [H2C.x + H2C.w - 4, zf, SUB_Z + 6], [H2C.x + H2C.w - 4, zf, SUB_Z + H2C_H - 10], [H2C.x + 4, zf, SUB_Z + H2C_H - 10]], true);
  const glass = path3([[H2C.x + 10, zf, SUB_Z + 30], [H2C.x + H2C.w - 10, zf, SUB_Z + 30], [H2C.x + H2C.w - 10, zf, SUB_Z + H2C_H - 16], [H2C.x + 10, zf, SUB_Z + H2C_H - 16]], true);
  box("vac.h2.cabinet", [H2C.x, H2C.y, SUB_Z], [H2C.x + H2C.w, H2C.y + H2C.d, SUB_Z + H2C_H], { tone: "mid" }, {
    r: 1.5, steps: 3, bevel: 0.5, sys: "vac",
    inner: Ln(k.sideSeam(H2C, SUB_Z + H2C_H - 5, P, 3), { tone: "faint" }),
    extra: Ln(door, { tone: "lo" }) + Ln(glass, { tone: "faint" }) + Dots([at([H2C.x + H2C.w - 7, zf, SUB_Z + 20])], { size: 0.7, tone: "hi" }),
  });
  for (const gx of [H2C.x + 14, H2C.x + 30]) {
    const F = yF(gx, H2C.y + H2C.d, SUB_Z + 19);
    disc("vac.h2.gauge", F, 0, 1.4, 3.6, { tone: "hi" }, { sys: "vac", extra: Ln(G.circleOf(F, 1.4, 2.6, P, 32), { tone: "lo" }) });
  }
}
const H2X = H2C.x + H2C.w / 2 + 18;
box("vac.h2.inlet", [H2X - 6, -6, VESSEL[4] + 4], [H2X + 6, 6, 20], { tone: "hi" }, { sys: "vac", bevel: 0.3, extra: Dots([at([H2X - 4, 6, 18]), at([H2X + 4, 6, 18])], { size: 0.4 }) });
pipe("vac.h2.line", [[H2X, 78, SUB_Z + H2C_H], [H2X, 78, 12], [H2X, 6, 12]], 1.6, { sys: "vac", tone: "hi", bend: 6, flanges: [true, true], free: [true, false] });
// a turbo pump on the source vessel's side, its foreline down through the floor to the dry pumps
{
  const F = xF(VESSEL[1], -62, 70);
  turned("vac.turbo.source", F, [[0, 10], [2, 10], [2, 8], [20, 8], [24, 5, 1], [26, 2.4]], { tone: "hi" }, { sys: "vac",
    inner: Ln(G.arcOf(F, 2, 8, P) + G.arcOf(F, 14, 8, P), { tone: "faint" }),
    extra: k.fadedSvg(G.ribsOf(F, 4, 13, 8, 28, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }) });
  pipe("vac.foreline.source", [[VESSEL[1] + 26, -62, 70], [VESSEL[1] + 34, -62, 70], [VESSEL[1] + 34, -62, 1.2]], 2.2, { sys: "vac", bend: 9, flanges: [true, true] });
  disc("vac.floor.port", zF(VESSEL[1] + 34, -62, 0), 0, 1.2, 6, { tone: "lo" }, { sys: "vac" });
}
// turbo pumps on the illuminator and PO top frames
for (const [name, x] of [["vac.turbo.illum", -120], ["vac.turbo.illum2", 20]]) {
  const F = zF(x, ILLUM[2] + 5, ILLUM[5]);
  turned(name, F, [[0, 6.5], [1.6, 6.5], [1.6, 5.2], [14, 5.2], [16, 3, 1], [17, 1.6]], { tone: "hi" }, { sys: "vac", inner: Ln(G.arcOf(F, 1.6, 5.2, P), { tone: "faint" }) });
}
// dry pumps in the subfab, right
for (const [i, x] of [[0, 330], [1, 372]].map(([i, x]) => [i, x])) {
  const plan = { x, y: 58, w: 36, d: 42, r: 2 };
  box("vac.dry", [x, 58, SUB_Z], [x + 36, 100, SUB_Z + 28], { tone: "mid" }, { sys: "vac", r: 2, steps: 3, bevel: 0.5,
    inner: Ln(k.sideSeam(plan, SUB_Z + 22, P, 3), { tone: "faint" }),
    extra: Ln(Array.from({ length: 5 }, (_, j) => k.planOutline({ x: x + 6 + j * 5, y: 66, w: 2, d: 26, r: 1 }, SUB_Z + 28, P, 2)).join(""), { tone: "faint" }) });
  const F = xF(x + 4, 79, SUB_Z + 38);
  turned("vac.dry.motor", F, [[0, 8], [26, 8], [28, 6, 1], [29, 3]], { tone: "hi" }, { sys: "vac", inner: Ln(G.arcOf(F, 6, 8, P) + G.arcOf(F, 20, 8, P), { tone: "faint" }) });
  box("vac.dry.cradle", [x + 6, 74, SUB_Z + 28], [x + 26, 84, SUB_Z + 30], { tone: "lo" }, { sys: "vac" });
}

// ---------------------------------------------------------------- 11 wafer and reticle handlers
SYS = "handler";
const LL = { x: 362, y: -76, w: 30, d: 60, r: 2 };
box("handler.loadlock", [LL.x, LL.y, 0], [LL.x + LL.w, LL.y + LL.d, 46], { tone: "mid" }, { sys: "handler", r: 2, steps: 3, bevel: 0.5,
  inner: Ln(k.sideSeam(LL, 23, P, 3), { tone: "faint" }),
  extra: Ln(path3([[LL.x + 6, LL.y + LL.d + 0.05, 30], [LL.x + LL.w - 6, LL.y + LL.d + 0.05, 30], [LL.x + LL.w - 6, LL.y + LL.d + 0.05, 36], [LL.x + 6, LL.y + LL.d + 0.05, 36]], true), { tone: "lo" }) });
const LP = { x: 396, y: -70, w: 20, d: 48, r: 1.5 };
box("handler.loadport", [LP.x, LP.y, 0], [LP.x + LP.w, LP.y + LP.d, 40], { tone: "mid" }, { sys: "handler", r: 1.5, steps: 3, bevel: 0.4 });
box("handler.foup", [LP.x + 1, LP.y + 6, 40], [LP.x + LP.w - 1, LP.y + LP.d - 6, 62], { tone: "hi" }, { sys: "handler", r: 4, steps: 4, bevel: 0.6,
  inner: Ln(k.sideSeam({ x: LP.x + 1, y: LP.y + 6, w: LP.w - 2, d: LP.d - 12, r: 4 }, 46, P, 4), { tone: "faint" }) });
box("handler.foup.handle", [LP.x + 6, LP.y + 18, 62], [LP.x + LP.w - 6, LP.y + LP.d - 18, 65], { tone: "mid" }, { sys: "handler", r: 1 });
{
  const RB = [346, -45];
  disc("handler.robot.base", zF(RB[0], RB[1], 0), 0, 14, 8, { tone: "mid" }, { sys: "handler", inner: Ln(G.arcOf(zF(RB[0], RB[1], 0), 10, 8, P), { tone: "faint" }) });
  disc("handler.robot.column", zF(RB[0], RB[1], 0), 14, 36, 4.2, { tone: "hi" }, { sys: "handler" });
  disc("handler.robot.shoulder", zF(RB[0], RB[1], 0), 36, 40, 6, { tone: "mid" }, { sys: "handler" });
  box("handler.robot.arm", [RB[0] - 3, RB[1] - 22, 40], [RB[0] + 3, RB[1] + 4, 43.5], { tone: "hi" }, { sys: "handler", r: 2.5, steps: 3 });
  disc("handler.robot.elbow", zF(RB[0], RB[1] - 19, 0), 43.5, 46.5, 4, { tone: "mid" }, { sys: "handler" });
  box("handler.robot.hand", [RB[0], RB[1] - 21.5, 46.5], [RB[0] + 8, RB[1] - 16.5, 48.5], { tone: "hi" }, { sys: "handler", r: 1.5, steps: 3 });
  box("handler.robot.palm", [RB[0] + 8, RB[1] - 24, 46.5], [RB[0] + 12, RB[1] - 14, 48.5], { tone: "mid" }, { sys: "handler", r: 0.6 });
  for (const dy of [-24, -16]) box("handler.robot.fork", [RB[0] + 12, RB[1] + dy, 46.5], [LL.x - 0.4, RB[1] + dy + 2, 47.5], { tone: "hi" }, { sys: "handler", r: 0.4 });
}
// reticle library and hand-off arm on a shelf off the PO's right posts
const SHELF = { x: PO[1], y: PO[2] + 4, w: 32, d: PO[3] - PO[2] - 4, r: 1 };
box("handler.reticle.shelf", [SHELF.x, SHELF.y, 290], [SHELF.x + SHELF.w, SHELF.y + SHELF.d, 294], { tone: "lo" }, { sys: "handler", r: 1 });
const RL = { x: PO[1] + 3, y: -70, w: 27, d: 34, r: 1.5 };
box("handler.reticle.library", [RL.x, RL.y, 294], [RL.x + RL.w, RL.y + RL.d, 318], { tone: "mid" }, { sys: "handler", r: 1.5, steps: 3, bevel: 0.4,
  inner: Ln([300, 306, 312].map((z) => k.sideSeam(RL, z, P, 3)).join(""), { tone: "faint" }) });
box("handler.reticle.pod", [RL.x + 6, RL.y + 8, 318], [RL.x + RL.w - 6, RL.y + RL.d - 8, 324], { tone: "hi" }, { sys: "handler", r: 1.5, steps: 3, bevel: 0.3 });
box("handler.reticle.arm", [PO[1] - 14, -55, 304], [RL.x, -51, 307], { tone: "hi" }, { sys: "handler", r: 0.8 });

// ---------------------------------------------------------------- 12 control racks at the back of the fab floor, and the RF generators that pump the amplifiers
SYS = "control";
for (const [i, x] of [338, 364, 390].entries()) {
  const plan = { x, y: -122, w: 24, d: 36, r: 1 };
  const yf = plan.y + plan.d + 0.05;
  const slots = Array.from({ length: 6 }, (_, j) => path3([[x + 4, yf, 20 + j * 18], [x + 20, yf, 20 + j * 18], [x + 20, yf, 23 + j * 18], [x + 4, yf, 23 + j * 18]], true)).join("");
  box("control.rack", [x, plan.y, 0], [x + 24, plan.y + plan.d, 128 - i * 14], { tone: "mid" }, { sys: "control", r: 1, steps: 2, bevel: 0.4,
    inner: Ln(k.sideSeam(plan, 8, P, 2), { tone: "faint" }),
    extra: Ln(slots, { tone: "faint" }) + `<g class="eu-led" data-led="${i}">${Dots([at([x + 6, yf, 12]), at([x + 10, yf, 12])], { size: 0.7, tone: "hi" })}</g>` });
}
box("control.tray", [-250, -124, 0], [338, -118, 3], { tone: "lo" }, { sys: "control", r: 0.6 });
SYS = "laser";
for (const a of AMP.slice(1)) {
  const plan = { x: a.x0 + 14, y: -6, w: a.x1 - a.x0 - 28, d: 30, r: 1 };
  box(`laser.${a.id}.rf`, [plan.x, plan.y, SUB_Z], [plan.x + plan.w, plan.y + plan.d, -36], { tone: "lo" }, { sys: "laser", r: 1, steps: 2,
    inner: Ln(k.sideSeam(plan, -44, P, 2), { tone: "faint" }),
    extra: Ln(Array.from({ length: 4 }, (_, j) => path3([[plan.x + 6 + j * 10, plan.y + plan.d + 0.05, -50], [plan.x + 9 + j * 10, plan.y + plan.d + 0.05, -50], [plan.x + 9 + j * 10, plan.y + plan.d + 0.05, -42], [plan.x + 6 + j * 10, plan.y + plan.d + 0.05, -42]], true)).join(""), { tone: "faint" }) });
}

// ---------------------------------------------------------------- inside details
// droplet camera and its light curtain lamp on the vessel's far wall: they time each droplet for the pre-pulse
SYS = "tin";
for (const [name, y, z, r] of [["tin.camera", -14, 78, 4.2], ["tin.lamp", -58, 78, 3.6]]) {
  const F = xF(VESSEL[0] + 4, y, z);
  turned(name, F, [[0, r + 1.6], [1.6, r + 1.6], [1.6, r], [12, r], [14, r - 1.2, 1], [15, r - 2]], { tone: "hi" }, { sys: "tin", inner: Ln(G.arcOf(F, 1.6, r, P), { tone: "faint" }) });
}
// EUV energy sensor looking at the plasma from the back wall
SYS = "source";
{
  const F = yF(-160, VESSEL[2] + 4, 92);
  turned("source.sensor", F, [[0, 5], [1.4, 5], [1.4, 3.4], [10, 3.4], [11, 2.4]], { tone: "hi" }, { sys: "source" });
  for (const [x, z] of [[-236, 104], [-170, 30]]) {
    const V2 = yF(x, VESSEL[2] + 4, z);
    disc("source.viewport", V2, 0, 1.6, 6, { tone: "mid" }, { sys: "source", extra: Ln(G.circleOf(V2, 1.6, 4, P, 36), { tone: "lo" }) + Dots(G.dotsOf(V2, 1.6, 5, 8, P, { all: true }), { size: 0.35 }) });
  }
}
// intermediate focus aperture plate on the illuminator floor
SYS = "if";
{
  const F = zF(IFP[0], Y0, ILLUM[4] + 4);
  disc("if.aperture", F, 0, 1.2, 7, { tone: "hi" }, { sys: "if", extra: Ln(G.circleOf(F, 1.2, 2.2, P, 32), { tone: "lo" }) + Dots(G.dotsOf(F, 1.2, 5.6, 6, P, { all: true }), { size: 0.35 }) });
}
// reticle masking blades: they open at the start of each scan and close at its end
SYS = "illum";
const REMA_Z = 229;
const REMA = [{ name: "illum.rema.a", x0: 64, x1: 82.4 }, { name: "illum.rema.b", x0: 87.8, x1: 92.6 }];
for (const b of REMA) {
  box(b.name, [b.x0, Y0 - 14, REMA_Z], [b.x1, Y0 + 14, REMA_Z + 1.2], { tone: "hi" }, { sys: "illum", r: 0.3 });
}
box("illum.rema.rail", [62, ILLUM[2] + 4, REMA_Z + 1.2], [89.8, Y0 - 10, REMA_Z + 4], { tone: "lo" }, { sys: "illum", r: 0.4 });
// encoder grid plates under the PO: the chucks' encoder heads read their position from these
SYS = "stages";
for (const [x0, x1, y0, y1] of [[104, 130, -80, -3], [150, 197, -80, -3], [130, 150, -80, -45], [130, 150, -25, -3]]) {
  box("stages.grid", [x0, y0, PO[4] - 3], [x1, y1, PO[4]], { tone: "lo" }, { sys: "stages", r: 0.4,
    extra: Ln(Array.from({ length: Math.max(1, Math.floor((x1 - x0) / 5)) }, (_, i) => path3([[x0 + 2.5 + i * 5, y1, PO[4] - 3], [x0 + 2.5 + i * 5, y1, PO[4]]])).join(""), { tone: "faint" }) });
}

// ---------------------------------------------------------------- light, drawn inside each housing in its own slot
function band(a, b, wa, wb) {
  const d = unit2([b[0] - a[0], b[1] - a[1]]);
  const n = [-d[1], d[0]];
  return path3([[a[0] + n[0] * wa, Y0, a[1] + n[1] * wa], [b[0] + n[0] * wb, Y0, b[1] + n[1] * wb], [b[0] - n[0] * wb, Y0, b[1] - n[1] * wb], [a[0] - n[0] * wa, Y0, a[1] - n[1] * wa]], true);
}
const LIGHTS = { src: [], ill: [], po: [] };
{
  // the 13.5 nm cone from the collector to the intermediate focus
  const rim = Array.from({ length: 48 }, (_, i) => at(G.pointOf(CF, SAG(COLL_R - 3), COLL_R - 3, (i / 48) * Math.PI * 2)));
  LIGHTS.src.push(`<path class="eu-beam" d="${k.pathOf(G.hullOf([...rim, at(xz(IFP))]), true)}"/>`);
}
for (let i = 0; i < OPT.length; i++) {
  const a = i === 0 ? IFP : OPT[i - 1].at;
  const wa = i === 0 ? 0.6 : OPT[i - 1].w;
  (i <= 4 ? LIGHTS.ill : LIGHTS.po).push(`<path class="eu-beam" d="${band(a, OPT[i].at, wa, OPT[i].w)}"/>`);
}
const CHIEF = {
  src: [PLASMA, xz([PL[0] + 14, PL[1] + SAG(14)]), xz(IFP)],
  ill: [xz(IFP), ...OPT.slice(0, 5).map((o) => xz(o.at))],
  po: OPT.slice(4).map((o) => xz(o.at)),
};
const lightSvg = (id) => `<g class="eu-light" data-light="${id}">${LIGHTS[id].join("")}<path class="eu-chief" d="${path3(CHIEF[id])}"/><path class="eu-pulse" data-pulse="${id}" d="${path3(CHIEF[id])}"/></g>`;

// wafer chucks: expose (under the PO) and measure (under the bridge)
const CHUCK = 33;
const WAFER_R = M.WAFER_MM / 2 / 5;
const mm = (v) => v / 5;
function chuckSvg(cx, id) {
  const plan = { x: cx - CHUCK, y: Y0 - CHUCK, w: 2 * CHUCK, d: 2 * CHUCK, r: 3 };
  const table = k.insetPlan(plan, 3);
  const parts = [
    `<path class="iso-halo" d="${k.haloOf(plan, BASE_H + 1, 6, P)}"/>`,
    S(k.slabOf(plan, BASE_H + 1, 9, P, 4, 0.6), { tone: "mid", inner: Ln(k.sideSeam(plan, BASE_H + 5, P, 4), { tone: "faint" }) }),
    S(k.slabOf(table, BASE_H + 10, 15, P, 3, 0.8), { tone: "hi" }),
    S(k.cylinder(cx, Y0, WAFER_R, BASE_H + 25, 2.5, P, 96, 0.4), { tone: "hi", className: "eu-wafer" }),
  ];
  const fields = M.FIELDS.map((f, i) => {
    const pts = [[f.x0, f.y0], [f.x1, f.y0], [f.x1, f.y1], [f.x0, f.y1]].map(([u, v]) => {
      const rr = Math.hypot(u, v);
      const s = rr > M.WAFER_MM / 2 - M.EDGE_MM ? (M.WAFER_MM / 2 - M.EDGE_MM) / rr : 1;
      return [cx + mm(u), Y0 + mm(v)];
    });
    return `<path class="eu-field" data-f="${i}" d="${k.onTop(pts, WZ, P, true)}"/>`;
  }).join("");
  const clip = `<clipPath id="eu-wclip-${id}"><path d="${k.pathOf(Array.from({ length: 96 }, (_, i) => at([cx + (WAFER_R - 0.6) * Math.cos((i / 96) * 2 * Math.PI), Y0 + (WAFER_R - 0.6) * Math.sin((i / 96) * 2 * Math.PI), WZ])), true)}"/></clipPath>`;
  parts.push(clip, `<g clip-path="url(#eu-wclip-${id})" data-fields="${id}">${fields}</g>`);
  parts.push(Dots(k.corners(table, 2).map(([x, y]) => at([x, y, BASE_H + 25])), { size: 0.5 }));
  // encoder heads read the grid plates above; drawn back to front
  const heads = byDepth(k.corners(plan, 1.6)).map(([x, y]) => S(k.cylinder(x, y, 1.2, BASE_H + 10, 3, P, 16), { tone: "hi" }));
  parts.splice(2, 0, ...heads.slice(0, 2));
  parts.splice(4 + 2, 0, ...heads.slice(2));
  return parts.join("");
}
// The chucks are drawn live in the slot of this item. Its shape is the whole space they sweep: stepping under the
// lens, rastering under the bridge and trading places along two lanes, so the settled order holds wherever they are.
put("stages.chucks", [(WX + MEAS_X) / 2, Y0, 40], "", [record(A.box([WX - 30 - CHUCK, Y0 - 30 - CHUCK, BASE_H], [MEAS_X + 26 + CHUCK, Y0 + 30 + CHUCK, WZ], { name: "stages.chucks" }))], { sys: "stages" });

// ---------------------------------------------------------------- 13–15 the outside, after a photo of a real scanner in its fab
// An open steel frame in tiers. Left: a service platform with railings and a ladder over a tier of tanks, with
// cabinets, a valve manifold and an electronics cabinet below. Right: a braced bay of hose loops and tall cabinets
// on top, a valve panel in the middle, a floor cabinet, a sensor head and the water manifold below. Over the
// optics: a top tier with the cable tray, the exhaust duct and a bulkhead of ports. The front stays open.
const seen = (n) => G.dot3(n, V) > 0.02;
const SX = seen([1, 0, 0]) ? 1 : -1; // the end face of a box that faces the viewer
const bolt = (pts, size = 0.42, tone = "lo") => Dots(pts.map(at), { size, tone });
const faceY = (y, x0, x1, z0, z1) => path3([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], true);
const tint = (name) => ({ className: `eu-tint eu-${name}` });
function rod(name, a, b, r, style = {}, options = {}) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  return turned(name, G.frameAlong(a, d), [[0, r], [Math.hypot(...d), r]], { tone: "mid", ...style }, options);
}
// a diagonal brace between two faces x = xa and x = xb: its round ends are pulled in so their rims just touch
function brace(name, [xa, y, za], [xb, , zb], r, options = {}) {
  const len = Math.hypot(xb - xa, zb - za);
  const c = Math.abs(xb - xa) / len;
  const e = (r * Math.sqrt(1 - c * c)) / c + 0.05;
  const u = [(xb - xa) / len, 0, (zb - za) / len];
  rod(name, [xa + u[0] * e, y, za + u[2] * e], [xb - u[0] * e, y, zb - u[2] * e], r, { tone: "mid" }, options);
}
function column(name, x, y, z0, z1, { s = 2.5, sys = SYS, plate = false } = {}) {
  if (plate) box(`${name}.plate`, [x - 4.5, y - 4.5, z0], [x + 4.5, y + 4.5, z0 + 1], { tone: "lo" }, { sys, r: 0.4, extra: bolt([[-3.3, -3.3], [3.3, -3.3], [-3.3, 3.3], [3.3, 3.3]].map(([dx, dy]) => [x + dx, y + dy, z0 + 1]), 0.4) });
  const b = plate ? z0 + 1 : z0;
  box(name, [x - s, y - s, b], [x + s, y + s, z1], { tone: "mid" }, { sys, r: 0.3, bevel: 0.2,
    extra: bolt([[x - s + 0.9, y + s, z1 - 1.8], [x + s - 0.9, y + s, z1 - 1.8], [x + SX * s, y - s + 0.9, z1 - 1.8], [x + SX * s, y + s - 0.9, z1 - 1.8]], 0.36) });
}
function deck(name, x0, x1, y0, y1, z, { t = 6, sys = SYS, grate = true } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r: 0.6 };
  const slots = [];
  if (grate) for (let x = x0 + 5; x + 6 <= x1 - 4; x += 10) for (let y = y0 + 4; y + 2 <= y1 - 3; y += 6) slots.push(k.planOutline({ x, y, w: 6, d: 2, r: 0.5 }, z + t, P, 2));
  const xe = SX > 0 ? x1 : x0;
  const edge = [...[0.08, 0.5, 0.92].map((f) => [x0 + (x1 - x0) * f, y1, z + t / 2]), ...[0.15, 0.5, 0.85].map((f) => [xe, y0 + (y1 - y0) * f, z + t / 2])];
  box(name, [x0, y0, z], [x1, y1, z + t], { tone: "lo" }, { sys, r: 0.6, inner: Ln(k.sideSeam(plan, z + 1.4, P, 2), { tone: "faint" }), extra: Ln(slots.join(""), { tone: "faint" }) + bolt(edge, 0.42) });
}
// posts on the deck, a top rail on the posts, and a knee rail and a toe board clamped to their outer faces
function railing(name, x0, x1, y0, y1, z, { h = 38, sys = SYS, gaps = [] } = {}) {
  const s = 1.1;
  const t = 1;
  const along = (a, b) => { const n = Math.max(1, Math.ceil((b - a) / 26)); return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n); };
  const split = (a, b) => { const out = []; let from = a; for (const [g0, g1] of gaps) { out.push([from, g0]); from = g1; } out.push([from, b]); return out; };
  const posts = [];
  for (const y of [y0, y1]) for (const x of along(x0, x1)) posts.push([x, y]);
  const ends = { [x0]: split(y0, y1), [x1]: [[y0, y1]] };
  for (const x of [x0, x1]) for (const [a, b] of ends[x]) for (const y of along(a, b)) if (y !== y0 && y !== y1) posts.push([x, y]);
  for (const [x, y] of posts) box(`${name}.post`, [x - s, y - s, z], [x + s, y + s, z + h], { tone: "mid" }, { sys, r: 0.3 });
  const clamps = (pts) => bolt(pts, 0.32);
  for (const [y, out] of [[y0, -1], [y1, 1]]) {
    box(`${name}.top`, [x0 - s, y - s, z + h], [x1 + s, y + s, z + h + 2], { tone: "hi" }, { sys, r: 0.4 });
    const ya = out > 0 ? y + s : y - s - t;
    const xs = posts.filter((p) => p[1] === y).map((p) => p[0]);
    for (const [z0, z1, part] of [[z + h / 2 - 1, z + h / 2 + 1, "knee"], [z, z + 4, "toe"]])
      box(`${name}.${part}`, [x0 - s, ya, z0], [x1 + s, ya + t, z1], { tone: part === "toe" ? "mid" : "hi" }, { sys, r: 0.3, extra: out > 0 ? clamps(xs.map((x) => [x, ya + t, (z0 + z1) / 2])) : "" });
  }
  for (const [x, out] of [[x0, -1], [x1, 1]]) {
    for (const [a, b] of ends[x]) {
      box(`${name}.top`, [x - s, a === y0 ? a + s : a - s, z + h], [x + s, b === y1 ? b - s : b + s, z + h + 2], { tone: "hi" }, { sys, r: 0.4 });
      const xa = out > 0 ? x + s : x - s - t;
      for (const [z0, z1, part] of [[z + h / 2 - 1, z + h / 2 + 1, "knee"], [z, z + 4, "toe"]])
        box(`${name}.${part}`, [xa, a === y0 ? a - s - t : a - s, z0], [xa + t, b === y1 ? b + s + t : b + s, z1], { tone: part === "toe" ? "mid" : "hi" }, { sys, r: 0.3 });
    }
  }
}
// a sheet-steel cabinet on a plinth: doors, louvres, hinges and handles on the front face y = y1
function cabinet(name, [x0, y0, z0], [x1, y1, z1], { doors = 1, sys = SYS, warn = false, stop = false, louvres = 4 } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r: 0.8 };
  box(`${name}.plinth`, [x0 + 1.5, y0 + 1.5, z0], [x1 - 1.5, y1 - 1.5, z0 + 3], { tone: "lo" }, { sys, r: 0.4 });
  const zb = z0 + 3;
  const yf = y1 + 0.05;
  const w = (x1 - x0) / doors;
  const lines = [];
  const hinges = [];
  for (let i = 0; i < doors; i++) {
    const d0 = x0 + i * w + 1.6;
    const d1 = x0 + (i + 1) * w - 1.6;
    lines.push(faceY(yf, d0, d1, zb + 2, z1 - 2));
    for (let j = 0; j < louvres; j++) lines.push(faceY(yf, d0 + 3, d1 - 3, zb + 6 + j * 3.4, zb + 7.4 + j * 3.4));
    const hx = i % 2 ? d1 - 1 : d0 + 1;
    hinges.push([hx, yf, zb + 9], [hx, yf, z1 - 9], [hx, yf, (zb + z1) / 2]);
  }
  lines.push(faceY(yf, x0 + 4, x0 + 13, z1 - 10, z1 - 6));
  // a status window and three indicator lights by the label plate
  const lx = x0 + 16;
  if (x1 - x0 > 26) lines.push(faceY(yf, lx, lx + 8, z1 - 11, z1 - 5));
  const leds = x1 - x0 > 26 ? [0, 1, 2].map((j) => [lx + 11 + j * 2.4, yf, z1 - 8]) : [];
  box(name, [x0, y0, zb], [x1, y1, z1], { tone: "mid" }, { sys, r: 0.8, steps: 2, bevel: 0.5,
    inner: Ln(k.sideSeam(plan, z1 - 3, P, 2), { tone: "faint" }),
    extra: Ln(lines.join(""), { tone: "lo" }) + bolt(hinges, 0.55, "mid") + bolt(k.corners(plan, 1.6).map(([x, y]) => [x, y, z1]), 0.42) + bolt([[x0 + 4.8, yf, z1 - 8], [x0 + 12.2, yf, z1 - 8]], 0.3) +
      (leds.length ? `<g class="eu-led" data-led="${name}">${bolt(leds, 0.62, "hi")}</g>` : "") });
  for (let i = 0; i < doors; i++) {
    const hx = i % 2 ? x0 + i * w + 4.5 : x0 + (i + 1) * w - 4.5;
    const zc = (zb + z1) / 2;
    box(`${name}.handle`, [hx - 0.8, y1, zc - 6], [hx + 0.8, y1 + 1.6, zc + 6], { tone: "hi" }, { sys, r: 0.3 });
  }
  if (warn) box(`${name}.warn`, [x0 + 5, y1, z1 - 22], [x0 + 12, y1 + 0.3, z1 - 15], tint("warn"), { sys, r: 0.2 });
  if (stop) {
    const x = x0 + (doors > 1 ? w / 2 : 10);
    const z = z1 - 16;
    disc(`${name}.stop.collar`, yF(x, y1, z), 0, 1, 4.6, tint("warn"), { sys });
    turned(`${name}.stop`, yF(x, y1 + 1, z), [[0, 1.6], [1.4, 1.6], [1.6, 3.4, 1], [2.8, 3.7, 1], [3.6, 2.9, 1], [4, 0.6]], tint("stop"), { sys });
  }
}
// a round dial on a face y = yf: bezel ring, tick dots, a needle from its hub
function gauge(name, x, yf, z, r = 4, { sys = SYS, needle = 0.7 } = {}) {
  const F = yF(x, yf, z);
  const face = yf + 1.45;
  const tip = [x + (r - 1.7) * Math.cos(needle), face, z + (r - 1.7) * Math.sin(needle)];
  disc(name, F, 0, 1.4, r, { tone: "hi" }, { sys,
    extra: Ln(G.circleOf(F, 1.4, r - 0.55, P, 40), { tone: "lo" }) + Dots(G.dotsOf(F, 1.4, r - 1.2, 12, P, { all: true }), { size: 0.24, tone: "lo" }) +
      Ln(path3([[x, face, z], tip]), { tone: "lo", free: "end" }) + bolt([[x, face, z]], 0.45) });
}
// a horizontal pressure vessel on saddles: dished heads, two straps, manways with bolt circles, nozzles on top
function tank(name, x0, x1, y, zc, r, { sys = SYS, saddles = [0.18, 0.82], nozzles = [], floor = 146, roof = 244 } = {}) {
  const F = xF(x0, y, zc);
  const L = x1 - x0;
  const hd = Math.min(10, r * 0.55);
  // the straps are steps in the same turned profile, so the tank and its straps order as one part
  const straps = saddles.flatMap((f) => [[L * f - 1.6, r], [L * f - 1.6, r + 1.2], [L * f + 1.6, r + 1.2], [L * f + 1.6, r]]);
  const prof = [[0, r * 0.32], [hd * 0.1, r * 0.6, 1], [hd * 0.3, r * 0.8, 1], [hd * 0.62, r * 0.94, 1], [hd, r], ...straps, [L - hd, r], [L - hd * 0.62, r * 0.94, 1], [L - hd * 0.3, r * 0.8, 1], [L - hd * 0.1, r * 0.6, 1], [L, r * 0.32]];
  const strapBolts = saddles.map((f) => Dots(G.dotsOf(F, L * f, r + 1.2, 6, P, { fade: [0.05, 0.4] }), { size: 0.3 })).join("");
  turned(name, F, prof, { tone: "hi" }, { sys, inner: Ln(G.arcOf(F, hd, r, P) + G.arcOf(F, L - hd, r, P), { tone: "faint" }), extra: strapBolts });
  for (const [s0, s1] of [[-1.6, 0], [L, L + 1.6]]) {
    const out = s0 < 0 ? -1 : 1;
    const face = seen([out, 0, 0]) ? Dots(G.dotsOf(F, out < 0 ? s0 : s1, r * 0.34, 10, P, { all: true }), { size: 0.34 }) : "";
    disc(`${name}.manway`, F, s0, s1, r * 0.42, { tone: "mid" }, { sys, owner: name, extra: face });
  }
  for (const f of saddles) {
    const s = L * f;
    box(`${name}.saddle`, [x0 + s - 3.4, y - r * 0.62, floor], [x0 + s + 3.4, y + r * 0.62, zc - r - 1.2], { tone: "lo" }, { sys, r: 0.3,
      extra: bolt([[x0 + s - 2.2, y + r * 0.62, floor + 1.2], [x0 + s + 2.2, y + r * 0.62, floor + 1.2]], 0.34) });
  }
  nozzles.forEach((s, j) => {
    const top = zc + r - 0.3;
    const N = zF(x0 + s, y, top);
    turned(`${name}.nozzle`, N, [[0, 2.4], [5, 2.4], [5, 3.8], [6.6, 3.8]], { tone: "mid" }, { sys, owner: name, extra: Dots(G.dotsOf(N, 6.6, 3.2, 6, P, { all: true }), { size: 0.28 }) });
    pipe(`${name}.line${j}`, [[x0 + s, y, top + 6.6], [x0 + s, y, roof]], 2.2, { sys, maxLength: 24 });
  });
}

// ------------- 13 left module: service platform, tanks, cabinets, manifold
SYS = "deck";
// its right edge stops short of where the source chamber slides when the machine comes apart
const LM = { x0: -479, x1: -298, y0: -119, y1: 21 };
for (const x of [-476, -387, -301]) for (const y of [-116, 18]) {
  column("deck.left.post", x, y, 0, 140, { plate: true });
  column("deck.left.post", x, y, 146, 244);
}
deck("deck.left.mid", LM.x0, LM.x1, LM.y0, LM.y1, 140);
deck("deck.left.top", LM.x0, LM.x1, LM.y0, LM.y1, 244);
railing("deck.left.rail", -474, -303, -114, 16, 250, { gaps: [[-32, -8]] });
// a ladder up the end, bracketed to both decks
for (const y of [-30, -10]) {
  box("deck.ladder.stile", [-484, y - 1.5, 0], [-482, y + 1.5, 290], { tone: "mid" }, { r: 0.3 });
  for (const z of [141, 245]) box("deck.ladder.bracket", [-482, y - 1.5, z], [-479, y + 1.5, z + 4], { tone: "lo" }, { r: 0.2, extra: bolt([[-480.5, y + 1.5, z + 2]], 0.3) });
}
for (let z = 12; z < 286; z += 11) rod("deck.ladder.rung", [-483, -28.5, z], [-483, -11.5, z], 0.75, { tone: "hi" });
tank("deck.tank.a", -470, -391, -2, 168, 18, { nozzles: [28, 54] });
tank("deck.tank.b", -383, -307, -2, 168, 18, { nozzles: [24, 52] });
tank("deck.tank.c", -468, -306, -78, 170, 16, { saddles: [0.12, 0.5, 0.88], nozzles: [38, 100, 130] });
// exhaust fan box on the platform: the duct over the top tier starts here
box("deck.exhaust", [-345, -60, 250], [-315, -30, 285], { tone: "mid" }, { r: 1, steps: 2, bevel: 0.4,
  inner: Ln(k.sideSeam({ x: -345, y: -60, w: 30, d: 30, r: 1 }, 280, P, 2), { tone: "faint" }),
  extra: Ln(Array.from({ length: 5 }, (_, j) => faceY(-29.95, -340, -320, 256 + j * 4, 257.6 + j * 4)).join(""), { tone: "lo" }) + bolt(k.corners({ x: -345, y: -60, w: 30, d: 30 }, 1.6).map(([x, y]) => [x, y, 285])) });
SYS = "power";
cabinet("power.left.cab", [-472, -60, 0], [-450, 14, 128]);
cabinet("power.left.cab", [-448, -60, 0], [-426, 14, 128]);
cabinet("power.left.ecab", [-348, -24, 0], [-306, 14, 120], { warn: true });
for (let i = 0; i < 5; i++) {
  const x = -334 + i * 6;
  disc("power.left.gland", yF(x, 14, 10), 0, 1.6, 1.3, { tone: "hi" });
  disc("power.left.grommet", zF(x, 24, 0), 0, 0.8, 1.9, { tone: "lo" });
  pipe(`power.left.cable.${i}`, [[x, 15.6, 10], [x, 24, 10], [x, 24, 0.8]], 0.7, { flanges: [false, false], bend: 3, limp: true, className: "eu-tint eu-black" });
}
SYS = "cool";
box("cool.left.manifold", [-424, 0, 0], [-352, 14, 12], { tone: "mid" }, { r: 0.8, steps: 2, bevel: 0.4,
  inner: Ln(k.sideSeam({ x: -424, y: 0, w: 72, d: 14, r: 0.8 }, 4, P, 2), { tone: "faint" }),
  extra: bolt(k.corners({ x: -424, y: 0, w: 72, d: 14 }, 1.6).map(([x, y]) => [x, y, 12])) });
for (let i = 0; i < 6; i++) {
  const c = -418 + i * 12;
  turned("cool.left.valve", zF(c, 7, 12), [[0, 3.2], [5, 3.2]], { tone: "hi" }, { inner: Ln(G.arcOf(zF(c, 7, 12), 2.5, 3.2, P), { tone: "faint" }) });
  box("cool.left.lever", [c - 0.6, 10.1, 14], [c + 0.6, 17, 15.4], tint("water"), { owner: "cool.left.valve", r: 0.3 });
  pipe(`cool.left.riser.${i}`, [[c, 7, 17], [c, 7, 140]], 1.8, { tone: "hi", maxLength: 30 });
  if (i < 5) gauge("cool.left.gauge", c + 6, 14, 6, 2.6);
}

// ------------- 14 right module: hose bay and tall cabinets, valve panel, floor cabinet, sensor head, water manifold
SYS = "deck";
for (const x of [428, 528, 628]) for (const y of [-116, 18]) {
  column("deck.right.post", x, y, 0, 150, { plate: true });
  column("deck.right.post", x, y, 156, 262);
  column("deck.right.post", x, y, 268, 414);
}
deck("deck.right.low", 425, 631, -119, 21, 150);
deck("deck.right.mid", 425, 631, -119, 21, 262);
SYS = "power";
cabinet("power.right.cab", [500, -40, 0], [560, 14, 120], { doors: 2, warn: true });
cabinet("power.right.tall", [532, -60, 268], [624, 14, 410], { doors: 2, stop: true, louvres: 6 });
column("power.sensor.stand", 479, 4, 0, 40, { s: 1.6, plate: true });
box("power.sensor", [470, -2, 40], [488, 10, 58], { tone: "hi" }, { r: 1, steps: 2, bevel: 0.4,
  inner: Ln(k.sideSeam({ x: 470, y: -2, w: 18, d: 12, r: 1 }, 54, P, 2), { tone: "faint" }), extra: bolt([[471.6, 10, 56.4], [486.4, 10, 56.4], [471.6, 10, 41.6], [486.4, 10, 41.6]], 0.36) });
turned("power.sensor.plug", yF(479, 10, 49), [[0, 2.4], [2.4, 2.4], [2.4, 1.7], [5, 1.7]], tint("pink"));
disc("power.sensor.grommet", zF(479, 24, 0), 0, 0.8, 2, { tone: "lo" });
pipe("power.sensor.cable", [[479, 15, 49], [479, 24, 49], [479, 24, 0.8]], 0.9, { flanges: [false, false], bend: 4, limp: true, className: "eu-tint eu-black" });
SYS = "cool";
// two risers from the floor, each cut by four valve bodies: the pipe runs from body to body, so nothing wraps anything.
// They stand where no frame post lines up with them on screen.
const VZ = [40, 70, 100, 130];
// The second one stands outside the frame, as in the photo, and turns into the side of the lower deck.
for (const [j, [x, y]] of [[590, 6], [640, 6]].entries()) {
  disc("cool.right.port", zF(x, y, 0), 0, 1, 4.2, { tone: "lo" });
  const last = j ? [[x, y, 153], [631, y, 153]] : [[x, y, 150]];
  [1, ...VZ.map((z) => z + 3.6)].forEach((z0, i) => pipe(`cool.right.header.${j}.${i}`, [[x, y, z0], ...(i < VZ.length ? [[x, y, VZ[i] - 3.6]] : last)], 2.4, { tone: "hi", flanges: [false, false], maxLength: 30, bend: 6 }));
  VZ.forEach((z, i) => {
    box("cool.right.valve", [x - 3.6, y - 3.6, z - 3.6], [x + 3.6, y + 3.6, z + 3.6], { tone: "mid" }, { r: 0.6, extra: bolt([[x - 2.4, y + 3.6, z + 2.4], [x + 2.4, y + 3.6, z - 2.4]], 0.3) });
    box("cool.right.lever", [x - 0.6, y + 3.6, z + 1.2], [x + 0.6, y + 10, z + 2.6], tint("water"), { owner: "cool.right.valve", r: 0.3 });
    if (j === 0) {
      const lane = 563 + i * 5.5;
      pipe(`cool.right.hose.${i}`, [[x - 3.6, y, z], [lane, y, z], [lane, y, 150]], 1.4, { bend: 4, className: "eu-tint eu-water" });
    }
  });
}
box("cool.panel", [436, -40, 156], [620, -36, 258], { tone: "mid" }, { r: 0.4,
  extra: bolt([0.03, 0.25, 0.5, 0.75, 0.97].flatMap((f) => [[436 + 184 * f, -36, 254.5], [436 + 184 * f, -36, 159.5]]), 0.38) });
for (let i = 0; i < 7; i++) {
  const c = 450 + i * 26;
  gauge("cool.panel.gauge", c, -36, 236, 4.6, { needle: 0.4 + i * 0.3 });
  for (const z of [206, 176]) {
    box("cool.panel.valve", [c - 3.5, -36, z - 3.5], [c + 3.5, -30, z + 3.5], { tone: "hi" }, { r: 0.6, extra: bolt([[c - 2.3, -30, z + 2.3], [c + 2.3, -30, z - 2.3]], 0.3) });
    box("cool.panel.lever", [c + 3.5, -32, z + 1], [c + 10, -30.8, z + 2.4], tint("water"), { owner: "cool.panel.valve", r: 0.3 });
  }
  pipe(`cool.panel.hose.${i}`, [[c, -30, 176], [c, -22, 176], [c, -22, 156]], 1.3, { bend: 4, className: "eu-tint eu-water" });
}
// the hose bay: X braces front and back, and three rows of hose loops hanging from bars under the top deck
for (const y of [18, -116]) {
  brace("cool.bay.brace", [430.5, y + 1.6, 270], [525.5, y, 412], 0.9);
  brace("cool.bay.brace", [430.5, y - 1.6, 412], [525.5, y, 270], 0.9);
}
[-30, -55, -80].forEach((y, j) => {
  box("cool.bay.bar", [432, y - 2, 410], [524, y + 2, 414], { tone: "mid" }, { r: 0.4 });
  [[436, 452], [458, 476], [482, 500], [506, 522]].forEach(([xa, xb], n) => {
    const zl = 296 + ((j * 3 + n * 7) % 5) * 10;
    pipe(`cool.loop.${j}.${n}`, [[xa, y, 410], [xa, y, zl], [xb, y, zl], [xb, y, 410]], 1.6, { bend: (xb - xa) / 2 - 0.3, limp: true, maxLength: 24, bundle: "bay", className: "eu-tint eu-black" });
  });
});

// ------------- 15 top tier over the optics: cable tray, exhaust duct, bulkhead of ports
SYS = "deck";
for (const x of [-258, -110, 40, 225]) column("deck.top.post", x, -114, 0, 414, { plate: true });
deck("deck.top", -262, 425.5, -119, -40, 414, { grate: false });
deck("deck.right.top", 425.5, 631, -119, 21, 414);
// the duct runs low along the top tier's front edge, so on screen it passes below the tray and the ports, not over them
pipe("deck.duct", [[-330, -45, 285], [-330, -45, 440], [500, -45, 440], [500, -45, 420]], 6, { tone: "hi", bend: 14, maxLength: 40 });
for (const x of [-200, -40, 120, 300]) box("deck.duct.stand", [x - 3, -49, 420], [x + 3, -41, 434], { tone: "lo" }, { owner: "deck.duct", r: 0.3, extra: bolt([[x - 1.8, -41, 421.2], [x + 1.8, -41, 421.2]], 0.3) });
box("deck.bulkhead", [-70, -118, 420], [70, -114, 488], { tone: "mid" }, { r: 0.4,
  extra: bolt([0.04, 0.5, 0.96].flatMap((f) => [[-70 + 140 * f, -114, 485], [-70 + 140 * f, -114, 423]]), 0.4) });
for (const [x, z] of [[-32, 442], [32, 442], [-32, 468], [32, 468]]) {
  const F = yF(x, -114, z);
  disc("deck.port", F, 0, 3, 12, { tone: "hi" }, { extra: Dots(G.dotsOf(F, 3, 10.4, 12, P, { all: true }), { size: 0.42 }) });
  const C = yF(x, -111, z);
  disc("deck.port.cover", C, 0, 1.4, 8, { tone: "mid" }, { extra: Ln(G.circleOf(C, 1.4, 5.6, P, 40), { tone: "faint" }) + Dots(G.dotsOf(C, 1.4, 7, 8, P, { all: true }), { size: 0.3 }) });
}
SYS = "power";
for (const y of [-112, -94]) box("power.tray.rail", [-240, y, 420], [400, y + 2, 426], { tone: "mid" }, { r: 0.3 });
for (let x = -230; x <= 390; x += 24) box("power.tray.rung", [x - 1, -110, 420], [x + 1, -94, 421.5], { tone: "lo" }, { r: 0.2 });
for (const x0 of [-258, 404]) box("power.tray.box", [x0, -114, 420], [x0 + 14, -90, 434], { tone: "mid" }, { r: 0.8, steps: 2, bevel: 0.4,
  extra: Ln(faceY(-89.95, x0 + 2, x0 + 12, 422, 432), { tone: "lo" }) + bolt([[x0 + 3, -89.95, 423], [x0 + 11, -89.95, 423], [x0 + 3, -89.95, 431], [x0 + 11, -89.95, 431]], 0.32) });
// four cables lying just clear of the rungs, well inside the side rails
for (let i = 0; i < 4; i++) pipe(`power.tray.cable.${i}`, [[-244, -106.8 + i * 3.2, 422.95], [404, -106.8 + i * 3.2, 422.95]], 0.9, { maxLength: 80, limp: true, bundle: "tray", className: i % 2 ? "eu-tint eu-water" : "eu-tint eu-black" });

// ------------- 16 the small lines: conduits into the decks, cable drops, a connector panel, hoses over the top
// conduits from every cabinet roof up into the deck above it
for (const [x0, x1, y, top, roof] of [[-472, -450, -23, 128, 140], [-448, -426, -23, 128, 140], [-348, -306, -5, 120, 140], [514, 560, -13, 120, 150], [532, 624, -23, 410, 414]]) {
  const n = Math.max(2, Math.floor((x1 - x0 - 6) / 6));
  for (let i = 0; i < n; i++) pipe(`power.conduit.${x0}.${i}`, [[x0 + 4 + ((x1 - x0 - 8) * i) / (n - 1), y, top], [x0 + 4 + ((x1 - x0 - 8) * i) / (n - 1), y, roof]], 0.8, { tone: "hi", className: i % 3 === 1 ? "eu-tint eu-black" : undefined });
}
// cable drops: from the tray's left junction box down beside the frame to the floor, and up the top-tier posts
for (let i = 0; i < 3; i++) {
  const y = -112 + i * 3; // behind the source chamber, also when it slides out
  disc("power.drop.grommet", zF(-269, y, 0), 0, 0.8, 1.9, { tone: "lo" });
  pipe(`power.drop.${i}`, [[-258, y, 431 - i * 2.6], [-269, y, 431 - i * 2.6], [-269, y, 0.8]], 0.8, { bend: 5 - i * 1.4, limp: true, bundle: "drop", maxLength: 40, className: i === 1 ? "eu-tint eu-water" : "eu-tint eu-black" });
}
for (const x of [40, 225]) for (let i = 0; i < 3; i++) {
  const cx = x - 2.6 + i * 2.6;
  disc("power.riser.grommet", zF(cx, -104, 0), 0, 0.8, 1.2, { tone: "lo" });
  pipe(`power.riser.${x}.${i}`, [[cx, -104, 0.8], [cx, -104, 414]], 0.6, { limp: true, bundle: `riser${x}`, maxLength: 60, className: "eu-tint eu-black" });
}
// connector panel on the platform: three rows of round plugs, the harness head of the left module
{
  const PX = [-466, -404];
  const conns = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 11; c++) conns.push([PX[0] + 5 + c * 5.2, -103.95, 260 + r * 8]);
  const rings = conns.map(([x, y, z]) => G.circleOf(yF(x, y, z), 0, 1.6, P, 18)).join("");
  box("power.patch", [PX[0], -108, 250], [PX[1], -104, 288], { tone: "mid" }, { sys: "power", r: 0.6, steps: 2, bevel: 0.3,
    extra: Ln(rings, { tone: "lo" }) + bolt(conns, 0.5, "hi") + bolt([[PX[0] + 1.6, -103.95, 286.4], [PX[1] - 1.6, -103.95, 286.4], [PX[0] + 1.6, -103.95, 251.6], [PX[1] - 1.6, -103.95, 251.6]], 0.36) });
}
// two water hoses over the top tier, from the port bulkhead's side across to the right module's roof
for (const [i, [z, xd]] of [[470, 470], [478, 480]].entries())
  pipe(`cool.top.hose.${i}`, [[70, -116, z], [xd, -116, z], [xd, -116, 420]], 1.5, { bend: 10, maxLength: 60, className: "eu-tint eu-water" });

// ---------------------------------------------------------------- settle and assemble
A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
const indexOf = (pred) => R.items.reduce((best, item, index) => (pred(item) ? index : best), -1);
const stageSlot = indexOf((it) => it.name === "stages.chucks");

// Moving parts live in reserved slots of the settled order.
const slots = new Map();
const addSlot = (index, svg, piece) => slots.set(index, [...(slots.get(index) ?? []), { svg, piece }]);
const inside = (prefixes) => indexOf((it) => prefixes.some((p) => it.name === p || it.name.startsWith(p + ".")) && !/\.(post|top\.front|top\.right|crossbeam|airmount|column|right)$/.test(it.name));

// droplets, the laser hit and the source light, inside the vessel after the collector and generator
const DROPS = 9;
addSlot(inside(["collector", "tin", "final.focus", "vessel.back", "vessel.left", "vessel.floor"]),
  lightSvg("src") +
  `<g data-part="laser-hit"><path class="eu-laser" d="${path3([[PL[0], Y0, FFOC.z1], PLASMA])}"/></g>` +
  `<g data-part="drops">${Array.from({ length: DROPS }, () => `<ellipse class="eu-drop" rx="1.1" ry="1.1" cx="0" cy="0"/>`).join("")}</g>` +
  `<defs><radialGradient id="eu-plasma-grad"><stop offset="0" class="eu-st0"/><stop offset="0.3" class="eu-st1"/><stop offset="1" class="eu-st2"/></radialGradient></defs>` +
  `<g data-part="plasma"><circle class="eu-plasma-halo" cx="${f2(at(PLASMA)[0])}" cy="${f2(at(PLASMA)[1])}" r="18"/><circle class="eu-plasma-core" cx="${f2(at(PLASMA)[0])}" cy="${f2(at(PLASMA)[1])}" r="2.6"/></g>`, "source");

// light: after the last item inside each housing, before its front frame
addSlot(inside(["illum.ffm", "illum.pfm", "illum.mc", "illum.mg", "illum.back", "illum.left", "illum.floor"]), lightSvg("ill") +
  `<g data-part="if-glow"><circle class="eu-if" cx="${f2(at(xz(IFP))[0])}" cy="${f2(at(xz(IFP))[1])}" r="2.2"/></g>`, "illum");
addSlot(inside(["po.m1", "po.m2", "po.m3", "po.m4", "po.m5", "po.m6", "po.back", "po.left", "po.floor", "po.dgl"]), lightSvg("po"), "po");

// reticle carriage on top: built at rest over the reticle, moved along x
const CAR = { x0: RX - 26, x1: RX + 26, y0: RAIL_Y[0] - 2, y1: RAIL_Y[1] + 6, z0: PO[5] + 6, z1: PO[5] + 14 };
// long-stroke motor blocks on both rails, a bridge between them, and the short-stroke stage on top that
// trims the reticle's position to nanometres; the clamp under the bridge holds the mask by electrostatics
const blockOf = (y) => ({ x: CAR.x0, y: y - 2, w: CAR.x1 - CAR.x0, d: 8, r: 1.4 });
const BRIDGE = { x: CAR.x0 + 3, y: RAIL_Y[0] + 6, w: CAR.x1 - CAR.x0 - 6, d: RAIL_Y[1] - RAIL_Y[0] - 8, r: 1 };
const SHORT = { x: RX - 18, y: Y0 - 18, w: 36, d: 36, r: 2 };
const motor = (plan) => S(k.slabOf(plan, CAR.z0, 11, P, 3, 0.4), { tone: "mid", inner: Ln(k.sideSeam(plan, CAR.z0 + 4, P, 3), { tone: "faint" }) }) +
  Dots(k.corners(plan, 1.6).map(([x, y]) => at([x, y, CAR.z0 + 11])), { size: 0.4 });
const reticleSvg = [
  S(k.slabOf({ x: RX - 15.2, y: Y0 - 15.2, w: 30.4, d: 30.4, r: 0.5 }, RZ, 1.3, P, 2), { tone: "hi" }),
  S(k.slabOf({ x: RX - 13, y: Y0 - 13, w: 26, d: 26, r: 0.4 }, RZ + 1.3, CAR.z0 + 2 - RZ - 1.3, P, 2), { tone: "lo" }),
  motor(blockOf(RAIL_Y[0])),
  S(k.slabOf(BRIDGE, CAR.z0 + 2, 7, P, 2, 0.4), { tone: "mid" }),
  S(k.slabOf(SHORT, CAR.z0 + 9, 4, P, 3, 0.6), { tone: "hi", inner: Ln(k.sideSeam(SHORT, CAR.z0 + 11, P, 3), { tone: "faint" }) }),
  Ln(k.planOutline(k.insetPlan(SHORT, 4), CAR.z0 + 13, P, 3), { tone: "faint" }),
  Dots(k.corners(SHORT, 2).map(([x, y]) => at([x, y, CAR.z0 + 13])), { size: 0.5 }),
  ...byDepth([[SHORT.x + 6, SHORT.y + 6], [SHORT.x + SHORT.w - 6, SHORT.y + 6], [SHORT.x + 6, SHORT.y + SHORT.d - 6], [SHORT.x + SHORT.w - 6, SHORT.y + SHORT.d - 6]])
    .map(([x, y]) => S(k.cylinder(x, y, 1.6, CAR.z0 + 13, 2.2, P, 16), { tone: "mid" })),
  motor(blockOf(RAIL_Y[1])),
].join("");
addSlot(R.items.length - 1, `<g class="it" data-sys="reticle" data-part="reticle-stage">${reticleSvg}</g>`, "reticle");

addSlot(stageSlot, `<g class="it" data-sys="stages" data-part="chuck-a">${chuckSvg(WX, "a")}</g><g class="it" data-sys="stages" data-part="chuck-b">${chuckSvg(MEAS_X, "b")}</g>` +
  `<g data-part="level-beams">${Ln(path3([[LS.pro + 6, Y0, LS.z + 2], [MEAS_X, Y0, WZ + 0.05], [LS.det - 6, Y0, LS.z + 2]]), { tone: "lit", className: "eu-ls" })}${Dots([at([MEAS_X, Y0, WZ + 0.05])], { size: 0.8, tone: "hi" })}</g>` +
  `<g data-part="slit"><path class="eu-slit" d="${k.onTop([[WX - 0.5, Y0 - mm(13)], [WX + 0.5, Y0 - mm(13)], [WX + 0.5, Y0 + mm(13)], [WX - 0.5, Y0 + mm(13)]], WZ + 0.05, P, true)}"/></g>`, "stand");

// Every item and every live slot sits in its own wrapper with its settled key and its lift (how much nearer the
// viewer its assembly's move takes it), so the page can re-sort them while the machine comes apart.
const liftOf = (piece) => G.dot3(PIECES[piece], V);
const wrap = (piece, key, inner) => `<g class="pc" data-piece="${piece}" data-k="${key.toFixed(5)}" data-l="${liftOf(piece).toFixed(4)}">${inner}</g>`;
const groups = R.items.map((item, index) =>
  wrap(item.piece, item.key, `<g class="it" data-sys="${item.sys}" data-name="${item.name}">${item.svg}</g>`) +
  (slots.get(index) ?? []).map((slot, j) => wrap(slot.piece, item.key + 1e-4 * (j + 1), slot.svg)).join(""),
);

const LABEL =
  "A cutaway EUV lithography scanner on a fab floor, with the CO2 drive laser in the subfab below. The laser's seed module and four amplifiers send pulses through a beam tube up into the source vessel, where they hit tin droplets in front of a collector mirror. The 13.5 nm light from the tin plasma converges to the intermediate focus, passes through the illuminator's facet mirrors to a reflective mask on a scanning reticle stage, and six projection mirrors shrink the pattern four times onto a wafer on one of two chucks, while the other chuck is measured under the metrology bridge.";
const svg = k.figureSvg({ width: W, height: H, label: LABEL, body: [...back, `<g class="eu-machine">${groups.join("")}</g>`] });

const DATA = {
  P,
  view: [W, H],
  y0: Y0,
  plasma: at(PLASMA).map(f2),
  drop: { x: PL[0], y0: DG.y1, y1: CATCH.y0, z: PL[1], y: Y0, count: DROPS },
  axisY: k.axisVector(P, [0, 1, 0]),
  axisX: k.axisVector(P, [1, 0, 0]),
  car: { travel: mm(M.RETICLE_FIELD_MM.scan) / 2 },
  wafer: { x: WX, meas: MEAS_X, mm: 1 / 5 },
  fields: M.FIELDS.map((f) => ({ cx: f2((f.x0 + f.x1) / 2), cy: f2((f.y0 + f.y1) / 2), dir: f.dir })),
  moves: Object.fromEntries(Object.entries(PIECES).map(([id, m]) => [id, [f2(at(m)[0] - at([0, 0, 0])[0]), f2(at(m)[1] - at([0, 0, 0])[1])]])),
  stagger: STAGGER,
  spring: SPRING,
};

const CSS = readFileSync(join(HERE, "euv.css"), "utf8");
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));
const SYSTEMS = [
  ["laser", "Drive laser", "CO2, 10.6 µm, about 20 kW in the subfab"],
  ["tin", "Tin droplets", "50,000 a second, about 27 µm across"],
  ["source", "Source and collector", "plasma, pre-pulse and main pulse"],
  ["if", "Intermediate focus", "250 W of 13.5 nm light"],
  ["illum", "Illuminator", "facet mirrors shape the slit"],
  ["reticle", "Reticle stage", "mask face down, scans at 1.57 m/s"],
  ["po", "Projection optics", "six mirrors, 4:1, NA 0.33"],
  ["stages", "Wafer stages", "two chucks, 0.39 m/s scans"],
  ["metro", "Metrology", "height map and marks of the next wafer"],
  ["vac", "Vacuum and hydrogen", "pumps, and H2 that sweeps tin off the mirrors"],
  ["handler", "Handlers", "wafer robot, load lock, reticle library"],
  ["control", "Control racks", "stage, source and dose control"],
  ["deck", "Frame and decks", "steel tiers, service platform, tanks, top-tier duct"],
  ["power", "Power and signal", "cabinets, cable tray, stop button, sensor head"],
  ["cool", "Cooling and service lines", "water manifolds, valve panel, hose loops"],
];
const list = `<ol class="eu-list" data-list>${SYSTEMS.map(([id, name, note], i) => `<li><button type="button" data-pick="${id}"><span class="eu-n">${String(i + 1).padStart(2, "0")}</span> ${name}<span class="eu-note">${note}</span></button></li>`).join("")}</ol>`;
const body =
  `<style>${CSS}</style>` +
  k.plateHtml({
    fig: "Fig 1",
    title: "EUV scanner, cut away",
    hint: "hover a part · ← → · space takes it apart",
    readout: "starting",
    keys: [
      { mark: "lit", label: "13.5 nm light: collector to wafer, eleven mirrors after the plasma" },
      { mark: "red", label: "CO2 drive laser pulse, 10.6 µm" },
      { mark: "raised", label: "Twin wafer chucks: one exposes, one is measured" },
      { mark: "blue", label: "Cooling water hoses and valve handles" },
    ],
    caption: `Tin droplets about ${M.DROPLET_UM} µm across leave the generator at about ${M.DROPLET_MS} m/s, ${M.fmt(M.DROPLET_HZ)} a second. A weak pre-pulse flattens each one into a disc; about ${M.PRE_TO_MAIN_US} µs later the main CO2 pulse (${M.CO2_UM} µm, ${M.PULSE_J} J) turns it into a plasma that glows at ${M.LAMBDA_NM} nm (${M.fmt(M.PHOTON_EV, 1)} eV photons). The collector focuses about ${M.P_IF} W to the intermediate focus. Air and glass both absorb this light, so everything runs in vacuum with a little hydrogen, and every optic is a mirror coated with about ${M.LAYERS} molybdenum and silicon layer pairs, each reflecting about ${Math.round(M.R_MIRROR * 100)}%. After ${M.REFLECTIONS} more reflections about ${M.fmt(M.P_WAFER, 1)} W reaches the wafer. While one wafer is exposed, the other chuck carries the next wafer under the metrology bridge, where a level sensor maps its height and an alignment sensor finds its marks; then the two chucks trade places. Masking blades shut the light between fields. The mask is lit 6° off normal, and the projection mirrors shrink its pattern 4:1, so the reticle stage scans four times as fast as the wafer stage and in the opposite direction. To give the resist ${M.DOSE_MJ_CM2} mJ/cm² through a ${M.FIELD_MM.slit} mm slit, the wafer moves at about ${M.fmt(M.WAFER_SPEED, 2)} m/s and the reticle at about ${M.fmt(M.RETICLE_SPEED, 2)} m/s; one ${M.FIELD_MM.slit} × ${M.FIELD_MM.scan} mm field takes ${Math.round(M.FIELD_SCAN_MS)} ms and about ${M.fmt(Math.round(M.PULSES_PER_FIELD / 100) * 100)} pulses. Motion is slowed: the source about 100,000 times, the stages about 4 times. Droplets are drawn far larger than they are. Round the optics stands the machine as it looks in the fab: an open steel frame in tiers with a service platform, tanks, cabinets, water manifolds, a valve panel, hose loops, a cable tray and an exhaust duct. The real machine weighs about 180 tonnes and ships in about 40 freight containers; its drive laser's beam travels up to 30 m from the subfab to the source. The machine is drawn far more compact than it is.`,
    body: `<div class="iso-stage eu-stage" tabindex="0" role="group" aria-label="EUV scanner. Hover or use the left and right arrow keys to pick a subsystem; space takes the machine apart and puts it back together; P pauses the motion.">${svg}<span class="eu-sr" role="status" aria-live="polite" data-status></span></div><div class="eu-controls"><button type="button" class="eu-apart" data-apart>Take apart</button></div>${list}`,
  });

const kitSource = strip("kit/iso-kit.mjs");
const modelSource = strip("model.mjs");
const page = k.pageHtml({ title: "EUV scanner", theme: THEME, body, script: kitSource + modelSource + LIVE, width: 1240 });
const name = THEME === "light" ? "euv-lithography-light.html" : "euv-lithography.html";
writeFileSync(join(HERE, name), page);
console.log("wrote", name, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `scale ${KS.toFixed(3)}`, `${PIPES.length} pipes`);

A.auditOrExit(R, P, { crowd: CROWD_OK });
