const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const PIN_CODE = process.env.APP_PIN || '4242';
const isDev = !app.isPackaged;

const createDefaultQuizState = () => ({
  questions: [
    {
      id: 'default-question',
      question: 'Awaiting configuration – please drop an Excel file in the config window.',
      answers: [
        { label: 'A', text: 'Answer A' },
        { label: 'B', text: 'Answer B' },
        { label: 'C', text: 'Answer C' },
        { label: 'D', text: 'Answer D' },
      ],
      correctAnswer: 'A',
    },
  ],
  awards: [],
  metadata: {
    source: 'Default',
    updatedAt: new Date().toISOString(),
  },
  lastAward: null,
});

let quizState = createDefaultQuizState();

let mainWindow;
let configWindow;

const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 720,
    resizable: false,
    title: 'Quiz Console',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '../preload/mainPreload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.webContents.openDevTools({ mode: 'detach' });
};

const shouldShowConfigWindow = () =>
  !quizState?.questions?.length || quizState?.metadata?.source === 'Default';

const createConfigWindow = () => {
  configWindow = new BrowserWindow({
    width: isDev ? 480 : 600,
    height: isDev ? 720 : 800,
    show: false,
    resizable: isDev,
    movable: true,
    fullscreen: !isDev,
    title: 'Question Config',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '../preload/configPreload.js'),
    },
  });

  configWindow.loadFile(path.join(__dirname, '../renderer/config.html'));
  if (isDev) {
    configWindow.webContents.openDevTools({ mode: 'detach' });
  }

  configWindow.once('ready-to-show', () => {
    if (shouldShowConfigWindow()) {
      showConfigWindow();
    }
  });

  configWindow.on('closed', () => {
    configWindow = null;
  });
};

const ensureConfigWindow = () => {
  if (!configWindow) {
    createConfigWindow();
  }
};

const showConfigWindow = () => {
  ensureConfigWindow();
  if (!configWindow) return;

  if (!isDev) {
    configWindow.setFullScreen(true);
  }

  configWindow.show();
  configWindow.focus();
};

const getPersistPath = () => path.join(app.getPath('userData'), 'quiz-state.json');

const persistQuizState = () => {
  try {
    fs.writeFileSync(getPersistPath(), JSON.stringify(quizState, null, 2), 'utf-8');
  } catch (error) {
    console.error('Unable to persist quiz state:', error);
  }
};

const hydrateQuizStateFromDisk = () => {
  try {
    const filePath = getPersistPath();
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?.questions?.length) {
      quizState = {
        ...createDefaultQuizState(),
        ...parsed,
        metadata: {
          ...parsed.metadata,
          source: parsed.metadata?.source || 'Persisted',
          updatedAt: parsed.metadata?.updatedAt || new Date().toISOString(),
        },
      };
    }
  } catch (error) {
    console.error('Unable to load persisted quiz state:', error);
  }
};

const broadcastQuizUpdate = () => {
  if (mainWindow) {
    mainWindow.webContents.send('quiz-updated', quizState);
  }

  if (configWindow) {
    configWindow.webContents.send('quiz-updated', quizState);
  }
};

const mapAnswer = (row, keys) => {
  for (const key of keys) {
    const value = row[key];
    if (value === undefined || value === null) {
      continue;
    }
    const text = String(value).trim();
    if (text.length > 0) {
      return text;
    }
  }

  return '';
};

const normalizeAnswerKey = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;

  const firstChar = normalized.toUpperCase()[0];
  if (ANSWER_LETTERS.includes(firstChar)) {
    return firstChar;
  }

  return null;
};

const ANSWER_LETTERS = Array.from({ length: 26 }, (_value, index) =>
  String.fromCharCode(65 + index),
);

const buildAnswers = (row) => {
  const answers = [];

  for (const letter of ANSWER_LETTERS) {
    const value = mapAnswer(row, [
      letter,
      letter.toLowerCase(),
      `Answer ${letter}`,
      `answer ${letter}`,
      `Answer${letter}`,
      `answer${letter}`,
      `Answer_${letter}`,
      `answer_${letter}`,
      `Option ${letter}`,
      `option ${letter}`,
      `Choice ${letter}`,
      `choice ${letter}`,
    ]);

    if (value) {
      answers.push({ label: letter, text: value });
    }
  }

  return answers;
};

const parseQuestionRows = (rows) => {
  return rows
    .map((row, index) => {
      const question =
        row.Question ||
        row.question ||
        row.Prompt ||
        row.prompt ||
        row['Question Text'] ||
        '';

      if (!question || !String(question).trim()) {
        return null;
      }

      const answers = buildAnswers(row);

      if (answers.length < 2) {
        throw new Error(`Question "${question}" must include at least two answer options.`);
      }

      const correctRaw =
        row.Correct ||
        row.correct ||
        row['Correct Answer'] ||
        row['correct answer'] ||
        row['Right Answer'] ||
        row['right answer'] ||
        row.Answer ||
        row.answer;

      let correctAnswer = normalizeAnswerKey(correctRaw);

      if (!correctAnswer && typeof correctRaw === 'string') {
        const normalizedText = correctRaw.trim().toLowerCase();
        const match = answers.find(
          (answer) => answer.text?.toLowerCase() === normalizedText && answer.label,
        );
        correctAnswer = match?.label || null;
      }

      if (!correctAnswer || !answers.some((answer) => answer.label === correctAnswer)) {
        throw new Error(
          `Question "${question}" must include a valid correct answer referencing one of the populated answer columns (A–Z).`,
        );
      }

      return {
        id: `question-${index + 1}`,
        order: index + 1,
        question: String(question).trim(),
        answers,
        correctAnswer,
      };
    })
    .filter(Boolean);
};

const sanitizeNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const parseAwardRows = (rows) =>
  rows
    .map((row, index) => {
      const name = row.Award || row.award || row.Prize || row.prize || row.Name || row.name;
      const probability =
        sanitizeNumber(
          row.Probability ??
            row.probability ??
            row.Weight ??
            row.weight ??
            row['Win %'] ??
            row['Win Chance'],
          0,
        ) || 0;
      const count =
        sanitizeNumber(
          row.Count ?? row.count ?? row.Remaining ?? row.remaining ?? row.Inventory ?? row.inventory,
          0,
        ) || 0;

      if (!name || probability <= 0 || count <= 0) {
        return null;
      }

      return {
        id: `award-${index + 1}`,
        name: String(name).trim(),
        probability,
        remaining: count,
        initialCount: count,
      };
    })
    .filter(Boolean);

const loadQuizFromWorkbook = (workbook, sourceName) => {
  const questionSheetName = workbook.SheetNames?.[0];

  if (!questionSheetName) {
    throw new Error('The Excel file does not contain any sheets.');
  }

  const questionSheet = workbook.Sheets[questionSheetName];
  const questionRows = XLSX.utils.sheet_to_json(questionSheet, { defval: '' });

  if (!questionRows.length) {
    throw new Error('The uploaded Excel file does not contain any question rows.');
  }

  const questions = parseQuestionRows(questionRows);

  if (!questions.length) {
    throw new Error('Please provide at least one row with a question prompt and answer text.');
  }

  let awards = [];
  const awardSheetName = workbook.SheetNames?.[1];

  if (awardSheetName) {
    const awardSheet = workbook.Sheets[awardSheetName];
    const awardRows = XLSX.utils.sheet_to_json(awardSheet, { defval: '' });
    awards = parseAwardRows(awardRows);
  }

  quizState = {
    questions,
    awards,
    metadata: {
      source: sourceName || 'Imported.xlsx',
      updatedAt: new Date().toISOString(),
    },
    lastAward: null,
  };

  persistQuizState();
};

const loadQuizFromExcelPath = (filePath) => {
  const workbook = XLSX.readFile(filePath);
  loadQuizFromWorkbook(workbook, path.basename(filePath));
};

const loadQuizFromExcelBuffer = (buffer, sourceName) => {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  loadQuizFromWorkbook(workbook, sourceName);
};

const drawAward = () => {
  const eligibleAwards = quizState.awards.filter((award) => award.remaining > 0 && award.probability > 0);

  if (!eligibleAwards.length) {
    throw new Error('No awards remain to be drawn.');
  }

  const totalWeight = eligibleAwards.reduce((sum, award) => sum + award.probability, 0);
  const target = Math.random() * totalWeight;

  let cumulative = 0;
  let selectedAward = eligibleAwards[0];

  for (const award of eligibleAwards) {
    cumulative += award.probability;
    if (target <= cumulative) {
      selectedAward = award;
      break;
    }
  }

  selectedAward.remaining -= 1;
  quizState.lastAward = {
    name: selectedAward.name,
    timestamp: new Date().toISOString(),
  };

  persistQuizState();
  broadcastQuizUpdate();

  return selectedAward;
};

app.whenReady().then(() => {
  hydrateQuizStateFromDisk();
  createMainWindow();
  createConfigWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createConfigWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('validate-pin', (_event, pinAttempt) => {
  if (String(pinAttempt || '').trim() !== PIN_CODE) {
    return {
      success: false,
      message: 'Invalid PIN. Please try again.',
    };
  }

  return {
    success: true,
    quiz: quizState,
  };
});

ipcMain.handle('get-quiz', () => quizState);

ipcMain.handle('process-excel', (_event, payload = {}) => {
  try {
    const { path: filePath, buffer, name } = payload;

    if (!filePath && !buffer) {
      throw new Error('Missing file information.');
    }

    if (filePath) {
      loadQuizFromExcelPath(filePath);
    } else {
      const normalizedBuffer = Buffer.isBuffer(buffer)
        ? buffer
        : Buffer.from(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer);
      loadQuizFromExcelBuffer(normalizedBuffer, name);
    }

    broadcastQuizUpdate();

    return {
      success: true,
      quiz: quizState,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message || 'Unable to process the Excel file.',
    };
  }
});

ipcMain.handle('draw-award', () => {
  try {
    const award = drawAward();
    return {
      success: true,
      award,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message || 'Unable to draw an award.',
    };
  }
});

ipcMain.handle('focus-config', () => {
  showConfigWindow();
  return { success: true };
});
