# Antigravity build prompt: Foveated 2.5D Lidar Dashboard

Paste this file into Google Antigravity and execute it top to bottom. You receive exactly two inputs: this file and a `mock_frames/` folder (copied to `public/mock/`). The Python backend is NOT running on your machine, so mock mode is the default and complete; live mode is a runtime switch. Do not skip section 11.

## 0. Build order and tiers

Ship the tiers in order; start nothing in a later tier before the earlier one passes section 11. Paragraphs marked `[Tier C]` ship their stated static stand-in when time runs out.

| Tier | Contents |
|---|---|
| A (must ship before anything in B) | setup, types, decoder, densify, geometry plus tests, `MockSource` and `ProceduralSource`, Studio Top-down with hover and pin, Controls, Telemetry, Benchmarks cards 1 to 3, Nav Mock/Live with health-check toast, keyboard strip |
| B | 3D columns, Adaptive vs uniform, Foveation slider, Geometry table and SVG rings (static, no drag dot), Problem, Pipeline (static chips, no mini canvases), Footer |
| C (only after A and B are verified per section 11) | hero canvas sweep, pulse and parallax (otherwise one static seeded frame), pipeline mini canvases and travelling pulse, magnifier canvases, geometry drag dot, PNG export, points overlay, 450 KB bundle budget, Performance-profile check; section 11 items 4 (hero 0.2 s screenshot) and 5 (profile) |

## 1. Mission and definition of done

Build, from an empty folder, a single-page dashboard for "Adaptive Variable Resolution 2.5D Lidar Mapping for Dynamic Environment Perception". A FastAPI backend (nuScenes-mini, SalsaNext-lite) produces a foveated 2.5D grid: 5 cm cells within 10 m growing to 50 cm at 100 m, classified as drivable, non-drivable terrain, static obstacle or dynamic object. The page states the problem, teaches foveation with two data-free interactions, renders the real map in 2D, 3D and against a uniform grid, and proves the measured results: mIoU 0.7466, 24.3 FPS end to end, 29.9x less memory than a uniform 5 cm 2D grid, 449.1x less than 5 cm 3D voxels. Done means: `npm run build` exits 0 with zero TypeScript errors; `npm run test` passes; a 20-frame mock scene plays at 30 or more render FPS; hovering 3 m ahead of the ego reports a 0.05 m cell and 80 m ahead a 0.50 m cell; dynamic objects are coral; every section exists with the exact copy, classes and motion below; section 12 is ticked in your own browser with screenshots in `docs/screenshots/`.

### 1.1 Problem statement coverage

| Problem statement item | Where it is proven on the page |
|---|---|
| Task 1: terrain analysis (drivable vs non-drivable ground) | `#problem` card 1; IoU bars drivable 0.857 and terrain 0.526 in `#benchmarks` card 3 |
| Task 2: static obstacle detection | `#problem` card 2; static IoU 0.872 in card 3; 98 % accuracy at 40 to 100 m in card 2 |
| Task 3: dynamic object detection | `#problem` card 3; coral cells in `#studio`; dynamic IoU 0.730 |
| Expected: deep-learning segmentation | `#pipeline` card 2 (SalsaNext-lite) |
| Expected: variable-resolution, foveated grid | `#foveation` and `#geometry` |
| Expected: real-time performance | `#pipeline` H2, Telemetry rail, 24.3 FPS stat |
| Expected: memory efficiency vs uniform high-res 3D with no alignment errors or data loss | `#benchmarks` card 1 (29.9x, 449.1x), compare-tab badge, `#geometry` paragraph |

## 2. Setup commands

```bash
npm create vite@5 avr-frontend -- --template react-ts
cd avr-frontend
npm i -D vite@5
npm i react@18.3.1 react-dom@18.3.1 framer-motion@11 three@0.169 @react-three/fiber@8 @react-three/drei@9 recharts@2 msgpackr pako zustand@5
npm i -D @types/react@18 @types/react-dom@18 @types/three @types/pako tailwindcss@3.4 postcss autoprefixer vitest@2
npx tailwindcss init -p
mkdir -p public/mock docs/screenshots && cp -r ../mock_frames/* public/mock/
test "$(ls public/mock/frames/scene-0061 | wc -l)" -eq 20 && test -f public/mock/health.json || { echo "mock files missing: mock_frames/ must sit next to avr-frontend/"; exit 1; }
printf "VITE_MOCK=true\nVITE_API_URL=http://localhost:8000\n" > .env
```

The pins matter: create-vite 5 has no interactive prompts and emits a Vite 5 / React 18 template; fiber 9 and drei 10 need React 19; Tailwind 4 has no `init`. The `mock_frames/` folder is the export of `python scripts/export_mock_frames.py --scenes scene-0061 scene-0103 --stride 2`: `scenes.json`, `classes.json`, `health.json`, `metrics.json` and `frames/<scene>/<even idx>.msgpack` (20 per scene, 8.4 MB total).

`index.html` head: `<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital,wght@0,400;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">`, `<title>Adaptive 2.5D Lidar Mapping</title>`. In `tsconfig.app.json` (the file `tsc -b` compiles; `tsconfig.json` is only a solution file) set `"strict": true`, `"noUncheckedIndexedAccess": true`; verify with `npx tsc -b --listFiles | head -1` that the app config is picked up. Scripts: `"build": "tsc -b && vite build"`, `"test": "vitest run"`. `vite.config.ts`: `manualChunks = { three: ["three", "@react-three/fiber", "@react-three/drei"] }`. `vitest.config.ts`: `export default defineConfig({ test: { environment: "node", include: ["src/__tests__/**/*.test.ts"] } })` (no jsdom; the tests are pure logic). `tailwind.config.ts`: `fontFamily.serif = ['"Instrument Serif"', "serif"]`, `fontFamily.sans = ["Inter", "sans-serif"]`, colours `navy #0F172A`, `coral #FF6B9D`, `lime #D4FC79`, `sky #EFF6FF`, `ink #1E293B`.

## 3. Brand and design system

### 3.1 Palette

| Token | Hex | Use |
|---|---|---|
| navy | #0F172A | Dark section and studio backgrounds, dark buttons, chart ink |
| coral | #FF6B9D | Eyebrows, dynamic-object class, error and reconnect states, sparkline |
| lime | #D4FC79 | Live dots, ring outlines, active tabs and toggles, CTA glow, hover outline, focus ring |
| sky | #EFF6FF | Page background, light sections |
| ink | #1E293B | Body text on light surfaces |

Every UI colour is one of these five, white, black, or an alpha variant (`bg-navy/70`, `border-white/10`, `text-ink/50`). No other greys. Lime is never text on a light surface. Coral text only as eyebrows or at 24 px and larger. Coral fills carry navy text, never white (2.6:1 fails AA). Non-class chart series use navy and navy alphas (`#0F172A`, `bg-navy/75`, `bg-navy/50`, `bg-navy/25`) on light cards and white alphas on navy surfaces; coral appears in charts only as the sparkline stroke and the grid-projection stage segment. Lime never fills a bar, line, area or segment; it marks live state, outlines, active tabs, focus rings, badges and the CTA glow.

Map classes are the single exception: 0 `ignore` transparent; 1 `drivable` `#3B82F6`; 2 `terrain_nondrivable` `#22C55E`; 3 `static_obstacle` `#94A3B8`; 4 `dynamic_object` `#FF6B9D` (the brand colour marks the safety-critical class). Colour-blind toggle swaps 1..4 to `#0072B2`, `#009E73`, `#999999`, `#D55E00`. Class colours appear only on cells, legend swatches, class-distribution bars and per-class charts. Names come from `classes.json`; its `colors` array is ignored.

### 3.2 Type, radii, shadows

Headings `font-serif` 400, italic allowed on a second line; Instrument Serif ships only at 400, so never apply `font-medium` or heavier to `font-serif`. Body `font-sans`; numbers `tabular-nums`. Eyebrow `text-xs font-semibold uppercase tracking-[0.18em] text-coral` (`text-lime` on navy). H2 `font-serif text-4xl md:text-6xl leading-[1] tracking-[-0.02em]`. Paragraph `mt-4 text-base md:text-lg leading-relaxed text-ink/70 max-w-2xl`. Cards `rounded-2xl`, controls `rounded-xl`, pills `rounded-full`, cells square. Light card `bg-white border border-navy/[0.08] shadow-[0_4px_12px_rgba(15,23,42,0.06)] hover:shadow-[0_12px_32px_rgba(15,23,42,0.12)] transition-shadow duration-300`. Chart card = light card `p-6`. Dark card `bg-white/5 border border-white/10 backdrop-blur-md p-4`. Ghost button `rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10`. Lime glow `shadow-[0_0_0_4px_rgba(212,252,121,0.35),0_8px_24px_rgba(212,252,121,0.25)]`. Focus `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime focus-visible:ring-offset-2`. Kbd chip `rounded-md border border-navy/15 bg-white px-1.5 py-0.5 font-mono text-[11px]`. Rail heading `text-[11px] uppercase tracking-[0.14em] text-white/40`.

### 3.3 Motion tokens (`src/motion/tokens.ts`; nothing tuned inline)

```ts
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;
export const SPRING = { type: "spring", stiffness: 260, damping: 24, mass: 0.8 } as const;
export const fadeUp = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE_OUT_EXPO } } };
export const fadeUpLg = { hidden: { opacity: 0, y: 40, filter: "blur(6px)" }, show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.9, ease: EASE_OUT_EXPO } } };
export const scaleIn = { hidden: { opacity: 0, scale: 0.96 }, show: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: EASE_OUT_EXPO } } };
export const stagger = (each = 0.06, start = 0) => ({ hidden: {}, show: { transition: { staggerChildren: each, delayChildren: start } } });
export const tabFade = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT_EXPO } }, exit: { opacity: 0, y: -6, transition: { duration: 0.18 } } };
export const hoverLift = { whileHover: { y: -3, transition: { duration: 0.2 } }, whileTap: { scale: 0.98 } };
export const livePulse = { animate: { scale: [1, 1.8], opacity: [0.8, 0] }, transition: { duration: 1.6, repeat: Infinity } };
```

Scroll reveals: `initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }}`. Count-ups: `useCountUp(target, decimals)` runs framer `animate(0, target, { duration: 1.2, ease: EASE_OUT_EXPO })` once when `useInView` fires at `amount: 0.5`, formatted with `Intl.NumberFormat("en-US")`. Live per-frame numbers never count up; they flash: `<motion.span key={value} initial={{ color: "#D4FC79" }} animate={{ color: "inherit" }} transition={{ duration: 0.4 }}>`. Wrap the app in `<MotionConfig reducedMotion="user">`; under reduced motion the hero loop stops, count-ups jump to final values, y, scale and blur motion is removed, opacity fades stay.

## 4. Page structure

Shell `<main className="bg-sky text-ink font-sans antialiased selection:bg-lime selection:text-navy">`, `html { scroll-behavior: smooth }`. Containers `mx-auto max-w-[1440px] px-4 md:px-8`; sections `py-20 md:py-32`. Order: Nav, Hero, Problem, Foveation, Pipeline, Live Map Studio, Benchmarks, Geometry, Footer.

### 4.1 Navigation

`<header className="fixed inset-x-0 top-0 z-50 flex justify-center pt-4 md:pt-6 pointer-events-none">` with pill `pointer-events-auto flex items-center gap-2 md:gap-5 rounded-full bg-navy/70 backdrop-blur-md px-4 md:px-6 py-3 border border-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.25)]`. Logo `viewBox="0 0 24 24"`: `<rect x="1" y="1" width="22" height="22" rx="3" fill="none" stroke="#D4FC79" stroke-opacity=".35"/>`, `<rect x="4.5" y="4.5" width="15" height="15" rx="2" fill="none" stroke="#D4FC79" stroke-opacity=".6"/>`, `<rect x="8" y="8" width="8" height="8" rx="1.5" fill="none" stroke="#D4FC79"/>`, `<rect x="10.5" y="10.5" width="3" height="3" fill="#FF6B9D"/>`. Wordmark `font-serif text-lg text-white` "AVR Lidar". Links `hidden md:flex gap-5 text-sm font-medium text-white/70 hover:text-white transition-colors duration-200`: "Problem", "Foveation", "Pipeline", "Live map", "Benchmarks", "Geometry" to `#problem #foveation #pipeline #studio #benchmarks #geometry`.

Right side, one `flex items-center gap-2` wrapper: a status label `text-xs text-white/70` reading "Mock", "Live", "Reconnecting" or "Procedural"; a status dot `h-2 w-2 rounded-full` with `aria-label` "Source: Mock" / "Live" / "Reconnecting" / "Procedural" (Mock lime static; Live lime with `livePulse`; Reconnecting coral `animate={{ opacity: [1, 0.3, 1] }}` 0.8 s loop; Procedural `bg-white/60`); then the segmented control `rounded-full bg-white/10 p-1 text-xs font-semibold` with buttons "Mock" and "Live" `relative rounded-full px-3 py-1 text-white/70`; the active one is `text-navy` over `motion.div layoutId="sourcePill" className="absolute inset-0 rounded-full bg-lime"` (SPRING). In the Procedural state the "Mock" segment stays active and the label carries the word. Entrance `y: -12 to 0, opacity 0 to 1` over 0.5 s; past 80 px of scroll the pill animates to `py-2`.

### 4.2 Hero (100vh)

`<section className="relative h-screen min-h-[720px] w-full overflow-hidden bg-navy flex flex-col items-center justify-center text-center">`. Layers: `<canvas className="absolute inset-0 z-0 h-full w-full">`, vignette `absolute inset-0 z-[1] pointer-events-none bg-[radial-gradient(ellipse_at_center,rgba(15,23,42,0)_35%,#0F172A_100%)]`, content `relative z-10 mt-16 md:mt-20 px-4`. Entrance timeline (explicit `transition.delay`, `EASE_OUT_EXPO`):

- t = 0.10: canvas opacity 0 to 1 over 1.2 s; sweep starts at t = 0.6.
- t = 0.20: badge (`fadeUp`) `inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 backdrop-blur-sm px-4 py-2 text-sm font-medium text-white/90`, a lime 8 px dot with a `livePulse` sibling absolutely positioned behind it, "Adaptive Variable Resolution 2.5D Lidar Mapping".
- t = 0.35 and 0.50: H1 `font-serif text-5xl sm:text-6xl md:text-7xl lg:text-[88px] leading-[0.95] tracking-[-0.02em] text-white max-w-5xl mt-6`, two `motion.span className="block"` lines with `fadeUpLg`: "Sharp where it matters." then `italic text-lime` "Light everywhere else."
- t = 0.70: subtitle (`fadeUp`) `mt-6 max-w-3xl text-sm sm:text-base md:text-lg leading-relaxed text-white/70`: "A foveated 2.5D lidar map: 5 cm cells within 10 m, 50 cm cells out to 100 m. One 200 m frame costs 4.28 MB instead of 128 MB, streams at 24 FPS, and keeps curbs, poles and pedestrians classified at 0.747 mIoU."
- t = 0.85: CTAs `mt-8 flex flex-col sm:flex-row gap-3 justify-center`. Primary `<a href="#studio">` `rounded-xl bg-lime px-6 sm:px-8 py-3 sm:py-3.5 text-sm font-semibold text-navy hover:shadow-[0_0_0_6px_rgba(212,252,121,0.25),0_8px_24px_rgba(212,252,121,0.35)] transition-shadow duration-300` "Open the live map", `whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}`. Secondary `<a href="#problem">` `rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10 transition-colors duration-300` "Read the method".
- t = 1.00: stats `mt-14 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl`, `stagger(0.08, 1.0)`, children `fadeUp`; value `font-serif text-4xl md:text-5xl text-white tabular-nums` count-up, label `mt-1 text-xs uppercase tracking-[0.18em] text-white/50`: `29.9x` "less memory vs uniform 5 cm 2D"; `449x` "less memory vs 5 cm 3D voxels"; `24.3` "frames per second, end to end"; `0.747` "mean IoU, 4 classes". Values read `DEFAULT_METRICS`, never live frames.
- Scroll cue `absolute bottom-8`: 1 by 40 px `bg-white/30` line, lime 6 px dot `animate={{ y: [0, 34] }}` 1.6 s infinite. Content parallax `x = (mx / w - 0.5) * -6`, `y = (my / h - 0.5) * -8` px via `useSpring`; the canvas moves the opposite way.

#### 4.2.1 Hero canvas (`src/hero/HeroCanvas.tsx`, Canvas 2D)

```
DPR <= 1.5; ResizeObserver; rAF paused when not intersecting or document.hidden; < 4 ms per frame at 1440 x 900
C = (0.5w, 0.56h) (0.62h below 768 px); R = 0.46 * min(w, h)
ring half-sizes (non-linear so all four read): 100 m at R, 40 m at 0.72R, 20 m at 0.50R, 10 m at 0.30R; cell px for rings 0..3: 5, 8, 13, 22
precompute on resize with mulberry32(7): walk each ring's lattice inside its Chebyshev band; u = (p - C) / R
  class: |u.y| < 0.09 drivable; 0.09..0.15 terrain; 0.15..0.19 static with p = 0.35; elsewhere static with p = 0.05, else empty
  keep with occupancy 0.40, 0.26, 0.15, 0.08 by ring; store angle = atan2(p.y - C.y, p.x - C.x)
8 coral rects 0.06 x 0.03 units travel the road at 0.12 units/s, four per direction, wrapping at |u.x| = 1
cells: fillRect in class colour at alpha 0.10 + 0.75 * intensity
static outlines: 1 px rgba(212,252,121,0.35) at the four half-sizes; top-right labels Inter 11 px uppercase, letter-spacing 0.08em, rgba(212,252,121,0.7): "5 cm", "10 cm", "20 cm", "50 cm"
ego: lime 10 px triangle at C pointing up (+x is up)
[Tier C] sweep: theta = (t / 6000) * 2 * PI; 1.5 px lime line from C to the outer edge at alpha 0.9 + a 35 degree trailing conic wedge lime 0.18 -> 0
  every cell whose angle lies between previous and current theta (handle the wrap at PI) gets intensity = 1; every cell decays intensity *= exp(-dt / 1400)
[Tier C] ring pulse every 3000 ms: square outline 0.30R -> R over 2400 ms easeOutCubic, lime 1 px, alpha 0.45 -> 0
[Tier C] parallax: target = (((mx / w) - 0.5) * 16, ((my / h) - 0.5) * 10) px; current += (target - current) * 0.08 per frame; ring r translates by current * (1 + 0.15r)
reduced motion, and the Tier A stand-in: one static seeded frame with the sweep at 45 degrees
```

### 4.3 Problem `#problem`

Light. Eyebrow "The problem". H2 "Millions of points a second." plus italic line "Milliseconds to decide." Paragraph: "3D point clouds are rich but processing millions of points per frame in real time creates compute and memory bottlenecks: a uniform 5 cm voxel map of one 200 m by 200 m by 6 m scene is 1.92 GB. Flat 2D occupancy grids are cheap but collapse a curb, a pothole and an overhang into one occupied bit. Human vision solves this with a fovea: full detail where the eyes point, a simplified periphery. This system does the same with a lidar map."

Cards `mt-14 grid md:grid-cols-2 lg:grid-cols-4 gap-6`, `stagger(0.1)`, children `fadeUp` plus `hoverLift`, light card `p-8`; eyebrow chip `inline-flex rounded-full bg-navy/[0.06] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/60`; below it a `mt-4 h-10 w-10 rounded-xl bg-navy text-lime grid place-items-center font-serif text-xl leading-none` tile showing "1", "2", "3", "4"; title `mt-6 font-serif text-2xl`; body `mt-3 text-sm leading-relaxed text-ink/70`; stat `mt-6 font-serif text-3xl tabular-nums` count-up with label `text-xs uppercase tracking-[0.18em] text-ink/50`:

1. "Task 1" / "Terrain analysis" / "Classify every cell as drivable or non-drivable ground, with per-cell min and max height so curbs and overhangs survive the 3D to 2.5D projection." / `0.857` "IoU drivable".
2. "Task 2" / "Static obstacles" / "Detect walls, poles, barriers and other fixed structure as static obstacles, kept apart from the ground classes by height and label." / `0.872` "IoU static obstacles".
3. "Task 3" / "Dynamic objects" / "Detect pedestrians, cyclists and vehicles as dynamic objects, the class that decides braking." / `0.730` "IoU dynamic objects".
4. "Method" / "Adaptive representation" / "Square rings keyed on Chebyshev distance: 5 cm cells to 10 m, 10 cm to 20 m, 20 cm to 40 m, 50 cm to 100 m. Ring edges are multiples of every cell size, so no cell straddles a boundary and no point is lost." / `534,400` "cells instead of 16,000,000".

### 4.4 Foveation slider `#foveation`

Light. Eyebrow "Foveation". H2 "One map. Four resolutions. Zero seams." Paragraph: "Drag to morph a uniform 5 cm grid into the four-ring adaptive grid. Ring boundaries are integer multiples of every cell size, so no point ever straddles two cells and no height is lost." Layout `mt-12 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 items-start`.

Left: a `w-full aspect-square max-w-[560px]` canvas inside `rounded-2xl bg-navy ring-1 ring-white/10 p-4` drawing the 200 m map as grid hatches at each ring's current pitch: hatch lines 1 px `rgba(255,255,255,0.18)`, capped at 96 lines per side with caption "lines capped for display" `absolute bottom-2 right-3 text-[10px] text-white/40`; ring boundary outlines 1 px lime at the alpha the slider fades in over [0.75, 1]. Below it `<input type="range" min="0" max="1" step="0.001" className="accent-lime h-2 w-full mt-4">` with end labels "Uniform 5 cm" and "Adaptive 4 rings" `text-xs font-semibold text-ink/60`.

Right (light card `p-6`): counters, label `text-xs uppercase tracking-[0.14em] text-ink/50`, value `font-serif text-5xl text-navy tabular-nums`: "Cells" 16,000,000 to 534,400 and "Memory at 8 B per cell" 128.0 MB to 4.28 MB, computed per ring:

```ts
// ring r: s_r = [0.05, 0.10, 0.20, 0.50][r], inner_r = [0, 10, 20, 40][r], outer_r = [10, 20, 40, 100][r]
// ring 3 coarsens 5 -> 50 cm over t in [0, 0.25), ring 2 -> 20 cm over [0.25, 0.5), ring 1 -> 10 cm over [0.5, 0.75); ring 0 stays 5 cm (u = 0)
const u = r === 0 ? 0 : clamp((t - [0, 0.5, 0.25, 0][r]) / 0.25, 0, 1);
const s = 0.05 * (s_r / 0.05) ** u;                                        // geometric cell-size ramp
const cells_r = Math.round((2 * outer_r / s) ** 2 - (2 * inner_r / s) ** 2);
// Cells = sum(cells_r); Memory = Cells * 8 bytes, MB with 2 decimals (1 decimal above 100 MB)
// u = 0: 13,440,000 / 1,920,000 / 480,000 / 160,000; u = 1: 134,400 / 120,000 / 120,000 / 160,000; t = 1 is exactly 534,400 and 4.28 MB
```

At t >= 0.99 a badge `rounded-full bg-lime px-3 py-1 text-xs font-semibold text-navy` pops with SPRING: "29.9x fewer cells, same 200 m coverage". `[Tier C]` Below, four 72 by 72 px magnifier canvases `grid grid-cols-4 gap-2`, each a 1 m by 1 m patch of 400, 100, 25 and 4 cells as 1 px `rgba(15,23,42,0.35)` strokes on `bg-white`, inner fill `rgba(15,23,42,0.06)`, captions `text-[11px] text-ink/60`: "5 m, 5 cm", "15 m, 10 cm", "30 m, 20 cm", "70 m, 50 cm".

### 4.5 Pipeline `#pipeline`

Navy `bg-navy text-white`. Lime eyebrow "Pipeline". H2 "From 34,721 points to a 245 KB map in 41 ms." Paragraph `text-white/70`: "Four stages, one GPU, 24.3 frames per second end to end. Stage times are means over 81 validation frames." Cards `mt-12 grid grid-cols-1 md:grid-cols-4 gap-4 relative`, dark card `p-6`, number `font-serif text-lime text-2xl`, title `mt-2 text-lg font-semibold`, body `mt-2 text-sm text-white/70`, chip `mt-4 inline-flex rounded-full bg-lime/10 px-2.5 py-1 text-xs font-semibold text-lime tabular-nums`:

1. "Point cloud" / "nuScenes LIDAR_TOP, 32 beams, 34,721 points per sweep, 0.89 dropped beyond 100 m." / "input"
2. "Segmentation" / "SalsaNext-lite on a 32 x 1024 range image. Five classes, mIoU 0.747." / "27.5 ms (range proj 8.0 + infer 19.1 + unproject 0.5)"
3. "Grid engine" / "Chebyshev rings, majority vote per cell, z_min and z_max as int16 cm." / "11.4 ms"
4. "2.5D map + wire" / "534,400 cells, 17,969 occupied on average, sparse msgpack." / "2.3 ms, 245 KB"

Cards reveal with `fadeUp`, `stagger(0.1)`. `[Tier C]` Connectors on md and up: 2 px `bg-white/10` lines with a lime pulse `h-2 w-2 rounded-full bg-lime shadow-[0_0_10px_#D4FC79]` travelling card 1 to 4 on a 2.4 s loop, `EASE_IN_OUT`, `repeat: Infinity`, plus one mini canvas per card:

```
canvas: h-[120px] w-full rounded-lg bg-white/5; seed mulberry32(card + 11); 300 points in a 120 x 120 px square
card 1: 1.5 px rgba(255,255,255,0.7) dots
card 2: same dots coloured by class: drivable within |y| < 30 px; terrain 30..45; static elsewhere with p = 0.3; 12 dynamic dots coral
card 3: dots lerp to the centre of their cell on a 3-ring lattice (pitch 4, 8, 16 px at radii 30, 60, 120 px) over 0.5 s EASE_OUT_EXPO
card 4: cells fill as squares in class colour at alpha 0.85 over 0.4 s
each card runs its step once when the pulse reaches its left edge and resets when the pulse restarts
```

### 4.6 Live Map Studio `#studio`

Light. Eyebrow "Live map". H2 "One frame, four resolutions." Paragraph "Every cell is real pipeline output decoded from the same sparse msgpack the backend streams. Hover a 5 cm cell beside the car, then a 50 cm cell at 90 m." Panel `mt-12 rounded-2xl bg-navy p-3 md:p-4 shadow-[0_24px_64px_rgba(15,23,42,0.25)]` revealed with `scaleIn`; inside `grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px] gap-3`. Map area `relative rounded-xl overflow-hidden bg-navy ring-1 ring-white/10 aspect-[4/3] lg:aspect-auto lg:h-[720px]`.

Tab bar `absolute top-3 left-3 z-20 flex gap-1 rounded-xl bg-white/10 backdrop-blur-md p-1`, buttons `relative rounded-lg px-3 py-1.5 text-xs font-semibold text-white/70 hover:text-white`: "Top-down 2.5D", "3D columns", "Adaptive vs uniform"; active `text-navy` over `motion.div layoutId="tabPill" className="absolute inset-0 rounded-lg bg-lime"`; content swaps in `AnimatePresence mode="wait"` with `tabFade`. Three.js is `React.lazy` loaded on first open of tab 2 behind an `absolute top-0 inset-x-0 h-0.5 overflow-hidden` bar whose `w-1/3 bg-lime` child runs `animate={{ x: ["-100%", "300%"] }}` at 1.2 s linear `repeat: Infinity`. Top-right `absolute top-3 right-3 z-20 flex gap-2`: render-FPS badge `rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-white tabular-nums` "60 fps" (rolling 30-sample mean), then a frame chip "scene-0061 / 12 of 39" and a time chip "+6.00 s" (relative to the scene's first `timestamp_us`) sharing the FPS badge classes. Legend `absolute bottom-3 left-3 z-20 rounded-xl bg-navy/80 backdrop-blur-md border border-white/10 p-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-white/80`: 10 px swatch rows "Drivable", "Terrain", "Static", "Dynamic" that toggle layers on click (off rows `opacity-40 line-through`), a `border-t border-white/10 col-span-2` divider, then lime "5 / 10 / 20 / 50 cm". Empty state: the four ring squares from 6.1 at half-sizes 10, 20, 40, 100 m in lime at alpha 0.2 plus centred "Waiting for the first frame" `text-sm text-white/60`.

Left rail "Controls" and right rail "Telemetry" (heading "This frame") are dark cards with rail headings. Readouts are `text-xs text-white/60 tabular-nums`; the scrubber style is a 6 px `bg-white/10` track, lime fill, 16 px white thumb, `ring-2 ring-lime` on focus.

| Element | Spec |
|---|---|
| Transport | three 36 px `rounded-lg bg-white/10 hover:bg-white/15 text-white` buttons: step back, play/pause (icon swap in `AnimatePresence`, scale 0.6 to 1 over 150 ms; `bg-lime text-navy` while playing), step forward. Inline 16 px SVG icons `stroke="currentColor" stroke-width="2" fill="none"`: step back `<path d="M19 20 9 12l10-8v16zM5 19V5"/>`, play `<path fill="currentColor" d="M8 5v14l11-7z"/>`, pause `<path d="M10 4v16M14 4v16"/>`, step forward `<path d="M5 4l10 8-10 8V4zM19 5v14"/>`; `aria-label` "Step back", "Play"/"Pause", "Step forward" |
| Scrubber | `<input type="range">` in the scrubber style; readout "Frame 12 / 39" and "+6.00 s" |
| FPS | segmented control "1 / 5 / 10 / 20 / 30", default 10, active `bg-lime text-navy` |
| Scenes | rows `rounded-lg p-2.5 hover:bg-white/5`, name `text-sm font-semibold text-white`, description `text-xs text-white/60 line-clamp-1`, "39 frames, 20 exported" `text-[11px] text-white/40`; active row gets a 2 px lime left bar via `layoutId="sceneBar"` |
| Confidence | "Confidence at least" `<input type="range" min="0" max="255" step="1">` in the scrubber style, readout "{round(v / 255 * 100)} %"; cells below render at 25 percent alpha |
| Switches | 40 by 22 px, `role="switch"`, white knob, lime track on, `bg-white/15` off, SPRING: "Ring outlines" on, "Height shading" on, "Colour-blind palette" off, "Wireframe (3D)" off, "Points overlay (3D, live only)" off |
| Exaggeration | "Height exaggeration" `<input type="range" min="1" max="5" step="0.5">` in the scrubber style, default 2, readout "2.0x" |
| Buttons | ghost buttons "Reset view" and "Export PNG" |
| Values | `font-serif text-4xl text-white tabular-nums` with the flash rule: "Latency" (`stats.latency_ms.total`, 1 decimal, ms) and "Pipeline FPS" (`1000 / total`). Headline FPS elsewhere always comes from `metrics.json`; this rail says "this frame" because the first mock frame is a cold-start outlier at 60.8 ms |
| Stage bar | 8 px `rounded-full overflow-hidden flex`: `bg-white/80` "segmentation incl. range projection" (`latency_ms.inference`), `bg-coral` "grid projection", `bg-white` "encode"; widths via `motion.div animate={{ width }}` 0.25 s; legend swatches and labels `text-[11px] text-white/50` |
| Sparkline | last 100 totals, recharts `LineChart` full width by 40 px, `stroke="#FF6B9D"` 1.5, no axes, `isAnimationActive={false}` |
| Mini stats | `grid grid-cols-3 gap-2 text-center`, labels as rail headings: "Points", "Occupied cells", "Wire KB" = bytes received before any inflate (`ArrayBuffer.byteLength` of the fetch or WS message) / 1024, one decimal |
| Class distribution | heading "Occupied cells by class"; `h-2.5 rounded-full overflow-hidden flex` stacked bar of `class_counts[1..4]` in class colours, `motion.div animate={{ width }}` 0.25 s; then a `grid grid-cols-4 text-[11px] text-white/50 tabular-nums` row of counts |
| Ego minimap | 120 px `bg-white/5 rounded-lg`; `ego_pose` is global nuScenes (scene-0061 frame 0 is x 411.30, y 1180.89), so subtract the scene's first pose, auto-fit the trail with 8 px padding, trail `white/40`, current pose a lime dot with a 6 px yaw tick |
| Pinned inspector | card per section 7; empty text "Click a cell to pin it here." `text-xs text-white/40` |

Below the panel a keyboard strip `mt-4 flex flex-wrap gap-2 justify-center text-xs text-ink/60` of kbd chips: Space, Left, Right, 1 to 4, R, W, O, H, C, Esc.

### 4.7 Benchmarks `#benchmarks`

Light. Eyebrow "Benchmarks". H2 "Measured, not modelled." Paragraph "81 validation frames from nuScenes-mini, checkpoint epoch 59, one CUDA GPU. Every number loads from metrics.json, not typed in." Stat cards `mt-14 grid grid-cols-2 md:grid-cols-4 gap-6` (`stagger(0.08)`, `fadeUp`, chart card, value `font-serif text-5xl text-navy tabular-nums` count-up, sub `mt-2 text-xs text-ink/50`): "0.7466" mIoU, sub "point accuracy 0.8883"; "24.3 FPS" end to end, sub "p50 41.16 ms, p95 46.80 ms"; "29.9x" less than uniform 5 cm 2D, sub "4.28 MB vs 128.00 MB"; "449.1x" less than 5 cm 3D voxels, sub "vs 1.92 GB". Then `mt-6 grid lg:grid-cols-3 gap-6` chart cards (title `text-sm font-semibold`, subtitle `text-xs text-ink/50`), charts mounting in view with `animationDuration={900} animationEasing="ease-out"`; contents in section 8.

### 4.8 Geometry `#geometry`

Navy. Lime eyebrow "Geometry". H2 "Square rings on Chebyshev distance." Paragraph `text-white/70`: "Ring r covers max(|x|, |y|) in [inner, outer) with square cells of side s. Every boundary is an integer multiple of every cell size, so a 3D point maps to exactly one cell. Each ring is a 400 by 400 tensor with its centre masked, so the whole map batches on the GPU as four identical tensors." Layout `mt-12 grid lg:grid-cols-2 gap-12 items-center`. Left: SVG `viewBox="-110 -110 220 220"`, four `motion.rect` squares at half-sizes 30, 50, 72, 100, stroke lime 1, `pathLength` 0 to 1 over 0.8 s, `stagger(0.15)`; per-ring lattices at pitch 6, 5, 4.4, 3.5 SVG units for rings 0..3 (clipped to each annulus), `stroke="rgba(255,255,255,0.10)"` 0.5 px, revealed `opacity 0 to 0.25` over 0.6 s after the squares finish. `[Tier C]` A coral 6 px dot with framer `drag` constrained to the outer square shows a lime `text-[10px]` label from `worldToCell` (map SVG units to metres per ring; the half-sizes are non-linear), e.g. "ring 2, cell 0.20 m, (23.4, -5.1) m". Right: table from `health.rings`, columns "Ring", "Range (m)", "Cell (cm)", "Cells", "Hole", rows `border-b border-white/10 py-3 text-sm tabular-nums`, `fadeUp` `stagger(0.06)`; footnote `mt-4 text-sm text-white/60` "Total 534,400 cells, 8 bytes per cell, 4.28 MB. A uniform 5 cm grid over the same 200 m needs 16,000,000 cells."

### 4.9 Footer

`py-10 text-center text-xs text-ink/50`: "nuScenes v1.0-mini. SalsaNext-lite, epoch 59. Backend: FastAPI, sparse msgpack over WebSocket. Numbers: results/metrics.json, 81 validation frames." Link "API docs on localhost:8000/docs" `underline decoration-coral`.

## 5. Data layer

### 5.1 Source seam (`src/data/source.ts`)

```ts
export interface FrameSource {
  listScenes(): Promise<SceneInfo[]>; health(): Promise<Health>; classes(): Promise<Classes>; metrics(): Promise<Metrics>;
  getFrame(scene: string, idx: number): Promise<GridFrame>;
  stream(scene: string, fps: number, onFrame: (f: GridFrame, wireBytes: number) => void): StreamHandle;
}
export interface StreamHandle { play(): void; pause(): void; seek(idx: number): void; setFps(v: number): void; setScene(name: string): void; close(): void; }
```

Implementations `MockSource` (default), `LiveSource`, `ProceduralSource`. Initial source = `localStorage["avr.mode"]` if it is `"mock"` or `"live"`; else `"live"` only when `import.meta.env.VITE_MOCK === "false"` (exact string); anything else, including unset, is mock. `VITE_API_URL` falls back to `"http://localhost:8000"` when unset or empty. The nav toggle overrides and persists to `localStorage["avr.mode"]`. Document both variables in README. Renderers and rails never know which source is active.

### 5.2 Types (`src/data/types.ts`, field-for-field with `codec.py`)

```ts
export const EMPTY_CM = -32768;
export const CLASS_NAMES = ["ignore", "drivable", "terrain_nondrivable", "static_obstacle", "dynamic_object"] as const;
export interface RingLayer {
  ring: number; size: number; cell_m: number; inner_hole: number; n: number;
  idx: Uint32Array; label: Uint8Array; z_max_cm: Int16Array; z_min_cm: Int16Array; confidence: Uint8Array; count: Uint16Array; // all length n
}
export interface GridFrame {
  scene: string; idx: number; timestamp_us: number; ego_pose: { x: number; y: number; yaw: number };
  rings: RingLayer[];                                            // length 4, index = ring id
  stats: { num_points: number; points_dropped_beyond_range: number;
    latency_ms: { inference: number; projection: number; encode: number; total: number };
    memory_bytes: number; occupied_cells: number; class_counts: number[]; compressed: boolean; };
}
export interface RingSpec { ring: number; inner_m: number; outer_m: number; cell_m: number; size: number; inner_hole: number; cells: number; }
export interface Health { ok?: boolean; mode: "model" | "gt"; device?: string; encoding?: string; rings: RingSpec[]; }
export interface SceneInfo { name: string; description: string; num_frames: number; split: string; exported_indices?: number[]; }
export interface Classes { names: string[]; colors: string[] }
export type Metrics = typeof DEFAULT_METRICS & Record<string, unknown>;   // DEFAULT_METRICS from src/data/metricsDefaults.ts, section 8
```

`DenseRing` holds five `size * size` arrays plus `prevIdx: Uint32Array(size * size)` and `prevN: number`, allocated once per ring. On the wire `latency_ms.inference` is range projection + network inference + unprojection (`codec.grid_frame_to_dict`), `encode` is the measured gather time and `total` includes it. Mock `health.json` has only `mode` and `rings`; show "offline" for device in mock mode.

### 5.3 Wire format and decoder (`src/data/decoder.ts`)

One msgpack map (`use_bin_type`) with exactly the keys above. Per ring six msgpack `bin` fields, `idx` plus the five value arrays, all raw little-endian bytes aligned with `idx`: `idx` uint32 (flat `i * size + j`, strictly increasing), `label` uint8, `z_max_cm` and `z_min_cm` int16 (sentinel -32768), `confidence` uint8, `count` uint16. Only occupied cells (`count > 0`) are sent: 14,000 to 19,400 of 534,400 per frame, 165 to 228 KiB (`scene-0061/0.msgpack` is 227,035 bytes). Hole cells are never occupied on the wire (their count is 0 there); the renderer still guards against them. If `buf[0] === 0x78` the payload is zlib (`level=1`): `pako.inflate` first; an uncompressed frame starts with `0x86`.

```ts
import { unpack } from "msgpackr"; import { inflate } from "pako";
function view<T>(C: { new (b: ArrayBufferLike, o: number, n: number): T; BYTES_PER_ELEMENT: number }, b: Uint8Array, n: number): T {
  if (b.byteOffset % C.BYTES_PER_ELEMENT !== 0) b = new Uint8Array(b);   // copies into a fresh, zero-offset ArrayBuffer; never use .slice(): msgpackr hands back Node Buffers under vitest and Buffer.slice() shares memory
  if (b.byteLength !== n * C.BYTES_PER_ELEMENT) throw new Error("length mismatch");
  return new C(b.buffer, b.byteOffset, n);
}
export function decodeFrame(buf: Uint8Array): GridFrame {
  if (buf[0] === 0x78) buf = inflate(buf);
  const w = unpack(buf);
  const rings = w.rings.map((r: any): RingLayer => ({ ring: r.ring, size: r.size, cell_m: r.cell_m, inner_hole: r.inner_hole, n: r.n,
    idx: view(Uint32Array, r.idx, r.n), label: view(Uint8Array, r.label, r.n), z_max_cm: view(Int16Array, r.z_max_cm, r.n),
    z_min_cm: view(Int16Array, r.z_min_cm, r.n), confidence: view(Uint8Array, r.confidence, r.n), count: view(Uint16Array, r.count, r.n) }));
  return { ...w, rings };
}
```

Assert little-endian once at startup (`new Uint8Array(new Uint32Array([1]).buffer)[0] === 1`), else fall back to a `DataView` loop with `getInt16(o, true)`. The source catches decode errors, `console.warn`s and skips the frame; nothing throws into React. Points payload `{ n, xyz: bin float32 (n * 3), label: bin uint8 (n) }`, never compressed. Decode on the main thread (unpack of 230 KB is about 0.5 ms); no worker.

### 5.4 Densify (`src/data/densify.ts`)

Allocate one `DenseRing` per ring once and reuse forever. First use: `label.fill(0)`, `z_max_cm.fill(EMPTY_CM)`, `z_min_cm.fill(EMPTY_CM)`, `confidence.fill(0)`, `count.fill(0)`. Every frame: for `t < prevN` reset the five arrays at `prevIdx[t]` to those fill values; then `for (t < n) { k = idx[t]; label[k] = r.label[t]; z_max_cm[k] = r.z_max_cm[t]; z_min_cm[k] = r.z_min_cm[t]; confidence[k] = r.confidence[t]; count[k] = r.count[t]; }`; then `prevIdx.set(idx); prevN = n`. Cell `(i, j) = (floor(k / size), k % size)`. Under 1 ms for 19,000 cells. Dense arrays serve the inspector and the resampler; painters draw from the sparse arrays.

### 5.5 World and cell maths (`src/grid/geometry.ts`, from `varres_grid.py`)

Ego frame: origin at the sensor, +x forward, +y left, z up, metres. Read geometry from `health.rings` at runtime; these constants are the fallback and test fixture: `OUTER = [10, 20, 40, 100]`, `CELL = [0.05, 0.10, 0.20, 0.50]`, `SIZE = 400` (every ring, since `2 * outer / cell = 400`), `HOLE = [0, 200, 200, 160]` (`round(2 * inner / cell)`). Half extent of ring r is `outer_r = size * cell_m / 2`.

```ts
export function ringOf(x: number, y: number) { const d = Math.max(Math.abs(x), Math.abs(y)); let r = 0; while (r < 4 && d >= OUTER[r]!) r++; return r; } // searchsorted side="right"; 4 = dropped
export function worldToCell(x: number, y: number) { const r = ringOf(x, y); if (r === 4) return null; const s = CELL[r]!, h = OUTER[r]!;
  const i = clamp(Math.floor((x + h) / s + 1e-9), 0, SIZE - 1), j = clamp(Math.floor((y + h) / s + 1e-9), 0, SIZE - 1);
  return { ring: r, i, j, flat: i * SIZE + j }; }
export function cellCenter(r: number, i: number, j: number) { const s = CELL[r]!, h = OUTER[r]!; return { x: -h + (i + 0.5) * s, y: -h + (j + 0.5) * s }; }
export function inHole(r: number, i: number, j: number) { const k = HOLE[r]!; if (!k) return false; const a = (SIZE - k) / 2, b = a + k; return i >= a && i < b && j >= a && j < b; }
export const inHoleFlat = (r: number, k: number) => inHole(r, Math.floor(k / SIZE), k % SIZE);
```

Boundaries belong to the outer ring: `d = 10` is ring 1, `d = 40` is ring 3, `d = 100` is dropped. Bytes: 8 per annulus cell (u8 + i16 + i16 + u8 + u16), frame `534,400 * 8 = 4,275,200`; uniform 2D 5 cm `4000 * 4000 * 8 = 128,000,000`; uniform 3D `4000 * 4000 * 120 * 1 = 1,920,000,000`. `toUniform(dense, cell_m = 0.5)` mirrors `VarResGrid.to_uniform`: `U = round(200 / cell_m)`, uniform cell `(a, b)` centred at `(-100 + (a + 0.5) * cell_m, -100 + (b + 0.5) * cell_m)`, nearest lookup via `worldToCell` into that ring's dense `label` and `z_max_cm`; cache the `(ring, flat)` table per cell size.

### 5.6 Mock mode (default)

`MockSource` fetches `/mock/scenes.json`, `/mock/classes.json`, `/mock/health.json`, `/mock/metrics.json`. Shipped scenes: `scene-0061` ("Parked truck, construction, intersection, turn left, following a van", 39 frames, train) and `scene-0103` ("Many peds right, wait for turning car, long bike rack left, cyclist", 40 frames, val), each with `exported_indices` 0, 2, ..., 38 (20 frames, stride 2). Frames at `/mock/frames/<scene>/<idx>.msgpack`, uncompressed, identical to the live format. On scene select prefetch all 20 frames with `Promise.all` behind a `h-0.5 bg-lime` progress bar, decode once, cache in `Map<string, GridFrame>`. Playback steps through `exported_indices` and wraps; the scrubber snaps to them and shows the real frame index. The client owns the clock: a `requestAnimationFrame` accumulator advancing one frame every `1000 / fps` ms.

### 5.7 Procedural fallback (`src/data/synth.ts`)

Used when any mock JSON fetch fails or a frame fails to decode; the nav label reads "Procedural". `synthFrame(idx)` is a pure function of idx (scrubbing, prefetch and the vitest `synth` case call it out of order) building the same sparse wire shape from `mulberry32(idx * 7919 + 17)`. Scene `synthetic-0001`, "Procedural avenue with traffic", 40 frames, `exported_indices` 0..39. Content (metres): road `|y| < 4` drivable; sidewalks `4 <= |y| < 7` terrain; walls `12 <= |y| < 12.5` static; 0.3 m poles at `y = 8` and `-8` every 15 m, static; six 4.5 by 1.8 m cars and four 0.6 by 0.6 m pedestrians, class 4:

```ts
// every moving body is a closed-form function of idx, never accumulated; wrap = (v, lo, hi) => ((v - lo) % (hi - lo) + (hi - lo)) % (hi - lo) + lo
car k in 0..5:        laneY = [-2.5, -2.5, -2.5, 2.5, 2.5, 2.5][k]; x = wrap(-100 + 33 * (k % 3) + 0.6 * idx * (k < 3 ? 1 : -1), -100, 100); z_min 20, z_max 150 cm
pedestrian p in 0..3: x = -30 + 20 * p; y = wrap(8 + 0.15 * idx * (p % 2 ? 1 : -1), -8, 8); z_min 0, z_max 170 cm
road z_min = z_max = 0 with +-3 cm noise; sidewalk z_min 0, z_max 15; wall z_min 0, z_max 200 to 300; pole z_min 0, z_max 400 (cm)
d = Chebyshev distance of the cell centre in metres
timestamp_us = 1_600_000_000_000_000 + idx * 500_000; scene = "synthetic-0001"
ego_pose = { x: 0.6 * idx, y: 2 * Math.sin(idx / 40 * Math.PI), yaw: Math.atan2(2 * Math.PI / 40 * Math.cos(idx / 40 * Math.PI), 1) }
```

Per ring, walk the annulus cells overlapping a primitive (skip hole cells), classify by cell centre, keep with probability `[0.55, 0.35, 0.18, 0.07][ring] * (1 - d / 110)`, `count = 1 + floor(rand * 6)`, `confidence` 200 to 255, emit `idx` ascending. Stats: `num_points` 33,000 to 36,500; `points_dropped_beyond_range` 0 or 1; `latency_ms` `inference 27.5`, `projection 11.4`, `encode 2.3`, `total 41.3` with 5 percent jitter; `memory_bytes 4275200`; `occupied_cells` = sum of n; `class_counts[5]` from labels; `compressed false`. Procedural `health` is `{ mode: "gt", rings: <spec built from OUTER/CELL/SIZE/HOLE> }`, `classes` is `{ names: CLASS_NAMES, colors: [] }`, `metrics` is `DEFAULT_METRICS`, `scenes` is the single synthetic scene.

### 5.8 Live mode (REST + WebSocket, copied from `app.py`)

Base `VITE_API_URL` (default `http://localhost:8000`); WebSocket on the same host (`ws://`, `wss://` on https). CORS is open.

| Endpoint | Returns | Error |
|---|---|---|
| `GET /api/health` | `{ ok: true, mode: "gt" \| "model", device, encoding, rings: RingSpec[] }` | none |
| `GET /api/scenes` | `{ scenes: SceneInfo[] }` without `exported_indices`; every index 0 to `num_frames - 1` exists | none |
| `GET /api/classes` | `{ names: string[5], colors: string[5] }` | none |
| `GET /api/scenes/{scene}/frames/{idx}?compress=false` | `application/x-msgpack` GridFrame. The `X-Content-Compression: zlib \| none` header is not CORS-exposed by the backend (no `expose_headers`), so the client must never branch on it; detect zlib only via `buf[0] === 0x78` | 404 detail `unknown scene {scene}` or `frame {idx} out of range for {scene}` |
| `GET /api/scenes/{scene}/frames/{idx}/points?max=20000` | msgpack PointCloud; `max` 100 to 200000 | 404 as above |
| `GET /api/metrics` | `metrics.json` | 404 `metrics.json not found; run python -m avr_lidar.eval.benchmark`: keep `DEFAULT_METRICS` |
| `WS /ws/stream?scene=scene-0061&fps=10&compress=false` | one binary GridFrame per tick while playing; `fps` clamped to 0.5 to 30; every new connection starts with `playing = true` at idx 0 | unknown scene closes with code 4004 |

Client commands, exact JSON text. The server paces; the client never runs a clock in live mode.

| Command | Server behaviour |
|---|---|
| `{"cmd":"play"}`, `{"cmd":"pause"}` | sets `playing` |
| `{"cmd":"seek","idx":12}` | wraps modulo `num_frames` and pushes that frame even when paused |
| `{"cmd":"fps","value":5}` | clamped 0.5 to 30 |
| `{"cmd":"scene","name":"scene-0103"}` | idx resets to 0, one frame pushed. An unknown name is ignored with no reply, so only send names returned by `/api/scenes`, validated client-side |

Reconnect with backoff 500 ms doubling to a cap of 8 s. Open the socket with the current scene and fps already in the query (`/ws/stream?scene=<active>&fps=<fps>&compress=false`), then send in this order: `{"cmd":"pause"}` if the user had paused, `{"cmd":"seek","idx":<frameIdx>}`. Do not resend `scene` or `fps`; they are in the URL.

Switching the pill to Live calls `/api/health` with a 2 s timeout; on failure show a coral toast `rounded-xl bg-coral px-4 py-3 text-sm font-medium text-navy` "Backend not reachable at {VITE_API_URL}, staying in mock mode" in a `fixed bottom-6 left-1/2 -translate-x-1/2 z-[60]` portal, `initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}` at 0.28 s `EASE_OUT_EXPO`, auto-dismissed after 4 s or on click, `role="status" aria-live="polite"`; snap the pill back via `layoutId`. If a live stream drops, an `absolute inset-0 z-30 grid place-items-center bg-navy/80 backdrop-blur-sm` overlay fades in over 0.25 s with an inner card `rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/80 max-w-sm` reading "Backend not reachable at {VITE_API_URL}. Reconnecting in {n}s. Switch to Mock to keep exploring." and a `rounded-xl bg-lime px-4 py-2 text-sm font-semibold text-navy` button "Switch to Mock".

### 5.9 State

Zustand `useUiStore` holds only small state: `source`, `health`, `classes`, `scenes`, `metrics`, `activeScene`, `frameIdx`, `timestamp_us`, `stats`, `wireBytes`, `playing`, `fps`, `history` (ring buffer of 100 totals), `egoTrail`, `layers: boolean[5]`, `confidenceMin`, `ringOutlines`, `heightShading`, `cvd`, `wireframe`, `points`, `exaggeration`, `hover`, `pinned`, `tab`, `connection`. The decoded `GridFrame` and dense arrays never enter React state: they live in a module-level `latestFrame` ref plus an `EventTarget` dispatching `"frame"`; renderers subscribe in `useEffect` and paint directly. Store writes from playback are throttled to 10 Hz.

## 6. Map renderers

### 6.1 Top-down 2.5D (`src/render/TopDown.tsx`, Canvas 2D)

Two stacked canvases: cells and overlay. One `OffscreenCanvas(400, 400)` per ring (fallback `document.createElement("canvas")`) with a persistent `ImageData` and a `Uint32Array px32` over its buffer. Pixel index equals the flat cell index (row = i, col = j); the flip to screen happens in the composite transform, so no per-cell flip arithmetic exists. Colour LUT `lut: Uint32Array(5 * 256)`, rebuilt only when the palette or height-shading toggle changes: for class c with base `(R, G, B)` and per-class height window `[zLo, zHi]` cm (`drivable [-30, 30]`, `terrain [-30, 60]`, `static [0, 400]`, `dynamic [0, 250]`), entry k is `(255 << 24) | (B' << 16) | (G' << 8) | R'`, `C' = min(255, round(C * shade))`, `shade = heightShading ? 0.6 + 0.6 * k / 255 : 1`, so a 12 cm curb reads lighter than the road beside it.

```ts
function paintRing(L: RingLayer, px32: Uint32Array, painted: Uint32Array, paintedN: number): number {
  for (let t = 0; t < paintedN; t++) px32[painted[t]!] = 0;              // clear only last frame's cells
  for (let t = 0; t < L.n; t++) {
    const c = L.label[t]!;
    if (c === 0 || !layers[c] || (L.inner_hole && inHoleFlat(L.ring, L.idx[t]!))) continue;   // never paint over the inner ring
    const k = clampByte(((L.z_max_cm[t]! - zLo[c]!) * 255) / (zHi[c]! - zLo[c]!));
    let v = lut[c * 256 + k]!; if (L.confidence[t]! < confidenceMin) v = (v & 0x00ffffff) | (64 << 24);   // 25 % alpha
    px32[L.idx[t]!] = v;
  }
  painted.set(L.idx); ctx.putImageData(imageData, 0, 0); return L.n;
}
```

Painting touches about 19,000 cells per frame, never 640,000; repaint on new frame, layer, confidence or palette change. Composite and overlay:

```
k = (min(W, H) / 200) * zoom px per metre; zoom range 0.5..40; ctx.setTransform(-k, 0, 0, -k, cx, cy) with (cx, cy) the ego's panned screen position
default view: zoom 1.5, (cx, cy) = (W / 2, 0.80 * H): ego near the bottom, ~105 m of forward range visible at 720 px; "Reset view" returns exactly here; 11.4 hover screenshots use it unpanned
for r = 3, 2, 1, 0: ctx.imageSmoothingEnabled = k * cell_r < 1 (smooth when minified, crisp squares when magnified); ctx.drawImage(ringCanvas[r], -outer_r, -outer_r, 2 * outer_r, 2 * outer_r)
empty and hole cells have alpha 0, so inner rings paint over outer ones and navy shows through
+x is screen-up, +y is screen-left; hover inverse x = (cy - py) / k, y = (cx - px) / k
overlay after resetTransform(): ring squares at 10, 20, 40, 100 m lime 1 px alpha 0.9, labels "5 cm" "10 cm" "20 cm" "50 cm" (Inter 11 px, inside each square's top-right corner);
  10 m grid lines rgba(255,255,255,0.08); lime 12 px ego triangle at the origin pointing up; hovered cell lime 1.5 px square; pinned cell white 1.5 px square with a 1 px rgba(15,23,42,0.8) inner stroke
input: wheel zooms about the cursor; drag pans; pinch on touch; double-click zooms 2x; "Reset view" springs back (SPRING)
scene change fades the cell canvas to 0.4 over 150 ms and back on the first frame; outline toggle animates alpha 0 -> 0.9 over 250 ms; redraw only on new frame or view change
```

### 6.2 3D columns (`src/render/Columns3D.tsx`, react-three-fiber)

```
<Canvas dpr={[1, 1.5]} frameloop="demand" camera={{ fov: 45, near: 0.1, far: 600 }}>; camera.up.set(0, 0, 1); navy background
per ring: one InstancedMesh, unit BoxGeometry, MeshStandardMaterial({ roughness: 0.85, metalness: 0 }), capacity 60000, instanceColor enabled
  count = n after class and confidence filtering; if n > 60000: count = 60000 and console.warn once per ring; never reallocate the mesh
  per occupied cell: position (cx, cy, zMin + h / 2) from cellCenter; scale (cell_m, cell_m, h); zMin = z_min_cm / 100 * ex; h = max(0.03, (z_max_cm - z_min_cm) / 100) * ex
  write instanceMatrix and instanceColor in place with one reused Object3D and Color; set needsUpdate; invalidate()
lights: ambientLight 0.55; directionalLight at (-40, 30, 80) intensity 1.1
four flat navy planes at ring extents with lime EdgesGeometry outlines at z 0.02 (respect the toggle)
drei OrbitControls: target (14, 0, 0), maxPolarAngle 1.45, minDistance 5, maxDistance 300
fly-in on mount: camera lerps (-90, 0, 60) -> (-32, 0, 20) over 1.6 s EASE_IN_OUT in useFrame; controls enabled on landing
wireframe toggle: material.wireframe on all four meshes; opacity pulse 1 -> 0.85 -> 1 over 200 ms; this view shows cells doubling in footprint at 10, 20 and 40 m
exaggeration: useSpring(ex, { stiffness: 120, damping: 20 }) read in useFrame
invalidate(): at the end of every useFrame tick during the fly-in and while the spring is not at rest; otherwise only on a new frame or OrbitControls "change"
[Tier C] points overlay (live only): THREE.Points, PointsMaterial({ size: 0.08, vertexColors: true }) from /points?max=20000
never build a connected height-field surface over cell centres: at 3.5 percent occupancy it renders as holes
```

### 6.3 Adaptive vs uniform (`src/render/Compare.tsx`)

Two top-down composites sharing one view transform: left the adaptive map from 6.1, right a fifth 400 by 400 offscreen canvas holding `toUniform` at 50 cm over [-100, 100] (U = 400), recomputed once per frame only while this tab is visible:

```ts
for (let a = 0; a < 400; a++) for (let b = 0; b < 400; b++) {
  const c = lutCell[a * 400 + b]!;                        // cached worldToCell of the uniform cell centre
  const cls = dense[c.ring]!.label[c.flat]!, z = dense[c.ring]!.z_max_cm[c.flat]!;
  uni32[a * 400 + b] = cls === 0 ? 0 : lut[cls * 256 + clampByte(((z - zLo[cls]!) * 255) / (zHi[cls]! - zLo[cls]!))]!;
}
```

The right pane is clipped with `clipPath: inset(0 0 0 ${x}px)` from a framer `drag="x"` handle (`dragConstraints` the container, `dragElastic={0}`, `dragMomentum={false}`): a 2 px white line with a 40 px white circle holding one 16 px SVG `stroke="#0F172A" stroke-width="2" fill="none"` `<path d="M10 5l-4 3 4 3M14 5l4 3-4 3"/>`; `role="slider"`, `aria-valuenow` in percent, `aria-label` "Compare divider", `whileHover={{ scale: 1.08 }}`, auto-entering 25 to 50 percent over 0.9 s; arrow keys move it 2 percent. Captions `absolute bottom-3 rounded-lg bg-navy/80 px-3 py-1.5 text-xs text-white tabular-nums`: left "Adaptive: 534,400 cells, 4.28 MB, 5 cm inside 10 m"; right "Uniform 50 cm everywhere: 160,000 cells, 1.28 MB, a 4.5 m car is 9 cells wide". Badge `absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-lime px-3 py-1 text-xs font-semibold text-navy`: "Uniform 5 cm at this range would need 16,000,000 cells, 29.9x the memory".

### 6.4 Frame budget (under 16 ms, integrated GPU laptop, 1080p)

```
unpack 0.5 ms; densify 0.5; paint four rings 0.8 + putImageData 1.2; composite 0.7; overlay 0.5; 3D instance update < 5 when that tab is open; resample 2 when visible; store update 0.3; hero < 4
rules: zero typed-array allocations per frame after warm-up; never fillRect per map cell; never a GridFrame in React state; sparkline capped at 100 points and 10 Hz;
  invalidate() the r3f canvas only as 6.2 states; three.js lazy in its own chunk; DPR <= 1.5 everywhere; [Tier C] initial JS < 450 KB gzipped
```

## 7. Interactivity

| Interaction | Behaviour |
|---|---|
| Hover inspector (2D tabs) | `pointermove` to world via the 6.1 inverse, `worldToCell`, read the dense arrays. Tooltip in `AnimatePresence`, `scale 0.96 to 1, opacity 0 to 1` over 120 ms, offset (14, 14), flipping near edges: `rounded-xl bg-navy/90 backdrop-blur-md border border-white/10 px-3 py-2 text-xs text-white tabular-nums`; rows: swatch plus class name, "Ring 2, cell 0.20 m", "x 23.40 m, y -5.10 m", "z 0.12 to 1.84 m", "count 7, confidence 92 %"; empty cell: "Empty cell, ring 3, 0.50 m" |
| Click pins | the tooltip morphs into the Telemetry card with `layoutId="inspector"` (SPRING); the pinned cell keeps the 6.1 white outline and re-reads its values every frame; "Unpin" ghost button or Esc |
| View | pan by drag, wheel zoom about the cursor, pinch, double-click 2x, "Reset view" |
| Playback | play, pause, step, scrub, FPS 1/5/10/20/30, loop; live mode sends the 5.8 WS commands |
| Keyboard | Space play/pause, Left/Right step, 1 to 4 toggle classes, R reset view, W wireframe, O outlines, H height shading, C colour-blind palette, Esc unpin; ignored while an input is focused; listed in the on-screen strip |
| Filters | layer toggles (legend rows and switches), confidence slider, ring outlines, height shading, colour-blind palette. The palette toggle recolours map, legend, class-distribution bar, IoU chart, accuracy chart and pinned card together, legend swatches cross-fading over 0.3 s |
| Other controls | scene, data source, tab, exaggeration, wireframe and points switches; foveation slider; geometry drag dot; compare divider |
| `[Tier C]` Export | "Export PNG" via `canvas.toBlob` as `avr-<scene>-<idx>.png` (cells and overlay composited) |

## 8. Metrics panels

`src/data/metricsDefaults.ts` exports `DEFAULT_METRICS`: copy `mock_frames/metrics.json` verbatim into the literal (all keys including `rings`, `class_names` and `confusion`; full precision, e.g. `cell_label_accuracy: 0.8723693644819436`; do not retype values). The page is complete without any fetch; when `/mock/metrics.json` or `/api/metrics` loads, spread it over `DEFAULT_METRICS` so a missing key keeps its default. Chart cards in 4.7:

| Card (title / subtitle) | Spec |
|---|---|
| 1. "Memory per frame" / "Same 200 m coverage, 8 bytes per cell" | Horizontal `BarChart layout="vertical"`, `XAxis type="number" scale="log" domain={[1e6, 4e9]}`; bars "Adaptive 2.5D" 4,275,200 `fill="#0F172A"`, "Uniform 2D 5 cm" 128,000,000 navy at opacity 0.45, "Uniform 3D 5 cm voxels" 1,920,000,000 navy at opacity 0.75 (the adaptive bar is the darkest); `LabelList` "4.28 MB", "128 MB", "1.92 GB"; callout chips `rounded-full bg-lime px-2.5 py-0.5 text-xs font-semibold text-navy` "29.9x" and "449.1x" pop with SPRING after the bars finish. Below, three `text-sm tabular-nums` lines: "534,400 cells in the adaptive grid vs 16,000,000 at uniform 5 cm"; "245 KB sparse msgpack per frame, mean 17,969 occupied cells"; "8 bytes per cell: label u8, z max i16, z min i16, confidence u8, count u16" |
| 2. "Accuracy by distance, per class" / "Cell size grows 10x, static obstacles stay at 98%" | Grouped `BarChart`, categories `"0-10 m · 5 cm"`, `"10-20 m · 10 cm"`, `"20-40 m · 20 cm"`, `"40-100 m · 50 cm"` as two-line XAxis ticks via a custom `tick` (distance on line 1 `text-ink`, cell size on line 2 `text-ink/50`); four bars in class colours from `accuracy_by_distance_per_class`; `YAxis domain={[0, 1]}` as percent; overall `accuracy_by_distance` as a navy `Line` `stroke="#0F172A" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3, fill: "#0F172A" }}` (90.1, 84.9, 89.3, 92.5). Tooltip "{class}: {pct}% of {points_by_distance} points". Footnote `text-xs text-ink/50`: "Bins are Euclidean distance from the sensor; the dominant cell size per bin is 5, 10, 20 and 50 cm. Drivable and terrain beyond 40 m have few points (141,923 in the bin) and are dominated by static obstacles; dynamic objects are still caught at 48% there." |
| 3. "IoU per class and latency" / "mIoU 0.7466, 41.3 ms mean, 24.3 FPS" | Top: four 8 px `rounded-full` tracks `bg-navy/10` filled in class colours, width 0 to value over 0.9 s: drivable 0.857, non-drivable terrain 0.526, static obstacle 0.872, dynamic object 0.730, each with a thin `bg-navy/30` companion bar from `cell_iou_per_class`. Bottom: stacked bar `flex h-6 overflow-hidden rounded-full`, widths proportional to stage means: range projection 7.99 `bg-navy`, inference 19.06 `bg-navy/75`, unproject 0.46 `bg-navy/50`, grid projection 11.42 `bg-coral`, encode 2.30 `bg-navy/25`; segments grow left to right with `stagger(0.08)`; legend with matching swatches and ms values; chips "p50 41.16 ms", "p95 46.80 ms", "inference alone 52.9 FPS", "grid engine alone 88.3 FPS". Footer `text-sm text-ink/70`: "Point accuracy 88.8 %. Cell label accuracy 87.2 %. Obstacle cells retained within 10 m: 91.0 %." |

## 9. Accessibility and responsiveness

Contrast: ink on sky 12.6:1, white on navy 17:1, lime on navy 14:1, navy on lime 14:1, coral on navy 6.3:1; never coral text on sky below 24 px, never white on coral, never lime on white. Real `<button>`, `<input type="range">` and `role="switch"` controls with `aria-label`; the map canvas has `role="img"` with a live `aria-label` "Top-down map, scene-0061 frame 12, 18,987 occupied cells"; tabs use `role="tablist"` with arrow keys; every shortcut is on screen; the legend names classes beside swatches; tap targets at least 40 px; reduced motion per 3.3. Below `lg` the studio stacks: map `aspect-[4/3]` on top, then Controls and Telemetry as horizontal card rows; below `md` the foveation section stacks, the stats strip is two columns and nav links hide; 16 px gutters; no horizontal scroll at 390 px; pinch and drag work on touch. Test at 1440 by 900 and 390 by 844.

## 10. Files

```
avr-frontend/
  index.html  .env  tailwind.config.ts  postcss.config.js  vite.config.ts  vitest.config.ts  tsconfig.json  tsconfig.app.json  README.md
  public/mock/{scenes,classes,health,metrics}.json
  public/mock/frames/scene-0061/{0,2,...,38}.msgpack   public/mock/frames/scene-0103/{0,2,...,38}.msgpack
  docs/screenshots/*.png
  src/main.tsx  src/App.tsx  src/index.css  src/store.ts  src/frameBus.ts
  src/motion/{tokens,useCountUp}.ts
  src/hero/{Hero,HeroCanvas}.tsx
  src/sections/{Nav,Problem,Foveation,FoveationCanvas,Pipeline,Studio,Benchmarks,Geometry,Footer}.tsx
  src/studio/{Controls,Telemetry,Legend,Inspector,TabBar,Scrubber,Switch,Minimap}.tsx
  src/charts/{MemoryBars,AccuracyByDistance,IouLatency,Sparkline}.tsx
  src/render/{TopDown,Columns3D,Compare}.tsx  src/render/{lut,view}.ts
  src/data/{types,source,decoder,densify,resample,mockSource,liveSource,synth,metricsDefaults}.ts
  src/grid/geometry.ts
  src/__tests__/{geometry,densify,decoder,resample,synth,foveation}.test.ts
```

README covers `npm run dev | build | test`, `VITE_MOCK` and `VITE_API_URL` (parsing rules from 5.1), the keyboard map, and the backend commands `python -m uvicorn avr_lidar.server.app:app --host 0.0.0.0 --port 8000` and `python scripts/export_mock_frames.py --scenes scene-0061 scene-0103 --stride 2`.

## 11. Verification you must run yourself

1. `npm run build` exits 0 with zero TypeScript errors; three.js is in its own chunk.
2. `npm run test` passes with these cases:

| Suite | Assertions |
|---|---|
| `geometry` | `worldToCell(0, 0)` is ring 0 cell (200, 200); `worldToCell(9.999, 0)` ring 0, i 399; `worldToCell(10, 0)` ring 1, i 300, j 200; `worldToCell(-40, 39.9)` ring 3; `worldToCell(100, 0)` and `worldToCell(-100, 0)` are null; `cellCenter(worldToCell(x, y))` within half a cell of (x, y) for 1,000 random points inside 100 m; `inHole(1, 200, 200)` true, `inHole(1, 99, 200)` false |
| `densify` | idx [3, 7] yields -32768 and label 0 everywhere else; a second frame into the same buffers clears the first |
| `decoder` | build the fixture as `pack({ k: "abc", ...ring })` with `msgpackr.pack` so the first bin lands at an odd `byteOffset`; assert that offset was odd before decoding; decode and compare every array; assert `decoded.rings[0].idx.byteOffset % 4 === 0` and every decoded idx is outside the ring's hole; `pako.deflate` it and confirm the 0x78 path yields identical arrays; a length mismatch throws and the source skips the frame |
| `resample` | the uniform 50 cm cell centred at (0.25, 0.25) reads ring 0 cell (205, 205); the cell centred at (50.25, 0.25) reads ring 3 |
| `synth` | idx strictly increasing; no hole cells; `class_counts` sums to `occupied_cells`; `latency_ms.total` within 10 percent of 41.3; `synthFrame(7)` called twice is deep-equal |
| `foveation` | the 4.4 formula gives 16,000,000 at t = 0 and exactly 534,400 cells and 4.28 MB at t = 1 |

3. `npm run dev`, open `http://localhost:5173` at 1440 by 900: no console errors; the network panel shows `/mock/frames/scene-0061/0.msgpack` at 227,035 bytes; the nav label reads Mock.
4. Screenshot to `docs/screenshots/`: hero at 0.2 s (`[Tier C]`) and 2 s, problem after reveal, foveation at t = 0 and t = 1 with the badge, pipeline, each studio tab (3D with wireframe on), the tooltip over a ring 0 cell reading "cell 0.05 m" and a ring 3 cell reading "cell 0.50 m" from the 6.1 default view, compare slider at 25 percent, benchmarks after animation, geometry with the dot in ring 2, full page at 390 by 844.
5. Play at 10 FPS for 20 s: render badge stays at 30 or above; the frame counter loops 0, 2, ..., 38, 0. `[Tier C]` At 30 FPS Top-down stays at 30 or above and a Performance profile shows no task above 16 ms after the first three frames.
6. Toggle every switch and shortcut once; the colour-blind palette recolours map, legend and charts together; dynamic objects are coral by default.
7. Emulate `prefers-reduced-motion: reduce`: static hero, final numbers, no y or scale motion.
8. Rename `public/mock/frames`, reload: the Procedural scene plays with no errors; restore.
9. Click "Live" with no backend: coral toast within 2.5 s and the pill returns to Mock.
10. Drag the foveation slider 0 to 1: counters end at exactly 534,400 and 4.28 MB and the badge appears.

## 12. Acceptance checklist

- [ ] Only the five brand colours, white, black and alpha variants in the UI; class colours only on cells, swatches and per-class charts; dynamic objects coral; lime marks live state, outlines, active tabs, focus, badges and the CTA glow, never a chart series; no white text on coral.
- [ ] Hero: four nested squares, lime sweep lighting cells that decay, 3 s ring pulse, parallax, under 4 ms per frame; timeline within 0.1 s of 4.2; stats count up once from `DEFAULT_METRICS`.
- [ ] Every reveal, tab swap and hover uses `tokens.ts`; no inline durations or easings; live numbers flash, never count.
- [ ] Foveation slider morphs 16,000,000 to 534,400 cells and 128.0 MB to 4.28 MB; magnifiers show 400 / 100 / 25 / 4 cells; pipeline shows 27.5 / 11.4 / 2.3 ms and 245 KB with the travelling pulse.
- [ ] Decoder handles 0x86 and 0x78 frames, misaligned bins and length mismatches without crashing; synthetic frames report 27.5 / 11.4 / 2.3 / 41.3 ms.
- [ ] Hover beside the ego reads "Ring 0, cell 0.05 m"; at 90 m "Ring 3, cell 0.50 m"; coordinates match `cellCenter`; +x is screen-up.
- [ ] Rings nested in 2D; 3D wireframe shows footprints doubling at 10, 20 and 40 m; compare slider shows detail lost near the ego and the 29.9x badge.
- [ ] Benchmarks show 0.7466, 24.3 FPS, 29.9x, 449.1x, p50 41.16 ms, p95 46.80 ms, per-class accuracy by Euclidean distance bin, log memory bars; the accuracy x-axis shows the cell size under every band.
- [ ] Problem section shows four cards mapped to Task 1, Task 2, Task 3 and Method per 1.1.
- [ ] Mock playback loops `exported_indices` at 1/5/10/20/30 FPS at 30 or more render FPS; the Telemetry rail is labelled "this frame".
- [ ] Live switch health-checks with a 2 s timeout, streams `/ws/stream`, sends the five commands exactly, reconnects with backoff and re-sends pause, falls back with the toast.
- [ ] Ego minimap plots poses relative to the scene's first pose; legend rows toggle layers; keyboard strip lists every shortcut.
- [ ] Vitest green, build clean, screenshots saved, no horizontal scroll at 390 px, reduced motion honoured.
