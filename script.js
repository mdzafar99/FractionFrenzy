/**
 * =============================================================================
 * Fraction Frenzy — Game Logic
 * -----------------------------------------------------------------------------
 * A fully vanilla (no framework) HTML/CSS/JS educational game. Players build a
 * "current fraction" by shading slices of a pie chart to match a randomly
 * generated "target fraction".
 *
 * The code is organized into small, single-purpose functions and a single
 * module-scoped `state` object (instead of scattered global variables) so the
 * game state is easy to reason about and easy to reset.
 * =============================================================================
 */

/* -----------------------------------------------------------------------
 * Constants
 * --------------------------------------------------------------------- */

// Maps each difficulty level to the number of slices the fraction circle
// should be divided into.
const DIFFICULTY_SLICES = {
  easy: 4,
  medium: 8,
  hard: 12,
};

// A pleasant, high-contrast palette used to color shaded slices. Slices cycle
// through this palette by index so the pie looks vibrant as pieces are added.
const SLICE_COLORS = [
  '#7c5cff', // purple
  '#ff5ca8', // pink
  '#ff9f5c', // orange
  '#3fb6ff', // blue
  '#2fd6b0', // teal
  '#ffd23f', // yellow
  '#ff6b6b', // coral
  '#8e6bff', // violet
  '#4dd0e1', // cyan
  '#f2a65a', // amber
  '#66d19e', // mint
  '#ef7cc0', // magenta
];

const UNSHADED_FILL = '#eef0fb';

// Colors used for falling confetti pieces on a correct answer.
const CONFETTI_COLORS = ['#7c5cff', '#ff5ca8', '#ff9f5c', '#3fb6ff', '#2fd6b0', '#ffd23f'];

// How many completed levels make up one full lap of the progress bar. The
// bar fills up over this many levels, then resets (with an animated jump)
// so the player always has a visible sense of forward motion.
const LEVELS_PER_PROGRESS_LAP = 5;

// How long a feedback message stays highlighted before it can be replaced.
const FEEDBACK_MIN_VISIBLE_MS = 200;

/* -----------------------------------------------------------------------
 * Module state
 * ---------------------------------------------------------------------
 * A single state container instead of many loose global variables. Every
 * function that needs game state reads/writes through this object.
 * --------------------------------------------------------------------- */
const state = {
  difficulty: 'medium', // 'easy' | 'medium' | 'hard'
  totalSlices: DIFFICULTY_SLICES.medium, // total number of slices in the pie
  slices: [], // array of { shaded: boolean, element: SVGPathElement }
  target: { numerator: 0, denominator: DIFFICULTY_SLICES.medium }, // target fraction
  score: 0,
  level: 1,
  awaitingNextLevel: false, // true once the current level has been solved
};

/* -----------------------------------------------------------------------
 * DOM references (cached once at startup)
 * --------------------------------------------------------------------- */
let dom = {};

function cacheDomReferences() {
  dom = {
    circleSvg: document.getElementById('fractionCircle'),
    circleCenterLabel: document.getElementById('circleCenterLabel'),
    targetFractionDisplay: document.getElementById('targetFractionDisplay'),
    currentFractionDisplay: document.getElementById('currentFractionDisplay'),
    scoreValue: document.getElementById('scoreValue'),
    levelValue: document.getElementById('levelValue'),
    difficultySelect: document.getElementById('difficultySelect'),
    progressFill: document.getElementById('progressFill'),
    progressTrack: document.getElementById('progressTrack'),
    progressCaption: document.getElementById('progressCaption'),
    feedbackMessage: document.getElementById('feedbackMessage'),
    addPieceBtn: document.getElementById('addPieceBtn'),
    removePieceBtn: document.getElementById('removePieceBtn'),
    checkAnswerBtn: document.getElementById('checkAnswerBtn'),
    nextLevelBtn: document.getElementById('nextLevelBtn'),
    resetGameBtn: document.getElementById('resetGameBtn'),
    confettiContainer: document.getElementById('confettiContainer'),
  };
}

/* =========================================================================
 * Math helpers
 * ======================================================================= */

/** Greatest common divisor, used to simplify fractions for comparison. */
function greatestCommonDivisor(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const temp = y;
    y = x % y;
    x = temp;
  }
  return x === 0 ? 1 : x;
}

/** Returns a random integer between min and max, inclusive. */
function randomIntInclusive(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/* =========================================================================
 * createCircle()
 * Builds (or rebuilds) the SVG fraction circle with `totalSlices` equal
 * wedges. Each wedge is an individually selectable <path> element.
 * ======================================================================= */
function createCircle(totalSlices) {
  const svg = dom.circleSvg;

  // Clear any previously drawn slices before rebuilding.
  svg.innerHTML = '';

  const size = 320; // matches the SVG viewBox
  const center = size / 2;
  const radius = size / 2 - 8; // small margin so strokes aren't clipped
  const angleStep = (2 * Math.PI) / totalSlices;

  const newSlices = [];

  for (let index = 0; index < totalSlices; index += 1) {
    // Rotate the first slice to start at the top of the circle (12 o'clock)
    // by offsetting the starting angle by -90 degrees (-PI / 2).
    const startAngle = index * angleStep - Math.PI / 2;
    const endAngle = startAngle + angleStep;

    const startX = center + radius * Math.cos(startAngle);
    const startY = center + radius * Math.sin(startAngle);
    const endX = center + radius * Math.cos(endAngle);
    const endY = center + radius * Math.sin(endAngle);

    // A single slice is a pie wedge: move to center, line to the arc start,
    // draw the arc, then close back to the center.
    const pathData = [
      `M ${center} ${center}`,
      `L ${startX} ${startY}`,
      `A ${radius} ${radius} 0 0 1 ${endX} ${endY}`,
      'Z',
    ].join(' ');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('class', 'slice');
    path.setAttribute('data-index', String(index));
    path.setAttribute('tabindex', '0');
    path.setAttribute('role', 'button');
    path.setAttribute('aria-label', `Slice ${index + 1} of ${totalSlices}, unshaded`);
    path.style.fill = UNSHADED_FILL;

    // Slices can also be toggled directly by clicking/pressing Enter or
    // Space on them, in addition to the Add/Remove buttons.
    path.addEventListener('click', () => toggleSliceByIndex(index));
    path.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleSliceByIndex(index);
      }
    });

    svg.appendChild(path);
    newSlices.push({ shaded: false, element: path });
  }

  state.totalSlices = totalSlices;
  state.slices = newSlices;
}

/**
 * Toggles a specific slice on or off when the player interacts with the
 * pie directly (as opposed to using the Add Piece / Remove Piece buttons).
 */
function toggleSliceByIndex(index) {
  const slice = state.slices[index];
  if (!slice) return;

  if (slice.shaded) {
    unshadeSlice(index);
  } else {
    shadeSlice(index);
  }

  updateFraction();
}

/** Applies the shaded visual state and animation to a slice. */
function shadeSlice(index) {
  const slice = state.slices[index];
  if (!slice || slice.shaded) return;

  slice.shaded = true;
  const color = SLICE_COLORS[index % SLICE_COLORS.length];
  slice.element.style.fill = color;
  slice.element.classList.remove('unshading');
  slice.element.classList.add('shaded');
  slice.element.setAttribute(
    'aria-label',
    `Slice ${index + 1} of ${state.totalSlices}, shaded`,
  );

  // Re-trigger the pop animation on repeated shades by removing/adding the
  // class on the next animation frame.
  restartCssAnimation(slice.element, 'shaded');
}

/** Removes the shaded visual state and animates the transition back out. */
function unshadeSlice(index) {
  const slice = state.slices[index];
  if (!slice || !slice.shaded) return;

  slice.shaded = false;
  slice.element.style.fill = UNSHADED_FILL;
  slice.element.classList.remove('shaded');
  slice.element.classList.add('unshading');
  slice.element.setAttribute(
    'aria-label',
    `Slice ${index + 1} of ${state.totalSlices}, unshaded`,
  );

  restartCssAnimation(slice.element, 'unshading');
}

/** Forces a CSS animation to restart even if the class is already present. */
function restartCssAnimation(element, className) {
  element.classList.remove(className);
  // Reading offsetWidth forces a reflow, which lets the browser "notice"
  // the class was removed before it gets re-added.
  // eslint-disable-next-line no-unused-expressions
  element.offsetWidth;
  element.classList.add(className);
}

/* =========================================================================
 * generateTargetFraction()
 * Produces a new random target fraction whose denominator matches the
 * current number of slices, and displays it.
 * ======================================================================= */
function generateTargetFraction() {
  const denominator = state.totalSlices;
  // Numerator ranges from 1 to denominator - 1 so the target is always a
  // proper, non-trivial fraction (never 0/n or n/n).
  const numerator = randomIntInclusive(1, denominator - 1);

  state.target = { numerator, denominator };
  dom.targetFractionDisplay.textContent = `${numerator}/${denominator}`;
  bumpElement(dom.targetFractionDisplay);
}

/* =========================================================================
 * addPiece()
 * Shades the first unshaded slice, if one exists.
 * ======================================================================= */
function addPiece() {
  const firstUnshadedIndex = state.slices.findIndex((slice) => !slice.shaded);

  // All slices are already shaded — do nothing, per spec.
  if (firstUnshadedIndex === -1) return;

  shadeSlice(firstUnshadedIndex);
  updateFraction();
}

/* =========================================================================
 * removePiece()
 * Unshades the last shaded slice, if one exists.
 * ======================================================================= */
function removePiece() {
  let lastShadedIndex = -1;
  for (let i = state.slices.length - 1; i >= 0; i -= 1) {
    if (state.slices[i].shaded) {
      lastShadedIndex = i;
      break;
    }
  }

  // No slice is shaded — do nothing, per spec.
  if (lastShadedIndex === -1) return;

  unshadeSlice(lastShadedIndex);
  updateFraction();
}

/* =========================================================================
 * updateFraction()
 * Recomputes and redisplays the current fraction based on shaded slices.
 * ======================================================================= */
function updateFraction() {
  const shadedCount = state.slices.filter((slice) => slice.shaded).length;
  const total = state.totalSlices;

  dom.currentFractionDisplay.textContent = `${shadedCount}/${total}`;
  dom.circleCenterLabel.textContent = `${shadedCount}/${total}`;

  bumpElement(dom.currentFractionDisplay);
  bumpElement(dom.circleCenterLabel);
}

/** Adds a brief "pulse" animation class to an element, then removes it. */
function bumpElement(element) {
  element.classList.remove('bump');
  // eslint-disable-next-line no-unused-expressions
  element.offsetWidth;
  element.classList.add('bump');
}

/* =========================================================================
 * checkAnswer()
 * Compares the current fraction with the target fraction (using simplified
 * cross-multiplication so equivalent fractions like 2/4 and 1/2 still
 * match) and reacts accordingly.
 * ======================================================================= */
function checkAnswer() {
  const shadedCount = state.slices.filter((slice) => slice.shaded).length;
  const currentNumerator = shadedCount;
  const currentDenominator = state.totalSlices;

  const isCorrect =
    currentNumerator * state.target.denominator ===
    state.target.numerator * currentDenominator;

  if (isCorrect) {
    handleCorrectAnswer();
  } else {
    handleIncorrectAnswer();
  }
}

function handleCorrectAnswer() {
  showMessage('Correct! Great Job! 🎉', 'correct');
  launchConfetti();

  state.score += 10;
  dom.scoreValue.textContent = String(state.score);
  bumpElement(dom.scoreValue);

  state.awaitingNextLevel = true;
  dom.nextLevelBtn.disabled = false;
}

function handleIncorrectAnswer() {
  showMessage('Not quite — try adjusting your slices and check again!', 'incorrect');
  // Per spec: do NOT reset the level on a wrong answer.
}

/* =========================================================================
 * showMessage()
 * Displays a feedback message with a color-coded style (green for correct,
 * red for incorrect).
 * ======================================================================= */
let messageTimeoutId = null;

function showMessage(text, type) {
  const el = dom.feedbackMessage;

  el.textContent = text;
  el.classList.remove('correct', 'incorrect', 'visible');

  // Force reflow so the re-added class reliably re-triggers its animation.
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth;

  el.classList.add(type, 'visible');

  if (messageTimeoutId) {
    clearTimeout(messageTimeoutId);
  }
  messageTimeoutId = window.setTimeout(() => {
    // Message stays visible; this timeout only guards against overlapping
    // rapid clicks re-triggering the entrance animation too soon.
  }, FEEDBACK_MIN_VISIBLE_MS);
}

/* =========================================================================
 * nextLevel()
 * Advances to the next level: new target fraction, cleared slices,
 * incremented level counter, updated progress bar. Disables itself again
 * until the player solves the new level.
 * ======================================================================= */
function nextLevel() {
  if (!state.awaitingNextLevel) return;

  state.level += 1;
  dom.levelValue.textContent = String(state.level);
  bumpElement(dom.levelValue);

  clearAllSlices();
  generateTargetFraction();
  updateFraction();
  updateProgress();

  state.awaitingNextLevel = false;
  dom.nextLevelBtn.disabled = true;

  showMessage(`Level ${state.level} — a new target fraction has appeared!`, 'correct');
}

/** Unshades every slice in the pie without regenerating the circle. */
function clearAllSlices() {
  state.slices.forEach((slice, index) => {
    if (slice.shaded) {
      unshadeSlice(index);
    }
  });
}

/* =========================================================================
 * updateProgress()
 * Updates the level-progress bar's width and ARIA value based on how far
 * the player has advanced within the current "lap" of levels.
 * ======================================================================= */
function updateProgress() {
  const positionInLap = ((state.level - 1) % LEVELS_PER_PROGRESS_LAP) + 1;
  const percent = (positionInLap / LEVELS_PER_PROGRESS_LAP) * 100;

  dom.progressFill.style.width = `${percent}%`;
  dom.progressTrack.setAttribute('aria-valuenow', String(Math.round(percent)));
  dom.progressCaption.textContent = `Level ${state.level} progress`;
}

/* =========================================================================
 * resetGame()
 * Resets score, level, and current fraction; generates a fresh target
 * fraction; clears every slice.
 * ======================================================================= */
function resetGame() {
  state.score = 0;
  state.level = 1;
  state.awaitingNextLevel = false;

  dom.scoreValue.textContent = '0';
  dom.levelValue.textContent = '1';
  dom.nextLevelBtn.disabled = true;

  clearAllSlices();
  updateFraction();
  generateTargetFraction();
  updateProgress();

  showMessage('Game reset — good luck!', 'correct');
}

/* =========================================================================
 * Difficulty handling
 * ======================================================================= */
function handleDifficultyChange(event) {
  const newDifficulty = event.target.value;
  if (!DIFFICULTY_SLICES[newDifficulty]) return;

  state.difficulty = newDifficulty;
  const sliceCount = DIFFICULTY_SLICES[newDifficulty];

  createCircle(sliceCount);
  updateFraction();
  generateTargetFraction();

  state.awaitingNextLevel = false;
  dom.nextLevelBtn.disabled = true;

  showMessage(`Difficulty set to ${capitalize(newDifficulty)} — circle rebuilt.`, 'correct');
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/* =========================================================================
 * Confetti animation
 * A lightweight, dependency-free confetti burst built from plain <span>
 * elements animated with CSS keyframes (see .confetti-piece in style.css).
 * ======================================================================= */
function launchConfetti() {
  const pieceCount = 60;
  const container = dom.confettiContainer;

  for (let i = 0; i < pieceCount; i += 1) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';

    const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    const leftPercent = Math.random() * 100;
    const durationSeconds = 1.6 + Math.random() * 1.4;
    const delaySeconds = Math.random() * 0.3;
    const rotation = Math.random() * 360;

    piece.style.left = `${leftPercent}%`;
    piece.style.backgroundColor = color;
    piece.style.animationDuration = `${durationSeconds}s`;
    piece.style.animationDelay = `${delaySeconds}s`;
    piece.style.transform = `rotate(${rotation}deg)`;
    piece.style.borderRadius = i % 3 === 0 ? '50%' : '2px';

    container.appendChild(piece);

    // Clean up each confetti piece once its fall animation finishes so the
    // DOM doesn't accumulate leftover nodes across multiple correct answers.
    window.setTimeout(() => {
      piece.remove();
    }, (durationSeconds + delaySeconds) * 1000 + 200);
  }
}

/* =========================================================================
 * Button click micro-animation
 * Adds a brief "clicked" pulse class to any button when pressed.
 * ======================================================================= */
function attachClickPulse(button) {
  button.addEventListener('click', () => {
    button.classList.remove('clicked');
    // eslint-disable-next-line no-unused-expressions
    button.offsetWidth;
    button.classList.add('clicked');
  });
}

/* =========================================================================
 * Event wiring
 * ======================================================================= */
function setupEventListeners() {
  dom.addPieceBtn.addEventListener('click', addPiece);
  dom.removePieceBtn.addEventListener('click', removePiece);
  dom.checkAnswerBtn.addEventListener('click', checkAnswer);
  dom.nextLevelBtn.addEventListener('click', nextLevel);
  dom.resetGameBtn.addEventListener('click', resetGame);
  dom.difficultySelect.addEventListener('change', handleDifficultyChange);

  [dom.addPieceBtn, dom.removePieceBtn, dom.checkAnswerBtn, dom.nextLevelBtn, dom.resetGameBtn].forEach(
    attachClickPulse,
  );
}

/* =========================================================================
 * initGame()
 * Sets up the initial game state when the page first loads.
 * ======================================================================= */
function initGame() {
  cacheDomReferences();
  setupEventListeners();

  createCircle(DIFFICULTY_SLICES[state.difficulty]);
  updateFraction();
  generateTargetFraction();
  updateProgress();

  dom.scoreValue.textContent = String(state.score);
  dom.levelValue.textContent = String(state.level);
  dom.nextLevelBtn.disabled = true;
}

// Kick off the game once the DOM is ready.
document.addEventListener('DOMContentLoaded', initGame)

