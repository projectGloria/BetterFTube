import { defineContentScript } from 'wxt/utils/define-content-script';
import { isOn, onAttrChange, onNavigate, valueOf } from '../lib/dom.js';

// MAIN world = YouTube's own JS context. Required because the player API
// (getAvailableQualityLevels, setPlaybackQualityRange…) lives as expando methods
// on #movie_player, and isolated-world scripts see the bare DOM element only.
// Trade-off: no `browser.*` here, which is why settings arrive via <html> attrs.
export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  runAt: 'document_start',
  world: 'MAIN',

  main() {
    // Highest → lowest. 'auto' is deliberately absent: it's never a target.
    const ORDER = ['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
    let appliedFor = null; // video id we already set quality on

    const applyQuality = () => {
      const target = isOn('default-quality') && valueOf('default-quality');
      if (!target) return;
      const player = document.getElementById('movie_player');
      if (typeof player?.getAvailableQualityLevels !== 'function') return;
      // Pre-roll ads have their own (lower) levels; setting quality there gets
      // reset when the real video starts, so wait for it.
      if (player.classList.contains('ad-showing')) return;

      const videoId = player.getVideoData?.()?.video_id;
      if (!videoId || videoId === appliedFor) return;
      const levels = player.getAvailableQualityLevels().filter((q) => q !== 'auto');
      if (!levels.length) return; // metadata not loaded yet; a later event retries

      // Best available at or below the target. If even the lowest is above it
      // (rare), take the lowest available rather than doing nothing.
      const pick =
        target === 'max'
          ? levels[0]
          : (ORDER.slice(ORDER.indexOf(target)).find((q) => levels.includes(q)) ?? levels.at(-1));

      player.setPlaybackQualityRange?.(pick, pick);
      player.setPlaybackQuality?.(pick); // legacy no-op on new players, harmless
      appliedFor = videoId;
    };

    // Speed: per-channel override (published by the isolated world as
    // data-bft-channel-speed, see lib/behaviors.js) beats the default-speed setting.
    // player.setPlaybackRate, not video.playbackRate: setting the element directly
    // works but leaves YouTube's own speed menu showing the wrong value.
    let speedFor = null;
    const applySpeed = () => {
      if (!isOn('on')) return;
      const rate = Number(isOn('remember-speed') && valueOf('channel-speed')) || Number(isOn('default-speed') && valueOf('default-speed')) || 0;
      if (!rate) return; // nothing configured: leave YouTube's own choice alone
      const player = document.getElementById('movie_player');
      if (typeof player?.setPlaybackRate !== 'function' || player.classList.contains('ad-showing')) return;
      const videoId = player.getVideoData?.()?.video_id;
      if (!videoId || videoId === speedFor) return;
      document.dispatchEvent(new Event('bft:rate-applying'));
      player.setPlaybackRate(rate);
      speedFor = videoId;
    };

    const applyAll = () => {
      const data = document.getElementById('movie_player')?.getVideoData?.();
      for (const [name, value] of [['video-id', data?.video_id], ['channel-id', data?.channel_id]]) {
        const attr = `data-bft-${name}`;
        if (value && document.documentElement.getAttribute(attr) !== value) document.documentElement.setAttribute(attr, value);
        else if (!value) document.documentElement.removeAttribute(attr);
      }
      applyQuality();
      applySpeed();
    };

    // Media events don't bubble, but they DO capture → one listener on document
    // catches every <video> YouTube creates or recycles.
    document.addEventListener('loadeddata', applyAll, true);
    document.addEventListener('yt-navigate-start', () => {
      appliedFor = null; speedFor = null;
      document.documentElement.removeAttribute('data-bft-video-id');
      document.documentElement.removeAttribute('data-bft-channel-id');
    });
    onNavigate(applyAll);
    document.addEventListener('playing', applyAll, true);
    // Changing a setting in the popup → re-apply to the current video.
    onAttrChange(['default-quality'], () => {
      appliedFor = null;
      applyQuality();
    });
    onAttrChange(['default-speed', 'channel-speed'], () => {
      speedFor = null;
      applySpeed();
    });
  },
});
