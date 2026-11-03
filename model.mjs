// The EUV scanner model, shared by the build and the live page. Pure numbers, no DOM.
//
// Light: a CO2 laser hits tin droplets, the plasma glows at 13.5 nm, and eleven multilayer mirrors
// carry that light from the source to the wafer. The stages then have to move at whatever speed
// delivers the resist's dose with the power that is left.

export const LAMBDA_NM = 13.5;
export const PHOTON_EV = 1239.84 / LAMBDA_NM; // 91.8 eV per photon

// Source: one droplet, one pre-pulse and one main pulse every 20 microseconds.
export const DROPLET_HZ = 50000;
export const PERIOD_US = 1e6 / DROPLET_HZ; // 20 µs
export const DROPLET_UM = 27; // about 25-30 µm of molten tin
export const DROPLET_MS = 70; // m/s out of the nozzle
export const SPACING_MM = (DROPLET_MS / DROPLET_HZ) * 1000; // 1.4 mm between droplets
export const DISC_UM = 300; // the pre-pulse flattens the droplet into a thin disc, well over 100 µm wide
export const PRE_TO_MAIN_US = 2; // the disc grows for a few microseconds before the main pulse
export const CO2_UM = 10.6; // main pulse wavelength
export const LASER_KW = 20; // average power of the CO2 drive laser
export const PULSE_J = (LASER_KW * 1000) / DROPLET_HZ; // 0.4 J per main pulse
export const AMPLIFIERS = 4; // seed module, then four CO2 power amplifiers in the subfab

// Power down the light path, with every multilayer mirror reflecting about 67% at 13.5 nm.
export const P_IF = 250; // W at the intermediate focus
export const EUV_MJ = (P_IF / DROPLET_HZ) * 1000; // 5 mJ of 13.5 nm light per pulse
export const R_MIRROR = 0.67;
export const LAYERS = 40; // Mo/Si pairs per mirror coating
export const PERIOD_NM = 6.9; // thickness of one Mo/Si pair, about half the wavelength
export const ILLUMINATOR = ["field facet mirror", "pupil facet mirror", "condenser mirror", "grazing mirror"];
export const PROJECTION = ["M1", "M2", "M3", "M4", "M5", "M6"];
export const P_RETICLE = P_IF * R_MIRROR ** ILLUMINATOR.length; // about 50 W
export const P_WAFER = P_RETICLE * R_MIRROR * R_MIRROR ** PROJECTION.length; // about 3 W
export const REFLECTIONS = ILLUMINATOR.length + 1 + PROJECTION.length; // 11 after the collector
export const THROUGHPUT = P_WAFER / P_IF; // about 1.2%

// Imaging: 4:1 reduction, NA 0.33, a 26 mm wide slit scanned 33 mm per field.
export const MAG = 4;
export const NA = 0.33;
export const K1 = 0.32;
export const RESOLUTION_NM = (K1 * LAMBDA_NM) / NA; // about 13 nm lines
export const FIELD_MM = { slit: 26, scan: 33 };
export const RETICLE_FIELD_MM = { slit: FIELD_MM.slit * MAG, scan: FIELD_MM.scan * MAG }; // 104 x 132 mm
export const RETICLE_MM = 152; // 6 inch mask blank
export const CHIEF_RAY_DEG = 6; // light meets the mask 6 degrees off normal
export const WAFER_MM = 300;
export const EDGE_MM = 3;

// Scan speed is set by the dose: the wafer has to move slowly enough for every point under the
// slit to collect DOSE. dose = power / (slit width x speed).
export const DOSE_MJ_CM2 = 30;
export const WAFER_SPEED = P_WAFER / ((DOSE_MJ_CM2 / 1000) * (FIELD_MM.slit / 10)) / 100; // m/s, about 0.39
export const RETICLE_SPEED = WAFER_SPEED * MAG; // about 1.6 m/s, the other way
export const FIELD_SCAN_MS = (FIELD_MM.scan / 1000 / WAFER_SPEED) * 1000; // about 84 ms of light per field
export const PULSES_PER_FIELD = Math.round((FIELD_SCAN_MS / 1000) * DROPLET_HZ); // droplets that light one field

// Fields on the wafer: a 26 x 33 mm grid, scanned in x (the scan axis) and stepped in y. Every field that
// reaches inside the edge ring is exposed, the partial ones at the rim too.
export function fieldsOf(radius = WAFER_MM / 2 - EDGE_MM, field = FIELD_MM) {
  const list = [];
  const nx = Math.ceil(radius / field.scan) + 1;
  const ny = Math.ceil(radius / field.slit) + 1;
  for (let j = -ny; j < ny; j++) {
    const row = [];
    for (let i = -nx; i < nx; i++) {
      const x0 = i * field.scan;
      const y0 = j * field.slit - field.slit / 2;
      const cx = Math.max(x0, Math.min(0, x0 + field.scan));
      const cy = Math.max(y0, Math.min(0, y0 + field.slit));
      if (Math.hypot(cx, cy) < radius) row.push({ x0, y0, x1: x0 + field.scan, y1: y0 + field.slit });
    }
    // Serpentine order: alternate rows run the other way, and so does the scan direction.
    if (((j % 2) + 2) % 2) row.reverse();
    list.push(...row.map((f, k) => ({ ...f, dir: ((j % 2) + 2) % 2 ? -1 : 1, row: j, index: k })));
  }
  return list;
}
export const FIELDS = fieldsOf();

// Twin stages: one chuck exposes while the other measures the next wafer's height map and marks.
export const WPH = 160; // wafers per hour of an NXE:3600-class tool at 30 mJ/cm²

// Phases of one 20 µs source cycle, as fractions of the period.
export const CYCLE = {
  pre: 0.0, // pre-pulse hits the droplet at the primary focus
  main: PRE_TO_MAIN_US / PERIOD_US, // main CO2 pulse hits the disc
  light: PRE_TO_MAIN_US / PERIOD_US + 0.005, // 13.5 nm burst, under 100 ns
};

export const fmt = (value, digits = 0) => value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
