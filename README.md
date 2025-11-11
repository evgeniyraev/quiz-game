# GalacticBlackFriday Quiz Console

Electron-based console that unlocks a quiz view after entering a PIN and keeps its content in sync with a drag-and-drop Excel configuration window.

## Getting started

```bash
npm install
npm start
```

Two windows will appear:

- **Quiz Console** (main window) – prompts for a PIN. The default PIN is `4242` and can be overridden via the `APP_PIN` environment variable.
- **Question Config** (side window) – accepts Excel files to update the question and answers in real time.
- Both windows open Chrome DevTools in a detached inspector by default so you can debug renderers immediately.
- The quiz window uses an onscreen keypad for PIN entry. After an incorrect answer the quiz locks, plays the configured “lose” media, and requires the PIN again before continuing.
- The latest imported configuration is persisted between launches. If no configuration is available the quiz window displays a warning; long-press the top-left corner for five seconds to bring the config window to the front at any time.

## Media & working hours

- Open the **Question Config** window to pick a working directory, working hours, and the media files for each state (idle, quiz, win, lose). Paths are relative to the selected directory so you can keep videos, audio, and YAML exports together.
  - `Pin` media is used when the PIN keypad is visible.
  - `Idle` media acts as a screensaver during working hours; tapping it reveals the PIN screen.
- Use the **Export YAML** / **Import YAML** buttons to back up or restore the full settings bundle.
- Use **Export Working Dir** to copy the entire working directory (media, settings, playlists, Excel files) to a removable drive. Each exported package includes a `.galacticblackfriday` marker and `settings.yaml` so the runtime can auto-import it when the drive is attached.
- Working hours are a simple daily start/end. Outside those hours the quiz console hides all controls and continuously plays the probability-weighted non-working playlist from the Excel file.
- During open hours the console automatically plays:
  - Idle video when waiting for a contestant.
  - Quiz video while questions are on screen.
  - Win video when a prize is awarded (prize text overlays on top).
  - Lose media when a wrong answer is given before returning to the PIN screen.

## Excel format

The importer expects a workbook with at least one sheet named however you like (it just grabs the first sheet for questions).

### Sheet 1 – Questions

- Required columns (case-insensitive):
  - `Question` (or `Prompt`, `Question Text`)
  - At least two answer columns. Use `Answer A`, `Answer B`, … and continue with as many letters as you need. Blank columns are ignored, so each row can have a different number of answers.
  - `Correct` (`Correct Answer`, `Right Answer`, or `Answer` also work) – place the letter of the correct option (A–Z) for that row.
- Each row becomes a slide in the quiz flow. The quiz window displays one question at a time, forces the player to pick an answer, and uses button states to show whether it was right before letting them continue. After the final question it triggers the award draw.
- Incorrect answers reset the quiz back to the first question, so make sure your PIN holder is ready to re-authorise contestants before they try again.

### Sheet 2 – Awards

- Optional but required if you want the end-of-quiz prize wheel.
- Columns:
  - `Award` (or `Prize`, `Name`)
  - `Probability` (relative weight for random selection)
  - `Count` (number of times this award can be given out)
- After the last question the quiz calls into the award table, draws a prize using the weighted probabilities, and decrements the remaining count. Once an award runs out it drops out of the pool automatically.

### Sheet 3 – NonWorking (after-hours playlist)

- Optional but used whenever the venue is outside working hours.
- Columns:
  - `Video` (relative path under the working directory)
  - `Weight` (probability weight for the random selector)
- The playlist cycles through videos using the supplied weights without repeating the same entry twice in a row.

### Importing

1. Drag and drop the `.xlsx` file into the **Question Config** window (or focus the drop zone and press Enter/Space to open a file picker).
2. The preview updates immediately and the quiz window refreshes for any unlocked sessions.
   - On macOS the file path may be hidden for privacy. The importer automatically falls back to reading the binary contents, so drag-and-drop works on both macOS and Windows.
3. A ready-to-use template lives at `sample-question.xlsx`.

## Project layout

```
src/
  main/        # Electron main process
  preload/     # Safe IPC bridges exposed to renderers
  renderer/    # UI for quiz and config windows
```

## Next steps

- Plug the quiz window into real scoring logic or answer validation.
- Persist imported questions or support multiple rows for future navigation.
- Attach a USB drive that contains a folder with `settings.yaml` (or the `.galacticblackfriday` marker) and the app automatically imports it into the working directory, refreshing media and playlists on the fly.
