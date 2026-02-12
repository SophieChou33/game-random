import { defaultLibrary } from "./data.js";

// --- State Management ---
const state = {
  library: [], // Array of book metadata {id, title, sourceType, url?}
  activeBook: null, // Current full book object {id, title, words: []}

  // View State
  selectedIndices: new Set(),
  viewMode: "board", // 'board' | 'list'
  theme: localStorage.getItem("theme") || "light",

  // Game State
  game: {
    active: false,
    playlist: [],
    currentIndex: -1,
  },
};

// --- DOM Elements ---
const dom = {
  app: document.getElementById("app"),
  screens: {
    home: document.getElementById("home-screen"),
    welcome: document.getElementById("welcome-screen"),
    game: document.getElementById("game-screen"),
  },
  // Home
  bookGrid: document.getElementById("book-grid"),
  homeThemeToggle: document.getElementById("home-theme-toggle"),

  // Welcome (Detail)
  backHomeBtn: document.getElementById("back-home-btn"),
  detailThemeToggle: document.getElementById("detail-theme-toggle"),
  topicTitle: document.getElementById("topic-title"),
  viewBtns: document.querySelectorAll(".view-btn"),
  topicContainer: document.getElementById("topic-container"),
  selectAllBtn: document.getElementById("select-all-btn"),
  selectedCountEl: document.getElementById("selected-count"),
  startBtn: document.getElementById("start-btn"),
  resumeBtn: document.getElementById("resume-btn"), // New Resume Button

  // Game
  exitBtn: document.getElementById("exit-btn"),
  cardEl: document.getElementById("card"),
  wordDisplay: document.getElementById("word-display"),
  curIndexEl: document.getElementById("current-index"),
  totalCountEl: document.getElementById("total-count"),
  gameThemeToggle: document.getElementById("game-theme-toggle"),
};

// --- Library Manager ---
const LibraryManager = {
  init() {
    const stored = localStorage.getItem("library");
    if (stored) {
      state.library = JSON.parse(stored);

      // Check usage of old single default structure or new array
      // Ensure ALL defaults exist and UPDATE them to match data.js (fix stale URLs)
      defaultLibrary.forEach((defBook) => {
        const existingIdx = state.library.findIndex((b) => b.id === defBook.id);
        if (existingIdx === -1) {
          // Add new
          state.library.push(this.extractMeta(defBook));
        } else {
          // Update existing default book logic
          // We preserve 'count' and 'title' if IT WAS RENAMED via CSV metadata?
          // Actually, for URLs, we MUST update.
          // Let's safe update: URL and sourceType.
          // Title implies we might overwrite the cached "A1 Title", but syncAll() will fix that in a moment anyway.
          state.library[existingIdx].url = defBook.url;
          state.library[existingIdx].sourceType = defBook.sourceType;
          // Note: We don't force-overwrite title here because syncAll() will fetch the latest A1 title.
        }
      });
      this.save();
    } else {
      // First time load: Copy all defaults
      state.library = defaultLibrary.map((b) => this.extractMeta(b));
      this.save();
    }

    // Eager Load / Sync All
    this.syncAll();
  },

  async syncAll() {
    // Create an array of promises to fetch all CSV books
    const promises = state.library
      .filter((b) => b.sourceType === "csv")
      .map((b) => this.loadBook(b.id)); // loadBook handles fetching and meta updating

    await Promise.all(promises);
    renderHome(); // Re-render to show updated titles/counts
  },

  save() {
    localStorage.setItem("library", JSON.stringify(state.library));
  },

  extractMeta(book) {
    return {
      id: book.id,
      title: book.title,
      sourceType: book.sourceType, // 'local' | 'csv'
      url: book.url || null,
      count: book.words ? book.words.length : 0,
    };
  },

  async loadBook(bookId) {
    const meta = state.library.find((b) => b.id === bookId);
    if (!meta) return null;

    // Check if it's one of the LOCAL defaults
    const localDefault = defaultLibrary.find(
      (d) => d.id === bookId && d.sourceType === "local",
    );
    if (localDefault) {
      return { ...localDefault, title: meta.title };
    }

    // CSV Source (Either default CSV or user added CSV)
    if (meta.sourceType === "csv") {
      // Fetch CSV
      try {
        const result = await CSVFetcher.fetch(meta.url);
        // data: { words, metadata }
        const words = result.words;

        // Update count
        let needsSave = false;
        if (meta.count !== words.length) {
          meta.count = words.length;
          needsSave = true;
        }

        // Update Title from Metadata if present
        if (result.metadata && result.metadata.title) {
          if (meta.title !== result.metadata.title) {
            meta.title = result.metadata.title;
            needsSave = true;
          }
        }

        if (needsSave) this.save();

        return {
          id: meta.id,
          title: meta.title,
          sourceType: "csv",
          url: meta.url,
          words: words,
        };
      } catch (err) {
        console.error("Failed to load CSV book", err);
        alert("無法讀取 CSV 連結，請檢查網址或網路狀態。");
        return null;
      }
    }
    return null;
  },
};

// --- CSV Fetcher ---
const CSVFetcher = {
  async fetch(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Network response was not ok");
    const text = await response.text();
    return this.parse(text);
  },

  parse(csvText) {
    const lines = csvText.split(/\r?\n/).filter((line) => line.trim() !== "");
    const data = [];
    const metadata = {};

    lines.forEach((line, index) => {
      const parts = line.split(",");
      const term = parts[0]?.trim();
      const zhuyin = parts[1]?.trim() || "";

      if (!term) return;

      // Logic: Use Row 1 (Index 0) as Title
      if (index === 0) {
        // If the first row, presume it's a title UNLESS it looks like a standard header
        // Simple heuristic: If it's "Term", "Word" etc., ignore it as title but definitely skip adding as a word
        const lower = term.toLowerCase();
        if (
          lower !== "term" &&
          lower !== "word" &&
          !lower.includes("題目") &&
          !lower.includes("content")
        ) {
          metadata.title = term;
        }
        // Always skip the first row from being a word card, as it is either Title or Header
        return;
      }

      data.push({ term, zhuyin });
    });

    return { words: data, metadata };
  },
};

// --- Storage Manager (Resume Functionality) ---
const StorageManager = {
  getStorageKey(bookId) {
    return `guess_game_progress_${bookId}`;
  },

  saveProgress(bookId, playlist, currentIndex, originalIndices) {
    const data = {
      playlist,
      currentIndex,
      originalIndices: Array.from(originalIndices), // Convert Set to Array
      timestamp: Date.now(),
    };
    localStorage.setItem(this.getStorageKey(bookId), JSON.stringify(data));
  },

  loadProgress(bookId) {
    const json = localStorage.getItem(this.getStorageKey(bookId));
    if (!json) return null;
    try {
      const data = JSON.parse(json);
      // Validate data integrity
      if (
        !data.playlist ||
        !Array.isArray(data.playlist) ||
        typeof data.currentIndex !== "number"
      ) {
        return null;
      }
      return data;
    } catch (e) {
      console.error("Failed to parse game progress", e);
      return null;
    }
  },

  clearProgress(bookId) {
    localStorage.removeItem(this.getStorageKey(bookId));
  },
};

// --- Navigation ---
function navigateTo(screenName) {
  Object.values(dom.screens).forEach((el) => el.classList.remove("active"));
  dom.screens[screenName].classList.add("active");
}

// --- Logic Implementation ---

function init() {
  applyTheme(state.theme);
  LibraryManager.init();
  renderHome();
  setupEventListeners();
}

function renderHome() {
  dom.bookGrid.innerHTML = "";

  state.library.forEach((book) => {
    const el = document.createElement("div");
    el.className = "book-card";
    el.innerHTML = `
            <div class="book-title">${book.title}</div>
            <div class="book-meta">
                <span class="source-badge ${book.sourceType === "csv" ? "csv" : "local"}">
                    ${book.sourceType === "csv" ? "Google Sheets" : "內建"}
                </span>
                <span>• ${book.count} 個詞彙</span>
            </div>
        `;
    el.addEventListener("click", () => openBook(book.id));
    dom.bookGrid.appendChild(el);
  });
}

async function openBook(bookId) {
  const book = await LibraryManager.loadBook(bookId);
  if (!book) return;

  state.activeBook = book;
  state.viewMode = "board"; // Reset to board

  // Update UI
  dom.topicTitle.textContent = book.title;

  updateWelcomeUI(bookId);

  navigateTo("welcome");
}

function updateWelcomeUI(bookId) {
  // Check for existing progress
  const progress = StorageManager.loadProgress(bookId);

  // Restore selection if progress exists, otherwise clear
  // Note: If we are just refreshing (like in exitGame), we might want to keep current selection
  // if no progress exists? But here we strictly sync with storage or clear if new.
  if (progress && progress.originalIndices) {
    state.selectedIndices = new Set(progress.originalIndices);
  } else {
    // Only clear if we are opening fresh and no progress?
    // Actually, openBook logic was: clear, then restore if progress.
    // So consistent behavior is: always match storage or empty.
    state.selectedIndices.clear();
  }

  renderTopicList();

  // Update UI based on progress availability
  if (progress) {
    dom.resumeBtn.style.display = "flex";
    dom.startBtn.innerHTML = `
            <span class="material-symbols-rounded">play_arrow</span>
            開始新遊戲
        `;
  } else {
    dom.resumeBtn.style.display = "none";
    dom.startBtn.innerHTML = `
            <span class="material-symbols-rounded">play_arrow</span>
            開始遊戲
        `;
  }
}

function renderTopicList() {
  const list = state.activeBook.words;
  dom.topicContainer.innerHTML = "";
  dom.topicContainer.className = `topic-grid ${state.viewMode === "list" ? "list-view" : ""}`;

  list.forEach((item, index) => {
    const el = document.createElement("div");
    el.className = "topic-item";
    if (state.selectedIndices.has(index)) {
      el.classList.add("selected");
    }

    // Only show term
    el.innerHTML = `
            <span class="topic-text">${item.term}</span>
            <span class="material-symbols-rounded check-icon">check_circle</span>
        `;

    el.addEventListener("click", () => toggleSelection(index, el));
    dom.topicContainer.appendChild(el);
  });

  // Init state UI
  updateSelectionUI();

  // Update View Buttons
  dom.viewBtns.forEach((btn) => {
    if (btn.dataset.view === state.viewMode) btn.classList.add("active");
    else btn.classList.remove("active");
  });
}

// --- Actions ---

function toggleSelection(index, el) {
  if (state.selectedIndices.has(index)) {
    state.selectedIndices.delete(index);
    el.classList.remove("selected");
  } else {
    state.selectedIndices.add(index);
    el.classList.add("selected");
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = state.selectedIndices.size;
  dom.selectedCountEl.textContent = count;
  dom.startBtn.disabled = count === 0;

  // Update Select All Text
  const total = state.activeBook.words.length;
  const isAllSelected = count === total && total > 0;
  dom.selectAllBtn.textContent = isAllSelected ? "取消全選" : "全選";
}

// --- Event Listeners ---
function setupEventListeners() {
  // Home
  dom.homeThemeToggle.addEventListener("click", toggleTheme);

  // Navigation
  dom.backHomeBtn.addEventListener("click", () => {
    renderHome(); // Refresh home to show updated titles/counts
    navigateTo("home");
  });

  // Detail
  dom.detailThemeToggle.addEventListener("click", toggleTheme);
  dom.startBtn.addEventListener("click", () => startGame(false)); // Start New
  dom.resumeBtn.addEventListener("click", () => startGame(true)); // Resume
  dom.exitBtn.addEventListener("click", exitGame);

  // Game
  if (dom.gameThemeToggle) {
    dom.gameThemeToggle.addEventListener("click", toggleTheme);
  }

  // View Toggles
  dom.viewBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.viewMode = btn.dataset.view;
      renderTopicList();
    });
  });

  // Select All
  dom.selectAllBtn.addEventListener("click", () => {
    const total = state.activeBook.words.length;
    if (state.selectedIndices.size === total) {
      state.selectedIndices.clear();
    } else {
      for (let i = 0; i < total; i++) state.selectedIndices.add(i);
    }
    renderTopicList();
  });

  // Swipe
  initSwipeAttributes();
}

function toggleTheme() {
  state.theme = state.theme === "light" ? "dark" : "light";
  applyTheme(state.theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  const iconName = theme === "light" ? "dark_mode" : "light_mode";
  // Update all toggles
  [dom.homeThemeToggle, dom.detailThemeToggle, dom.gameThemeToggle].forEach(
    (btn) => {
      if (btn) btn.querySelector("span").textContent = iconName;
    },
  );
}

// --- Game Logic ---
function startGame(isResume = false) {
  state.game.active = true;

  if (isResume) {
    // RESUME MODE
    const progress = StorageManager.loadProgress(state.activeBook.id);
    if (progress) {
      state.game.playlist = progress.playlist;
      state.game.currentIndex = progress.currentIndex;
      // Restore selected indices for visual consistency if needed, though game is already built
      state.selectedIndices = new Set(progress.originalIndices);
    } else {
      // Fallback if load fails
      alert("無法讀取存檔，將開始新遊戲。");
      startGame(false);
      return;
    }
  } else {
    // NEW GAME MODE
    if (state.selectedIndices.size === 0) return;

    // Create playlist
    const pool = Array.from(state.selectedIndices).map(
      (idx) => state.activeBook.words[idx],
    );
    state.game.playlist = shuffle(pool);
    state.game.currentIndex = -1; // Will be incremented to 0 by nextQuestion logic if we used that, but here we set to start.

    // Logic for new game setup
    state.game.currentIndex = 0;
    // Clear old progress
    StorageManager.clearProgress(state.activeBook.id);
    // Save INITIAL new progress
    StorageManager.saveProgress(
      state.activeBook.id,
      state.game.playlist,
      0,
      state.selectedIndices,
    );
  }

  // UI Update
  dom.totalCountEl.textContent = state.game.playlist.length;
  navigateTo("game");

  updateCardUI();
}

function exitGame() {
  state.game.active = false;
  if (state.activeBook) {
    // Save progress one last time to be sure
    StorageManager.saveProgress(
      state.activeBook.id,
      state.game.playlist,
      state.game.currentIndex,
      state.selectedIndices,
    );
    updateWelcomeUI(state.activeBook.id);
  }
  navigateTo("welcome");
  dom.cardEl.style.transform = "";
  dom.wordDisplay.textContent = "...";
}

function nextQuestion() {
  if (state.game.currentIndex < state.game.playlist.length - 1) {
    state.game.currentIndex++;
    updateCardUI();
    // Save Progress
    StorageManager.saveProgress(
      state.activeBook.id,
      state.game.playlist,
      state.game.currentIndex,
      state.selectedIndices,
    );
  } else {
    // End of game logic...
  }
}

function prevQuestion() {
  if (state.game.currentIndex > 0) {
    state.game.currentIndex--;
    updateCardUI();
    // Save Progress
    StorageManager.saveProgress(
      state.activeBook.id,
      state.game.playlist,
      state.game.currentIndex,
      state.selectedIndices,
    );
  }
}

function updateCardUI() {
  const w = state.game.playlist[state.game.currentIndex];
  dom.wordDisplay.textContent = w.term;
  dom.curIndexEl.textContent = state.game.currentIndex + 1;
}

// Fisher-Yates Shuffle
function shuffle(array) {
  let currentIndex = array.length,
    randomIndex;

  // While there remain elements to shuffle.
  while (currentIndex != 0) {
    // Pick a remaining element.
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }

  return array;
}

// Swipe Logic (Reused)
function initSwipeAttributes() {
  let startX = 0,
    currentX = 0,
    isDragging = false;
  const threshold = 100;

  const onStart = (e) => {
    if (!state.game.active) return;
    isDragging = true;
    startX = e.touches ? e.touches[0].clientX : e.clientX;
    dom.cardEl.style.transition = "none";
  };

  const onMove = (e) => {
    if (!isDragging) return;
    currentX = e.touches ? e.touches[0].clientX : e.clientX;
    const dx = currentX - startX;
    dom.cardEl.style.transform = `translateX(${dx}px) rotate(${dx * 0.05}deg)`;
  };

  const onEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    const dx = currentX - startX;
    if (Math.abs(dx) > threshold) {
      if (dx > 0) {
        if (state.game.currentIndex < state.game.playlist.length - 1) {
          animateSwipeAndAction("right", nextQuestion);
        } else {
          resetCardPosition();
        }
      } else {
        if (state.game.currentIndex > 0)
          animateSwipeAndAction("left", prevQuestion);
        else resetCardPosition();
      }
    } else {
      resetCardPosition();
    }
  };

  dom.cardEl.addEventListener("mousedown", onStart);
  dom.cardEl.addEventListener("touchstart", onStart);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("touchmove", onMove);
  window.addEventListener("mouseup", onEnd);
  window.addEventListener("touchend", onEnd);
}

function resetCardPosition() {
  dom.cardEl.style.transition = "transform 0.3s ease";
  dom.cardEl.style.transform = "translate(0,0) rotate(0)";
}

function animateSwipeAndAction(direction, callback) {
  dom.cardEl.style.transition = "transform 0.3s ease-in, opacity 0.3s ease-in";
  dom.cardEl.style.transform = `translateX(${direction === "right" ? 120 : -120}%) rotate(${direction === "right" ? 20 : -20}deg)`;
  dom.cardEl.style.opacity = "0";

  setTimeout(() => {
    callback();
    dom.cardEl.style.transition = "none";
    dom.cardEl.style.transform = "scale(0.8)";
    dom.cardEl.style.opacity = "0";
    void dom.cardEl.offsetWidth;

    dom.cardEl.style.transition =
      "transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.4s ease";
    dom.cardEl.style.transform = "scale(1)";
    dom.cardEl.style.opacity = "1";
  }, 300);
}

// Bootstrap
init();
