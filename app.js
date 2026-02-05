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
    history: [],
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
  state.selectedIndices.clear();
  state.viewMode = "board"; // Reset to board

  // Update UI
  dom.topicTitle.textContent = book.title;

  renderTopicList();
  navigateTo("welcome");
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
  dom.startBtn.addEventListener("click", startGame);
  dom.detailThemeToggle.addEventListener("click", toggleTheme);
  dom.startBtn.addEventListener("click", startGame);
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
function startGame() {
  if (state.selectedIndices.size === 0) return;

  state.game.active = true;
  state.game.history = [];
  state.game.currentIndex = -1;

  // UI Update
  dom.totalCountEl.textContent = "∞";
  navigateTo("game");

  nextQuestion();
}

function exitGame() {
  state.game.active = false;
  navigateTo("welcome");
  dom.cardEl.style.transform = "";
  dom.wordDisplay.textContent = "...";
}

function nextQuestion() {
  if (state.game.currentIndex < state.game.history.length - 1) {
    state.game.currentIndex++;
  } else {
    const word = getRandomWord();
    state.game.history.push(word);
    state.game.currentIndex++;
  }
  updateCardUI();
}

function prevQuestion() {
  if (state.game.currentIndex > 0) {
    state.game.currentIndex--;
    updateCardUI();
  }
}

function getRandomWord() {
  const pool = Array.from(state.selectedIndices);
  let available = pool;
  if (state.game.history.length > 0 && pool.length > 1) {
    const current = state.game.history[state.game.currentIndex].term;
    available = pool.filter(
      (idx) => state.activeBook.words[idx].term !== current,
    );
  }
  const idx = available[Math.floor(Math.random() * available.length)];
  return state.activeBook.words[idx];
}

function updateCardUI() {
  const w = state.game.history[state.game.currentIndex];
  dom.wordDisplay.textContent = w.term;
  dom.curIndexEl.textContent = state.game.currentIndex + 1;
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
      if (dx > 0) animateSwipeAndAction("right", nextQuestion);
      else {
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
