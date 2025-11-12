const pinForm = document.getElementById("pin-form");
const pinInput = document.getElementById("pin-input");
const pinError = document.getElementById("pin-error");
const pinSection = document.getElementById("pin-section");
const questionSection = document.getElementById("question-section");
const questionText = document.getElementById("question-text");
const questionProgress = document.getElementById("question-progress");
const questionError = document.getElementById("question-error");
const answerList = document.getElementById("answer-list");
const awardSection = document.getElementById("award-section");
const awardName = document.getElementById("award-name");
const awardDetails = document.getElementById("award-details");
const restartButton = document.getElementById("restart-btn");
const pinKeypad = document.getElementById("pin-keypad");
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
};

const updateAnswerOptionClasses = (reveal = false) => {
  const question =
    quizData?.questions?.[currentQuestionIndex ?? 0];
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
      playMedia(getMediaUrl("quizVideo"), { loop: true });
      break;
    case "pin":
      nonWorkingActive = false;
      playMedia(getMediaUrl("pinVideo") || getMediaUrl("idleVideo"), {
        loop: true,
      });
      break;
    case "win":
      nonWorkingActive = false;
      playMedia(getMediaUrl("winVideo"), { loop: true });
      break;
    case "lose":
      nonWorkingActive = false;
      playMedia(getMediaUrl("loseVideo"), {
        loop: false,
        onEnded: () => lockQuizForReauth(),
      });
      break;
    case "closed":
      nonWorkingActive = true;
      startClosedPlaylist();
      break;
    case "idle":
    default:
      nonWorkingActive = false;
      playMedia(getMediaUrl("idleVideo"), { loop: true });
      break;
  }
};

const showIdleScreen = () => {
  pinSection.classList.add("hidden");
  questionSection.classList.add("hidden");
  awardSection.classList.add("hidden");
  setOverlayVisible(false);
  setMode(isClosed ? "closed" : "idle");
};

const showPinScreen = (message) => {
  if (message) {
    pinError.textContent = message;
  }
  setOverlayVisible(true);
  pinSection.classList.remove("hidden");
  questionSection.classList.add("hidden");
  awardSection.classList.add("hidden");
  setMode("pin");
  pinInput.focus?.();
};

const resetForNextPlayer = ({ message, showPin } = {}) => {
  unlocked = false;
  pinInput.value = "";
  selectedAnswer = null;
  pinError.textContent = message || "";

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
    return;
  }

  if (key === "del") {
    pinInput.value = pinInput.value.slice(0, -1);
    return;
  }

  if (key === "clear") {
    pinInput.value = "";
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
  if (isClosed) {
    pinError.textContent = "We are currently closed.";
    return;
  }

  if (currentMode === "idle") {
    showPinScreen();
    return;
  }

  resetQuizFlow(quizData, { resetIndex: true });
  resetForNextPlayer({ showPin: false });
});

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
  const closedNow = !isWithinWorkingHours();
  if (closedNow && !isClosed) {
    enterClosedMode();
  } else if (!closedNow && isClosed) {
    exitClosedMode();
  }
};

const enterClosedMode = () => {
  isClosed = true;
  nonWorkingActive = false;
  if (configWarning) {
    configWarning.textContent =
      "We are currently closed. Please come back during working hours.";
  }
  resetForNextPlayer({
    message: "We are currently closed. Please come back during working hours.",
    showPin: false,
  });
};

const exitClosedMode = () => {
  isClosed = false;
  nonWorkingActive = false;
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

setInterval(updateWorkingHoursStatus, 30000);

const renderQuestion = () => {
  questionSection.classList.remove("correct-state", "incorrect-state");
  if (!hasQuestions()) {
    questionText.textContent =
      "No questions available. Please import a new Excel file.";
    questionProgress.textContent = "";
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
  questionProgress.textContent = "Question";
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
    labelEl.textContent = label;

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
  renderQuestion();
};

const handleAwardReveal = async () => {
  questionError.textContent = "";

  const response = await window.quizAPI.drawAward();

  if (!response.success) {
    questionError.textContent = response.message || "Unable to draw an award.";
    return;
  }

  const remainingLabel =
    typeof response.award?.remaining === "number"
      ? `(${response.award.remaining} remaining)`
      : "";

  awardName.textContent = response.award?.name || "Mystery Prize";
  awardDetails.textContent = remainingLabel;
  awardSection.classList.remove("hidden");
  questionSection.classList.add("hidden");
  setOverlayVisible(true);
  setMode("win");
};

const revealSelection = () => {
  updateAnswerOptionClasses(true);
  questionError.textContent = "";
};

const selectAnswer = (answerKey) => {
  if (!hasQuestions()) return;
  selectedAnswer = answerKey;
  revealSelection();

  const question = quizData.questions[currentQuestionIndex ?? 0];
  const isCorrect = question.correctAnswer === answerKey;

  if (isCorrect) {
    questionSection.classList.add("correct-state");
    handleAwardReveal();
  } else {
    questionSection.classList.add("incorrect-state");
    questionError.textContent = "Incorrect answer. Please re-enter PIN.";
    setMode("lose");
  }
};

answerList.addEventListener("click", (event) => {
  const option = event.target.closest(".answer-option");
  if (!option) return;
  if (isClosed) return;
  selectAnswer(option.dataset.answer);
});

restartButton.addEventListener("click", () => {
  resetForNextPlayer({ showPin: true });
});

pinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isClosed) {
    pinError.textContent = "We are currently closed.";
    return;
  }
  const pin = pinInput.value.trim();
  pinError.textContent = "";

  if (!pin) {
    pinError.textContent = "Please enter a PIN.";
    return;
  }

  pinForm.querySelector("button").disabled = true;
  const response = await window.quizAPI.validatePin(pin);
  pinForm.querySelector("button").disabled = false;

  if (!response.success) {
    pinError.textContent = response.message || "Unable to validate PIN.";
    pinInput.value = "";
    return;
  }

  unlocked = true;
  pinInput.value = "";
  pinSection.classList.add("hidden");
  questionSection.classList.remove("hidden");
  resetQuizFlow(response.quiz, { resetIndex: true });
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
