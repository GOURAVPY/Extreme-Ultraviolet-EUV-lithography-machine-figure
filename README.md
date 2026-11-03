# Extreme-Ultraviolet-EUV-lithography-machine-figure

An interactive isometric figure of an EUV lithography scanner, drawn as one machine with its parts in place: the CO2 drive laser in the subfab, tin droplets at 50,000 a second, the source vessel and collector, the all-mirror illuminator, the reflective reticle on its scanning stage, the six-mirror projection optics that shrink 4:1, and twin wafer chucks scanning 4× slower in the opposite direction.

Every number the page shows comes from `model.mjs`, the same module that moves the parts.

## Open it

```bash
node serve.mjs 4319
```

Then open http://localhost:4319 (dark) or http://localhost:4319/euv-lithography-light.html (light).

Hover a part or use ← → to pick a subsystem, Space takes the machine apart, P pauses.

## Build it

```bash
node build.mjs
node build.mjs --light
node build.mjs --audit
```

`build.mjs` writes the two standalone pages. `--audit` proves the geometry: nothing passes through anything, every pipe ends on a real port, and every overlap is drawn in depth order, at rest and in every frame of the take-apart.

## Files

- `model.mjs`: every number (wavelength, droplet rate, mirror reflectivity, dose, scan speeds, field grid)
- `build.mjs`: the geometry and the page
- `live.js`: the motion (source cycle, field-by-field exposure, chuck swap, take-apart springs)
- `euv.css`: theme tokens
- `kit/`: the isometric drawing kit from [anatomy](https://github.com/wheresryan22/anatomy) (MIT)
