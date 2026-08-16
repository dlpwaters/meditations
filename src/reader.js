export function createReaderState(pageCount) {
  return { pageCount, index: 0, mode: 'original', contentsOpen: false, randomMode: false };
}

export function readingForMode(page, mode) {
  if (mode === 'familiar') return page.modernVersion || 'This familiar reading is being prepared.';
  return page.text;
}

export function randomIndex(pageCount, currentIndex, rng = Math.random) {
  if (pageCount <= 1) return 0;
  const candidate = Math.floor(rng() * (pageCount - 1));
  return candidate >= currentIndex ? candidate + 1 : candidate;
}

export function nextReaderIndex(state, rng = Math.random) {
  if (state.randomMode) return randomIndex(state.pageCount, state.index, rng);
  return Math.min(state.pageCount - 1, state.index + 1);
}

export function randomFlipDirection(state) {
  return state.index < state.pageCount - 1 ? 'next' : 'previous';
}

export function reduceReaderState(state, action) {
  if (action.type === 'SET_MODE' && ['original', 'familiar'].includes(action.mode)) return { ...state, mode: action.mode };
  if (action.type === 'TOGGLE_CONTENTS') return { ...state, contentsOpen: !state.contentsOpen };
  if (action.type === 'CLOSE_CONTENTS') return { ...state, contentsOpen: false };
  if (action.type === 'TOGGLE_RANDOM_MODE') return { ...state, randomMode: !state.randomMode };
  if (action.type === 'SELECT_INDEX') return { ...state, index: Math.max(0, Math.min(state.pageCount - 1, action.index)), contentsOpen: false };
  const delta = action.type === 'NEXT' ? 1 : action.type === 'PREVIOUS' ? -1 : 0;
  return delta ? { ...state, index: Math.max(0, Math.min(state.pageCount - 1, state.index + delta)) } : state;
}

export function createReadingPath(allPages, recommendedIds) {
  if (!recommendedIds) return allPages;
  const pagesById = new Map(allPages.map((page) => [page.id, page]));
  const seen = new Set();
  return recommendedIds.map((id) => {
    if (seen.has(id)) throw new Error(`Duplicate recommended page ID: ${id}`);
    seen.add(id);
    const page = pagesById.get(id);
    if (!page) throw new Error(`Unknown recommended page ID: ${id}`);
    return page;
  });
}

export function restoreFullBookIndex(allPages, startId) {
  const index = allPages.findIndex((page) => page.id === startId);
  return index < 0 ? 0 : index;
}

function escapeHtml(value) { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]); }
function textPage(page, mode) { return `<article class="spread-page text-page" data-page-id="${page.id}"><p class="page-label">${page.label}</p><p class="page-text">${escapeHtml(readingForMode(page, mode))}</p></article>`; }
function artPage(page) {
  const source = page.illustration?.status === 'complete' ? `<img src="${page.illustration.path}" alt="Illustration for ${page.label}">` : '<div class="art-placeholder"><span>Illustration</span><small>in preparation</small></div>';
  return `<article class="spread-page art-page" data-page-id="${page.id}">${source}<p class="art-label">${page.label}</p></article>`;
}

export function createReader({ status, book, progress, previous, next, fullBook, contentsButton, contents, originalButton, familiarButton, randomButton, fullscreenButton }) {
  let allPages = [];
  let pages = [];
  let state;
  let pageFlip;
  let physicalPage = 0;
  let pendingPage = null;
  let pendingRandomIndex = null;
  let recommendedMode = false;
  let initialised = false;
  const bookShell = book.closest?.('.book-shell') || book;
  let resizeFrame = 0;

  function resizeBook() {
    if (!pageFlip) return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => pageFlip.update());
  }

  function renderPages() {
    const markup = pages.flatMap((page) => [textPage(page, state.mode), artPage(page)]).join('');
    if (!pageFlip) {
      book.innerHTML = markup;
      return book.querySelectorAll('.spread-page');
    }
    const template = document.createElement('template');
    template.innerHTML = markup;
    return template.content.querySelectorAll('.spread-page');
  }
  function sync() {
    progress.textContent = `${state.index + 1} of ${pages.length}`;
    previous.disabled = state.index === 0;
    next.disabled = !state.randomMode && state.index === pages.length - 1;
    originalButton.setAttribute('aria-pressed', String(state.mode === 'original'));
    familiarButton.setAttribute('aria-pressed', String(state.mode === 'familiar'));
    randomButton.setAttribute('aria-pressed', String(state.randomMode));
    randomButton.textContent = state.randomMode ? 'Random on' : 'Random';
    contents.hidden = !state.contentsOpen;
    fullBook.hidden = !recommendedMode;
    fullscreenButton.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  }
  function buildContents() {
    const groups = Map.groupBy(pages, (page) => page.book);
    contents.querySelector('.contents-list').innerHTML = [...groups].map(([bookNumber, entries]) => `<section><h2>Book ${bookNumber}</h2>${entries.map((page) => `<button type="button" data-index="${pages.indexOf(page)}"><span>Section ${page.section}</span><small>${escapeHtml(page.lesson || 'Reflection')}</small></button>`).join('')}</section>`).join('');
  }
  function initialiseFlip(renderedPages) {
    if (!pageFlip) {
      pageFlip = new St.PageFlip(book, { width: 360, height: 520, size: 'stretch', minWidth: 280, maxWidth: 600, minHeight: 400, maxHeight: 760, showCover: false, usePortrait: false, mobileScrollSupport: false, maxShadowOpacity: 0.45 });
      pageFlip.on('flip', (event) => {
        const nextPhysicalPage = event.data;
        const isProgrammaticTurn = pendingPage === nextPhysicalPage;
        const isManualForwardTurn = nextPhysicalPage > physicalPage;
        physicalPage = nextPhysicalPage;
        pendingPage = null;
        if (pendingRandomIndex !== null) {
          const randomPage = pendingRandomIndex;
          pendingRandomIndex = null;
          showIndex(randomPage);
          return;
        }
        if (state.randomMode && isManualForwardTurn && !isProgrammaticTurn) {
          showIndex(nextReaderIndex(state));
          return;
        }
        state = reduceReaderState(state, { type: 'SELECT_INDEX', index: Math.floor(nextPhysicalPage / 2) });
        sync();
      });
      pageFlip.loadFromHTML(renderedPages);
      return;
    }
    pageFlip.updateFromHtml(renderedPages);
  }
  function showIndex(index) {
    state = reduceReaderState(state, { type: 'SELECT_INDEX', index });
    pendingPage = state.index * 2;
    sync();
    pageFlip.turnToPage(pendingPage);
  }
  function rebuild({ startIndex = 0 } = {}) {
    state = { ...createReaderState(pages.length), mode: state?.mode || 'original', randomMode: state?.randomMode || false, index: startIndex };
    const renderedPages = renderPages();
    buildContents();
    initialiseFlip(renderedPages);
    physicalPage = startIndex * 2;
    showIndex(startIndex);
  }
  function forward() {
    if (!state.randomMode) {
      pageFlip.flipNext();
      return;
    }
    pendingRandomIndex = nextReaderIndex(state);
    if (randomFlipDirection(state) === 'next') pageFlip.flipNext();
    else pageFlip.flipPrev();
  }
  function setMode(mode) {
    const currentIndex = state.index;
    state = reduceReaderState(state, { type: 'SET_MODE', mode });
    const renderedPages = renderPages();
    initialiseFlip(renderedPages);
    showIndex(currentIndex);
  }
  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await bookShell.requestFullscreen();
  }
  function openRecommendedPath(ids) {
    pages = createReadingPath(allPages, ids);
    recommendedMode = true;
    if (initialised) rebuild();
  }
  function openFullBook({ startId } = {}) {
    const activeId = startId || pages[state.index]?.id;
    pages = createReadingPath(allPages);
    recommendedMode = false;
    rebuild({ startIndex: restoreFullBookIndex(allPages, activeId) });
  }

  previous.addEventListener('click', () => pageFlip.flipPrev());
  next.addEventListener('click', forward);
  fullBook.addEventListener('click', () => openFullBook());
  randomButton.addEventListener('click', () => { state = reduceReaderState(state, { type: 'TOGGLE_RANDOM_MODE' }); sync(); });
  fullscreenButton.addEventListener('click', toggleFullscreen);
  originalButton.addEventListener('click', () => setMode('original'));
  familiarButton.addEventListener('click', () => setMode('familiar'));
  contentsButton.addEventListener('click', () => { state = reduceReaderState(state, { type: 'TOGGLE_CONTENTS' }); sync(); });
  contents.addEventListener('click', (event) => { const button = event.target.closest('[data-index]'); if (button) showIndex(Number(button.dataset.index)); });
  document.addEventListener('fullscreenchange', () => { sync(); resizeBook(); });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resizeBook).observe(bookShell);
  document.addEventListener('keydown', (event) => { if (event.key === 'ArrowLeft') pageFlip.flipPrev(); if (event.key === 'ArrowRight') forward(); if (event.key === 'Escape' && document.fullscreenElement) document.exitFullscreen(); if (event.key === 'Escape' && state.contentsOpen) { state = reduceReaderState(state, { type: 'CLOSE_CONTENTS' }); sync(); } });

  return {
    setPages(loadedPages) {
      allPages = loadedPages;
      pages = createReadingPath(allPages);
    },
    initialise() {
      if (initialised) return;
      rebuild();
      initialised = true;
      status.textContent = '';
    },
    openFullBook,
    openRecommendedPath,
    getState: () => state,
  };
}
