const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("url");
const yaml = require("js-yaml");
const XLSX = require("xlsx");

const { onUserEnterCode, getDayCounter } = require("./TOTP");

const isDev = !app.isPackaged;
const enableMediaTab =
  process.argv.includes("--media-tab") || process.env.ENABLE_MEDIA_TAB === "1";
const allowDuplicateCodes =
  isDev ||
  process.argv.includes("--allow-duplicate-codes") ||
  process.env.ALLOW_DUPLICATE_CODES === "1";

const SETTINGS_FILENAME = "settings.yaml";
const PLAYLIST_DIRNAME = "afterhours";
const LOGO_DIRNAME = "logos";
const EXPORT_MARKER = ".galacticblackfriday";
const WORKBOOK_BASENAME = "quiz-latest";
const WORKBOOK_EXTENSIONS = [".xlsx", ".xlsm", ".xlsb", ".xls"];
const REDEEMED_LOG_FILENAME = "redeemed-codes.log";

const defaultSettings = () => ({
  workingDirectory: "",
  workingHours: {
    start: "09:00",
    end: "21:00",
  },
  media: {
    pinVideo: "",
    pinLoop: true,
    idleVideo: "",
    idleLoop: true,
    quizVideo: "",
    quizLoop: true,
    winVideo: "",
    winLoop: true,
    loseVideo: "",
    loseLoop: true,
    wrongPinVideo: "",
    wrongPinLoop: true,
    preQuizVideo: "",
    preQuizLoop: true,
  },
  nonWorkingPlaylist: [],
  nonWorkingEnabled: false,
  externalSyncEnabled: false,
});

const createDefaultQuizState = () => ({
  questions: [
    {
      id: "default-question",
      question:
        "Awaiting configuration – please drop an Excel file in the config window.",
      answers: [
        { label: "A", text: "Answer A" },
        { label: "B", text: "Answer B" },
        { label: "C", text: "Answer C" },
        { label: "D", text: "Answer D" },
      ],
      correctAnswer: "A",
    },
  ],
  awards: [],
  metadata: {
    source: "Default",
    updatedAt: new Date().toISOString(),
  },
  lastAward: null,
  redeemedCodes: {
    day: getDayCounter(),
    entries: [],
  },
  settings: defaultSettings(),
  mediaResolved: {
    pinVideo: "",
    pinLoop: true,
    idleVideo: "",
    idleLoop: true,
    quizVideo: "",
    quizLoop: true,
    winVideo: "",
    winLoop: true,
    loseVideo: "",
    loseLoop: true,
    wrongPinVideo: "",
    wrongPinLoop: true,
    preQuizVideo: "",
    preQuizLoop: true,
    nonWorkingPlaylist: [],
  },
});

let quizState = createDefaultQuizState();

const isExternalSyncEnabled = () =>
  Boolean(quizState.settings?.externalSyncEnabled);

const getExportableSettings = (settings = quizState.settings) => {
  if (!settings) return {};
  const { workingDirectory, ...rest } = settings;
  return rest;
};

let mainWindow;
let configWindow;
let externalWatcherTimer = null;

const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 1920,
    resizable: isDev,
    fullscreen: !isDev,
    fullscreenable: true,
    simpleFullscreen: process.platform === "darwin" && !isDev,
    autoHideMenuBar: true,
    title: "Quiz Console",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "../preload/mainPreload.js"),
    },
  });

  // Lock the viewport to portrait HD proportions so content stays consistent.
  mainWindow.setAspectRatio(1080 / 1920);

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  if (!isDev) {
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setFullScreen(true);
  }
  // mainWindow.webContents.openDevTools({ mode: "detach" });
};

const shouldShowConfigWindow = () =>
  !quizState?.questions?.length || quizState?.metadata?.source === "Default";

const toFileUrl = (filePath) => {
  try {
    return pathToFileURL(filePath).href;
  } catch {
    return "";
  }
};

const resolveMediaPath = (relativePath) => {
  if (!relativePath) return "";
  const baseDir = quizState.settings.workingDirectory;
  if (!baseDir) return "";
  const absolutePath = path.resolve(baseDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return "";
  }
  return toFileUrl(absolutePath);
};

const resolveLogoPath = (logoFile) => {
  if (!logoFile) return "";
  const baseDir = quizState.settings.workingDirectory;
  if (!baseDir) return "";
  const safeName = path.basename(String(logoFile).trim());
  if (!safeName) return "";
  const absolutePath = path.join(baseDir, LOGO_DIRNAME, safeName);
  if (!fs.existsSync(absolutePath)) {
    return "";
  }
  return toFileUrl(absolutePath);
};

const resolveAwardLogoUrl = (logoValue) => resolveLogoPath(logoValue);

const updateResolvedMedia = () => {
  const media = quizState.settings.media || {};
  quizState.mediaResolved = {
    pinVideo: resolveMediaPath(media.pinVideo),
    pinLoop: media.pinLoop !== false,
    idleVideo: resolveMediaPath(media.idleVideo),
    idleLoop: media.idleLoop !== false,
    quizVideo: resolveMediaPath(media.quizVideo),
    quizLoop: media.quizLoop !== false,
    winVideo: resolveMediaPath(media.winVideo),
    winLoop: media.winLoop !== false,
    loseVideo: resolveMediaPath(media.loseVideo),
    loseLoop: media.loseLoop !== false,
    wrongPinVideo: resolveMediaPath(media.wrongPinVideo),
    wrongPinLoop: media.wrongPinLoop !== false,
    preQuizVideo: resolveMediaPath(media.preQuizVideo),
    preQuizLoop: media.preQuizLoop !== false,
    nonWorkingPlaylist: (quizState.settings.nonWorkingPlaylist || []).map(
      (item) => ({
        ...item,
        url: resolveMediaPath(item.file),
      }),
    ),
  };

  (quizState.awards || []).forEach((award) => {
    award.logoUrl = resolveAwardLogoUrl(award.logo);
  });
};

updateResolvedMedia();

const mergeSettings = (patch = {}, options = {}) => {
  const prevSyncEnabled = isExternalSyncEnabled();

  quizState.settings = {
    ...quizState.settings,
    ...patch,
    workingHours: {
      ...quizState.settings.workingHours,
      ...(patch.workingHours || {}),
    },
    media: {
      ...quizState.settings.media,
      ...(patch.media || {}),
    },
    nonWorkingEnabled:
      typeof patch.nonWorkingEnabled === "boolean"
        ? patch.nonWorkingEnabled
        : quizState.settings.nonWorkingEnabled,
    externalSyncEnabled:
      typeof patch.externalSyncEnabled === "boolean"
        ? patch.externalSyncEnabled
        : Boolean(quizState.settings.externalSyncEnabled),
  };

  if (patch.nonWorkingPlaylist) {
    quizState.settings.nonWorkingPlaylist = patch.nonWorkingPlaylist;
  }

  persistQuizState();
  updateResolvedMedia();
  if (!options.skipYamlWrite) {
    writeSettingsYaml();
  }

  const nextSyncEnabled = isExternalSyncEnabled();
  if (prevSyncEnabled !== nextSyncEnabled) {
    applyExternalSyncPreference();
  }
};

const resetToDefaults = () => {
  quizState = createDefaultQuizState();
  persistQuizState();
  updateResolvedMedia();
  const settingsPath = getSettingsFilePath();
  if (settingsPath && fs.existsSync(settingsPath)) {
    fs.unlinkSync(settingsPath);
  }
  applyExternalSyncPreference();
  broadcastQuizUpdate();
};

const ensureDirExists = (dirPath) => {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const getWorkingDirectory = () => quizState.settings.workingDirectory || "";

const getSettingsFilePath = () => {
  const dir = getWorkingDirectory();
  return dir ? path.join(dir, SETTINGS_FILENAME) : "";
};

const getRedeemedLogPath = () => {
  const dir = getWorkingDirectory();
  return dir ? path.join(dir, REDEEMED_LOG_FILENAME) : "";
};

const writeSettingsYaml = () => {
  const settingsPath = getSettingsFilePath();
  if (!settingsPath) return;
  ensureDirExists(path.dirname(settingsPath));
  const exportable = getExportableSettings();
  fs.writeFileSync(settingsPath, yaml.dump(exportable), "utf-8");
  const markerPath = path.join(path.dirname(settingsPath), EXPORT_MARKER);
  fs.writeFileSync(markerPath, "");
};

const clearDirectoryContents = (dirPath) => {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath);
  entries.forEach((entry) => {
    const entryPath = path.join(dirPath, entry);
    fs.rmSync(entryPath, { recursive: true, force: true });
  });
};

const copyDirectoryContents = (source, destination) => {
  ensureDirExists(destination);
  const entries = fs.readdirSync(source, { withFileTypes: true });
  entries.forEach((entry) => {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(srcPath);
      try {
        fs.symlinkSync(linkTarget, destPath);
      } catch {
        fs.copyFileSync(srcPath, destPath);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
};

const saveWorkbookArtifact = (
  sourcePath,
  buffer,
  originalName = "quiz.xlsx",
) => {
  const workingDir = requireWorkingDirectory();
  ensureDirExists(workingDir);
  const extension = path.extname(originalName) || ".xlsx";
  const destination = path.join(workingDir, `quiz-latest${extension}`);
  if (sourcePath) {
    fs.copyFileSync(sourcePath, destination);
  } else if (buffer) {
    fs.writeFileSync(
      destination,
      Buffer.isBuffer(buffer)
        ? buffer
        : Buffer.from(
            buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer,
          ),
    );
  }
  quizState.metadata.workbookFile = path.basename(destination);
};

const getMountRoots = () => {
  const platform = os.platform();
  if (platform === "win32") {
    const drives = [];
    for (let code = 67; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (fs.existsSync(drive)) {
        drives.push(drive);
      }
    }
    return drives;
  }

  const username = os.userInfo().username || process.env.USER || "";
  const roots = [
    "/Volumes",
    "/media",
    "/mnt",
    `/media/${username}`,
    `/run/media/${username}`,
  ];
  return roots.filter((root) => fs.existsSync(root));
};

const findExternalConfigDirs = () => {
  const workingDir = path.resolve(getWorkingDirectory() || "");
  const dirs = [];
  const roots = getMountRoots();

  roots.forEach((root) => {
    let candidates = [];
    try {
      const stat = fs.statSync(root);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(root, { withFileTypes: true });
        const firstLevel = entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(root, entry.name));
        candidates.push(root, ...firstLevel);

        firstLevel.forEach((dir) => {
          try {
            const secondLevelEntries = fs.readdirSync(dir, {
              withFileTypes: true,
            });
            secondLevelEntries
              .filter((entry) => entry.isDirectory())
              .forEach((entry) => {
                candidates.push(path.join(dir, entry.name));
              });
          } catch {
            /* ignore */
          }
        });
      }
    } catch {
      candidates = [];
    }

    candidates.forEach((candidate) => {
      try {
        const resolved = path.resolve(candidate);
        if (resolved === workingDir) return;
        const settingsPath = path.join(candidate, SETTINGS_FILENAME);
        const markerPath = path.join(candidate, EXPORT_MARKER);
        if (fs.existsSync(settingsPath) || fs.existsSync(markerPath)) {
          dirs.push(candidate);
        }
      } catch {
        // ignore
      }
    });
  });

  return dirs;
};

const broadcastSyncMessage = (message) => {
  [mainWindow, configWindow].forEach((win) => {
    win?.webContents.send("sync-message", message);
  });
};

const createConfigWindow = () => {
  configWindow = new BrowserWindow({
    width: 600,
    height: 800,
    show: false,
    resizable: isDev,
    movable: true,
    fullscreen: false,
    title: "Question Config",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "../preload/configPreload.js"),
    },
  });

  configWindow.loadFile(path.join(__dirname, "../renderer/config.html"));
  if (isDev) {
    // configWindow.webContents.openDevTools({ mode: "detach" });
  }

  configWindow.once("ready-to-show", () => {
    if (shouldShowConfigWindow()) {
      showConfigWindow();
    }
  });

  configWindow.on("closed", () => {
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

  configWindow.show();
  configWindow.focus();
};

const getPersistPath = () =>
  path.join(app.getPath("userData"), "quiz-state.json");

const persistQuizState = () => {
  try {
    fs.writeFileSync(
      getPersistPath(),
      JSON.stringify(quizState, null, 2),
      "utf-8",
    );
  } catch (error) {
    console.error("Unable to persist quiz state:", error);
  }
};

const refreshRedeemedCodesDay = () => {
  const today = getDayCounter();
  if (!quizState.redeemedCodes || quizState.redeemedCodes.day !== today) {
    quizState.redeemedCodes = { day: today, entries: [] };
  }
};

const parseRedeemedLog = (opts = {}) => {
  const { dayFilter } = opts;
  const logPath = getRedeemedLogPath();
  if (!logPath || !fs.existsSync(logPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(logPath, "utf-8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const entries = lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (typeof dayFilter === "number") {
      return entries.filter((entry) => {
        const entryDay =
          typeof entry.day === "number"
            ? entry.day
            : getDayCounter(new Date(entry.timestamp || Date.now()).getTime());
        return entryDay === dayFilter;
      });
    }

    return entries;
  } catch (error) {
    console.error("Unable to read redeemed code log:", error);
    return [];
  }
};

const hasCodeRedeemedToday = (code) => {
  if (allowDuplicateCodes || !code) return false;
  const today = getDayCounter();
  const entries = parseRedeemedLog({ dayFilter: today });
  return entries.some((entry) => String(entry.code) === String(code));
};

const recordRedeemedCode = (code, award) => {
  const today = getDayCounter();
  const entry = {
    code: String(code),
    award: award?.name || "",
    timestamp: new Date().toISOString(),
    day: today,
  };
  if (hasCodeRedeemedToday(code)) {
    return;
  }
  quizState.redeemedCodes = { day: today, entries: [] };
  const logPath = getRedeemedLogPath();
  if (!logPath) {
    throw new Error("Working directory is not set for redeemed code logging.");
  }
  try {
    ensureDirExists(path.dirname(logPath));
    fs.appendFileSync(logPath, JSON.stringify(entry) + os.EOL, "utf-8");
  } catch (error) {
    console.error("Unable to write redeemed code log:", error);
    throw error;
  }
  persistQuizState();
};

const hydrateQuizStateFromDisk = () => {
  try {
    const filePath = getPersistPath();
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.questions?.length) {
      quizState = {
        ...createDefaultQuizState(),
        ...parsed,
        metadata: {
          ...parsed.metadata,
          source: parsed.metadata?.source || "Persisted",
          updatedAt: parsed.metadata?.updatedAt || new Date().toISOString(),
        },
        settings: {
          ...defaultSettings(),
          ...parsed.settings,
          workingHours: {
            ...defaultSettings().workingHours,
            ...(parsed.settings?.workingHours || {}),
          },
          media: {
            ...defaultSettings().media,
            ...(parsed.settings?.media || {}),
          },
          nonWorkingPlaylist: parsed.settings?.nonWorkingPlaylist || [],
          externalSyncEnabled:
            typeof parsed.settings?.externalSyncEnabled === "boolean"
              ? parsed.settings.externalSyncEnabled
              : false,
        },
      };
      updateResolvedMedia();
      ensureAwardStateCompatibility();
      refreshAwardsForToday();
      refreshRedeemedCodesDay();
    }
  } catch (error) {
    console.error("Unable to load persisted quiz state:", error);
  }
};

const loadSettingsFromFile = (filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const parsed = yaml.load(fileContent);
    if (typeof parsed === "object" && parsed !== null) {
      if ("workingDirectory" in parsed) {
        delete parsed.workingDirectory;
      }
      return parsed;
    }
    return null;
  } catch (error) {
    console.error("Failed to read settings file:", error);
    return null;
  }
};

const syncFromExternal = (externalDir) => {
  const workingDir = getWorkingDirectory();
  if (!workingDir) {
    return false;
  }
  const resolvedExternal = path.resolve(externalDir);
  const resolvedWorking = path.resolve(workingDir);
  if (resolvedExternal === resolvedWorking) {
    return false;
  }
  if (!fs.existsSync(externalDir) || !fs.statSync(externalDir).isDirectory()) {
    return false;
  }

  clearDirectoryContents(workingDir);
  copyDirectoryContents(externalDir, workingDir);

  const importedSettings = loadSettingsFromFile(
    path.join(workingDir, SETTINGS_FILENAME),
  );
  if (importedSettings) {
    mergeSettings(importedSettings, { skipYamlWrite: true });
  }

  loadWorkbookFromDirectory(workingDir);
  writeSettingsYaml();
  updateResolvedMedia();
  broadcastQuizUpdate();
  broadcastSyncMessage(`Imported configuration from ${externalDir}`);
  return true;
};

const syncToExternal = (destinationDir) => {
  const workingDir = getWorkingDirectory();
  if (!workingDir) {
    throw new Error("Select a working directory first.");
  }

  const resolvedDest = path.resolve(destinationDir);
  const resolvedWorking = path.resolve(workingDir);
  if (resolvedDest === resolvedWorking) {
    throw new Error("Destination matches working directory.");
  }

  ensureDirExists(resolvedDest);
  clearDirectoryContents(resolvedDest);
  copyDirectoryContents(workingDir, resolvedDest);
  fs.writeFileSync(path.join(resolvedDest, EXPORT_MARKER), "");
};

const externalImportCache = new Map();

function scanExternalImports() {
  if (!isExternalSyncEnabled()) return;
  const workingDir = getWorkingDirectory();
  if (!workingDir) return;

  const sources = findExternalConfigDirs();
  sources.forEach((source) => {
    try {
      const marker = fs.existsSync(path.join(source, SETTINGS_FILENAME))
        ? path.join(source, SETTINGS_FILENAME)
        : path.join(source, EXPORT_MARKER);
      if (!fs.existsSync(marker)) return;
      const stat = fs.statSync(marker);
      const cacheKey = path.resolve(source);
      const lastImported = externalImportCache.get(cacheKey) || 0;
      if (stat.mtimeMs <= lastImported) {
        return;
      }
      const imported = syncFromExternal(source);
      if (imported) {
        externalImportCache.set(cacheKey, Date.now());
      }
    } catch {
      // ignore
    }
  });
}

function startExternalWatcher() {
  if (externalWatcherTimer || !isExternalSyncEnabled()) return;
  externalWatcherTimer = setInterval(scanExternalImports, 20000);
}

function stopExternalWatcher() {
  if (externalWatcherTimer) {
    clearInterval(externalWatcherTimer);
    externalWatcherTimer = null;
  }
}

function applyExternalSyncPreference() {
  if (isExternalSyncEnabled()) {
    scanExternalImports();
    startExternalWatcher();
  } else {
    stopExternalWatcher();
  }
}

const broadcastQuizUpdate = () => {
  if (mainWindow) {
    mainWindow.webContents.send("quiz-updated", quizState);
  }

  if (configWindow) {
    configWindow.webContents.send("quiz-updated", quizState);
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

  return "";
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
  const parsed = rows
    .map((row, index) => {
      const question =
        row.Question ||
        row.question ||
        row.Prompt ||
        row.prompt ||
        row["Question Text"] ||
        "";

      if (!question || !String(question).trim()) {
        return null;
      }

      const answers = buildAnswers(row);

      if (answers.length < 2) {
        throw new Error(
          `Question "${question}" must include at least two answer options.`,
        );
      }

      const correctRaw =
        row.Correct ||
        row.correct ||
        row["Correct Answer"] ||
        row["correct answer"] ||
        row["Right Answer"] ||
        row["right answer"] ||
        row.Answer ||
        row.answer;

      let correctAnswer = normalizeAnswerKey(correctRaw);

      if (!correctAnswer && typeof correctRaw === "string") {
        const normalizedText = correctRaw.trim().toLowerCase();
        const match = answers.find(
          (answer) =>
            answer.text?.toLowerCase() === normalizedText && answer.label,
        );
        correctAnswer = match?.label || null;
      }

      if (
        !correctAnswer ||
        !answers.some((answer) => answer.label === correctAnswer)
      ) {
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

  if (parsed.length > 1) {
    const randomIndex = Math.floor(Math.random() * parsed.length);
    [parsed[parsed.length - 1], parsed[randomIndex]] = [
      parsed[randomIndex],
      parsed[parsed.length - 1],
    ];
  }

  return parsed;
};

const sanitizeNumber = (value, fallback = 0) => {
  let normalizedValue = value;
  if (typeof normalizedValue === "string") {
    const trimmed = normalizedValue.trim();
    const cleaned = trimmed
      .replace(/,/g, "")
      .replace(/%/g, "")
      .replace(/[^\d.-]/g, "");
    normalizedValue = cleaned.length ? cleaned : trimmed;
  }
  const num = Number(normalizedValue);
  return Number.isFinite(num) ? num : fallback;
};

const toLowerString = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const parseDateFromValue = (value) => {
  console.log(value)
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "number") {
    if (XLSX?.SSF?.parse_date_code) {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) {
        return new Date(
          Date.UTC(
            parsed.y,
            parsed.m - 1,
            parsed.d,
            parsed.H,
            parsed.M,
            parsed.S,
          ),
        );
      }
    }
    return new Date(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Replace dots with slashes to help Date.parse handle more formats.
    const normalized = trimmed.replace(/\./g, "/");
    const parsed = Date.parse(normalized);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed);
    }
  }
  return null;
};

const getDayKeyFromValue = (value) => {
  const parsed = parseDateFromValue(value);
  if (!parsed) return null;
  return String(getDayCounter(parsed.getTime()));
};

const getTodayDayKey = () => String(getDayCounter());

const parseNonWorkingRows = (rows) =>
  rows
    .map((row, index) => {
      const file =
        row.Video ||
        row.video ||
        row.File ||
        row.file ||
        row.Path ||
        row.path ||
        row.Media ||
        row.media;

      const weight =
        sanitizeNumber(
          row.Weight ?? row.weight ?? row.Probability ?? row.probability,
          1,
        ) || 1;

      if (!file) {
        return null;
      }

      return {
        id: `nonworking-${index + 1}`,
        file: String(file).trim(),
        weight: weight > 0 ? weight : 1,
      };
    })
    .filter(Boolean);

const parseCountValue = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^(inf(inity)?|unlimited|∞)$/i.test(trimmed)) {
      return -1;
    }
    const normalized = trimmed.replace(/,/g, "");
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return null;
};

const awardHeaderMatcher = /(award|prize|name|reward)/i;
const awardTypeMatcher = /type/i;
const awardLogoMatcher = /logo/i;
const weightMatcher = /(weight|prob|chance|win|%)/i;
const countMatcher =
  /(count|qty|quantity|inventory|stock|remaining|supply|No.)/i;

const getAwardTableHeaderIndex = (rows = []) =>
  rows.findIndex((row = []) => {
    if (!Array.isArray(row)) return false;
    const normalized = row.map((cell) =>
      typeof cell === "string" ? cell.trim() : "",
    );
    const hasNameColumn = normalized.some((cell) =>
      awardHeaderMatcher.test(cell || ""),
    );
    if (!hasNameColumn) return false;
    const hasSupportingColumn = normalized.some(
      (cell) =>
        weightMatcher.test(cell || "") ||
        countMatcher.test(cell || "") ||
        awardLogoMatcher.test(cell || "") ||
        awardTypeMatcher.test(cell || ""),
    );
    return hasSupportingColumn;
  });

const buildAwardColumnDescriptors = (
  headerRow = [],
  parentRow = [],
  childRow = [],
) => {
  let activeParentDateKey = null;
  let activeParentDateRaw = "";

  return headerRow.map((cell, index) => {
    const headerTextRaw = cell ?? "";
    const parentTextRaw = parentRow[index] ?? "";
    const childTextRaw = childRow[index] ?? "";
    const headerText = toLowerString(headerTextRaw);
    const parentText = toLowerString(parentTextRaw);
    const childText = toLowerString(childTextRaw);
    const headerDateKey = getDayKeyFromValue(headerTextRaw);
    const parentDateKey = getDayKeyFromValue(parentTextRaw);

    if (parentDateKey) {
      activeParentDateKey = parentDateKey;
      activeParentDateRaw =
        parentTextRaw === null || parentTextRaw === undefined
          ? ""
          : parentTextRaw;
    } else if (
      typeof parentTextRaw === "string" &&
      parentTextRaw.trim().length > 0
    ) {
      activeParentDateKey = null;
      activeParentDateRaw = "";
    }

    const inheritedParentDateKey =
      !parentDateKey && !parentTextRaw ? activeParentDateKey : null;
    const inheritedParentRaw =
      !parentDateKey && !parentTextRaw ? activeParentDateRaw : "";

    const dateKey =
      headerDateKey ?? parentDateKey ?? inheritedParentDateKey ?? null;

    const descriptor = {
      index,
      headerText,
      parentText,
      rawHeader: headerTextRaw,
      rawParent: parentTextRaw,
      dateKey,
      dateLabel:
        dateKey && (headerDateKey || parentDateKey || inheritedParentDateKey)
          ? headerDateKey
            ? headerTextRaw
            : parentDateKey
              ? parentTextRaw
              : inheritedParentRaw
          : null,
      role: null,
    };

    const combinedText = `${headerText} ${parentText} ${childText}`.trim();

    const headerMatches = (regex) =>
      regex.test(headerText) ||
      regex.test(parentText) ||
      regex.test(childText) ||
      regex.test(combinedText);

    if (dateKey) {
      if (headerMatches(weightMatcher)) {
        descriptor.role = "date-probability";
      } else if (headerMatches(countMatcher)) {
        descriptor.role = "date-count";
      } else {
        descriptor.role = "date-info";
      }
      return descriptor;
    }

    if (headerMatches(awardHeaderMatcher)) {
      descriptor.role = "name";
    } else if (headerMatches(awardTypeMatcher)) {
      descriptor.role = "type";
    } else if (headerMatches(awardLogoMatcher)) {
      descriptor.role = "logo";
    } else if (headerMatches(weightMatcher)) {
      descriptor.role = "probability";
    } else if (headerMatches(countMatcher)) {
      descriptor.role = "count";
    } else {
      descriptor.role = "info";
    }

    return descriptor;
  });
};

const applyScheduleToAward = (award, dayKey = getTodayDayKey()) => {
  if (!award || award.currentDay === dayKey) {
    return;
  }

  const schedule = award.dailySchedule || {};
  const entry =
    schedule[dayKey] ||
    schedule[schedule[dayKey]?.fallbackKey || ""] ||
    schedule.default ||
    null;

  if (!entry) {
    award.probability = 0;
    award.unlimited = false;
    award.remaining = 0;
    award.initialCount = 0;
    award.currentDay = dayKey;
    return;
  }

  const probability = sanitizeNumber(entry.probability, 0);
  award.probability = probability > 0 ? probability : 0;

  const resolvedCount =
    typeof entry.count === "number" && Number.isFinite(entry.count)
      ? entry.count
      : null;
  const unlimited = Boolean(entry.unlimited) || resolvedCount === -1;

  award.unlimited = unlimited;
  award.currentDay = dayKey;

  if (unlimited) {
    award.remaining = -1;
    award.initialCount = null;
    return;
  }

  const countValue = resolvedCount ?? 0;
  const normalizedCount = countValue > 0 ? countValue : 0;
  award.remaining = normalizedCount;
  award.initialCount = normalizedCount;
};

const refreshAwardsForToday = () => {
  const todayKey = getTodayDayKey();
  (quizState.awards || []).forEach((award) => {
    applyScheduleToAward(award, todayKey);
  });
};

const ensureAwardStateCompatibility = () => {
  (quizState.awards || []).forEach((award, index) => {
    if (!award.id) {
      award.id = `award-${index + 1}`;
    }
    if (award.logo) {
      award.logo = path.basename(String(award.logo).trim());
    }
    if (!award.dailySchedule) {
      const baseCount = award.unlimited
        ? -1
        : typeof award.initialCount === "number"
          ? award.initialCount
          : typeof award.remaining === "number"
            ? award.remaining
            : 0;
      award.dailySchedule = {
        default: {
          probability: sanitizeNumber(award.probability, 0),
          count: baseCount,
          unlimited: Boolean(award.unlimited),
        },
      };
      award.currentDay = null;
    }
    award.logoUrl = resolveAwardLogoUrl(award.logo);
  });
};

const parseAwardRows = (rows = []) => {
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error(
      "The awards sheet is empty. Please provide prize rows with names and weights.",
    );
  }

  const headerIndex = getAwardTableHeaderIndex(rows);
  if (headerIndex === -1) {
    throw new Error(
      "Unable to find the award table header. Ensure one row contains columns such as Prize, Logo, Type, Weight, and Count.",
    );
  }

  const headerRow = rows[headerIndex] || [];
  const parentRow = rows[headerIndex - 1] || [];
  const childRow = rows[headerIndex + 1] || [];
  const descriptors = buildAwardColumnDescriptors(headerRow, parentRow, childRow);
  const formatDateLabel = (value) => {
    if (value === undefined || value === null) {
      return "";
    }
    const parsedDate = parseDateFromValue(value);
    if (parsedDate) {
      return parsedDate.toISOString().split("T")[0];
    }
    const text = String(value).trim();
    return text;
  };
  const dateKeyLabels = {};
  descriptors.forEach((descriptor) => {
    if (!descriptor.dateKey || dateKeyLabels[descriptor.dateKey]) {
      return;
    }
    const labelSource =
      descriptor.dateLabel ??
      descriptor.rawParent ??
      descriptor.rawHeader ??
      descriptor.dateKey;
    dateKeyLabels[descriptor.dateKey] = formatDateLabel(labelSource);
  });
  const getDateLabel = (key) => {
    if (!key) return "this date";
    const source = dateKeyLabels[key];
    if (source === undefined || source === null) {
      return `day ${key}`;
    }
    const text = String(source).trim();
    return text.length ? text : `day ${key}`;
  };
  const dataRows = rows
    .slice(headerIndex + 1)
    .filter(
      (row) =>
        Array.isArray(row) &&
        row.some((cell) => String(cell ?? "").trim().length > 0),
    );

  if (!dataRows.length) {
    throw new Error(
      "The awards sheet does not contain any prize rows below the header row.",
    );
  }

  const todayKey = getTodayDayKey();

  const parsedAwards = dataRows
    .map((row, rowIndex) => {
      const getValueByRole = (role) => {
        const descriptor = descriptors.find((col) => col.role === role);
        if (!descriptor) return null;
        return row[descriptor.index];
      };

      const getFirstValueByRoles = (roles = []) => {
        for (const role of roles) {
          const value = getValueByRole(role);
          if (value !== undefined && value !== null && value !== "") {
            return value;
          }
        }
        return null;
      };

      const rawName = getFirstValueByRoles(["name"]);
      const name =
        rawName === null || rawName === undefined ? "" : String(rawName).trim();
      if (!name || /lose\s*rate/i.test(String(name))) {
        return null;
      }

      const rawType = getFirstValueByRoles(["type"]);
      const normalizedType =
        typeof rawType === "string" ? rawType.trim().toLowerCase() : "";
      const isGrand = normalizedType === "grand";

      const rawLogo = getFirstValueByRoles(["logo"]);
      const logo =
        rawLogo === null || rawLogo === undefined
          ? ""
          : path.basename(String(rawLogo).trim());

      const rawProbability = getFirstValueByRoles(["probability"]);
      const baseProbability = sanitizeNumber(rawProbability, 0);

      const rawCount = getFirstValueByRoles(["count"]);
      const baseCount = parseCountValue(rawCount);

      const schedule = {};
      const dateKeysWithCounts = new Set();
      const dateKeysWithWeights = new Set();

      descriptors.forEach((descriptor) => {
        if (!descriptor.dateKey || !descriptor.role) return;
        const cellValue = row[descriptor.index];
        if (!schedule[descriptor.dateKey]) {
          schedule[descriptor.dateKey] = {};
        }

        if (descriptor.role === "date-probability") {
          const weightValue = sanitizeNumber(cellValue, 0);
          schedule[descriptor.dateKey].probability = weightValue;
          if (weightValue > 0) {
            dateKeysWithWeights.add(descriptor.dateKey);
          }
        } else if (descriptor.role === "date-count") {
          const countValue = parseCountValue(cellValue);
          if (countValue !== null) {
            schedule[descriptor.dateKey].count = countValue;
            if (countValue === -1) {
              schedule[descriptor.dateKey].unlimited = true;
            }
            dateKeysWithCounts.add(descriptor.dateKey);
          }
        }
      });

      dateKeysWithCounts.forEach((key) => {
        if (dateKeysWithWeights.has(key)) return;
        const entry = schedule[key];
        if (!entry) return;
        const countValue = entry.count;
        if (
          typeof countValue === "number" &&
          Number.isFinite(countValue) &&
          countValue > 0
        ) {
          entry.probability = countValue;
          return;
        }
        if (countValue === -1) {
          throw new Error(
            `Prize "${name}" on ${getDateLabel(
              key,
            )} has unlimited count but no weight. Please provide a weight.`,
          );
        }
        throw new Error(
          `Prize "${name}" on ${getDateLabel(
            key,
          )} is missing a weight. Add a weight or provide a positive count to infer the chance.`,
        );
      });

      if (baseProbability > 0 || baseCount !== null) {
        schedule.default = {
          probability: baseProbability,
          count: baseCount,
          unlimited: baseCount === -1,
        };
      }

      const hasScheduleEntries = Object.keys(schedule).some(
        (key) => key !== "default",
      );

      if (!hasScheduleEntries && baseProbability <= 0 && baseCount === null) {
        return null;
      }

      const award = {
        id: `award-${rowIndex + 1}`,
        name: String(name).trim(),
        type: isGrand ? "grand" : normalizedType,
        isGrand,
        logo,
        logoUrl: resolveAwardLogoUrl(logo),
        probability: 0,
        remaining: 0,
        initialCount: 0,
        unlimited: false,
        currentDay: null,
        dailySchedule: schedule,
      };

      applyScheduleToAward(award, todayKey);
      return award;
    })
    .filter(Boolean);

  if (!parsedAwards.length) {
    throw new Error(
      "No valid prizes were found. Check that each prize row includes a name plus either a weight or count for the current day.",
    );
  }

  return parsedAwards;
};

const loadQuizFromWorkbook = (workbook, sourceName) => {
  const questionSheetName = workbook.SheetNames?.[0];

  if (!questionSheetName) {
    throw new Error("The Excel file does not contain any sheets.");
  }

  const questionSheet = workbook.Sheets[questionSheetName];
  const questionRows = XLSX.utils.sheet_to_json(questionSheet, { defval: "" });

  if (!questionRows.length) {
    throw new Error(
      "The uploaded Excel file does not contain any question rows.",
    );
  }

  const questions = parseQuestionRows(questionRows);

  if (!questions.length) {
    throw new Error(
      "Please provide at least one row with a question prompt and answer text.",
    );
  }

  let awards = [];
  const awardSheetName = workbook.SheetNames?.[1];

  if (awardSheetName) {
    const awardSheet = workbook.Sheets[awardSheetName];
    const awardRows = XLSX.utils.sheet_to_json(awardSheet, {
      header: 1,
      defval: "",
      blankrows: false,
    });
    awards = parseAwardRows(awardRows);
  }

  quizState.questions = questions;
  quizState.awards = awards;
  quizState.metadata = {
    source: sourceName || "Imported.xlsx",
    updatedAt: new Date().toISOString(),
  };
  quizState.lastAward = null;

  const playlistSheetName =
    workbook.SheetNames?.find((name) => name.toLowerCase() === "nonworking") ||
    workbook.SheetNames?.find((name) =>
      name.toLowerCase().includes("playlist"),
    ) ||
    workbook.SheetNames?.[2];

  if (playlistSheetName && workbook.Sheets[playlistSheetName]) {
    const playlistRows = XLSX.utils.sheet_to_json(
      workbook.Sheets[playlistSheetName],
      { defval: "" },
    );
    const parsedPlaylist = parseNonWorkingRows(playlistRows);
    quizState.settings.nonWorkingPlaylist = parsedPlaylist;
    quizState.settings.nonWorkingEnabled = parsedPlaylist.length > 0;
  } else {
    quizState.settings.nonWorkingPlaylist = [];
    quizState.settings.nonWorkingEnabled = false;
  }

  persistQuizState();
  updateResolvedMedia();
  ensureAwardStateCompatibility();
  refreshAwardsForToday();
  writeSettingsYaml();
};

const loadQuizFromExcelPath = (filePath) => {
  const workbook = XLSX.readFile(filePath);
  loadQuizFromWorkbook(workbook, path.basename(filePath));
};

const loadQuizFromExcelBuffer = (buffer, sourceName) => {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  loadQuizFromWorkbook(workbook, sourceName);
};

const findLatestWorkbookInDir = (dirPath) => {
  if (!dirPath) return "";
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const ext = path.extname(entry.name).toLowerCase();
        if (
          !entry.name.toLowerCase().startsWith(WORKBOOK_BASENAME) ||
          !WORKBOOK_EXTENSIONS.includes(ext)
        ) {
          return null;
        }

        const resolvedPath = path.join(dirPath, entry.name);
        const stat = fs.statSync(resolvedPath);
        return {
          path: resolvedPath,
          mtime: stat.mtimeMs,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);

    return candidates[0]?.path || "";
  } catch (error) {
    console.error("Unable to scan working directory for workbook:", error);
    return "";
  }
};

const loadWorkbookFromDirectory = (dirPath) => {
  const workbookPath = findLatestWorkbookInDir(dirPath);
  if (!workbookPath) {
    return false;
  }

  try {
    loadQuizFromExcelPath(workbookPath);
    return true;
  } catch (error) {
    console.error("Failed to load workbook from working directory:", error);
    return false;
  }
};

const drawAward = () => {
  refreshAwardsForToday();
  const eligibleAwards = quizState.awards.filter(
    (award) =>
      (award.unlimited || award.remaining > 0) && award.probability > 0,
  );

  if (!eligibleAwards.length) {
    throw new Error("No awards remain to be drawn.");
  }

  const totalWeight = eligibleAwards.reduce(
    (sum, award) => sum + award.probability,
    0,
  );
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

  if (!selectedAward.unlimited) {
    selectedAward.remaining -= 1;
  }
  quizState.lastAward = {
    name: selectedAward.name,
    timestamp: new Date().toISOString(),
  };

  persistQuizState();
  broadcastQuizUpdate();

  return selectedAward;
};

app.whenReady().then(() => {
  console.log("[main] app ready");
  hydrateQuizStateFromDisk();
  createMainWindow();
  createConfigWindow();
  applyExternalSyncPreference();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createConfigWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("validate-pin", async (_event, pinAttempt) => {
  const pinValue = String(pinAttempt || "").trim();
  let success = await onUserEnterCode(pinValue);

  if (!success) {
    return {
      success: false,
      code: "INVALID_PIN",
      message: "Invalid PIN. Please try again.",
    };
  }

  if (!allowDuplicateCodes && hasCodeRedeemedToday(pinValue)) {
    return {
      success: false,
      code: "PIN_ALREADY_USED",
      message: "This code has already won today. Please try a new code.",
    };
  }

  try {
    const award = drawAward();
    return {
      success: true,
      quiz: quizState,
      award,
      flow: award?.isGrand ? "grand" : "quiz",
      pin: pinValue,
    };
  } catch (error) {
    return {
      success: false,
      code: "NO_PRIZES",
      message: error?.message || "No prizes remain.",
    };
  }
});

ipcMain.handle("get-quiz", () => quizState);

ipcMain.handle("redeem-award", async (_event, payload = {}) => {
  try {
    const { code, award } = payload;
    if (!code || !award) {
      throw new Error("Missing code or award for redemption log.");
    }
    if (hasCodeRedeemedToday(code)) {
      return { success: true, alreadyLogged: true };
    }
    recordRedeemedCode(code, award);
    return { success: true };
  } catch (error) {
    console.error("Unable to log redeemed award:", error);
    return { success: false, message: error.message || "Unable to log award." };
  }
});

ipcMain.handle("process-excel", (_event, payload = {}) => {
  try {
    const workingDir = requireWorkingDirectory();
    const { path: filePath, buffer, name } = payload;

    if (!filePath && !buffer) {
      throw new Error("Missing file information.");
    }

    if (filePath) {
      loadQuizFromExcelPath(filePath);
      saveWorkbookArtifact(filePath, null, name || path.basename(filePath));
    } else {
      const normalizedBuffer = Buffer.isBuffer(buffer)
        ? buffer
        : Buffer.from(
            buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer,
          );
      loadQuizFromExcelBuffer(normalizedBuffer, name);
      saveWorkbookArtifact(null, normalizedBuffer, name || "quiz.xlsx");
    }

    broadcastQuizUpdate();

    return {
      success: true,
      quiz: quizState,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message || "Unable to process the Excel file.",
    };
  }
});

ipcMain.handle("get-flags", () => ({
  success: true,
  enableMediaTab,
}));

ipcMain.handle("draw-award", () => {
  try {
    const award = drawAward();
    return {
      success: true,
      award,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message || "Unable to draw an award.",
    };
  }
});

ipcMain.handle("focus-config", () => {
  showConfigWindow();
  return { success: true };
});

ipcMain.handle("select-working-directory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select Working Directory",
  });

  if (result.canceled || !result.filePaths?.length) {
    return { success: false, message: "Selection canceled" };
  }

  const selectedDir = result.filePaths[0];
  ensureDirExists(selectedDir);
  const settingsPath = path.join(selectedDir, SETTINGS_FILENAME);
  const existingSettings = loadSettingsFromFile(settingsPath);

  mergeSettings({ workingDirectory: selectedDir }, { skipYamlWrite: true });

  let needsImport = true;
  if (existingSettings) {
    mergeSettings(existingSettings, { skipYamlWrite: true });
    needsImport = false;
  }

  const workbookLoaded = loadWorkbookFromDirectory(selectedDir);
  if (workbookLoaded) {
    needsImport = false;
  }

  writeSettingsYaml();
  broadcastQuizUpdate();
  return {
    success: true,
    path: quizState.settings.workingDirectory,
    settings: quizState.settings,
    mediaResolved: quizState.mediaResolved,
    needsImport,
  };
});

ipcMain.handle("update-settings", (_event, patch = {}) => {
  mergeSettings(patch);
  broadcastQuizUpdate();
  return {
    success: true,
    settings: quizState.settings,
    mediaResolved: quizState.mediaResolved,
  };
});

const requireWorkingDirectory = () => {
  const dir = getWorkingDirectory();
  if (!dir) {
    throw new Error("Please select a working directory first.");
  }
  ensureDirExists(dir);
  return dir;
};

ipcMain.handle("export-settings", async () => {
  const result = await dialog.showSaveDialog({
    title: "Export Settings",
    filters: [{ name: "YAML", extensions: ["yml", "yaml"] }],
    defaultPath: "settings.yaml",
  });

  if (result.canceled || !result.filePath) {
    return { success: false, message: "Export canceled" };
  }

  const payload = yaml.dump(getExportableSettings());
  fs.writeFileSync(result.filePath, payload, "utf-8");
  return { success: true };
});

ipcMain.handle("import-settings", async () => {
  const workingDir = requireWorkingDirectory();
  const result = await dialog.showOpenDialog({
    title: "Import Settings",
    filters: [{ name: "YAML", extensions: ["yml", "yaml"] }],
    properties: ["openFile"],
  });

  if (result.canceled || !result.filePaths?.length) {
    return { success: false, message: "Import canceled" };
  }

  const fileContent = fs.readFileSync(result.filePaths[0], "utf-8");
  const imported = yaml.load(fileContent);
  if (!imported || typeof imported !== "object") {
    throw new Error("Invalid YAML format.");
  }
  if ("workingDirectory" in imported) {
    delete imported.workingDirectory;
  }

  const destPath = path.join(workingDir, SETTINGS_FILENAME);
  if (path.resolve(result.filePaths[0]) !== destPath) {
    fs.copyFileSync(result.filePaths[0], destPath);
  }

  mergeSettings(imported, { skipYamlWrite: true });
  writeSettingsYaml();
  broadcastQuizUpdate();
  return {
    success: true,
    settings: quizState.settings,
    mediaResolved: quizState.mediaResolved,
  };
});

const moveFile = (source, dest) => {
  try {
    fs.renameSync(source, dest);
  } catch (error) {
    fs.copyFileSync(source, dest);
    try {
      fs.unlinkSync(source);
    } catch (unlinkError) {
      // ignore
    }
  }
};

ipcMain.handle("ingest-media", async (_event, payload = {}) => {
  const workingDir = requireWorkingDirectory();
  const { key, path: sourcePath, name, buffer } = payload;
  if (!key) {
    return { success: false, message: "Missing media key." };
  }

  const mediaDir = path.join(workingDir, "media");
  ensureDirExists(mediaDir);
  const extension =
    path.extname(name || sourcePath || "") ||
    (payload.isImage ? ".png" : ".mp4");
  const safeName = `${key}-${Date.now()}${extension}`;
  const destination = path.join(mediaDir, safeName);

  try {
    if (sourcePath) {
      moveFile(sourcePath, destination);
    } else if (buffer) {
      fs.writeFileSync(destination, Buffer.from(buffer));
    } else {
      throw new Error("Missing file data.");
    }

    const relativePath = path.relative(workingDir, destination);
    mergeSettings(
      {
        media: {
          ...quizState.settings.media,
          [key]: relativePath,
        },
      },
      { skipYamlWrite: false },
    );
    broadcastQuizUpdate();

    return {
      success: true,
      relativePath,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message || "Unable to process media file.",
    };
  }
});

ipcMain.handle("ingest-afterhours", async (_event, payload = {}) => {
  const workingDir = requireWorkingDirectory();
  const playlistDir = path.join(workingDir, PLAYLIST_DIRNAME);
  ensureDirExists(playlistDir);
  const { path: sourcePath, name, buffer, weight = 1 } = payload;

  const extension =
    path.extname(name || sourcePath || "") ||
    (payload.isImage ? ".png" : ".mp4");
  const safeName = `${Date.now()}${extension}`;
  const destination = path.join(playlistDir, safeName);

  try {
    if (sourcePath) {
      moveFile(sourcePath, destination);
    } else if (buffer) {
      fs.writeFileSync(destination, Buffer.from(buffer));
    } else {
      throw new Error("Missing file data.");
    }

    const relativePath = path.join(PLAYLIST_DIRNAME, safeName);
    quizState.settings.nonWorkingPlaylist = [
      ...(quizState.settings.nonWorkingPlaylist || []),
      {
        id: `nonworking-${Date.now()}`,
        file: relativePath,
        weight: Number(weight) || 1,
      },
    ];
    quizState.settings.nonWorkingEnabled = true;

    persistQuizState();
    updateResolvedMedia();
    writeSettingsYaml();
    broadcastQuizUpdate();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      message: error.message || "Unable to ingest playlist media.",
    };
  }
});

ipcMain.handle("export-working-directory", async () => {
  const workingDir = requireWorkingDirectory();
  const result = await dialog.showOpenDialog({
    title: "Export Working Directory",
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || !result.filePaths?.length) {
    return { success: false, message: "Export canceled" };
  }

  const destinationRoot = result.filePaths[0];
  const exportFolderName = `GalacticBlackFriday-${Date.now()}`;
  const exportPath = path.join(destinationRoot, exportFolderName);

  try {
    ensureDirExists(exportPath);
    copyDirectoryContents(workingDir, exportPath);
    fs.writeFileSync(path.join(exportPath, EXPORT_MARKER), "");
    broadcastSyncMessage(`Exported configuration to ${exportPath}`);
    return { success: true, path: exportPath };
  } catch (error) {
    return {
      success: false,
      message: error.message || "Unable to export working directory.",
    };
  }
});

ipcMain.handle("reset-settings", () => {
  resetToDefaults();
  return { success: true };
});
