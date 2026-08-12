// Color Loom — game layer (scoring, color-theory & design achievements, progression).
//
// Written in the same flat, global-function style as sketch.js (no build step,
// no modules). This file must load BEFORE sketch.js so its functions exist
// when sketch.js's onchange/onclick handlers reach for them.
//
// Reuses sketch.js's global `decToBin` for the Mirror Rule achievement, and
// reads/writes sketch.js's global colorR/colorG/colorB for palette presets.

// ---------------------------------------------------------------------------
// Color math helpers
// ---------------------------------------------------------------------------

// 12-slice color wheel, evenly spaced 30° apart, anchored on the true RGB/HSB
// hue circle (Red 0°, Green 120°, Blue 240° are the RGB primaries; Yellow,
// Cyan, Magenta are the RGB secondaries). This is the "light" color wheel a
// screen can actually produce — not the pigment (RYB) wheel taught with
// paint, where blue/orange are complements instead of blue/yellow. Naming it
// honestly avoids mislabeling colors (e.g. calling a green swatch "Yellow").
const HUE_FAMILY_NAMES = [
  "Red", "Orange", "Yellow", "Chartreuse", "Green", "Spring Green",
  "Cyan", "Azure", "Blue", "Violet", "Magenta", "Rose",
];

const WARM_FAMILIES = [0, 1, 2, 3, 10, 11]; // Red..Chartreuse, Magenta, Rose
const COOL_FAMILIES = [4, 5, 6, 7, 8, 9]; // Green..Violet

function rgbToHsb(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : (delta / max) * 100;
  const v = max * 100;
  return { h, s, v };
}

// Perceptual brightness (not raw HSB "value") — weights channels the way the
// eye actually perceives them, so e.g. pure blue reads as dark and pure
// yellow reads as light, matching how "value" is taught in art class.
function relativeLuminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b; // 0-255
}

function hueFamilyIndex(h) {
  return Math.floor((((h + 15) % 360) + 360) % 360 / 30);
}

// Near-zero saturation has no meaningful hue, so treat it as achromatic
// rather than forcing it into a family bucket.
function getHueFamily(h, s) {
  if (s < 8) return null;
  return hueFamilyIndex(h);
}

function valueBand(luminance) {
  if (luminance < 85) return "dark";
  if (luminance > 170) return "light";
  return "mid";
}

function saturationBand(s) {
  if (s < 8) return "grayscale";
  if (s < 30) return "muted";
  if (s < 65) return "moderate";
  return "vivid";
}

function clamp255(v) {
  v = Math.round(Number(v));
  if (isNaN(v)) return 0;
  return Math.max(0, Math.min(255, v));
}

// A rule's neighborhood table is left-right symmetric when swapping the
// left/right neighbor never changes the outcome. decToBin()'s bit order
// (from sketch.js) is [111,110,101,100,011,010,001,000], so mirroring pairs
// index 1<->4 (110<->011) and 3<->6 (100<->001); indices 0,2,5,7 are
// palindromic neighborhoods and always self-symmetric.
function isSymmetricRuleNumber(n) {
  if (typeof decToBin !== "function") return false;
  const bits = decToBin(n);
  return bits[1] === bits[4] && bits[3] === bits[6];
}

// ---------------------------------------------------------------------------
// State & persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = "colorloomGameState";

const POINTS = { NEW_RULE: 10, NEW_COLOR: 5, COMPLETION: 25, DOWNLOAD: 20 };
const ACHIEVEMENT_BASE_BONUS = 15;
const ACHIEVEMENT_GROWTH = 1.15;

function defaultState() {
  return {
    score: 0,
    exploredRules: [],
    exploredColors: [],
    completions: 0,
    achievementsUnlocked: [],
    surpriseCharges: 0,
    savedCombos: [],
    saveGallery: [],
    compositionFlags: {
      balanced: false,
      negativeSpace: false,
      fullBleed: false,
      rhythmic: false,
      unpredictable: false,
    },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const merged = Object.assign(defaultState(), parsed);
      merged.compositionFlags = Object.assign(
        defaultState().compositionFlags,
        parsed.compositionFlags || {}
      );
      return merged;
    }
  } catch (e) {
    console.warn("Color Loom: could not load saved progress", e);
  }
  return defaultState();
}

let state = loadState();

function saveGameState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Color Loom: could not save progress", e);
  }
}

// ---------------------------------------------------------------------------
// Progression: levels & unlockable palettes
// ---------------------------------------------------------------------------

const PALETTES = {
  palette_sunset: { name: "Sunset", r: 255, g: 94, b: 77 },
  palette_ocean: { name: "Ocean", r: 0, g: 119, b: 190 },
  palette_neon: { name: "Neon", r: 57, g: 255, b: 20 },
  palette_pastel: { name: "Pastel", r: 255, g: 209, b: 220 },
  palette_earth: { name: "Earth", r: 139, g: 90, b: 43 },
  palette_jewel: { name: "Jewel", r: 106, g: 13, b: 173 },
  palette_mono: { name: "Mono", r: 128, g: 128, b: 128 },
  palette_coral: { name: "Coral", r: 255, g: 127, b: 80 },
};

const LEVELS = [
  { name: "Doodler", threshold: 0, unlocks: [] },
  { name: "Sketch Artist", threshold: 100, unlocks: ["palette_sunset", "palette_ocean"] },
  { name: "Studio Regular", threshold: 250, unlocks: ["palette_neon", "palette_pastel"] },
  { name: "Colorist", threshold: 500, unlocks: ["gallery"] },
  { name: "Curator", threshold: 1000, unlocks: ["palette_earth", "palette_jewel"] },
  { name: "Visionary", threshold: 2000, unlocks: ["palette_mono", "palette_coral"] },
];

function getCurrentLevel() {
  let current = LEVELS[0];
  let next = null;
  for (let i = 0; i < LEVELS.length; i++) {
    if (state.score >= LEVELS[i].threshold) {
      current = LEVELS[i];
      next = LEVELS[i + 1] || null;
    }
  }
  return Object.assign({}, current, { next });
}

function getUnlockedFeatureSet() {
  const unlocked = new Set();
  LEVELS.forEach((l) => {
    if (state.score >= l.threshold) {
      l.unlocks.forEach((u) => unlocked.add(u));
    }
  });
  return unlocked;
}

// Sets the colorR/colorG/colorB globals (defined in sketch.js) directly and
// registers the finished combo in one shot — deliberately bypasses
// updateColorR/G/B so a palette pick doesn't get recorded as three separate
// (and transiently wrong) intermediate combos.
function applyPalette(key) {
  const p = PALETTES[key];
  if (!p || typeof colorR === "undefined") return;

  colorR = p.r;
  colorG = p.g;
  colorB = p.b;

  const rInput = document.getElementById("quantityR");
  const gInput = document.getElementById("quantityG");
  const bInput = document.getElementById("quantityB");
  if (rInput) rInput.value = p.r;
  if (gInput) gInput.value = p.g;
  if (bInput) bInput.value = p.b;

  registerColorExplored(p.r, p.g, p.b);
}

// ---------------------------------------------------------------------------
// Derived stats (recomputed after every new color, cheap since combo counts
// stay small for a casual session)
// ---------------------------------------------------------------------------

function deriveStats() {
  const families = new Set();
  const familyCounts = {};
  const valueBands = new Set();
  const saturationBands = new Set();
  let warmCount = 0;
  let coolCount = 0;

  state.exploredColors.forEach((c) => {
    if (c.family !== null) {
      families.add(c.family);
      familyCounts[c.family] = (familyCounts[c.family] || 0) + 1;
      if (WARM_FAMILIES.includes(c.family)) warmCount++;
      if (COOL_FAMILIES.includes(c.family)) coolCount++;
    }
    valueBands.add(c.valueBand);
    saturationBands.add(c.saturationBand);
  });

  const has = (f) => families.has(((f % 12) + 12) % 12);
  let complementary = false;
  let analogous = false;
  let triadic = false;
  let splitComplementary = false;
  let tetradic = false;

  for (let i = 0; i < 12; i++) {
    if (has(i) && has(i + 6)) complementary = true;
    if (has(i) && has(i + 1) && has(i + 2)) analogous = true;
    if (has(i) && has(i + 4) && has(i + 8)) triadic = true;
    if (has(i) && has(i + 5) && has(i + 7)) splitComplementary = true;
  }

  tetradicSearch:
  for (let i = 0; i < 6; i++) {
    if (!(has(i) && has(i + 6))) continue;
    for (let j = 0; j < 12; j++) {
      if (j === i || j === i + 6) continue;
      if (has(j) && has(j + 6)) {
        tetradic = true;
        break tetradicSearch;
      }
    }
  }

  let monochromatic = false;
  let tint = false;
  let shade = false;
  let tone = false;
  Object.keys(familyCounts).forEach((f) => {
    const combosInFamily = state.exploredColors.filter((c) => c.family == f);
    // Tint/shade/tone/monochromatic are all about VARIATION within a hue you've
    // already found, so they all require 2+ distinct discoveries in that family —
    // a single lucky light-and-vivid color shouldn't count as "already found".
    if (combosInFamily.length >= 2) {
      const vSet = new Set(combosInFamily.map((c) => c.valueBand));
      const sSet = new Set(combosInFamily.map((c) => c.saturationBand));
      if (vSet.size >= 2 || sSet.size >= 2) monochromatic = true;
      if (combosInFamily.some((c) => c.valueBand === "light" && c.saturationBand !== "muted")) tint = true;
      if (combosInFamily.some((c) => c.valueBand === "dark")) shade = true;
      if (combosInFamily.some((c) => c.saturationBand === "muted" && c.valueBand === "mid")) tone = true;
    }
  });

  return {
    families, familyCounts, valueBands, saturationBands, warmCount, coolCount,
    complementary, analogous, triadic, splitComplementary, tetradic,
    monochromatic, tint, shade, tone,
  };
}

// ---------------------------------------------------------------------------
// Achievements (56 total)
// ---------------------------------------------------------------------------

const ACHIEVEMENTS = [
  // --- Rule exploration ---
  { id: "first_loom", category: "Rule Exploration", name: "First Loom", description: "Complete your first pattern run.", check: (s) => s.completions >= 1 },
  { id: "rule_breaker", category: "Rule Exploration", name: "Rule Breaker", description: "Explore 10 different rules.", check: (s) => s.exploredRules.length >= 10 },
  { id: "rule_master", category: "Rule Exploration", name: "Rule Master", description: "Explore 50 different rules.", check: (s) => s.exploredRules.length >= 50 },
  { id: "master_weaver", category: "Rule Exploration", name: "Master Weaver", description: "Explore all 256 rules.", check: (s) => s.exploredRules.length >= 256 },
  { id: "century_club", category: "Rule Exploration", name: "Century Club", description: "Complete 10 pattern runs.", check: (s) => s.completions >= 10 },

  // --- Primary colors (RGB primaries) ---
  { id: "true_red", category: "Primary Colors", name: "True Red", description: "Mix a color that reads as pure red.", check: (s, st) => st.families.has(0) },
  { id: "true_green", category: "Primary Colors", name: "True Green", description: "Mix a color that reads as pure green.", check: (s, st) => st.families.has(4) },
  { id: "true_blue", category: "Primary Colors", name: "True Blue", description: "Mix a color that reads as pure blue.", check: (s, st) => st.families.has(8) },

  // --- Secondary colors ---
  { id: "true_yellow", category: "Secondary Colors", name: "True Yellow", description: "Mix a color that reads as pure yellow.", check: (s, st) => st.families.has(2) },
  { id: "true_cyan", category: "Secondary Colors", name: "True Cyan", description: "Mix a color that reads as pure cyan.", check: (s, st) => st.families.has(6) },
  { id: "true_magenta", category: "Secondary Colors", name: "True Magenta", description: "Mix a color that reads as pure magenta.", check: (s, st) => st.families.has(10) },

  // --- Tertiary colors ---
  { id: "orange_discovered", category: "Tertiary Colors", name: "Orange Discovered", description: "Mix an orange hue.", check: (s, st) => st.families.has(1) },
  { id: "chartreuse_discovered", category: "Tertiary Colors", name: "Chartreuse Discovered", description: "Mix a chartreuse (yellow-green) hue.", check: (s, st) => st.families.has(3) },
  { id: "spring_green_discovered", category: "Tertiary Colors", name: "Spring Green Discovered", description: "Mix a spring green hue.", check: (s, st) => st.families.has(5) },
  { id: "azure_discovered", category: "Tertiary Colors", name: "Azure Discovered", description: "Mix an azure hue.", check: (s, st) => st.families.has(7) },
  { id: "violet_discovered", category: "Tertiary Colors", name: "Violet Discovered", description: "Mix a violet hue.", check: (s, st) => st.families.has(9) },
  { id: "rose_discovered", category: "Tertiary Colors", name: "Rose Discovered", description: "Mix a rose hue.", check: (s, st) => st.families.has(11) },

  // --- Color wheel completion ---
  { id: "wheel_watcher", category: "Color Wheel", name: "Wheel Watcher", description: "Discover colors from 6 of the 12 hue families.", check: (s, st) => st.families.size >= 6 },
  { id: "full_spectrum", category: "Color Wheel", name: "Full Spectrum", description: "Discover colors from all 12 hue families.", check: (s, st) => st.families.size >= 12 },
  { id: "wheel_master", category: "Color Wheel", name: "Color Wheel Master", description: "Find 3+ distinct colors within every hue family.", check: (s, st) => Object.keys(st.familyCounts).length >= 12 && Object.values(st.familyCounts).every((c) => c >= 3) },

  // --- Value ---
  { id: "into_shadows", category: "Value", name: "Into the Shadows", description: "Mix a very dark color.", check: (s, st) => st.valueBands.has("dark") },
  { id: "highlight_hunter", category: "Value", name: "Highlight Hunter", description: "Mix a very bright, light color.", check: (s, st) => st.valueBands.has("light") },
  { id: "midtone_maven", category: "Value", name: "Midtone Maven", description: "Mix a balanced mid-value color.", check: (s, st) => st.valueBands.has("mid") },
  { id: "full_tonal_range", category: "Value", name: "Full Tonal Range", description: "Discover a dark, a mid, and a light color.", check: (s, st) => st.valueBands.has("dark") && st.valueBands.has("mid") && st.valueBands.has("light") },

  // --- Saturation ---
  { id: "vivid_visionary", category: "Saturation", name: "Vivid Visionary", description: "Mix a highly saturated, vibrant color.", check: (s, st) => st.saturationBands.has("vivid") },
  { id: "muted_master", category: "Saturation", name: "Muted Master", description: "Mix a low-saturation, dusty color.", check: (s, st) => st.saturationBands.has("muted") },
  { id: "grayscale_sage", category: "Saturation", name: "Grayscale Sage", description: "Mix a fully neutral, grayscale color.", check: (s, st) => st.saturationBands.has("grayscale") },

  // --- Color harmony ---
  { id: "complementary_pair", category: "Color Harmony", name: "Complementary Pair", description: "Discover two colors directly opposite on the wheel.", check: (s, st) => st.complementary },
  { id: "analogous_trio", category: "Color Harmony", name: "Analogous Trio", description: "Discover three neighboring hues on the wheel.", check: (s, st) => st.analogous },
  { id: "triadic_harmony", category: "Color Harmony", name: "Triadic Harmony", description: "Discover three hues evenly spaced around the wheel.", check: (s, st) => st.triadic },
  { id: "split_complementary", category: "Color Harmony", name: "Split-Complementary", description: "Discover a hue plus both neighbors of its complement.", check: (s, st) => st.splitComplementary },
  { id: "tetradic_harmony", category: "Color Harmony", name: "Tetradic Harmony", description: "Discover two complementary pairs (4 hues total).", check: (s, st) => st.tetradic },
  { id: "monochromatic_study", category: "Color Harmony", name: "Monochromatic Study", description: "Discover 2+ colors in the same hue family at different values/saturations.", check: (s, st) => st.monochromatic },

  // --- Color temperature ---
  { id: "warm_palette", category: "Color Temperature", name: "Warm Palette", description: "Discover 5 different warm-hued colors.", check: (s, st) => st.warmCount >= 5 },
  { id: "cool_palette", category: "Color Temperature", name: "Cool Palette", description: "Discover 5 different cool-hued colors.", check: (s, st) => st.coolCount >= 5 },
  { id: "temperature_balance", category: "Color Temperature", name: "Temperature Balance", description: "Discover both a warm and a cool color.", check: (s, st) => st.warmCount >= 1 && st.coolCount >= 1 },

  // --- Tints, shades & tones ---
  { id: "tint_explorer", category: "Tints, Shades & Tones", name: "Tint Explorer", description: "Discover a light, soft version of a hue you've already found.", check: (s, st) => st.tint },
  { id: "shade_explorer", category: "Tints, Shades & Tones", name: "Shade Explorer", description: "Discover a dark version of a hue you've already found.", check: (s, st) => st.shade },
  { id: "tone_explorer", category: "Tints, Shades & Tones", name: "Tone Explorer", description: "Discover a muted version of a hue you've already found.", check: (s, st) => st.tone },

  // --- Collection ---
  { id: "palette_collector", category: "Collection", name: "Palette Collector", description: "Discover 25 unique colors overall.", check: (s) => s.exploredColors.length >= 25 },
  { id: "chromatic_historian", category: "Collection", name: "Chromatic Historian", description: "Discover 75 unique colors overall.", check: (s) => s.exploredColors.length >= 75 },

  // --- Pattern design: rule structure ---
  { id: "mirror_rule", category: "Pattern Design", name: "Mirror Rule", description: "Discover a rule whose pattern is left-right symmetric.", check: (s) => s.exploredRules.some(isSymmetricRuleNumber) },
  { id: "chaos_theory", category: "Pattern Design", name: "Chaos Theory", description: "Discover Rule 30, the classic chaotic pattern.", check: (s) => s.exploredRules.includes(30) },
  { id: "sierpinski_triangle", category: "Pattern Design", name: "Sierpinski's Triangle", description: "Discover Rule 90, the famous fractal.", check: (s) => s.exploredRules.includes(90) },
  { id: "edge_of_complexity", category: "Pattern Design", name: "Edge of Complexity", description: "Discover Rule 110, capable of unbounded complexity.", check: (s) => s.exploredRules.includes(110) },
  { id: "traffic_flow", category: "Pattern Design", name: "Traffic Flow", description: "Discover Rule 184, a traffic/particle-flow model.", check: (s) => s.exploredRules.includes(184) },
  { id: "order_and_void", category: "Pattern Design", name: "Order & Void", description: "Discover Rule 0, pure emptiness.", check: (s) => s.exploredRules.includes(0) },
  { id: "solid_ground", category: "Pattern Design", name: "Solid Ground", description: "Discover Rule 255, a fully filled field.", check: (s) => s.exploredRules.includes(255) },

  // --- Pattern design: live composition ---
  { id: "balanced_composition", category: "Composition", name: "Balanced Composition", description: "Complete a run with roughly even fill/empty balance.", check: (s) => s.compositionFlags.balanced },
  { id: "negative_space", category: "Composition", name: "Negative Space", description: "Complete a mostly-empty run.", check: (s) => s.compositionFlags.negativeSpace },
  { id: "full_bleed", category: "Composition", name: "Full Bleed", description: "Complete a mostly-filled run.", check: (s) => s.compositionFlags.fullBleed },
  { id: "rhythmic_repeater", category: "Composition", name: "Rhythmic Repeater", description: "Complete a run where the pattern settles into a repeating cycle.", check: (s) => s.compositionFlags.rhythmic },
  { id: "unpredictable", category: "Composition", name: "Unpredictable", description: "Complete a run with high row-to-row variation.", check: (s) => s.compositionFlags.unpredictable },

  // --- Gallery / saving ---
  { id: "first_print", category: "Gallery", name: "First Print", description: "Save your first canvas.", check: (s) => s.saveGallery.length >= 1 },
  { id: "gallery_curator", category: "Gallery", name: "Gallery Curator", description: "Save 5 unique canvases.", check: (s) => s.saveGallery.length >= 5 },
  { id: "master_curator", category: "Gallery", name: "Master Curator", description: "Save 20 unique canvases.", check: (s) => s.saveGallery.length >= 20 },
];

function nextAchievementBonus() {
  const order = state.achievementsUnlocked.length;
  return Math.round(ACHIEVEMENT_BASE_BONUS * Math.pow(ACHIEVEMENT_GROWTH, order));
}

function checkAchievements() {
  const stats = deriveStats();
  let unlockedAny = false;

  ACHIEVEMENTS.forEach((a) => {
    if (!state.achievementsUnlocked.includes(a.id) && a.check(state, stats)) {
      const bonus = nextAchievementBonus();
      state.score += bonus;
      state.achievementsUnlocked.push(a.id);
      state.surpriseCharges += 1;
      unlockedAny = true;
      showAchievementToast(a, bonus);
    }
  });

  if (unlockedAny) {
    saveGameState();
    updateSurpriseButton();
  }

  renderAchievementsPanel();
  renderGameBar();
  renderPalettes();
}

// ---------------------------------------------------------------------------
// Scoring events — called from sketch.js at the moment a rule/color/run/save
// actually happens
// ---------------------------------------------------------------------------

function registerRuleExplored(ruleNumber) {
  const n = clamp255(ruleNumber); // rules share the same 0-255 range as a color channel
  if (!state.exploredRules.includes(n)) {
    state.exploredRules.push(n);
    state.score += POINTS.NEW_RULE;
  }
  saveGameState();
  renderGameBar();
  checkAchievements();
}

function registerColorExplored(r, g, b) {
  r = clamp255(r);
  g = clamp255(g);
  b = clamp255(b);
  const key = `${r},${g},${b}`;
  const exists = state.exploredColors.some((c) => c.key === key);
  if (!exists) {
    const hsb = rgbToHsb(r, g, b);
    const luminance = relativeLuminance(r, g, b);
    state.exploredColors.push({
      key, r, g, b,
      h: hsb.h, s: hsb.s, v: hsb.v,
      luminance,
      family: getHueFamily(hsb.h, hsb.s),
      valueBand: valueBand(luminance),
      saturationBand: saturationBand(hsb.s),
    });
    state.score += POINTS.NEW_COLOR;
  }
  saveGameState();
  renderGameBar();
  checkAchievements();
}

function registerRunCompleted(runInfo) {
  state.completions += 1;
  state.score += POINTS.COMPLETION;

  if (runInfo) {
    if (runInfo.avgDensity >= 0.4 && runInfo.avgDensity <= 0.6) state.compositionFlags.balanced = true;
    if (runInfo.avgDensity < 0.15) state.compositionFlags.negativeSpace = true;
    if (runInfo.avgDensity > 0.85) state.compositionFlags.fullBleed = true;
    if (runInfo.repeatFound) state.compositionFlags.rhythmic = true;
    if (runInfo.avgVariation > 0.4) state.compositionFlags.unpredictable = true;
  }

  saveGameState();
  renderGameBar();
  checkAchievements();
}

// Once per unique (rule, color) combo — so spam-clicking Save doesn't farm
// points, but genuinely trying a new look and saving it always pays off.
function registerDownload(rule, r, g, b) {
  r = clamp255(r);
  g = clamp255(g);
  b = clamp255(b);
  const key = `${rule}|${r},${g},${b}`;
  if (!state.savedCombos.includes(key)) {
    state.savedCombos.push(key);
    state.score += POINTS.DOWNLOAD;
    state.saveGallery.push({ rule, r, g, b, timestamp: Date.now() });
    if (state.saveGallery.length > 50) state.saveGallery.shift();
  }
  saveGameState();
  renderGameBar();
  checkAchievements();
  renderGallery();
}

// Consumes one earned charge (granted per achievement unlock) to jump to a
// random rule you haven't explored yet.
function useSurpriseMe() {
  if (state.surpriseCharges <= 0) return;

  const unexplored = [];
  for (let i = 0; i <= 255; i++) {
    if (!state.exploredRules.includes(i)) unexplored.push(i);
  }
  const pool = unexplored.length ? unexplored : Array.from({ length: 256 }, (_, i) => i);
  const pick = pool[Math.floor(Math.random() * pool.length)];

  state.surpriseCharges -= 1;
  saveGameState();
  updateSurpriseButton();

  if (typeof updateInput === "function") {
    updateInput(pick); // reuses sketch.js's own rule-setting + UI-sync logic
  }
}

// ---------------------------------------------------------------------------
// UI rendering
// ---------------------------------------------------------------------------

function renderGameBar() {
  const scoreEl = document.getElementById("gameScore");
  if (scoreEl) scoreEl.textContent = `Score: ${state.score}`;

  const level = getCurrentLevel();
  const badge = document.getElementById("levelBadge");
  if (badge) badge.textContent = level.name;

  const fill = document.getElementById("levelProgressFill");
  const label = document.getElementById("levelProgressLabel");
  if (fill && label) {
    if (level.next) {
      const span = level.next.threshold - level.threshold;
      const progressed = Math.max(0, Math.min(1, (state.score - level.threshold) / span));
      fill.style.width = `${Math.round(progressed * 100)}%`;
      label.textContent = `${state.score} / ${level.next.threshold} pts to ${level.next.name}`;
    } else {
      fill.style.width = "100%";
      label.textContent = `${state.score} pts — max level reached!`;
    }
  }

  const unlocked = getUnlockedFeatureSet();
  const galleryBtn = document.getElementById("galleryBtn");
  if (galleryBtn) {
    const isUnlocked = unlocked.has("gallery");
    galleryBtn.disabled = !isUnlocked;
    galleryBtn.textContent = isUnlocked ? "Gallery" : "🔒 Gallery";
    galleryBtn.title = isUnlocked ? "View your saved canvases" : "Unlocks at Colorist level (500 pts)";
  }

  const countEl = document.getElementById("achievementsCount");
  if (countEl) countEl.textContent = `(${state.achievementsUnlocked.length}/${ACHIEVEMENTS.length})`;
}

function renderPalettes() {
  const row = document.getElementById("paletteRow");
  if (!row) return;
  const unlocked = getUnlockedFeatureSet();
  row.innerHTML = "";

  Object.keys(PALETTES).forEach((key) => {
    const p = PALETTES[key];
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "palette-swatch";
    if (unlocked.has(key)) {
      swatch.style.background = `rgb(${p.r},${p.g},${p.b})`;
      swatch.title = p.name;
      swatch.onclick = () => applyPalette(key);
    } else {
      swatch.classList.add("locked");
      swatch.disabled = true;
      swatch.textContent = "🔒";
      swatch.title = "Locked — level up to unlock";
    }
    row.appendChild(swatch);
  });
}

function renderAchievementsPanel() {
  const list = document.getElementById("achievementsList");
  if (!list) return;
  list.innerHTML = "";

  const categories = [];
  ACHIEVEMENTS.forEach((a) => {
    if (!categories.includes(a.category)) categories.push(a.category);
  });

  categories.forEach((cat) => {
    const header = document.createElement("li");
    header.className = "achievement-category";
    header.textContent = cat;
    list.appendChild(header);

    ACHIEVEMENTS.filter((a) => a.category === cat).forEach((a) => {
      const unlocked = state.achievementsUnlocked.includes(a.id);
      const item = document.createElement("li");
      item.className = "achievement-item " + (unlocked ? "unlocked" : "locked");
      item.innerHTML =
        `<span class="achievement-icon">${unlocked ? "✅" : "🔒"}</span>` +
        `<span class="achievement-text"><strong>${a.name}</strong><br><small>${a.description}</small></span>`;
      list.appendChild(item);
    });
  });
}

function toggleAchievements() {
  const panel = document.getElementById("achievementsPanel");
  if (panel) panel.classList.toggle("hidden");
}

function renderGallery() {
  const list = document.getElementById("galleryList");
  if (!list) return;
  list.innerHTML = "";

  if (!state.saveGallery.length) {
    const empty = document.createElement("li");
    empty.className = "gallery-empty";
    empty.textContent = "Nothing saved yet — hit Save to add your first piece!";
    list.appendChild(empty);
    return;
  }

  state.saveGallery.slice().reverse().forEach((entry) => {
    const item = document.createElement("li");
    item.className = "gallery-item";
    const date = new Date(entry.timestamp).toLocaleDateString();
    item.innerHTML =
      `<span class="gallery-swatch" style="background: rgb(${entry.r},${entry.g},${entry.b})"></span>` +
      `Rule ${entry.rule} — rgb(${entry.r}, ${entry.g}, ${entry.b}) — ${date}`;
    list.appendChild(item);
  });
}

function toggleGallery() {
  const unlocked = getUnlockedFeatureSet();
  if (!unlocked.has("gallery")) return;
  const panel = document.getElementById("galleryPanel");
  if (panel) panel.classList.toggle("hidden");
}

function updateSurpriseButton() {
  const btn = document.getElementById("surpriseBtn");
  if (!btn) return;
  btn.textContent = `🎲 Surprise Me (${state.surpriseCharges})`;
  btn.disabled = state.surpriseCharges <= 0;
}

// ---------------------------------------------------------------------------
// Achievement unlock feedback: toast + fanfare + confetti
// ---------------------------------------------------------------------------

function playAchievementFanfare() {
  if (typeof monoSynth === "undefined" || !monoSynth) return;
  if (typeof userStartAudio === "function") userStartAudio();
  const notes = ["C5", "E5", "G5", "C6"];
  notes.forEach((note, i) => {
    setTimeout(() => monoSynth.play(note, 0.2, 0, 1 / 8), i * 90);
  });
}

function spawnConfetti() {
  const layer = document.getElementById("confettiLayer");
  if (!layer) return;
  const colors = ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93"];
  for (let i = 0; i < 24; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 0.3}s`;
    layer.appendChild(piece);
    setTimeout(() => piece.remove(), 2500);
  }
}

function showAchievementToast(achievement, bonus) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML =
    `<strong>🏆 Achievement Unlocked!</strong><br>${achievement.name} ` +
    `<span class="toast-bonus">+${bonus} pts</span><br><small>${achievement.description}</small>`;
  container.appendChild(toast);

  playAchievementFanfare();
  spawnConfetti();

  setTimeout(() => {
    toast.classList.add("toast-hide");
    setTimeout(() => toast.remove(), 500);
  }, 4000);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function initGame() {
  renderGameBar();
  renderPalettes();
  renderAchievementsPanel();
  renderGallery();
  updateSurpriseButton();
}

initGame();
