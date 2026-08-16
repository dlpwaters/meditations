export const SETUP_SKIP_KEY = 'meditations.setupSkipped';

export async function fetchSetupStatus(fetchImpl = fetch) {
  const response = await fetchImpl('/api/setup-status');
  if (!response.ok) throw new Error('setup_status_unavailable');
  const result = await response.json();
  return { configured: result.configured === true };
}

export async function submitSetupKey({ key, fetchImpl = fetch }) {
  const response = await fetchImpl('/api/setup-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.configured !== true) throw new Error(result.error || 'setup_failed');
  return { configured: true };
}

export function createSetupController({ form, input, status, submitButton, skipButton, storage, onSuccess, onFailure, onSkip, fetchImpl }) {
  function render(message, state = 'idle') {
    status.textContent = message;
    submitButton.disabled = state === 'loading';
    skipButton.disabled = state === 'loading';
  }

  async function save(event) {
    event.preventDefault();
    const key = input.value;
    render('Saving key…', 'loading');
    try {
      await submitSetupKey({ key, fetchImpl });
      render('Key saved.');
      input.value = '';
      onSuccess();
    } catch {
      render('Could not save that key. Please try again.', 'error');
      input.value = '';
      onFailure('Could not save that key. Please try again.');
    }
  }

  function skip() {
    storage.setItem(SETUP_SKIP_KEY, 'true');
    render('You can add a key later.');
    onSkip();
  }

  form.addEventListener('submit', save);
  skipButton.addEventListener('click', skip);
  return { render };
}
