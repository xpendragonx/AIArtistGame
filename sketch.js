
// Notes on The Coding Train 7.1+ The Nature of Code
// 7.2 https://www.youtube.com/watch?v=W1zKu3fDQR8

// Wolfram elementary CA. One-dimensional.

let sliderAmount = 127;

p5.disablefriendlyerrors = true;

let running = false;

let timeStamp = 0;
let step = 0;

let button;

let n = 0;

let cells = [];

let record = [];

let final;

let sound = 3;

let ruleSet = [0, 0, 0, 1, 1, 1, 1, 0];

let colorR = 0;

let colorG = 0;

let colorB = 0;

// Current rule number (kept alongside ruleSet so game.js has a plain 0-255
// value to score/save against without re-deriving it from the bit table).
let currentRule = 110;

// Per-run pattern stats, sampled each generation and read by game.js's
// registerRunCompleted() when a run reaches the bottom of the canvas.
let runDensitySum = 0;
let runDensityCount = 0;
let runVariationSum = 0;
let runVariationCount = 0;
let runHistory = [];
let runRepeatFound = false;

function resetRunStats() {
  runDensitySum = 0;
  runDensityCount = 0;
  runVariationSum = 0;
  runVariationCount = 0;
  runHistory = [];
  runRepeatFound = false;
}

let combos = [
  1,
  1,
  1,
  1,
  1,
  0,
  1,
  0,
  1,
  1,
  0,
  0,
  0,
  1,
  1,
  0,
  1,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
];

let fontSize = 1;

// For rumble sound etc.
let monoSynth;

function setup() {
  final = createCanvas(700, 500);
  repaintBackground();
  ruleSet = decToBin(110);
  currentRule = 110;
  textSize(fontSize);
  setupCells();
  resetRunStats();
  drawCells();
  monoSynth = new p5.MonoSynth();

  // Register the starting rule/color so they count toward exploration totals.
  if (typeof registerRuleExplored === "function") registerRuleExplored(currentRule);
  if (typeof registerColorExplored === "function") registerColorExplored(colorR, colorG, colorB);

  // button = createButton("Reset");
 //button.mousePressed(resetSystem);
  // button.position(42,8);
}

function download() {
saveCanvas(final, 'myCanvas', 'jpg');
if (typeof registerDownload === "function") registerDownload(currentRule, colorR, colorG, colorB);
}

function decToBin(_n) {

  let cE = [0, 0, 0, 0, 0, 0, 0, 0];

  let phase = [128, 64, 32, 16, 8, 4, 2, 1]; // When to switch.
  let cp = [0, 0, 0, 0, 0, 0, 0, 0]; // Counter.
  let sm = [0, 0, 0, 0, 0, 0, 0, 0]; // Switch mode.

  for (let ni = 0; ni <= _n; ni++) {
    // Iterate over our 8 binary digit places.
    for (let Wi = 7; Wi > -1; Wi--) {
      // Digit matches switch mode digit.
      cE[Wi] = sm[Wi];
      // Increment individual counter for this digit.
      cp[Wi] += 1;
      // If we hit phase number, switch mode and
      // restart digit's individual counter.
      if (cp[Wi] === phase[Wi]) {
        cp[Wi] = 0;
        if (sm[Wi] === 0) sm[Wi] = 1;
        else sm[Wi] = 0;
      }
    }
  }

  return cE;
}

// Read an array of binary, translate to decimal.
function whatRule(_a) {
  let runningTotal = 0;
  for (let i = 0; i < _a.length; i++) {
    if (_a[i] === 1) {
      runningTotal += pow(2, _a.length - 1 - i);
    }
  }
  return runningTotal;
}

function repaintBackground() {
  background(255);
}

function resetSystem() {
  repaintBackground();
  //printInstructions();
  n = 0;
  emptyCells();
  setupCells();
  resetRunStats();
  drawCells();

  playDing();
  sound = 3;
}

function iterate() {
  getRule();

  drawCells();

  playSynth();
}

function getRule() {
  let newCells = [];
  // Push first, ignored value onto start of array.
  // Just plug in some noise.
  newCells.push(Math.floor(random(0, 1) * 2));

  for (let i = 1; i < cells.length - 1; i++) {
    for (let j = 0; j < combos.length; j += 3) {
      if (
        cells[i - 1] === combos[j] &&
        cells[i] === combos[j + 1] &&
        cells[i + 1] === combos[j + 2]
      ) {
        newCells.push(ruleSet[Math.floor(j / 3)]);
        break;
      }
    }
  }

  // Count generation.
  n++;

  // Push last, ignored value onto end. Just noise.
  newCells.push(Math.floor(random(0, 1) * 2));

  trackRunStats(newCells);

  cells = newCells;
}

// Samples this generation for the "Composition" design achievements:
// fill density (balanced/negative-space/full-bleed), row-to-row variation
// (unpredictable), and whether the pattern has looped back to a state it's
// already visited (rhythmic repeater). Cheap and bounded — only compares
// against a short rolling history.
function trackRunStats(newCells) {
  const onCount = newCells.reduce((sum, v) => sum + v, 0);
  runDensitySum += onCount / newCells.length;
  runDensityCount++;

  if (cells.length === newCells.length) {
    let diff = 0;
    for (let k = 0; k < newCells.length; k++) {
      if (cells[k] !== newCells[k]) diff++;
    }
    runVariationSum += diff / newCells.length;
    runVariationCount++;
  }

  const patternKey = newCells.join("");
  if (runHistory.includes(patternKey)) runRepeatFound = true;
  runHistory.push(patternKey);
  if (runHistory.length > 40) runHistory.shift();
}

function setupCells() {
  // Use as many cells as can fit across screen.
  let nOc = Math.floor(((2 * width) / fontSize) * 2);
  //let nOc = 80;
  for (let i = 0; i < nOc; i++) {
    cells.push(Math.floor(random() * 2));
  }
}

function startBtn() {
  running = !running;
}

function emptyCells() {
  cells = [];
}
let m = 0;
function drawCells() {
  let tL = fontSize * cells.length;
  let htL = Math.floor(tL * 0.5);
  let startPos = width * 0.5 - htL;
  let Ystep = n + 5;

  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === 0) stroke(colorR, colorG, colorB);
    else stroke(220);

    text(cells[i], startPos + i * fontSize, Ystep);

    // Reached end of canvas?
    if (Ystep > height) {
      playDing();
      n = 0;
      startBtn()

      if (typeof registerRunCompleted === "function") {
        registerRunCompleted({
          avgDensity: runDensityCount ? runDensitySum / runDensityCount : 0,
          avgVariation: runVariationCount ? runVariationSum / runVariationCount : 0,
          repeatFound: runRepeatFound,
        });
      }
      resetRunStats();

      break;
    }
  }
}

function draw() {
  if (running) {
    if (millis() - timeStamp >= step) {
      timeStamp = millis();
      iterate();
    }
  }
}

function updateSlider(slideAmount) {
  var sliderDiv = document.getElementById("sliderAmount");
  var inputVal = document.getElementById("quantity");
  var slideVal = document.getElementById("slide");
  inputVal.value = slideAmount;
  //sliderDiv.innerHTML = slideAmount;
  ruleSet = decToBin(slideAmount);
  currentRule = Number(slideAmount);
  sound = sound + 0.75;
  console.log(sound)

  if (typeof registerRuleExplored === "function") registerRuleExplored(currentRule);

  // Generating Record Code
  //   record.push(slideAmount)
  // console.log(record.toString())
  // var recordElement = document.getElementById("recordElement")
  // recordElement.innerHTML = record.toString()
}

function updateInput(inputAmount) {
  var sliderDiv = document.getElementById("sliderAmount");
  var inputVal = document.getElementById("quantity");
  var slideVal = document.getElementById("slide");
  slideVal.value = inputAmount;
  //sliderDiv.innerHTML = inputAmount;
  inputVal.value = inputAmount;
  ruleSet = decToBin(inputAmount);
  currentRule = Number(inputAmount);

  if (typeof registerRuleExplored === "function") registerRuleExplored(currentRule);

  // Generating Record Code
  //record.push(inputAmount)
  //console.log(record.toString())
  // var recordElement = document.getElementById("recordElement")
  // recordElement.innerHTML = record.toString()
}

function updateColorR(newColor) {
  var inputElement = document.getElementById("quantityR");
  inputElement.value = newColor;
  colorR = newColor
  if (typeof registerColorExplored === "function") registerColorExplored(colorR, colorG, colorB);
}
function updateColorG(newColor) {
  var inputElement = document.getElementById("quantityG");
  inputElement.value = newColor;
  colorG = newColor
  if (typeof registerColorExplored === "function") registerColorExplored(colorR, colorG, colorB);
}
function updateColorB(newColor) {
  var inputElement = document.getElementById("quantityB");
  inputElement.value = newColor;
  colorB = newColor
  if (typeof registerColorExplored === "function") registerColorExplored(colorR, colorG, colorB);
}

function updateValue() {
  var x = document.getElementById("myText").value;
  document.getElementById("demo").innerHTML = x;
}

// *^*^*^*^*^*^*^*^^*^*^*^
// Sound stuff below here.

function playSynth() {
  userStartAudio();

  let note = random(["A"+Math.floor(n/80+4), "B" +Math.floor(n/80+4), "C"+Math.floor(n/80+4)]);
  // note velocity (volume, from 0 to 1)
  let velocity = random(0.1, 0.2);
  // time from now (in seconds)
  let time = 0;
  // note duration (in seconds)
  let dur = 1 / 22;

// let n = 0;
  //console.log("n" +Math.floor(n/70 + 3))
  
  monoSynth.play(note, velocity, time, dur);
}

function playDing() {
  userStartAudio();

  //let note = random(['A5','B4', 'C4']);
  let note = "A5";
  // note velocity (volume, from 0 to 1)
  let velocity = random(0.1, 0.2);
  // time from now (in seconds)
  let time = 0;
  // note duration (in seconds)
  let dur = 1 / 22;

  monoSynth.play(note, velocity, time, dur);
}
