const pinForm = document.getElementById('pin-form');
const pinInput = document.getElementById('pin-input');
const pinError = document.getElementById('pin-error');
const pinSection = document.getElementById('pin-section');
const questionSection = document.getElementById('question-section');
const questionText = document.getElementById('question-text');
const questionProgress = document.getElementById('question-progress');
const questionError = document.getElementById('question-error');
const answerList = document.getElementById('answer-list');
const awardSection = document.getElementById('award-section');
const awardName = document.getElementById('award-name');
const awardDetails = document.getElementById('award-details');
const restartButton = document.getElementById('restart-btn');
const pinKeypad = document.getElementById('pin-keypad');
const configWarning = document.getElementById('config-warning');
const configHotspot = document.getElementById('config-hotspot');

const HOTSPOT_HOLD_MS = 5000;

let unlocked = false;
let quizData = null;
let currentIndex = 0;
let selectedAnswer = null;
let relockTimer = null;
let advanceTimer = null;
let hotspotTimer = null;

const hasQuestions = () => Boolean(quizData?.questions?.length);

const hideAwardSection = () => {
  awardSection.classList.add('hidden');
  questionSection.classList.remove('hidden');
  questionError.textContent = '';
  questionSection.classList.remove('correct-state', 'incorrect-state');
};

const clearRelockTimer = () => {
  if (relockTimer) {
    clearTimeout(relockTimer);
    relockTimer = null;
  }
};

const clearAdvanceTimer = () => {
  if (advanceTimer) {
    clearTimeout(advanceTimer);
    advanceTimer = null;
  }
};

const updateAnswerOptionClasses = (reveal = false) => {
  const question = quizData?.questions?.[currentIndex];
  if (!question) return;

  answerList.querySelectorAll('.answer-option').forEach((option) => {
    const key = option.dataset.answer;
    option.classList.toggle('selected', key === selectedAnswer);

    if (reveal) {
      option.classList.toggle('correct', key === question.correctAnswer);
      option.classList.toggle(
        'incorrect',
        key === selectedAnswer && selectedAnswer !== question.correctAnswer,
      );
    } else {
      option.classList.remove('correct', 'incorrect');
    }
  });
};

const unlockToPinScreen = (message) => {
  unlocked = false;
  pinInput.value = '';
  selectedAnswer = null;
  clearAdvanceTimer();
  if (message) {
    pinError.textContent = message;
  }
  pinSection.classList.remove('hidden');
  questionSection.classList.add('hidden');
  awardSection.classList.add('hidden');
};

const lockQuizForReauth = () => {
  unlockToPinScreen('Please re-enter PIN to continue.');
};

const triggerReauth = () => {
  if (relockTimer) return;
  relockTimer = setTimeout(() => {
    relockTimer = null;
    lockQuizForReauth();
  }, 1200);
};

const handleKeypadInput = (key) => {
  if (!key) return;

  if (/^[0-9]$/.test(key)) {
    if (pinInput.value.length < Number(pinInput.maxLength || 10)) {
      pinInput.value += key;
    }
    return;
  }

  if (key === 'del') {
    pinInput.value = pinInput.value.slice(0, -1);
    return;
  }

  if (key === 'clear') {
    pinInput.value = '';
    return;
  }

  if (key === 'enter') {
    if (typeof pinForm.requestSubmit === 'function') {
      pinForm.requestSubmit();
    } else {
      pinForm.dispatchEvent(new Event('submit'));
    }
  }
};

if (pinKeypad) {
  pinKeypad.addEventListener('click', (event) => {
    const { key } = event.target.dataset || {};
    handleKeypadInput(key);
  });
}

const updateConfigWarning = () => {
  if (!configWarning) return;
  if (!quizData?.questions?.length || quizData?.metadata?.source === 'Default') {
    configWarning.textContent = 'No quiz loaded. Long-press the top-left corner for 5 seconds to open configuration.';
  } else {
    configWarning.textContent = '';
  }
};

const startHotspotHold = () => {
  if (hotspotTimer) return;
  hotspotTimer = setTimeout(() => {
    hotspotTimer = null;
    if (configWarning) {
      configWarning.textContent = 'Opening configuration window...';
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

if (configHotspot) {
  configHotspot.addEventListener('pointerdown', startHotspotHold);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((eventName) => {
    configHotspot.addEventListener(eventName, cancelHotspotHold);
  });
}

const renderQuestion = () => {
  clearRelockTimer();
  clearAdvanceTimer();
  questionSection.classList.remove('correct-state', 'incorrect-state');
  if (!hasQuestions()) {
    questionText.textContent = 'No questions available. Please import a new Excel file.';
    questionProgress.textContent = '';
    questionError.textContent = '';
    answerList.innerHTML = '';
    return;
  }

  updateConfigWarning();
  const question = quizData.questions[currentIndex];
  questionText.textContent = question?.question || 'Question';
  questionProgress.textContent = `Question ${currentIndex + 1} of ${quizData.questions.length}`;
  questionError.textContent = '';
  answerList.innerHTML = '';
  selectedAnswer = null;

  (question.answers || []).forEach(({ label, text }) => {
    const li = document.createElement('li');
    const labelEl = document.createElement('span');
    const textEl = document.createElement('span');

    li.className = 'answer-option';
    li.dataset.answer = label;

    labelEl.className = 'label';
    labelEl.textContent = label;

    textEl.className = 'text';
    textEl.textContent = text || '—';

    li.appendChild(labelEl);
    li.appendChild(textEl);
    answerList.appendChild(li);
  });

  updateAnswerOptionClasses(false);
};

const resetQuizFlow = (quiz, { resetIndex = true } = {}) => {
  quizData = quiz;

  if (!quizData?.questions?.length) {
    currentIndex = 0;
  } else if (resetIndex || currentIndex >= quizData.questions.length) {
    currentIndex = 0;
  }

  hideAwardSection();
  renderQuestion();
};

const handleAwardReveal = async () => {
  questionError.textContent = '';

  const response = await window.quizAPI.drawAward();

  if (!response.success) {
    questionError.textContent = response.message || 'Unable to draw an award.';
    return;
  }

  const remainingLabel =
    typeof response.award?.remaining === 'number'
      ? `(${response.award.remaining} remaining)`
      : '';

  awardName.textContent = response.award?.name || 'Mystery Prize';
  awardDetails.textContent = remainingLabel;
  awardSection.classList.remove('hidden');
  questionSection.classList.add('hidden');
};

const revealSelection = () => {
  updateAnswerOptionClasses(true);
  questionError.textContent = '';
};

const autoAdvance = () => {
  advanceTimer = setTimeout(() => {
    advanceTimer = null;

    if (currentIndex < quizData.questions.length - 1) {
      currentIndex += 1;
      renderQuestion();
    } else {
      handleAwardReveal();
    }
  }, 800);
};

const selectAnswer = (answerKey) => {
  if (!hasQuestions()) return;
  selectedAnswer = answerKey;
  revealSelection();

  const question = quizData.questions[currentIndex];
  const isCorrect = question.correctAnswer === answerKey;

  if (isCorrect) {
    questionSection.classList.add('correct-state');
    autoAdvance();
  } else {
    questionSection.classList.add('incorrect-state');
    questionError.textContent = 'Incorrect answer. Please re-enter PIN.';
    triggerReauth();
  }
};

answerList.addEventListener('click', (event) => {
  const option = event.target.closest('.answer-option');
  if (!option || relockTimer) return;
  selectAnswer(option.dataset.answer);
});

restartButton.addEventListener('click', () => {
  unlockToPinScreen();
});

pinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const pin = pinInput.value.trim();
  pinError.textContent = '';

  if (!pin) {
    pinError.textContent = 'Please enter a PIN.';
    return;
  }

  pinForm.querySelector('button').disabled = true;
  const response = await window.quizAPI.validatePin(pin);
  pinForm.querySelector('button').disabled = false;

  if (!response.success) {
    pinError.textContent = response.message || 'Unable to validate PIN.';
    pinInput.value = '';
    return;
  }

  unlocked = true;
  pinInput.value = '';
  pinSection.classList.add('hidden');
  questionSection.classList.remove('hidden');
  resetQuizFlow(response.quiz, { resetIndex: true });
});

window.quizAPI.onQuizUpdated((quiz) => {
  if (!quiz) return;
  quizData = quiz;

  if (!unlocked) {
    return;
  }

  if (!awardSection.classList.contains('hidden')) {
    // Keep showing the award screen; the user can restart to reflect new data.
    return;
  }

  currentIndex = 0;
  renderQuestion();
});

window.quizAPI.requestQuiz().then((quiz) => {
  quizData = quiz;
  updateConfigWarning();
});
