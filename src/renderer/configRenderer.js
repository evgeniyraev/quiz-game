const dropZone = document.getElementById("drop-zone");
const statusEl = document.getElementById("config-status");
const previewQuestion = document.getElementById("preview-question");
const previewAnswers = document.getElementById("preview-answers");
const previewMeta = document.getElementById("preview-meta");
const questionCount = document.getElementById("question-count");
const awardList = document.getElementById("award-list");
const playlistList = document.getElementById("playlist-list");
const nonWorkingSection = document.getElementById("non-working");
const workingDirInput = document.getElementById("working-dir");
const chooseDirBtn = document.getElementById("choose-dir-btn");
const chooseDirCalloutBtn = document.getElementById("choose-dir-callout");
const workingDirWarning = document.getElementById("working-dir-warning");
const importWarning = document.getElementById("import-warning");
const importSettingsCalloutBtn = document.getElementById(
  "import-settings-callout",
);
const workingStartInput = document.getElementById("working-start");
const workingEndInput = document.getElementById("working-end");
const idleVideoInput = document.getElementById("idle-video-input");
const quizVideoInput = document.getElementById("quiz-video-input");
const winVideoInput = document.getElementById("win-video-input");
const loseVideoInput = document.getElementById("lose-video-input");
const pinVideoInput = document.getElementById("pin-video-input");
const saveSettingsBtn = document.getElementById("save-settings-btn");
const saveSettingsBtnMedia = document.getElementById("save-settings-btn-media");
const exportSettingsBtn = document.getElementById("export-settings-btn");
const importSettingsBtn = document.getElementById("import-settings-btn");
const resetSettingsBtn = document.getElementById("reset-settings-btn");
const exportWorkingBtn = document.getElementById("export-working-btn");
const playlistDropZone = document.getElementById("playlist-drop");
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll("[data-tab-panel]");
const mediaTabButton = document.getElementById("media-tab-btn");
const mediaTabPanel = document.getElementById("media-tab-panel");
const mediaInputs = document.querySelectorAll("[data-media-key]");

const defaultSettings = {
  workingDirectory: "",
  workingHours: { start: "09:00", end: "21:00" },
  media: {
    idleVideo: "",
    quizVideo: "",
    winVideo: "",
    loseVideo: "",
  },
  nonWorkingPlaylist: [],
  nonWorkingEnabled: false,
};

const cloneSettings = (settings) =>
  typeof structuredClone === "function"
    ? structuredClone(settings)
    : JSON.parse(JSON.stringify(settings));

let settingsState = cloneSettings(defaultSettings);
let needsConfigImport = false;
let quizSnapshot = null;
let mediaTabEnabled = false;

const setStatus = (message, tone = "info") => {
  statusEl.textContent = message || "";
  statusEl.style.color =
    tone === "error" ? "#ff8585" : tone === "success" ? "#8ff5c1" : "#f6c177";
};

const describeQuestions = (questions = []) => {
  const count = questions.length;
  if (!count) return "0 questions";
  return `${count} question${count === 1 ? "" : "s"}`;
};

const setActiveTab = (target) => {
  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tabTarget === target);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.tabPanel !== target);
  });
};

const setPreviewQuestion = (question) => {
  if (!question) {
    previewQuestion.textContent = "No question configured.";
    previewAnswers.innerHTML = "";
    return;
  }

  previewQuestion.textContent = question.question || "Question";
  previewAnswers.innerHTML = "";

  (question.answers || []).forEach(({ label, text }) => {
    const li = document.createElement("li");
    const isCorrect = question.correctAnswer === label;
    li.textContent = `${label}: ${text || "—"}`;
    if (isCorrect) {
      li.classList.add("correct-answer");
    }
    previewAnswers.appendChild(li);
  });
};

const renderAwards = (awards = []) => {
  awardList.innerHTML = "";

  if (!awards.length) {
    const li = document.createElement("li");
    li.textContent = "No awards configured.";
    awardList.appendChild(li);
    return;
  }

  awards.forEach((award) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    const remaining = document.createElement("span");

    label.textContent = award.name;
    label.className = "label";

    const remainingText = award.unlimited
      ? "Unlimited supply"
      : typeof award.remaining === "number" &&
          typeof award.initialCount === "number"
        ? `${award.remaining}/${award.initialCount} left`
        : `${award.remaining ?? "?"} remaining`;

    remaining.textContent = `${remainingText} • weight ${award.probability}`;

    li.appendChild(label);
    li.appendChild(remaining);
    awardList.appendChild(li);
  });
};

const renderPlaylist = (playlist = []) => {
  playlistList.innerHTML = "";

  if (!playlist.length) {
    const li = document.createElement("li");
    li.textContent = "No after-hours playlist configured.";
    playlistList.appendChild(li);
    return;
  }

  playlist.forEach((entry) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    const weight = document.createElement("span");
    label.textContent = entry.file || "—";
    weight.textContent = `Weight: ${entry.weight}`;
    li.appendChild(label);
    li.appendChild(weight);
    playlistList.appendChild(li);
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
    previewMeta.textContent = `${quiz.metadata.source || "Unknown"} • Updated ${new Date(
      quiz.metadata.updatedAt,
    ).toLocaleString()}`;
  } else {
    previewMeta.textContent = "";
  }
};

const setControlsEnabled = (enabled) => {
  const buttons = [
    saveSettingsBtn,
    exportSettingsBtn,
    importSettingsBtn,
    saveSettingsBtnMedia,
  ];
  buttons.forEach((btn) => {
    if (btn) btn.disabled = !enabled;
  });
  mediaInputs.forEach((input) => {
    input.disabled = !enabled;
  });
};

const updateWorkingDirWarnings = () => {
  const hasDir = Boolean(settingsState.workingDirectory);
  if (workingDirWarning) {
    workingDirWarning.classList.toggle("hidden", hasDir);
  }
  if (importWarning) {
    importWarning.classList.toggle("hidden", !(hasDir && needsConfigImport));
  }
  setControlsEnabled(hasDir);
};

const updateNonWorkingVisibility = () => {
  if (!nonWorkingSection) return;
  const visible = Boolean(settingsState.nonWorkingEnabled);
  nonWorkingSection.classList.toggle("hidden", !visible);
};

const applySettingsToForm = (settings = defaultSettings) => {
  settingsState = {
    ...defaultSettings,
    ...settings,
    workingHours: {
      ...defaultSettings.workingHours,
      ...(settings.workingHours || {}),
    },
    media: {
      ...defaultSettings.media,
      ...(settings.media || {}),
    },
    nonWorkingPlaylist: settings.nonWorkingPlaylist || [],
    nonWorkingEnabled:
      typeof settings.nonWorkingEnabled === "boolean"
        ? settings.nonWorkingEnabled
        : Boolean(settings.nonWorkingPlaylist?.length),
  };

  if (workingDirInput) {
    workingDirInput.value = settingsState.workingDirectory || "";
  }

  if (workingStartInput)
    workingStartInput.value = settingsState.workingHours.start;
  if (workingEndInput) workingEndInput.value = settingsState.workingHours.end;
  if (idleVideoInput) idleVideoInput.value = settingsState.media.idleVideo;
  if (quizVideoInput) quizVideoInput.value = settingsState.media.quizVideo;
  if (winVideoInput) winVideoInput.value = settingsState.media.winVideo;
  if (loseVideoInput) loseVideoInput.value = settingsState.media.loseVideo;
  if (pinVideoInput) pinVideoInput.value = settingsState.media.pinVideo;
  renderPlaylist(settingsState.nonWorkingPlaylist);
  updateWorkingDirWarnings();
  updateNonWorkingVisibility();
};

const renderQuizData = (quiz) => {
  if (!quiz) return;
  quizSnapshot = quiz;
  renderPreview(quiz);
  applySettingsToForm(quiz.settings);
  needsConfigImport = false;
};

const applyFeatureFlags = (flags = {}) => {
  mediaTabEnabled = Boolean(flags.enableMediaTab);
  if (!mediaTabEnabled) {
    mediaTabButton?.classList.add('hidden');
    mediaTabPanel?.classList.add('hidden');
    if (mediaTabButton?.classList.contains('active')) {
      setActiveTab('setup');
    }
  } else {
    mediaTabButton?.classList.remove('hidden');
    mediaTabPanel?.classList.remove('hidden');
    if (!document.querySelector('.tab-btn.active')) {
      setActiveTab('setup');
    }
    setupMediaInputs();
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

  if (!settingsState.workingDirectory) {
    setStatus("Please select a working directory before importing.", "error");
    return;
  }

  if (!file.name.endsWith(".xlsx")) {
    setStatus("Only .xlsx files are supported.", "error");
    return;
  }

  setStatus(`Importing ${file.name}...`);

  const payload = await buildPayload(file);
  const result = await window.configAPI.importExcel(payload);

  if (!result.success) {
    setStatus(result.message || "Unable to import file.", "error");
    return;
  }

  setStatus(`Loaded ${file.name}`, "success");
  renderQuizData(result.quiz);
};

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    dropZone.classList.add("active");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("active");
  });
});

dropZone.addEventListener("drop", (event) => {
  const files = event.dataTransfer?.files;
  handleFileList(files);
});

dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx";
    input.onchange = () => handleFileList(input.files);
    input.click();
  }
});

window.configAPI.requestQuiz().then(renderQuizData);
window.configAPI.onQuizUpdated(renderQuizData);
window.configAPI.onSyncMessage((message) => setStatus(message, "success"));
window.configAPI.getFlags?.().then(applyFeatureFlags);

window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());

const collectSettingsFromForm = () => ({
  workingHours: {
    start: workingStartInput?.value || defaultSettings.workingHours.start,
    end: workingEndInput?.value || defaultSettings.workingHours.end,
  },
  media: {
    pinVideo: pinVideoInput?.value.trim() || "",
    idleVideo: idleVideoInput?.value.trim() || "",
    quizVideo: quizVideoInput?.value.trim() || "",
    winVideo: winVideoInput?.value.trim() || "",
    loseVideo: loseVideoInput?.value.trim() || "",
  },
});

const handleMediaIngest = async (key, file) => {
  if (!file || !key) return;
  const payload = {
    key,
    name: file.name,
  };

  if (file.path) {
    payload.path = file.path;
  } else if (file.arrayBuffer) {
    const buffer = await file.arrayBuffer();
    payload.buffer = Array.from(new Uint8Array(buffer));
  }

  const result = await window.configAPI.ingestMedia(payload);
  if (!result.success) {
    setStatus(result.message || "Unable to ingest media.", "error");
    return;
  }

  const input = document.querySelector(`[data-media-key="${key}"]`);
  if (input) {
    input.value = result.relativePath || "";
  }

  settingsState.media[key] = result.relativePath || "";
  const saveResult = await window.configAPI.saveSettings({
    media: { [key]: result.relativePath || "" },
  });
  if (!saveResult.success) {
    setStatus(saveResult.message || "Unable to save media settings.", "error");
    return;
  }

  if (saveResult.settings) {
    applySettingsToForm(saveResult.settings);
  }

  setStatus("Media updated.", "success");
};

const setupMediaInputs = () => {
  mediaInputs.forEach((input) => {
    const key = input.dataset.mediaKey;
    if (!key) return;

    ["dragenter", "dragover"].forEach((eventName) => {
      input.addEventListener(eventName, (event) => {
        event.preventDefault();
        input.classList.add("drag-active");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      input.addEventListener(eventName, (event) => {
        event.preventDefault();
        input.classList.remove("drag-active");
      });
    });

    input.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      handleMediaIngest(key, file);
    });
  });
};

const handlePlaylistDrop = async (file) => {
  if (!file) return;
  const payload = { name: file.name };
  if (file.path) {
    payload.path = file.path;
  } else if (file.arrayBuffer) {
    const buffer = await file.arrayBuffer();
    payload.buffer = Array.from(new Uint8Array(buffer));
  }

  const result = await window.configAPI.ingestAfterhours(payload);
  if (!result.success) {
    setStatus(result.message || "Unable to ingest playlist media.", "error");
    return;
  }

  setStatus("Added to non-working playlist.", "success");
  window.configAPI.requestQuiz().then(renderQuizData);
};

saveSettingsBtn?.addEventListener("click", async () => {
  const payload = collectSettingsFromForm();
  const result = await window.configAPI.saveSettings(payload);
  if (!result.success) {
    setStatus(result.message || "Unable to save settings.", "error");
    return;
  }
  if (result.settings) {
    applySettingsToForm(result.settings);
  }
  setStatus("Settings saved.", "success");
});

saveSettingsBtnMedia?.addEventListener("click", async () => {
  const payload = collectSettingsFromForm();
  const result = await window.configAPI.saveSettings(payload);
  if (!result.success) {
    setStatus(result.message || "Unable to save settings.", "error");
    return;
  }
  if (result.settings) {
    applySettingsToForm(result.settings);
  }
  setStatus("Media settings saved.", "success");
});

const handleChooseDirectory = async () => {
  const result = await window.configAPI.selectWorkingDirectory();
  if (!result.success) {
    setStatus(result.message || "No directory selected.", "error");
    return;
  }

  needsConfigImport = Boolean(result.needsImport);
  const mergedSettings = result.settings || {
    ...settingsState,
    workingDirectory: result.path,
  };
  applySettingsToForm(mergedSettings);

  if (quizSnapshot) {
    renderPreview({ ...quizSnapshot, settings: mergedSettings });
    quizSnapshot = { ...quizSnapshot, settings: mergedSettings };
  }
  updateWorkingDirWarnings();
  setActiveTab(needsConfigImport ? "setup" : "media");
  setStatus("Working directory updated.", "success");
};

chooseDirBtn?.addEventListener("click", handleChooseDirectory);

exportSettingsBtn?.addEventListener("click", async () => {
  const result = await window.configAPI.exportSettings();
  if (!result.success) {
    setStatus(result.message || "Export canceled.", "error");
    return;
  }
  setStatus("Settings exported.", "success");
});

exportWorkingBtn?.addEventListener("click", async () => {
  const result = await window.configAPI.exportWorkingDirectory();
  if (!result.success) {
    setStatus(result.message || "Working directory export canceled.", "error");
    return;
  }
  setStatus(`Exported working directory to ${result.path}`, "success");
});

const handleImportSettings = async () => {
  const result = await window.configAPI.importSettingsFile();
  if (!result.success) {
    setStatus(result.message || "Import canceled.", "error");
    return;
  }
  needsConfigImport = false;
  setStatus("Settings imported.", "success");
  if (result.settings) {
    applySettingsToForm(result.settings);
    if (quizSnapshot) {
      renderPreview({ ...quizSnapshot, settings: result.settings });
      quizSnapshot = { ...quizSnapshot, settings: result.settings };
    }
  }
};

importSettingsBtn?.addEventListener("click", handleImportSettings);

if (playlistDropZone) {
  ["dragenter", "dragover"].forEach((eventName) => {
    playlistDropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      playlistDropZone.classList.add("active");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    playlistDropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      playlistDropZone.classList.remove("active");
    });
  });

  playlistDropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    handlePlaylistDrop(file);
  });

  playlistDropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "video/*";
      input.onchange = () => handlePlaylistDrop(input.files?.[0]);
      input.click();
    }
  });
}
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tabTarget;
    if (!settingsState.workingDirectory && target !== "setup") {
      setStatus("Please select a working directory first.", "error");
      return;
    }
    setActiveTab(target);
  });
});

chooseDirCalloutBtn?.addEventListener("click", handleChooseDirectory);
importSettingsCalloutBtn?.addEventListener("click", handleImportSettings);
resetSettingsBtn?.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "This will erase all settings and cached quiz data. Continue?",
  );
  if (!confirmed) return;
  const result = await window.configAPI.resetSettings();
  if (!result.success) {
    setStatus(result.message || "Unable to reset settings.", "error");
    return;
  }
  setStatus(
    "Settings reset. Please configure working directory again.",
    "success",
  );
  window.configAPI.requestQuiz().then(renderQuizData);
});
