import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { fetchDislikes, fetchSegments, isVideoId } from '../lib/api.js';
import { ORIGINS } from '../lib/features.js';
import { applyPreset, nextPreset } from '../lib/presets.js';
import { loadSettings, normalize, saveSettings } from '../lib/settings.js';
import { applyChanges, serialQueue } from '../lib/mutations.js';
import { normalizeSpeeds, writeSpeed } from '../lib/speeds.js';

const enqueue = serialQueue();
const updateSettings = fn => enqueue(async () => {
  const next = normalize(fn(await loadSettings()));
  await saveSettings(next);
  return next;
});

// Service worker: context menu, keyboard shortcuts, and the opt-in network
// calls. MV3 workers die after ~30s idle, so no state lives here beyond a
// disposable cache; every listener is registered synchronously at top level so
// a worker woken by an event finds it on first run.

const SB_CATEGORIES = new Set(['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'filler']);

async function activeTabId() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

// Fire-and-forget to a tab's content script. Rejects when the tab isn't
// YouTube (no receiver); that's expected, not an error.
const toTab = (tabId, msg) => browser.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => null);

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    // removeAll first: on update, create() with an existing id throws.
    // Promise form, not callback: Firefox's browser.* ignores callbacks entirely.
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: 'bft-block-channel',
      title: 'Block this channel',
      // 'link' + 'image' cover thumbnails and titles; 'page' covers the
      // channel-name text on the watch page.
      contexts: ['link', 'image', 'page'],
      documentUrlPatterns: ['*://www.youtube.com/*'],
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== 'bft-block-channel' || tab?.id == null) return;
    toTab(tab.id, { type: 'bft:block-channel' });
  });

  // Keyboard shortcuts (rebind at chrome://extensions/shortcuts)
  browser.commands.onCommand.addListener(async (command) => {
    const tabId = await activeTabId();
    if (command === 'toggle-enabled') {
      const s = await updateSettings((s) => ({ ...s, enabled: !s.enabled }));
      if (tabId != null) toTab(tabId, { type: 'bft:toast', text: `BetterFTube ${s.enabled ? 'on' : 'off'}` });
    } else if (command === 'cycle-preset') {
      let name;
      await updateSettings((s) => {
        const p = nextPreset(s);
        name = p.name;
        return applyPreset(s, p);
      });
      if (tabId != null) toTab(tabId, { type: 'bft:toast', text: `Preset: ${name}` });
    } else if (command === 'pick-element' && tabId != null) {
      toTab(tabId, { type: 'bft:pick' });
    }
  });

  const refreshPermissions = async () => {
    for (const tab of await browser.tabs.query({})) {
      if (tab.id != null) toTab(tab.id, { type: 'bft:online-refresh' });
    }
  };
  browser.permissions.onAdded.addListener(refreshPermissions);
  browser.permissions.onRemoved.addListener(refreshPermissions);

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;
    const extensionPage = sender.url?.startsWith(browser.runtime.getURL(''));
    const youtube = sender.url?.startsWith('https://www.youtube.com/');
    if (!extensionPage && !youtube) return false;
    let job;
    if (msg?.type === 'bft:settings-change') {
      job = updateSettings(s => applyChanges(s, msg.changes)).then(settings => ({ ok: true, settings }));
    } else if (msg?.type === 'bft:settings-replace' && extensionPage) {
      job = enqueue(async () => {
        const settings = normalize(msg.settings);
        // One storage write commits both backup parts together.
        await browser.storage.local.set({ 'bft:settings': settings,
          ...(msg.speeds === undefined ? {} : { 'bft:speeds': normalizeSpeeds(msg.speeds) }) });
        return { ok: true, settings };
      });
    } else if (msg?.type === 'bft:speed') {
      job = enqueue(() => writeSpeed(msg.channel, msg.rate)).then(() => ({ ok: true }));
    } else if (youtube && isVideoId(msg?.videoId)) {
      if (msg.type === 'bft:sb-segments') {
        job = withFeature('sponsorblock', async s => {
          const cats = s.features.sponsorblock.split(',').filter(c => SB_CATEGORIES.has(c));
          return { ok: true, segments: await fetchSegments(msg.videoId, cats) };
        });
      } else if (msg.type === 'bft:dislikes') {
        job = withFeature('dislikes', async () => ({ ok: true, dislikes: await fetchDislikes(msg.videoId) }));
      }
    }
    if (!job) return false;
    job.then(sendResponse, err => sendResponse({ ok: false, error: String(err.message ?? err) }));
    return true;
  });
});

async function withFeature(id, fn) {
  const settings = await loadSettings();
  if (!settings.enabled || !settings.features[id] || settings.features[id] === 'off') throw new Error('Feature disabled');
  if (!(await browser.permissions.contains({ origins: [ORIGINS[id]] }))) throw new Error('Permission needed');
  return fn(settings);
}
