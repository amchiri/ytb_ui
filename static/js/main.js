const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-content');
const logsEl = document.getElementById('logs');
const statusEl = document.getElementById('jobStatus');
const clearLogsBtn = document.getElementById('clearLogsBtn');
const modeSelect = document.getElementById('modeSelect');
const outputTemplateEl = document.getElementById('outputTemplate');

clearLogsBtn.addEventListener('click', async () => {
  logsEl.textContent = '';
  if (statusEl.textContent === 'done' || statusEl.textContent === 'error') {
    setStatus('idle');
  }
  try {
    await fetch('/api/clear-jobs', { method: 'POST' });
  } catch (err) {
    console.error('Clear jobs error:', err);
  }
});

const urlInput = document.getElementById('urlInput');
const downloadFromUrlBtn = document.getElementById('downloadFromUrlBtn');
const downloadFromUrlBlobBtn = document.getElementById('downloadFromUrlBlobBtn');

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchResults = document.getElementById('searchResults');
const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');
const downloadSelectedBlobBtn = document.getElementById('downloadSelectedBlobBtn');
const selectedLabel = document.getElementById('selectedLabel');

let currentJobId = null;
let pollTimer = null;
let lastSearchItems = [];
let selectedItemUrl = '';

function setStatus(status) {
  statusEl.textContent = status;
  statusEl.className = `pill ${status}`;
}

function appendLog(text) {
  logsEl.textContent = `${logsEl.textContent}${text}\n`;
  logsEl.scrollTop = logsEl.scrollHeight;
}

function formatDuration(seconds) {
  const sec = Number(seconds) || 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getOutputTemplate() {
  if (modeSelect.value === 'mp3_advanced') {
    return '%(artist)s - %(title)s.%(ext)s';
  }
  return outputTemplateEl.value.trim();
}

function lockOutputTemplate() {
  if (modeSelect.value === 'mp3_advanced') {
    outputTemplateEl.value = '%(artist)s - %(title)s.%(ext)s';
    outputTemplateEl.disabled = true;
  } else {
    outputTemplateEl.disabled = false;
  }
}

async function startDownload(url) {
  if (!url) {
    appendLog('Error: URL is empty.');
    return;
  }

  setStatus('running');
  logsEl.textContent = '';
  appendLog(`Initialisation du telechargement pour: ${url}`);

  const payload = {
    url,
    mode: modeSelect.value,
    output_template: getOutputTemplate(),
  };

  try {
    const response = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      setStatus('error');
      appendLog(data.error || 'Download API error');
      return;
    }

    currentJobId = data.job_id;
    pollJob();
  } catch (err) {
    setStatus('error');
    appendLog(`Network error: ${err}`);
  }
}

async function startBlobDownload(url, sourceButton = null) {
  if (!url) {
    appendLog('Error: URL is empty.');
    return;
  }

  setStatus('running');
  logsEl.textContent = '';
  appendLog('Preparation du Blob (cela peut prendre du temps)...');

  if (sourceButton) {
    sourceButton.disabled = true;
    sourceButton.textContent = 'Traitement...';
  }

  const payload = {
    url,
    mode: modeSelect.value,
    output_template: getOutputTemplate(),
  };

  try {
    const response = await fetch('/api/download-blob', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errorText = 'Blob download API error';
      try {
        const data = await response.json();
        if (data.error) {
          errorText = data.error;
          if (data.logs) {
            errorText += `\n--- Détails ---\n${data.logs}`;
          }
        }
      } catch (_ignored) {
        // Ignore JSON parsing errors for non-JSON response bodies.
      }
      setStatus('error');
      appendLog(errorText);
      return;
    }

    appendLog('Fichier pret ! Demarrage du transfert vers le navigateur...');
    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);

    const contentDisposition = response.headers.get('Content-Disposition') || '';
    const matchQuoted = contentDisposition.match(/filename="([^"]+)"/i);
    const matchSimple = contentDisposition.match(/filename=([^;]+)/i);
    const fileName = (matchQuoted && matchQuoted[1]) || (matchSimple && matchSimple[1]) || 'download.bin';

    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    window.URL.revokeObjectURL(objectUrl);

    setStatus('done');
    appendLog(`Blob telecharge avec succes: ${fileName}`);
  } catch (err) {
    setStatus('error');
    appendLog(`Blob error: ${err}`);
  } finally {
    if (sourceButton) {
      sourceButton.disabled = false;
      sourceButton.textContent = sourceButton.classList.contains('ghost') ? 'Blob' : 'Telecharger blob selection';
    }
  }
}

async function pollJob() {
  if (!currentJobId) {
    return;
  }

  try {
    const response = await fetch(`/api/job/${currentJobId}`);
    const data = await response.json();

    if (!response.ok) {
      setStatus('error');
      appendLog(data.error || 'Job not found');
      return;
    }

    setStatus(data.status || 'idle');
    logsEl.textContent = (data.logs || []).join('\n');
    logsEl.scrollTop = logsEl.scrollHeight;

    if (data.status === 'running' || data.status === 'queued') {
      pollTimer = setTimeout(pollJob, 1100);
    }
  } catch (err) {
    setStatus('error');
    appendLog(`Poll error: ${err}`);
  }
}

async function searchYouTube() {
  const query = searchInput.value.trim();
  if (!query) {
    appendLog('Error: search query is empty.');
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = 'Recherche...';
  searchResults.innerHTML = '';

  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();
    if (!response.ok) {
      appendLog(data.error || 'Search API error');
      return;
    }

    renderResults(data.items || []);
  } catch (err) {
    appendLog(`Search error: ${err}`);
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Chercher';
  }
}

function setSelectedItem(item) {
  if (!item || !item.url) {
    selectedItemUrl = '';
    selectedLabel.textContent = 'Aucune video selectionnee.';
    downloadSelectedBtn.disabled = true;
    downloadSelectedBlobBtn.disabled = true;
    return;
  }

  selectedItemUrl = item.url;
  selectedLabel.textContent = `Selection: ${item.title}`;
  downloadSelectedBtn.disabled = false;
  downloadSelectedBlobBtn.disabled = false;

  document.querySelectorAll('.result-item').forEach((card) => {
    card.classList.toggle('selected', card.dataset.url === selectedItemUrl);
  });
}

function renderResults(items) {
  lastSearchItems = items;

  if (!items.length) {
    searchResults.innerHTML = '<p class="hint">Aucun resultat.</p>';
    setSelectedItem(null);
    return;
  }

  const pickThumbnail = (item) => {
    if (item.thumbnail && item.thumbnail.trim()) {
      return item.thumbnail;
    }
    if (item.id) {
      return `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;
    }
    return '';
  };

  searchResults.innerHTML = items
    .map(
      (item, index) => `
        <article class="result-item" data-url="${item.url}">
          <img src="${pickThumbnail(item)}" alt="Miniature video" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${item.id || ''}/hqdefault.jpg';" />
          <div class="result-main">
            <h3>${item.title}</h3>
            <p>${item.uploader} | ${formatDuration(item.duration)} | ${Number(item.views || 0).toLocaleString()} vues</p>
          </div>
          <div class="result-actions">
            <button class="select-btn" data-index="${index}">Choisir</button>
            <button class="download-btn" data-index="${index}">Telecharger</button>
            <button class="blob-btn" data-index="${index}">Blob</button>
          </div>
        </article>
      `,
    )
    .join('');

  searchResults.querySelectorAll('button.select-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.index);
      setSelectedItem(lastSearchItems[index]);
    });
  });

  searchResults.querySelectorAll('button.download-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.index);
      const item = lastSearchItems[index];
      if (!item) {
        appendLog('Error: item introuvable.');
        return;
      }
      setSelectedItem(item);
      startDownload(item.url);
    });
  });

  searchResults.querySelectorAll('button.blob-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.index);
      const item = lastSearchItems[index];
      if (!item) {
        appendLog('Error: item introuvable.');
        return;
      }
      setSelectedItem(item);
      startBlobDownload(item.url, button);
    });
  });
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    panels.forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.target).classList.add('active');
  });
});

modeSelect.addEventListener('change', lockOutputTemplate);
lockOutputTemplate();

downloadFromUrlBtn.addEventListener('click', () => startDownload(urlInput.value.trim()));
downloadFromUrlBlobBtn.addEventListener('click', () => startBlobDownload(urlInput.value.trim(), downloadFromUrlBlobBtn));
searchBtn.addEventListener('click', searchYouTube);
downloadSelectedBtn.addEventListener('click', () => startDownload(selectedItemUrl));
downloadSelectedBlobBtn.addEventListener('click', () => startBlobDownload(selectedItemUrl, downloadSelectedBlobBtn));

urlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    startDownload(urlInput.value.trim());
  }
});

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    searchYouTube();
  }
});
