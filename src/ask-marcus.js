export async function submitMarcusQuestion({ input, fetchImpl = fetch }) {
  const response = await fetchImpl('/api/ask-marcus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.code || 'service_unavailable');
  return result;
}

function messageFor(code) { return code === 'key_required' ? 'Ask Marcus needs setup before it can respond.' : code === 'rate_limited' ? 'Marcus is busy. Please try again shortly.' : code === 'invalid_input' ? 'Enter a question of up to 4,000 characters.' : 'Marcus is unavailable right now. Please try again.'; }
function appendText(parent, tag, text, className) { const documentRef = parent.ownerDocument; if (!documentRef?.createElement) return; const element = documentRef.createElement(tag); if (className) element.className = className; element.textContent = text; parent.append(element); }

export function createAskController({ form, input, counter, status, submitButton, retryButton, results, backButton, exploreButton, fetchImpl, onBack, onExplore, onKeyRequired = () => {} }) {
  let result;
  function renderCounter() { counter.textContent = `${input.value.length} / 4,000`; }
  function clearResults() { results.replaceChildren?.(); results.textContent = ''; }
  function renderResults(nextResult) {
    clearResults();
    if (nextResult.safetyBanner) appendText(results, 'p', nextResult.safetyBanner, 'ask-safety');
    appendText(results, 'p', nextResult.message, 'ask-message');
    for (const section of nextResult.sections) { const card = results.ownerDocument?.createElement?.('article'); if (!card) continue; card.className = 'ask-card'; appendText(card, 'h2', section.label); appendText(card, 'p', section.lesson, 'ask-lesson'); appendText(card, 'p', section.reason); results.append(card); }
    results.textContent ||= [nextResult.safetyBanner, nextResult.message, ...nextResult.sections.flatMap((section) => [section.label, section.lesson, section.reason])].filter(Boolean).join(' ');
  }
  async function submit(event) { event?.preventDefault(); clearResults(); status.textContent = 'Asking Marcus…'; submitButton.disabled = true; retryButton.hidden = true; exploreButton.hidden = true; try { result = await submitMarcusQuestion({ input: input.value, fetchImpl }); status.textContent = ''; renderResults(result); exploreButton.hidden = false; } catch (error) { if (error.message === 'key_required') { onKeyRequired(); return; } status.textContent = messageFor(error.message); retryButton.hidden = false; } finally { submitButton.disabled = false; } }
  form.addEventListener('submit', submit); input.addEventListener('input', renderCounter); retryButton.addEventListener('click', submit); exploreButton.addEventListener('click', () => { if (result) onExplore(result.sections.map(({ id }) => id)); }); backButton.addEventListener('click', onBack); renderCounter(); return { submit, renderCounter };
}
