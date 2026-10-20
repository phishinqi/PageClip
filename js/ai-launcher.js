import { getLocale } from './i18n.js';
export const aiText = (zh, en) => getLocale() === 'en' ? en : zh;
export async function openAiOrganizer(ids) {
  await navigator.locks.request('pageclip-ai-launch', async () => {
    const url = chrome.runtime.getURL('ai-organizer.html');
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find(tab => tab.url?.split('?')[0] === url);
    await chrome.storage.session.set({ pageclip_ai_launch: { ids: [...new Set(ids)], createdAt: Date.now() } });
    if (existing) { await chrome.tabs.update(existing.id, { active: true }); return; }
    await chrome.tabs.create({ url });
  });
}
