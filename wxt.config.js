import { defineConfig } from 'wxt';
import { ORIGINS } from './lib/features.js';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Function form: lets the Firefox build get its gecko block without
  // polluting the Chromium manifest.
  manifest: ({ browser }) => ({
    name: 'BetterFTube',
    description: 'Declutter YouTube: hide Shorts, chips, comments, promos and more via toggles.',
    // storage: settings. contextMenus: right-click "Block this channel".
    // YouTube access comes from content-script `matches`, so no broad
    // host_permissions and no "read all your data on all websites" warning.
    permissions: ['storage', 'contextMenus'],
    // Opt-in features only. Requested at runtime when the user enables them, so a
    // third-party API access is optional; YouTube content-script access remains declared.
    optional_host_permissions: Object.values(ORIGINS),
    // Defaults only; users rebind at chrome://extensions/shortcuts
    // (Firefox: about:addons → gear → Manage Extension Shortcuts).
    commands: {
      'toggle-enabled': { suggested_key: { default: 'Alt+Shift+Y' }, description: 'Turn BetterFTube on/off' },
      'cycle-preset': { suggested_key: { default: 'Alt+Shift+P' }, description: 'Switch to the next preset' },
      'pick-element': { suggested_key: { default: 'Alt+Shift+H' }, description: 'Pick an element to hide' },
    },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        // A fixed id is required for storage to persist across reinstalls and for
        // permanent unsigned installs (xpinstall.signatures.required=false).
        // 128 = first version with MAIN-world content scripts.
        gecko: {
          id: 'betterftube@local',
          strict_min_version: '128.0',
          // Required for new Firefox extensions since 2025-11. We collect nothing.
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
