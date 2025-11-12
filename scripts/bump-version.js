#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ROOT = path.resolve(__dirname, "..");
const PACKAGE_JSON = path.join(ROOT, "package.json");
const PACKAGE_LOCK = path.join(ROOT, "package-lock.json");

const OPTIONS = [
  {
    id: "major",
    label: "Major",
    description: "Breaking changes, resets minor & patch (X.0.0).",
    bump: ([major]) => [major + 1, 0, 0],
  },
  {
    id: "minor",
    label: "Minor",
    description: "New features, resets patch (x.Y.0).",
    bump: ([major, minor]) => [major, minor + 1, 0],
  },
  {
    id: "patch",
    label: "Patch",
    description: "Bug fixes only (x.y.Z).",
    bump: ([major, minor, patch]) => [major, minor, patch + 1],
  },
];

const readJson = (filePath) => {
  const content = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(content);
};

const writeJson = (filePath, data) => {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
};

const parseVersion = (version) => {
  const segments = String(version)
    .split(".")
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));

  while (segments.length < 3) {
    segments.push(0);
  }

  return segments.slice(0, 3);
};

const formatVersion = ([major, minor, patch]) =>
  `${major}.${minor}.${patch}`;

const updatePackageLock = (newVersion) => {
  if (!fs.existsSync(PACKAGE_LOCK)) {
    return;
  }

  const lock = readJson(PACKAGE_LOCK);
  lock.version = newVersion;
  if (lock.packages && lock.packages[""]) {
    lock.packages[""].version = newVersion;
  }

  writeJson(PACKAGE_LOCK, lock);
};

const startPrompt = () => {
  const pkg = readJson(PACKAGE_JSON);
  const currentVersion = parseVersion(pkg.version || "0.0.0");
  let selectedIndex = 0;
  if (!process.stdin.isTTY) {
    console.error("Interactive terminal required to bump the version.");
    process.exit(1);
  }

  const renderMenu = () => {
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
    console.log(`Current version: ${formatVersion(currentVersion)}\n`);
    console.log("Use ↑/↓ to choose which segment to bump, then press Enter.\n");

    OPTIONS.forEach((option, index) => {
      const isSelected = index === selectedIndex;
      const prefix = isSelected ? "›" : " ";
      console.log(
        `${prefix} ${option.label.padEnd(7)} ${option.description}`,
      );
    });

    console.log("\nPress Ctrl+C to cancel.");
  };

  const applySelection = () => {
    const option = OPTIONS[selectedIndex];
    const bumped = option.bump(currentVersion);
    const newVersion = formatVersion(bumped);

    pkg.version = newVersion;
    writeJson(PACKAGE_JSON, pkg);
    updatePackageLock(newVersion);

    console.log(`\nUpdated version to ${newVersion}`);
    cleanupAndExit(0);
  };

  const cleanupAndExit = (code = 0) => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.exit(code);
  };

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on("keypress", (_str, key) => {
    if (!key) return;

    if (key.name === "up") {
      selectedIndex = (selectedIndex - 1 + OPTIONS.length) % OPTIONS.length;
      renderMenu();
    } else if (key.name === "down") {
      selectedIndex = (selectedIndex + 1) % OPTIONS.length;
      renderMenu();
    } else if (key.name === "return") {
      applySelection();
    } else if (key.sequence === "\u0003") {
      console.log("\nOperation canceled.");
      cleanupAndExit(0);
    }
  });

  renderMenu();
};

try {
  startPrompt();
} catch (error) {
  console.error("Failed to update version:", error.message);
  process.exit(1);
}
