const pinForm = document.getElementById("pin-form");
const pinInput = document.getElementById("pin-input");
const pinSection = document.getElementById("pin-section");
const preQuizSection = document.getElementById("pre-quiz-section");
const beginQuizButton = document.getElementById("begin-quiz-btn");
const wrongPinSection = document.getElementById("wrong-pin-section");
const wrongPinMessage = document.getElementById("wrong-pin-message");
const questionSection = document.getElementById("question-section");
const questionText = document.getElementById("question-text");
const questionError = document.getElementById("question-error");
const answerList = document.getElementById("answer-list");
const awardSection = document.getElementById("award-section");
const awardName = document.getElementById("award-name");
const awardLogo = document.getElementById("award-logo");
const loseSection = document.getElementById("lose-section");
const loseRestartButton = document.getElementById("lose-restart-btn");
const pinKeypad = document.getElementById("pin-keypad");
const pinDisplay = document.getElementById("pin-display");
const configWarning = document.getElementById("config-warning");
const configHotspot = document.getElementById("config-hotspot");
const pinHotspot = document.getElementById("pin-hotspot");
const stateVideo = document.getElementById("state-video");
const stateImage = document.getElementById("state-image");
const videoStage = document.querySelector(".video-stage");
const overlayCard = document.querySelector(".card.overlay");

const HOTSPOT_HOLD_MS = 5000;

let unlocked = false;
let quizData = null;
let currentQuestionIndex = null;
let selectedAnswer = null;
let hotspotTimer = null;
let nonWorkingIndex = -1;
let nonWorkingActive = false;
let isClosed = false;
let currentMode = "idle";
let pinSlots = [];
let pendingAward = null;
let awaitingQuizStart = false;
let answerTransitionTimer = null;
let lastPinCode = "";
let pinHoldTimer = null;
let pinHoldTriggered = false;
let closedUntilWorkingHours = false;

const ensurePinSlots = () => {
  if (!pinDisplay || !pinInput) return [];
  const desired =
    Number(pinDisplay.dataset.slots) || Number(pinInput.maxLength) || 6;
  const current = pinDisplay.querySelectorAll(".pin-slot");
  if (current.length === desired) {
    return Array.from(current);
  }

  pinDisplay.innerHTML = "";
  for (let index = 0; index < desired; index += 1) {
    const slot = document.createElement("span");
    slot.className = "pin-slot";
    slot.dataset.pinSlot = String(index);
    pinDisplay.appendChild(slot);
  }
  return Array.from(pinDisplay.querySelectorAll(".pin-slot"));
};

const refreshPinDisplay = () => {
  if (!pinDisplay || !pinInput) return;
  pinSlots = ensurePinSlots();
  const value = pinInput.value || "";
  pinSlots.forEach((slot, index) => {
    const filled = Boolean(value[index]);
    slot.classList.toggle("filled", filled);
    slot.textContent = filled ? value[index] : "";
  });
};

const hasQuestions = () => Boolean(quizData?.questions?.length);

const pickRandomQuestionIndex = () => {
  if (!quizData?.questions?.length) return null;
  return Math.floor(Math.random() * quizData.questions.length);
};

const hideAwardSection = () => {
  awardSection.classList.add("hidden");
  questionSection.classList.remove("hidden");
  questionError.textContent = "";
  questionSection.classList.remove("correct-state", "incorrect-state");
  if (awardLogo) {
    awardLogo.src = "";
    awardLogo.alt = "";
    awardLogo.classList.add("hidden");
  }
};

const hideLoseSection = () => {
  loseSection?.classList.add("hidden");
};

const hidePreQuizSection = () => {
  preQuizSection?.classList.add("hidden");
  awaitingQuizStart = false;
};

const hideWrongPinSection = () => {
  wrongPinSection?.classList.add("hidden");
  if (wrongPinMessage) wrongPinMessage.textContent = "";
};

const updateAnswerOptionClasses = (reveal = false) => {
  const question = quizData?.questions?.[currentQuestionIndex ?? 0];
  if (!question) return;

  answerList.querySelectorAll(".answer-option").forEach((option) => {
    const key = option.dataset.answer;
    option.classList.toggle("selected", key === selectedAnswer);

    if (reveal) {
      option.classList.toggle("correct", key === question.correctAnswer);
      option.classList.toggle(
        "incorrect",
        key === selectedAnswer && selectedAnswer !== question.correctAnswer,
      );
    } else {
      option.classList.remove("correct", "incorrect");
    }
  });
};

const getMediaUrl = (key) => quizData?.mediaResolved?.[key] || "";

const logAwardRedemption = async (award) => {
  if (!lastPinCode || !award) return;
  try {
    await window.quizAPI.redeemAward({ code: lastPinCode, award });
  } catch (error) {
    console.error("Failed to log award redemption", error);
  }
};

const setAwardLogo = (award) => {
  if (!awardLogo) return;
  const logoUrl = award?.logoUrl || "";
  if (logoUrl) {
    awardLogo.src = logoUrl;
    awardLogo.alt = `${award?.name || "Prize"} logo`;
    awardLogo.classList.remove("hidden");
  } else {
    awardLogo.src = "";
    awardLogo.alt = "";
    awardLogo.classList.add("hidden");
  }
};
const getPreQuizLoop = () =>
  Boolean(quizData?.settings?.media?.preQuizLoop ?? true);

const isImageUrl = (url = "") => /\.(png|jpe?g|gif|webp)$/i.test(url);

const setOverlayVisible = (visible) => {
  overlayCard?.classList.toggle("hidden", !visible);
};

const stopMedia = () => {
  if (stateVideo) {
    stateVideo.pause();
    stateVideo.removeAttribute("src");
    stateVideo.load();
  }
  if (stateImage) {
    stateImage.src = "";
    stateImage.style.display = "none";
  }
};

const playMedia = (
  url,
  { loop = true, onEnded, fallbackDuration = 3000 } = {},
) => {
  if (!stateVideo || !stateImage) return;

  if (!url) {
    stopMedia();
    if (onEnded) {
      onEnded();
    }
    return;
  }

  if (isImageUrl(url)) {
    stateVideo.pause();
    stateVideo.style.display = "none";
    stateImage.style.display = "block";
    stateImage.src = url;
    if (!loop && onEnded) {
      setTimeout(onEnded, fallbackDuration);
    }
    return;
  }

  stateImage.style.display = "none";
  stateVideo.style.display = "block";
  stateVideo.loop = loop;
  stateVideo.onended = null;
  stateVideo.src = url;
  stateVideo.currentTime = 0;
  stateVideo
    .play()
    .then(() => {
      if (!loop && onEnded) {
        stateVideo.onended = () => {
          stateVideo.onended = null;
          onEnded();
        };
      }
    })
    .catch(() => {
      if (onEnded) onEnded();
    });
};

const setMode = (mode) => {
  if (currentMode === mode) return;
  currentMode = mode;

  switch (mode) {
    case "quiz":
      nonWorkingActive = false;
      playMedia(getMediaUrl("quizVideo"), {
        loop: Boolean(quizData?.mediaResolved?.quizLoop ?? true),
      });
      break;
    case "prequiz":
      nonWorkingActive = false;
      playMedia(
        getMediaUrl("preQuizVideo") ||
          getMediaUrl("quizVideo") ||
          getMediaUrl("idleVideo"),
        { loop: getPreQuizLoop() },
      );
      break;
    case "pin":
      nonWorkingActive = false;
      playMedia(getMediaUrl("pinVideo") || getMediaUrl("idleVideo"), {
        loop: Boolean(quizData?.mediaResolved?.pinLoop ?? true),
      });
      break;
    case "win":
      nonWorkingActive = false;
      playMedia(getMediaUrl("winVideo"), {
        loop: Boolean(quizData?.mediaResolved?.winLoop ?? true),
      });
      break;
    case "lose":
      nonWorkingActive = false;
      playMedia(getMediaUrl("loseVideo"), {
        loop: Boolean(quizData?.mediaResolved?.loseLoop ?? false),
        onEnded: () => lockQuizForReauth(),
      });
      break;
    case "wrongpin":
      nonWorkingActive = false;
      playMedia(
        getMediaUrl("wrongPinVideo") ||
          getMediaUrl("loseVideo") ||
          getMediaUrl("idleVideo"),
        { loop: Boolean(quizData?.mediaResolved?.wrongPinLoop ?? true) },
      );
      break;
    case "closed":
      nonWorkingActive = true;
      startClosedPlaylist();
      break;
    case "idle":
    default:
      nonWorkingActive = false;
      playMedia(getMediaUrl("idleVideo"), {
        loop: Boolean(quizData?.mediaResolved?.idleLoop ?? true),
      });
      break;
  }
};

const showIdleScreen = () => {
  pinSection.classList.add("hidden");
  questionSection.classList.add("hidden");
  awardSection.classList.add("hidden");
  hidePreQuizSection();
  hideWrongPinSection();
  setOverlayVisible(false);
  setMode(isClosed ? "closed" : "idle");
};

const showPinScreen = (message) => {
  setOverlayVisible(true);
  pinSection.classList.remove("hidden");
  hideWrongPinSection();
  questionSection.classList.add("hidden");
  awardSection.classList.add("hidden");
  hidePreQuizSection();
  setMode("pin");
  pinInput.focus?.();
  refreshPinDisplay();
};

const resetForNextPlayer = ({ message, showPin } = {}) => {
  unlocked = false;
  pendingAward = null;
  awaitingQuizStart = false;
  pinInput.value = "";
  selectedAnswer = null;
  refreshPinDisplay();
  awardSection.classList.add("hidden");
  hideLoseSection();
  questionSection.classList.add("hidden");
  hideWrongPinSection();
  hidePreQuizSection();

  if (isClosed || !showPin) {
    showIdleScreen();
  } else {
    showPinScreen();
  }
};

const lockQuizForReauth = (message = "Please re-enter PIN to continue.") => {
  resetForNextPlayer({ message, showPin: true });
};

const showScreensaver = () => {
  unlocked = false;
  pinSection.classList.add("hidden");
  questionSection.classList.add("hidden");
  awardSection.classList.add("hidden");
  hideLoseSection();
  hidePreQuizSection();
  hideWrongPinSection();
  setOverlayVisible(false);
  setMode(isClosed ? "closed" : "idle");
};

const promptPinFromIdle = () => {
  if (isClosed || unlocked) return;
  if (currentMode !== "idle" && currentMode !== "pin") return;
  showPinScreen();
};

const handleKeypadInput = (key) => {
  if (isClosed) return;
  if (!key) return;

  if (/^[0-9]$/.test(key)) {
    if (pinInput.value.length < Number(pinInput.maxLength || 10)) {
      pinInput.value += key;
    }
    refreshPinDisplay();
    return;
  }

  if (key === "del" || key === "clear") {
    pinInput.value = pinInput.value.slice(0, -1);
    refreshPinDisplay();
    return;
  }

  if (key === "enter") {
    if (typeof pinForm.requestSubmit === "function") {
      pinForm.requestSubmit();
    } else {
      pinForm.dispatchEvent(new Event("submit"));
    }
  }
};

if (pinKeypad) {
  pinKeypad.addEventListener("click", (event) => {
    const { key } = event.target.dataset || {};
    handleKeypadInput(key);
  });
}

pinInput?.addEventListener("input", refreshPinDisplay);
refreshPinDisplay();

const updateConfigWarning = () => {
  if (!configWarning) return;
  if (
    !quizData?.questions?.length ||
    quizData?.metadata?.source === "Default"
  ) {
    configWarning.textContent =
      "No quiz loaded. Long-press the top-left corner for 5 seconds to open configuration.";
  } else {
    configWarning.textContent = "";
  }
};

const startHotspotHold = () => {
  if (hotspotTimer) return;
  hotspotTimer = setTimeout(() => {
    hotspotTimer = null;
    if (configWarning) {
      configWarning.textContent = "Opening configuration window...";
    }
    window.quizAPI.focusConfig();
  }, HOTSPOT_HOLD_MS);
};

const cancelHotspotHold = () => {
  if (!hotspotTimer) return;
  clearTimeout(hotspotTimer);
  hotspotTimer = null;
  updateConfigWarning();
};

configHotspot?.addEventListener("pointerdown", startHotspotHold);
["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
  configHotspot?.addEventListener(eventName, cancelHotspotHold);
});

const startPinHotspotHold = () => {
  if (pinHoldTimer) return;
  pinHoldTriggered = false;
  pinHoldTimer = setTimeout(() => {
    pinHoldTimer = null;
    pinHoldTriggered = true;
    handleEndOfDayToggle();
  }, HOTSPOT_HOLD_MS);
};

const cancelPinHotspotHold = () => {
  if (!pinHoldTimer) return;
  clearTimeout(pinHoldTimer);
  pinHoldTimer = null;
};

const handlePinHotspotTap = () => {
  if (isClosed) {
    return;
  }

  if (currentMode === "idle") {
    showPinScreen();
    return;
  }

  resetQuizFlow(quizData, { resetIndex: true });
  resetForNextPlayer({ showPin: false });
};

const attachIdleClickHandler = (element) => {
  element?.addEventListener("pointerdown", () => {
    promptPinFromIdle();
  });
};

attachIdleClickHandler(stateVideo);
attachIdleClickHandler(stateImage);
attachIdleClickHandler(videoStage);

pinHotspot?.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  startPinHotspotHold();
});

["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
  pinHotspot?.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (pinHoldTimer) {
      cancelPinHotspotHold();
      if (eventName === "pointerup" && !pinHoldTriggered) {
        handlePinHotspotTap();
      }
      return;
    }
    if (pinHoldTriggered) {
      pinHoldTriggered = false;
      return;
    }
    if (eventName === "pointerup") {
      handlePinHotspotTap();
    }
  });
});

const handleEndOfDayToggle = () => {
  if (!isWithinWorkingHours()) {
    if (!isClosed) {
      enterClosedMode({ lockUntilWorkingHours: true });
    }
    return;
  }
  if (isClosed && !closedUntilWorkingHours) {
    exitClosedMode();
  }
};

const enterClosedMode = ({ lockUntilWorkingHours = false } = {}) => {
  isClosed = true;
  nonWorkingActive = false;
  closedUntilWorkingHours = lockUntilWorkingHours || closedUntilWorkingHours;
  const message = lockUntilWorkingHours
    ? "End of day. See you next shift."
    : "We are currently closed for the day.";
  if (configWarning) {
    configWarning.textContent = message;
  }
  resetForNextPlayer({
    message,
    showPin: false,
  });
};

const exitClosedMode = () => {
  isClosed = false;
  nonWorkingActive = false;
  closedUntilWorkingHours = false;
  resetForNextPlayer({ showPin: false });
  updateConfigWarning();
};

const pickNextNonWorkingIndex = () => {
  const playlist = quizData?.mediaResolved?.nonWorkingPlaylist || [];
  const valid = playlist.filter((entry) => entry.url);
  if (!valid.length) return null;
  if (valid.length === 1) {
    nonWorkingIndex = playlist.findIndex((entry) => entry.id === valid[0].id);
    return nonWorkingIndex;
  }

  let attempts = 0;
  while (attempts < 5) {
    let totalWeight = valid.reduce(
      (sum, entry) => sum + (entry.weight || 1),
      0,
    );
    let target = Math.random() * totalWeight;
    for (const entry of valid) {
      target -= entry.weight || 1;
      if (target <= 0) {
        const candidateIndex = playlist.findIndex(
          (item) => item.id === entry.id,
        );
        if (candidateIndex !== nonWorkingIndex) {
          nonWorkingIndex = candidateIndex;
          return candidateIndex;
        }
      }
    }
    attempts += 1;
  }
  nonWorkingIndex = playlist.findIndex((item) => item.id === valid[0].id);
  return nonWorkingIndex;
};

const parseTimeToMinutes = (value) => {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
};

const isWithinWorkingHours = () => {
  const workingHours = quizData?.settings?.workingHours;
  if (!workingHours) return true;
  const start = parseTimeToMinutes(workingHours.start);
  const end = parseTimeToMinutes(workingHours.end);
  if (start === null || end === null || start === end) return true;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return start < end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
};

const updateWorkingHoursStatus = () => {
  if (closedUntilWorkingHours && isWithinWorkingHours()) {
    exitClosedMode();
    closedUntilWorkingHours = false;
  }
};

const startClosedPlaylist = () => {
  const playlist = quizData?.mediaResolved?.nonWorkingPlaylist || [];
  if (!playlist.length) {
    playMedia(getMediaUrl("idleVideo"), { loop: true });
    return;
  }

  const nextIndex = pickNextNonWorkingIndex();
  if (nextIndex === null || !playlist[nextIndex]?.url) {
    playMedia(getMediaUrl("idleVideo"), { loop: true });
    return;
  }

  const mediaEntry = playlist[nextIndex];
  playMedia(mediaEntry.url, {
    loop: false,
    onEnded: () => {
      if (isClosed) {
        startClosedPlaylist();
      }
    },
  });
};

setInterval(updateWorkingHoursStatus, 60000);

const renderQuestion = () => {
  if (answerTransitionTimer) {
    clearTimeout(answerTransitionTimer);
    answerTransitionTimer = null;
  }
  questionSection.classList.remove("correct-state", "incorrect-state");
  hidePreQuizSection();
  if (!hasQuestions()) {
    questionText.textContent =
      "No questions available. Please import a new Excel file.";
    questionError.textContent = "";
    answerList.innerHTML = "";
    return;
  }

  updateConfigWarning();
  if (currentQuestionIndex === null) {
    currentQuestionIndex = pickRandomQuestionIndex();
  }

  const question = quizData.questions[currentQuestionIndex];
  questionText.textContent = question?.question || "Question";
  questionError.textContent = "";
  answerList.innerHTML = "";
  selectedAnswer = null;

  (question.answers || []).forEach(({ label, text }) => {
    const li = document.createElement("li");
    const labelEl = document.createElement("span");
    const textEl = document.createElement("span");

    li.className = "answer-option";
    li.dataset.answer = label;

    labelEl.className = "label";
    labelEl.textContent = label + ")";

    textEl.className = "text";
    textEl.textContent = text || "—";

    li.appendChild(labelEl);
    li.appendChild(textEl);
    answerList.appendChild(li);
  });

  updateAnswerOptionClasses(false);
  setOverlayVisible(true);
  if (!isClosed) {
    setMode("quiz");
  }
};

const resetQuizFlow = (quiz, { resetIndex = true } = {}) => {
  quizData = quiz;

  if (!quizData?.questions?.length) {
    currentQuestionIndex = null;
  } else if (resetIndex || currentQuestionIndex === null) {
    currentQuestionIndex = pickRandomQuestionIndex();
  }

  hideAwardSection();
  hidePreQuizSection();
  renderQuestion();
};

const showAwardWin = (award) => {
  awardName.textContent = award?.name || "Mystery Prize";
  setAwardLogo(award);
  awardSection.classList.remove("hidden");
  hideLoseSection();
  questionSection.classList.add("hidden");
  setOverlayVisible(true);
  setMode("win");
};

const handleAwardReveal = () => {
  questionError.textContent = "";
  if (!pendingAward) {
    questionError.textContent = "No prizes remain. Please try again later.";
    showLoseSection("No prizes remain. Please try again later.");
    return;
  }

  showAwardWin(pendingAward);
  logAwardRedemption(pendingAward);
  pendingAward = null;
};

const showLoseSection = (message) => {
  questionSection.classList.add("incorrect-state");
  questionError.textContent =
    message || "Incorrect answer. Please re-enter PIN.";
  awardSection.classList.add("hidden");
  questionSection.classList.add("hidden");
  loseSection?.classList.remove("hidden");
  preQuizSection?.classList.add("hidden");
  setOverlayVisible(true);
  setMode("lose");
};

const revealSelection = () => {
  updateAnswerOptionClasses(true);
  questionError.textContent = "";
};

const selectAnswer = (answerKey) => {
  if (!hasQuestions()) return;
  if (answerTransitionTimer) return;
  selectedAnswer = answerKey;
  revealSelection();

  const question = quizData.questions[currentQuestionIndex ?? 0];
  const isCorrect = question.correctAnswer === answerKey;

  questionSection.classList.toggle("correct-state", isCorrect);
  questionSection.classList.toggle("incorrect-state", !isCorrect);

  answerTransitionTimer = setTimeout(() => {
    answerTransitionTimer = null;
    if (isCorrect) {
      handleAwardReveal();
    } else {
      showLoseSection("Incorrect answer. Please re-enter PIN.");
    }
  }, 2000);
};

answerList.addEventListener("click", (event) => {
  const option = event.target.closest(".answer-option");
  if (!option) return;
  if (isClosed) return;
  selectAnswer(option.dataset.answer);
});

pinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isClosed) {
    return;
  }
  if (pinForm.dataset.submitting === "true") {
    return;
  }
  const pin = pinInput.value.trim();

  if (!pin) {
    return;
  }

  pinForm.dataset.submitting = "true";
  const response = await window.quizAPI.validatePin(pin);
  delete pinForm.dataset.submitting;

  if (!response.success) {
    setOverlayVisible(true);
    setMode("wrongpin");
    pinInput.value = "";
    refreshPinDisplay();
    pinSection.classList.add("hidden");
    wrongPinSection?.classList.remove("hidden");
    wrongPinMessage.textContent =
      response.message || "Invalid PIN. Please try again.";
    return;
  }

  if (!response.award) {
    setOverlayVisible(true);
    setMode("lose");
    pinInput.value = "";
    refreshPinDisplay();
    return;
  }

  unlocked = true;
  pendingAward = response.award || null;
  lastPinCode = response.pin || "";
  awaitingQuizStart = response.flow !== "grand";
  pinInput.value = "";
  refreshPinDisplay();

  if (response.flow === "grand") {
    pinSection.classList.add("hidden");
    questionSection.classList.add("hidden");
    hidePreQuizSection();
    showAwardWin(response.award);
    await logAwardRedemption(response.award);
    pendingAward = null;
    return;
  }

  // Non-grand prize: show intermediate screen before quiz starts.
  pinSection.classList.add("hidden");
  awardSection.classList.add("hidden");
  questionSection.classList.add("hidden");
  preQuizSection?.classList.remove("hidden");
  setOverlayVisible(true);
  setMode("prequiz");
});

// Start quiz after non-grand PIN success.
const beginQuiz = () => {
  if (!awaitingQuizStart) return;
  awaitingQuizStart = false;
  preQuizSection?.classList.add("hidden");
  questionSection.classList.remove("hidden");
  resetQuizFlow(quizData, { resetIndex: true });
};

beginQuizButton?.addEventListener("click", beginQuiz);
preQuizSection?.addEventListener("pointerdown", beginQuiz);
wrongPinSection?.addEventListener("pointerdown", () => {
  wrongPinSection?.classList.add("hidden");
  pinInput.value = "";
  refreshPinDisplay();
  showPinScreen();
});

// Global tap handler to advance from pre-quiz or wrong-pin screens by tapping anywhere.
document.querySelector(".screen")?.addEventListener("pointerdown", () => {
  if (!preQuizSection?.classList.contains("hidden")) {
    beginQuiz();
    return;
  }
  if (!wrongPinSection?.classList.contains("hidden")) {
    wrongPinSection?.classList.add("hidden");
    pinInput.value = "";
    refreshPinDisplay();
    showPinScreen();
    return;
  }
  if (!awardSection.classList.contains("hidden")) {
    resetForNextPlayer({ showPin: true });
    return;
  }
  if (!loseSection?.classList.contains("hidden")) {
    resetForNextPlayer({ showPin: true });
  }
});

window.quizAPI.onQuizUpdated((quiz) => {
  if (!quiz) return;
  quizData = quiz;
  updateConfigWarning();
  updateWorkingHoursStatus();

  if (!unlocked) {
    resetForNextPlayer({ showPin: false });
    return;
  }

  if (!awardSection.classList.contains("hidden")) {
    return;
  }
  if (!preQuizSection?.classList.contains("hidden")) {
    return;
  }

  currentQuestionIndex = pickRandomQuestionIndex();
  renderQuestion();
});

window.quizAPI.requestQuiz().then((quiz) => {
  quizData = quiz;
  updateConfigWarning();
  updateWorkingHoursStatus();
  currentQuestionIndex = pickRandomQuestionIndex();
  if (!isClosed) {
    showIdleScreen();
  }
});
