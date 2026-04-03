const OFFICIAL_GENESYS_URL = 'https://www.yugioh-card.com/en/genesys/';
const POINT_CAP = 100;
const GENESYS_CACHE_KEY = 'genesys_points_v1';

const deckInput = document.getElementById('decklist');
const analyzeBtn = document.getElementById('analyzeBtn');
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const issuesEl = document.getElementById('issues');
const pointsBreakdownEl = document.getElementById('pointsBreakdown');

const normalizeName = (name) =>
  name
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const parseDecklist = (raw) => {
  const lines = raw.split(/\r?\n/);
  let section = 'main';
  const cards = [];
  const warnings = [];

  for (const originalLine of lines) {
    let line = originalLine.trim();
    if (!line) continue;

    const lower = line.toLowerCase();
    if (lower.startsWith('#main') || lower === 'main deck:') {
      section = 'main';
      continue;
    }
    if (lower.startsWith('#extra') || lower === 'extra deck:') {
      section = 'extra';
      continue;
    }
    if (lower.startsWith('!side') || lower.startsWith('#side') || lower === 'side deck:') {
      section = 'side';
      continue;
    }
    if (line.startsWith('#')) continue;

    line = line.replace(/^[-*]\s*/, '');

    if (/^\d+$/.test(line)) {
      warnings.push(`Skipped numeric card id line: ${line}`);
      continue;
    }

    let qty = 1;
    let name = line;

    const prefixQty = line.match(/^(\d+)\s*[xX]?\s+(.+)$/);
    const suffixQty = line.match(/^(.+?)\s+[xX](\d+)$/);

    if (prefixQty) {
      qty = Number(prefixQty[1]);
      name = prefixQty[2].trim();
    } else if (suffixQty) {
      qty = Number(suffixQty[2]);
      name = suffixQty[1].trim();
    }

    if (!name || qty < 1) continue;
    cards.push({ section, name, qty });
  }

  return { cards, warnings };
};

const extractPointsMap = (pageText) => {
  const marker = 'Card Name Points';
  const start = pageText.indexOf(marker);
  if (start === -1) throw new Error('Could not find point list on official page.');

  let slice = pageText.slice(start + marker.length);
  const stopMarkers = ['Official Tournament Store Program', '©'];
  for (const stop of stopMarkers) {
    const idx = slice.indexOf(stop);
    if (idx !== -1) {
      slice = slice.slice(0, idx);
      break;
    }
  }

  const map = new Map();
  for (const rawLine of slice.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(.*?)(\d+)$/);
    if (!match) continue;

    const cardName = match[1].replace(/^"|"$/g, '').trim();
    const points = Number(match[2]);
    if (!cardName) continue;

    const key = normalizeName(cardName);
    map.set(key, Math.max(points, map.get(key) || 0));
  }

  if (!map.size) throw new Error('Official point list was empty after parsing.');
  return map;
};

const fetchOfficialPointsMap = async () => {
  const cached = localStorage.getItem(GENESYS_CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed?.source === OFFICIAL_GENESYS_URL && Array.isArray(parsed.entries) && parsed.entries.length) {
        return new Map(parsed.entries);
      }
    } catch {
      // ignore bad cache
    }
  }

  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(OFFICIAL_GENESYS_URL)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`Failed to fetch official list (${res.status}).`);
  const html = await res.text();
  const pageText = new DOMParser().parseFromString(html, 'text/html').body?.innerText ?? '';
  const map = extractPointsMap(pageText);

  localStorage.setItem(
    GENESYS_CACHE_KEY,
    JSON.stringify({ source: OFFICIAL_GENESYS_URL, fetchedAt: new Date().toISOString(), entries: [...map.entries()] })
  );

  return map;
};

const fetchCardType = async (name) => {
  const url = `https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data?.data?.[0]?.type ?? null;
};

const analyzeDeck = async () => {
  const raw = deckInput.value.trim();
  if (!raw) throw new Error('Please paste a decklist first.');

  const { cards, warnings } = parseDecklist(raw);
  if (!cards.length) throw new Error('No parsable card lines found in the decklist.');

  const pointsMap = await fetchOfficialPointsMap();
  const copyCounts = new Map();
  const uniqueNames = new Set();
  const pointRows = [];
  let totalPoints = 0;

  for (const { name, qty } of cards) {
    const key = normalizeName(name);
    uniqueNames.add(name);
    copyCounts.set(key, (copyCounts.get(key) || 0) + qty);

    const cardPoints = pointsMap.get(key) || 0;
    const subtotal = cardPoints * qty;
    totalPoints += subtotal;

    if (cardPoints > 0) {
      pointRows.push({ name, qty, cardPoints, subtotal });
    }
  }

  const issues = [];

  if (totalPoints > POINT_CAP) {
    issues.push(`Total points are ${totalPoints}, which is above the ${POINT_CAP}-point cap.`);
  }

  for (const [key, count] of copyCounts.entries()) {
    if (count > 3) {
      issues.push(`More than 3 copies: "${key}" appears ${count} times.`);
    }
  }

  const typeFailures = [];
  const typeChecks = {};

  for (const name of uniqueNames) {
    try {
      const cardType = await fetchCardType(name);
      if (!cardType) {
        typeFailures.push(name);
        continue;
      }
      typeChecks[name] = cardType;
      if (/link/i.test(cardType)) {
        issues.push(`Illegal card type: "${name}" is a Link Monster.`);
      }
      if (/pendulum/i.test(cardType)) {
        issues.push(`Illegal card type: "${name}" is a Pendulum card.`);
      }
    } catch {
      typeFailures.push(name);
    }
  }

  if (typeFailures.length) {
    warnings.push(
      `Could not verify card type for ${typeFailures.length} card(s): ${typeFailures.slice(0, 8).join(', ')}${
        typeFailures.length > 8 ? ', ...' : ''
      }`
    );
  }

  return { totalPoints, pointRows, issues, warnings, cardCount: cards.reduce((n, c) => n + c.qty, 0), typeChecks };
};

const render = ({ totalPoints, pointRows, issues, warnings, cardCount }) => {
  const legal = issues.length === 0;

  statusEl.className = `status ${legal ? 'legal' : 'illegal'}`;
  statusEl.classList.remove('hidden');
  statusEl.innerHTML = legal
    ? `<h2>✅ Deck is legal</h2><p>This list is legal for GENESYS under the default ${POINT_CAP}-point cap.</p>`
    : '<h2>❌ Deck is illegal</h2><p>One or more GENESYS rules were violated.</p>';

  summaryEl.classList.remove('hidden');
  summaryEl.innerHTML = `
    <h2>Summary</h2>
    <ul>
      <li>Total cards parsed: <strong>${cardCount}</strong></li>
      <li>Total GENESYS points: <strong>${totalPoints}</strong> / ${POINT_CAP}</li>
      <li>Rules failed: <strong>${issues.length}</strong></li>
    </ul>
  `;

  issuesEl.classList.remove('hidden');
  issuesEl.innerHTML = `
    <h2>Legality reasons</h2>
    ${issues.length ? `<ul>${issues.map((x) => `<li>${x}</li>`).join('')}</ul>` : '<p>No violations found.</p>'}
    ${warnings.length ? `<h3>Warnings</h3><ul>${warnings.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
  `;

  pointsBreakdownEl.classList.remove('hidden');
  if (!pointRows.length) {
    pointsBreakdownEl.innerHTML = '<h2>Point breakdown</h2><p>No point-costed cards were found.</p>';
    return;
  }

  pointRows.sort((a, b) => b.subtotal - a.subtotal || a.name.localeCompare(b.name));

  pointsBreakdownEl.innerHTML = `
    <h2>Point breakdown</h2>
    <table>
      <thead>
        <tr><th>Card</th><th>Qty</th><th>Points each</th><th>Subtotal</th></tr>
      </thead>
      <tbody>
        ${pointRows
          .map(
            (row) =>
              `<tr><td>${row.name}</td><td>${row.qty}</td><td>${row.cardPoints}</td><td>${row.subtotal}</td></tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
};

analyzeBtn.addEventListener('click', async () => {
  statusEl.className = 'status';
  statusEl.classList.remove('hidden');
  statusEl.innerHTML = '<p>Analyzing deck…</p>';

  [summaryEl, issuesEl, pointsBreakdownEl].forEach((el) => el.classList.add('hidden'));

  try {
    const result = await analyzeDeck();
    render(result);
  } catch (error) {
    statusEl.className = 'status illegal';
    statusEl.innerHTML = `<h2>Could not analyze deck</h2><p>${error.message}</p>`;
  }
});
