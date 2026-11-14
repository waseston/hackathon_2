// Greener and healthier tips, picked from today's numbers.

import { fmtDuration } from './format.js';

export function tipsFor(today, settings, week) {
  const tips = [];
  const goal = settings.dailyGoalMinutes * 60;

  if (today.prompts >= 15) {
    tips.push({
      icon: '✍️',
      text: `You sent ${today.prompts} AI prompts today. One clear prompt with all the context often replaces three or four follow-ups, and each prompt is a full request to a data centre.`,
    });
  }
  const thanks = today.aiBySite.some((r) => r.prompts >= 5);
  if (thanks) {
    tips.push({ icon: '🙏', text: 'A "thanks!" message is a whole new prompt. Say thanks in your next real question instead.' });
  }
  if (today.aiSec > 10 * 60 && today.prompts === 0) {
    tips.push({
      icon: '🔎',
      text: `Wattch saw ${fmtDuration(today.aiSec)} on AI sites but no prompts. If it missed some, use the "+1 prompt" button in the popup or on the page.`,
    });
  }
  if (goal && today.activeSec > goal) {
    tips.push({ icon: '⏳', text: `You are ${fmtDuration(today.activeSec - goal)} over your daily goal. A short walk is a good reset.` });
  } else if (goal && today.activeSec > goal * 0.8) {
    tips.push({ icon: '⏳', text: `Only ${fmtDuration(goal - today.activeSec)} left before your daily goal.` });
  }
  const late = [23, 0, 1, 2, 3, 4].reduce((s, h) => s + (today.hours[h] || 0), 0);
  if (late > 20 * 60) {
    tips.push({ icon: '🌙', text: `${fmtDuration(late)} of browsing after 23:00. Late screens push sleep back; try a "no screens after 23:00" rule.` });
  }
  const top = today.topSites[0];
  if (top && today.activeSec > 30 * 60 && top.sec / today.activeSec > 0.4 && !top.ai) {
    tips.push({ icon: '📌', text: `${top.host} took ${Math.round((top.sec / today.activeSec) * 100)}% of your browser time today. Was that on purpose?` });
  }
  if (week && week.thisWeek.prompts > week.lastWeek.prompts * 1.3 && week.lastWeek.prompts > 10) {
    tips.push({ icon: '📈', text: 'Your AI use is up more than 30% on last week. Check whether every prompt was worth it.' });
  }
  // evergreen tips
  const evergreen = [
    { icon: '🖼️', text: 'Images, video, file uploads and "deep research" cost far more than the short text prompts Wattch counts. Use them when they really help.' },
    { icon: '📏', text: 'Ask for short answers ("in 3 bullet points") when that is all you need. Longer answers use more computing.' },
    { icon: '🔁', text: 'Regenerating an answer five times is five prompts. Rewrite your question instead.' },
    { icon: '🗂️', text: 'Close tabs you are not using. Fewer open tabs means less memory and battery used on your laptop.' },
    { icon: '🔆', text: 'Lower your screen brightness a little: the screen is one of the biggest power users on a laptop.' },
  ];
  const day = new Date().getDate();
  tips.push(evergreen[day % evergreen.length]);
  return tips.slice(0, 4);
}
