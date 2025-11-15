const { ipcRenderer } = require('electron');
const AudioCapture = require('./audio-capture');
const APIClient = require('./api-client');

let audioCapture;
let apiClient;
let isJoined = false;

// We'll query DOM after DOMContentLoaded to avoid null elements
document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements (queried after DOM ready)
  const zoomLinkInput = document.getElementById('zoom-link');
  const joinBtn = document.getElementById('join-btn');
  const leaveBtn = document.getElementById('leave-btn');
  const statusDiv = document.getElementById('status');
  const chatDiv = document.getElementById('chat');
  const responsesDiv = document.getElementById('responses');
  const userNameEl = document.getElementById('user-name');

  // Basic sanity: ensure required DOM elements exist
  if (!zoomLinkInput || !joinBtn || !leaveBtn || !statusDiv || !chatDiv || !responsesDiv || !userNameEl) {
    console.error('One or more required DOM elements are missing.');
    return;
  }

  // Initialize UI state
  joinBtn.disabled = false;
  leaveBtn.disabled = true;
  setStatus('Not connected', 'idle');

  // Initialize app (load settings / user)
  try {
    const settings = await ipcRenderer.invoke('get-settings');
    apiClient = new APIClient(settings.apiUrl);

    // Load user session from web dashboard (guarded)
    let user = null;
    try {
      user = await apiClient.getUser();
    } catch (err) {
      console.warn('Could not load user from API:', err);
    }
    userNameEl.textContent = (user && user.full_name) ? user.full_name : 'Guest';

    // Attach handlers
    joinBtn.addEventListener('click', () => joinMeeting({ zoomLinkInput, joinBtn, leaveBtn, statusDiv }));
    leaveBtn.addEventListener('click', () => leaveMeeting({ joinBtn, leaveBtn, statusDiv }));
  } catch (err) {
    console.error('Initialization error:', err);
    setStatus(`Error initializing app: ${err.message || err}`, 'error');
    joinBtn.disabled = true;
  }

  // Listen to events from main process
  ipcRenderer.on('chat-message', (event, data) => {
    addChatMessage(chatDiv, data);
  });

  ipcRenderer.on('transcript', (event, data) => {
    addChatMessage(chatDiv, {
      sender: 'Transcript',
      message: data.text,
      timestamp: data.timestamp || Date.now()
    });
  });

  ipcRenderer.on('ai-response', (event, data) => {
    addAIResponse(responsesDiv, data);
  });
});

// joinMeeting expects an object with the DOM elements it needs
async function joinMeeting(elements) {
  const { zoomLinkInput, joinBtn, leaveBtn, statusDiv } = elements;
  const zoomLink = zoomLinkInput.value.trim();
  if (!zoomLink) {
    alert('Please enter a Zoom link');
    return;
  }

  setStatus('Joining meeting...', 'loading', statusDiv);
  joinBtn.disabled = true;

  try {
    // Create session in backend
    const session = await apiClient.createSession({
      name: `Desktop Session ${new Date().toLocaleString()}`,
      mode: 'zoom'
    });

    // Join Zoom via main process
    const apiKey = await apiClient.getApiKey();
    const result = await ipcRenderer.invoke('join-zoom', {
      zoomLink,
      sessionId: session.id,
      apiKey
    });

    if (result && result.success) {
      isJoined = true;
      setStatus('Connected - Monitoring chat & audio', 'success', statusDiv);
      leaveBtn.disabled = false;
      joinBtn.disabled = true;

      // Start audio capture
      audioCapture = new AudioCapture();
      audioCapture.start((audioData) => {
        // Fire-and-forget transcription; catch internal errors inside apiClient if needed
        try {
          apiClient.transcribeAudio(session.id, audioData);
        } catch (err) {
          console.error('transcribeAudio error:', err);
        }
      });
    } else {
      // result may contain .error
      const msg = result && result.error ? result.error : 'Unknown error joining Zoom';
      throw new Error(msg);
    }
  } catch (error) {
    console.error('joinMeeting error:', error);
    setStatus(`Error: ${error.message || error}`, 'error', statusDiv);
    joinBtn.disabled = false;
    leaveBtn.disabled = true;
  }
}

async function leaveMeeting(elements) {
  const { joinBtn, leaveBtn, statusDiv } = elements || {};
  setStatus('Leaving meeting...', 'loading', statusDiv);

  try {
    if (audioCapture && typeof audioCapture.stop === 'function') {
      try {
        audioCapture.stop();
      } catch (err) {
        console.warn('audioCapture.stop() threw:', err);
      }
      audioCapture = null;
    }

    await ipcRenderer.invoke('leave-zoom');

    isJoined = false;
    setStatus('Not connected', 'idle', statusDiv);
    joinBtn.disabled = false;
    leaveBtn.disabled = true;
  } catch (err) {
    console.error('leaveMeeting error:', err);
    setStatus(`Error leaving meeting: ${err.message || err}`, 'error', statusDiv);
  }
}

function setStatus(text, type, statusDiv) {
  if (!statusDiv) {
    statusDiv = document.getElementById('status');
    if (!statusDiv) return;
  }
  statusDiv.textContent = text;
  statusDiv.className = `status status-${type}`;
}

function addChatMessage(chatDiv, data) {
  if (!chatDiv) {
    chatDiv = document.getElementById('chat');
    if (!chatDiv) return;
  }
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.innerHTML = `
    <div class="sender">${escapeHtml(data.sender || 'Unknown')}</div>
    <div class="content">${escapeHtml(data.message || '')}</div>
    <div class="time">${new Date(data.timestamp || Date.now()).toLocaleTimeString()}</div>
  `;
  chatDiv.appendChild(div);
  chatDiv.scrollTop = chatDiv.scrollHeight;
}

function addAIResponse(responsesDiv, data) {
  if (!responsesDiv) {
    responsesDiv = document.getElementById('responses');
    if (!responsesDiv) return;
  }
  const confidenceClass = (typeof data.confidence === 'number' && data.confidence >= 70) ? 'high' : 'low';
  const div = document.createElement('div');
  div.className = `ai-response confidence-${confidenceClass}`;
  div.innerHTML = `
    <div class="question">Q: ${escapeHtml(data.question || '')}</div>
    <div class="answer">A: ${escapeHtml(data.answer || '')}</div>
    <div class="confidence">Confidence: ${escapeHtml((data.confidence !== undefined) ? String(data.confidence) : 'N/A')}%</div>
  `;
  responsesDiv.appendChild(div);
  responsesDiv.scrollTop = responsesDiv.scrollHeight;
}

// Simple HTML-escape helper to avoid injecting raw HTML
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
