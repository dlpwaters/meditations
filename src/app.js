import { SETUP_SKIP_KEY, createSetupController, fetchSetupStatus } from './setup.js';
import { createReader } from './reader.js';
import { createAskController } from './ask-marcus.js';

export function initialView({ configured, skipped }) { return !configured && !skipped ? 'setup' : 'start'; }
export function createAppState({ configured, skipped }) { return { view: initialView({ configured, skipped }), configured, skipped, setup: { status: 'idle', error: '' } }; }
export function reduceAppState(state, action) {
  if (action.type === 'OPEN_START') return { ...state, view: 'start' };
  if (action.type === 'OPEN_ASK') return { ...state, view: 'ask' };
  if (action.type === 'OPEN_READER') return { ...state, view: 'reader' };
  if (action.type === 'OPEN_SETUP') return { ...state, view: 'setup', setup: { status: 'idle', error: '' } };
  if (action.type === 'SETUP_SUCCESS') return { ...state, view: 'start', configured: true, skipped: false, setup: { status: 'success', error: '' } };
  if (action.type === 'SETUP_FAILURE') return { ...state, view: 'setup', setup: { status: 'error', error: action.error } };
  if (action.type === 'SKIP_SETUP') return { ...state, view: 'start', skipped: true, setup: { status: 'idle', error: '' } };
  return state;
}
export function createAppController({ views, state, onReaderVisible = () => {} }) {
  let appState = state;
  let hasLocalSetupDecision = false;
  let initialSetupStatusApplied = false;
  function render() { views.forEach((view) => { view.hidden = view.dataset.view !== appState.view; }); if (appState.view === 'reader') onReaderVisible(); }
  return { getState: () => appState, render, transition(action) { if (action.type === 'SETUP_SUCCESS' || action.type === 'SKIP_SETUP') hasLocalSetupDecision = true; appState = reduceAppState(appState, action); render(); }, readerReady() { if (appState.view === 'reader') onReaderVisible(); }, applyInitialSetupStatus({ configured, skipped }) { if (hasLocalSetupDecision || initialSetupStatusApplied) return false; initialSetupStatusApplied = true; appState = createAppState({ configured, skipped }); render(); return true; } };
}

if (typeof document !== 'undefined') {
  const views = [...document.querySelectorAll('[data-view]')];
  const startStatus = document.querySelector('#start-status');
  const storage = window.localStorage;
  let readerReady = false;
  let readerInitialised = false;
  let appController;
  const reader = createReader({ status: document.querySelector('#reader-status'), book: document.querySelector('#book-pages'), progress: document.querySelector('#progress'), previous: document.querySelector('#previous-page'), next: document.querySelector('#next-page'), fullBook: document.querySelector('#full-book'), contentsButton: document.querySelector('#contents-button'), contents: document.querySelector('#contents-panel'), originalButton: document.querySelector('#original-mode'), familiarButton: document.querySelector('#familiar-mode'), randomButton: document.querySelector('#random-page'), fullscreenButton: document.querySelector('#fullscreen-toggle') });
  function dispatch(action) { appController.transition(action); }
  function initialiseReaderWhenVisible() { if (!readerReady || readerInitialised) return; readerInitialised = true; reader.initialise(); }
  const setupController = createSetupController({ form: document.querySelector('#setup-form'), input: document.querySelector('#setup-key'), status: document.querySelector('#setup-status'), submitButton: document.querySelector('#save-setup-key'), skipButton: document.querySelector('#skip-setup'), storage, onSuccess: () => { storage.removeItem(SETUP_SKIP_KEY); dispatch({ type: 'SETUP_SUCCESS' }); }, onFailure: (error) => dispatch({ type: 'SETUP_FAILURE', error }), onSkip: () => dispatch({ type: 'SKIP_SETUP' }) });
  appController = createAppController({ views, state: createAppState({ configured: false, skipped: false }), onReaderVisible: initialiseReaderWhenVisible });
  createAskController({ form: document.querySelector('#ask-form'), input: document.querySelector('#ask-input'), counter: document.querySelector('#ask-counter'), status: document.querySelector('#ask-status'), submitButton: document.querySelector('#submit-ask'), retryButton: document.querySelector('#retry-ask'), results: document.querySelector('#ask-results'), backButton: document.querySelector('#back-to-start'), exploreButton: document.querySelector('#explore-sections'), onBack: () => dispatch({ type: 'OPEN_START' }), onExplore: (ids) => { reader.openRecommendedPath(ids); dispatch({ type: 'OPEN_READER' }); }, onKeyRequired: () => dispatch({ type: 'OPEN_SETUP' }) });
  document.querySelector('#read-meditations').addEventListener('click', () => dispatch({ type: 'OPEN_READER' }));
  document.querySelector('#ask-marcus').addEventListener('click', () => dispatch({ type: appController.getState().configured ? 'OPEN_ASK' : 'OPEN_SETUP' }));
  document.querySelector('#replace-key').addEventListener('click', () => dispatch({ type: 'OPEN_SETUP' }));
  appController.render();
  fetchSetupStatus().then(({ configured }) => appController.applyInitialSetupStatus({ configured, skipped: storage.getItem(SETUP_SKIP_KEY) === 'true' })).catch(() => { if (appController.applyInitialSetupStatus({ configured: false, skipped: true })) startStatus.textContent = 'Setup status is unavailable. Reading is still available.'; });
  fetch('/data/meditations.pages.json').then((response) => response.ok ? response.json() : Promise.reject(new Error('Unable to load the book.'))).then(({ pages }) => { reader.setPages(pages); readerReady = true; appController.readerReady(); }).catch((error) => { const status = document.querySelector('#reader-status'); status.textContent = error.message; status.classList.add('is-error'); });
}
