// In-memory scraper state (persists across API route calls within the same process)

let scraperState = {
  isRunning: false,
  abortController: null,
  logBuffer: [],
  progress: {
    total: 0,
    completed: 0,
    success: 0,
    failed: 0,
    running: false,
    startTime: null,
    stats: {
      exact_match: 0,
      new_has_more: 0,
      old_has_more: 0,
      different: 0,
      no_new_emails: 0,
      no_old_emails: 0,
      both_empty: 0,
    },
    recentResults: [],
  },
};

export function getState() {
  return scraperState;
}

export function addLog(line) {
  scraperState.logBuffer.push(line);
  if (scraperState.logBuffer.length > 200) {
    scraperState.logBuffer = scraperState.logBuffer.slice(-200);
  }
}

export function getLogs(count = 100) {
  return scraperState.logBuffer.slice(-count);
}

export function resetState() {
  scraperState.logBuffer = [];
  scraperState.progress = {
    total: 0,
    completed: 0,
    success: 0,
    failed: 0,
    running: true,
    startTime: Date.now(),
    stats: {
      exact_match: 0,
      new_has_more: 0,
      old_has_more: 0,
      different: 0,
      no_new_emails: 0,
      no_old_emails: 0,
      both_empty: 0,
    },
    recentResults: [],
  };
}
