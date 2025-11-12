const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("url");
const yaml = require("js-yaml");
const XLSX = require("xlsx");

const PIN_CODE = process.env.APP_PIN || "4242";
const isDev = !app.isPackaged;
const enableMediaTab =
  process.argv.includes("--media-tab") || process.env.ENABLE_MEDIA_TAB === "1";

const SETTINGS_FILENAME = "settings.yaml";
const PLAYLIST_DIRNAME = "afterhours";
const EXPORT_MARKER = ".galacticblackfriday";

const defaultSettings = () => ({
  workingDirectory: "",
  workingHours: {
    start: "09:00",
    end: "21:00",
  },
  media: {
    pinVideo: "",
    idleVideo: "",
    quizVideo: "",
    winVideo: "",
    loseVideo: "",
  },
  nonWorkingPlaylist: [],
  nonWorkingEnabled: false,
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
  settings: defaultSettings(),
  mediaResolved: {
    idleVideo: "",
    quizVideo: "",
    winVideo: "",
    loseVideo: "",
    nonWorkingPlaylist: [],
  },
});

let quizState = createDefaultQuizState();

let mainWindow;
let configWindow;
let externalWatcherTimer = null;

const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 720,
    resizable: false,
    title: "Quiz Console",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "../preload/mainPreload.js"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
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

const updateResolvedMedia = () => {
  const media = quizState.settings.media || {};
  quizState.mediaResolved = {
    pinVideo: resolveMediaPath(media.pinVideo),
    idleVideo: resolveMediaPath(media.idleVideo),
    quizVideo: resolveMediaPath(media.quizVideo),
    winVideo: resolveMediaPath(media.winVideo),
    loseVideo: resolveMediaPath(media.loseVideo),
    nonWorkingPlaylist: (quizState.settings.nonWorkingPlaylist || []).map(
      (item) => ({
        ...item,
        url: resolveMediaPath(item.file),
      }),
    ),
  };
};

updateResolvedMedia();

const mergeSettings = (patch = {}, options = {}) => {
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
  };

  if (patch.nonWorkingPlaylist) {
    quizState.settings.nonWorkingPlaylist = patch.nonWorkingPlaylist;
  }

  persistQuizState();
  updateResolvedMedia();
  if (!options.skipYamlWrite) {
    writeSettingsYaml();
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

const writeSettingsYaml = () => {
  const settingsPath = getSettingsFilePath();
  if (!settingsPath) return;
  ensureDirExists(path.dirname(settingsPath));
  fs.writeFileSync(settingsPath, yaml.dump(quizState.settings), "utf-8");
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
    width: isDev ? 480 : 600,
    height: isDev ? 720 : 800,
    show: false,
    resizable: isDev,
    movable: true,
    fullscreen: !isDev,
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

  if (!isDev) {
    configWindow.setFullScreen(true);
  }

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
        },
      };
      updateResolvedMedia();
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
    return typeof parsed === "object" ? parsed : null;
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

const scanExternalImports = () => {
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
};

const startExternalWatcher = () => {
  if (externalWatcherTimer) return;
  externalWatcherTimer = setInterval(scanExternalImports, 20000);
};

const stopExternalWatcher = () => {
  if (externalWatcherTimer) {
    clearInterval(externalWatcherTimer);
    externalWatcherTimer = null;
  }
};

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
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

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

const parseAwardRows = (rows) =>
  rows
    .map((row, index) => {
      const name =
        row.Award ||
        row.award ||
        row.Prize ||
        row.prize ||
        row.Name ||
        row.name;
      const probability =
        sanitizeNumber(
          row.Probability ??
            row.probability ??
            row.Weight ??
            row.weight ??
            row["Win %"] ??
            row["Win Chance"],
          0,
        ) || 0;
      const count =
        sanitizeNumber(
          row.Count ??
            row.count ??
            row.Remaining ??
            row.remaining ??
            row.Inventory ??
            row.inventory,
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
    const awardRows = XLSX.utils.sheet_to_json(awardSheet, { defval: "" });
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

const drawAward = () => {
  const eligibleAwards = quizState.awards.filter(
    (award) => award.remaining > 0 && award.probability > 0,
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
  console.log("[main] app ready");
  hydrateQuizStateFromDisk();
  createMainWindow();
  createConfigWindow();
  scanExternalImports();
  startExternalWatcher();

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

ipcMain.handle("validate-pin", (_event, pinAttempt) => {
  if (String(pinAttempt || "").trim() !== PIN_CODE) {
    return {
      success: false,
      message: "Invalid PIN. Please try again.",
    };
  }

  return {
    success: true,
    quiz: quizState,
  };
});

ipcMain.handle("get-quiz", () => quizState);

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

  const payload = yaml.dump(quizState.settings);
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
