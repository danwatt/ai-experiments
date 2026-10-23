# Number Garden

Open `index.html` in a browser. Everything is in that one file: HTML, CSS, JavaScript, and illustrations. No installation, account, network, or external assets are needed.

- Ten addition, subtraction, or mixed facts per round.
- Choose facts with totals up to 10 or 20. Up-to-20 facts use basic fact families with addends from 0–10; subtraction never has a negative answer.
- Each answer grows a plant; a completed round adds a flower to the garden.
- Facts that were missed, revealed, helped, or answered more slowly get extra practice. Each round uses ten different facts and includes new facts.
- The parent view shows first-try accuracy, active round time, response time, and individual facts. Timing pauses when the page is hidden. There is no child-facing timer.
- Progress stays in this browser's local storage. Export JSON from the parent view for a backup. Clearing browser data removes progress. Moving the file, changing browser/profile, or switching between a file and a local server may use a different storage area. Private browsing and some file URL policies may prevent persistence; a warning appears if saving fails.

Timing records include first submitted response time and time until a fact is finished. Think-time and time after an incorrect answer count; feedback time, explicit pauses, and hidden-tab time do not. Hints and revealed answers are tracked separately. A round left unfinished remains in history with its completed answers; a new visit starts a new round. History retains the latest 200 rounds, while aggregate fact statistics and total flowers remain.

For a stable local address, serve this directory with any static server. The app also works directly from the file.
