import { ExtMessageSchema } from '../lib/messaging.js';
import * as recorder from '../lib/recorder/recorder.js';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_idle',
  main() {
    const isTopFrame = window.top === window;
    console.log('[aaa/content] loaded', { url: location.href, top: isTopFrame });

    chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
      const parsed = ExtMessageSchema.safeParse(raw);
      if (!parsed.success) return false;
      const msg = parsed.data;
      if (msg.kind === 'recorder:command') {
        if (msg.cmd === 'start') recorder.start();
        else recorder.stop();
        return false;
      }
      if (msg.kind === 'recorder:get-state') {
        sendResponse({ recording: recorder.isRecording() });
        return false;
      }
      return false;
    });
  },
});
