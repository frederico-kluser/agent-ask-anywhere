import {
  commandRecorder,
  getRecorderState,
  getWsStatus,
  onRecorderState,
  onStatus,
} from '../../lib/messaging.js';

const statusEl = document.getElementById('status');
const dotEl = document.getElementById('dot');
const recordBtn = document.getElementById('record-btn') as HTMLButtonElement | null;

let connected = false;
let recording = false;

function renderConnection(c: boolean): void {
  connected = c;
  if (statusEl) {
    statusEl.textContent = c ? 'Connected to localhost:8765' : 'Disconnected';
  }
  if (dotEl) {
    dotEl.className = c ? 'dot dot-on' : 'dot dot-off';
    dotEl.setAttribute('aria-label', c ? 'connected' : 'disconnected');
  }
  syncButton();
}

function renderRecording(r: boolean): void {
  recording = r;
  syncButton();
}

function syncButton(): void {
  if (!recordBtn) return;
  recordBtn.disabled = !connected;
  recordBtn.textContent = recording ? '■  Stop recording' : '●  Start recording';
  recordBtn.classList.toggle('is-recording', recording);
}

void getWsStatus().then(renderConnection);
void getRecorderState().then(renderRecording);
onStatus(renderConnection);
onRecorderState(renderRecording);

recordBtn?.addEventListener('click', () => {
  if (!connected) return;
  void commandRecorder(recording ? 'stop' : 'start');
});
