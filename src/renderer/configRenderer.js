const dropZone = document.getElementById('drop-zone');
const statusEl = document.getElementById('config-status');
const previewQuestion = document.getElementById('preview-question');
const previewAnswers = document.getElementById('preview-answers');
const previewMeta = document.getElementById('preview-meta');
const questionCount = document.getElementById('question-count');
const awardList = document.getElementById('award-list');

const setStatus = (message, tone = 'info') => {
  statusEl.textContent = message || '';
  statusEl.style.color =
    tone === 'error' ? '#ff8585' : tone === 'success' ? '#8ff5c1' : '#f6c177';
};

const describeQuestions = (questions = []) => {
  const count = questions.length;
  if (!count) return '0 questions';
  return `${count} question${count === 1 ? '' : 's'}`;
};

const setPreviewQuestion = (question) => {
  if (!question) {
    previewQuestion.textContent = 'No question configured.';
    previewAnswers.innerHTML = '';
    return;
  }

  previewQuestion.textContent = question.question || 'Question';
  previewAnswers.innerHTML = '';

  (question.answers || []).forEach(({ label, text }) => {
    const li = document.createElement('li');
    const isCorrect = question.correctAnswer === label;
    li.textContent = `${label}: ${text || '—'}`;
    if (isCorrect) {
      li.classList.add('correct-answer');
    }
    previewAnswers.appendChild(li);
  });
};

const renderAwards = (awards = []) => {
  awardList.innerHTML = '';

  if (!awards.length) {
    const li = document.createElement('li');
    li.textContent = 'No awards configured.';
    awardList.appendChild(li);
    return;
  }

  awards.forEach((award) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    const remaining = document.createElement('span');

    label.textContent = award.name;
    label.className = 'label';

    const remainingText =
      typeof award.remaining === 'number' && typeof award.initialCount === 'number'
        ? `${award.remaining}/${award.initialCount} left`
        : `${award.remaining ?? '?'} remaining`;

    remaining.textContent = `${remainingText} • weight ${award.probability}`;

    li.appendChild(label);
    li.appendChild(remaining);
    awardList.appendChild(li);
  });
};

const renderPreview = (quiz) => {
  if (!quiz) return;

  const questions = quiz.questions || [];
  const firstQuestion = questions[0];
  questionCount.textContent = describeQuestions(questions);
  setPreviewQuestion(firstQuestion);
  renderAwards(quiz.awards);

  if (quiz.metadata?.updatedAt) {
    previewMeta.textContent = `${quiz.metadata.source || 'Unknown'} • Updated ${new Date(
      quiz.metadata.updatedAt,
    ).toLocaleString()}`;
  } else {
    previewMeta.textContent = '';
  }
};

const buildPayload = async (file) => {
  if (file.path) {
    return { path: file.path, name: file.name };
  }

  const arrayBuffer = await file.arrayBuffer();
  return { buffer: arrayBuffer, name: file.name };
};

const handleFileList = async (files) => {
  if (!files?.length) return;
  const file = files[0];

  if (!file.name.endsWith('.xlsx')) {
    setStatus('Only .xlsx files are supported.', 'error');
    return;
  }

  setStatus(`Importing ${file.name}...`);

  const payload = await buildPayload(file);
  const result = await window.configAPI.importExcel(payload);

  if (!result.success) {
    setStatus(result.message || 'Unable to import file.', 'error');
    return;
  }

  setStatus(`Loaded ${file.name}`, 'success');
  renderPreview(result.quiz);
};

['dragenter', 'dragover'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    dropZone.classList.add('active');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('active');
  });
});

dropZone.addEventListener('drop', (event) => {
  const files = event.dataTransfer?.files;
  handleFileList(files);
});

dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx';
    input.onchange = () => handleFileList(input.files);
    input.click();
  }
});

window.configAPI.requestQuiz().then(renderPreview);
window.configAPI.onQuizUpdated(renderPreview);

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());
