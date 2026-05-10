import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

const keyPath = resolve(__dirname, '.extension-key.txt');
let extensionKey: string | undefined;
try {
  extensionKey = readFileSync(keyPath, 'utf8').trim();
} catch {
  extensionKey = undefined;
}

export default defineConfig({
  srcDir: '.',
  outDir: '.output',
  manifest: {
    name: 'agent-ask-anywhere',
    short_name: 'AAA',
    description:
      'Skill generator com lobby WebSocket auto-spawn — grave fluxos, gere .skill plug-and-play.',
    minimum_chrome_version: '116',
    ...(extensionKey ? { key: extensionKey } : {}),
    permissions: [
      'scripting',
      'storage',
      'tabs',
      'activeTab',
      'debugger',
      'offscreen',
      'webNavigation',
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'agent-ask-anywhere',
      default_popup: 'popup.html',
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    web_accessible_resources: [
      {
        resources: ['recorder-overlay.css'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
