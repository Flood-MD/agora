import { useState } from 'react';
import { Popover } from './Popover';

const RECENT_KEY = 'agora.emoji.recent';
const MAX_RECENT = 16;

/** A small built-in set, so no emoji library is needed. */
const GROUPS: { label: string; emojis: string }[] = [
  {
    label: 'Smileys',
    emojis:
      '😀 😃 😄 😁 😆 😅 😂 🤣 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😜 🤪 🤔 🤨 😐 😑 😶 🙄 😏 😬 😌 😴 🤯 🥳 😎 🤓 🧐 😕 😟 😮 😲 😳 🥺 😢 😭 😤 😠 😡 🤬 😱 😨 🤗 🤭 🫡 🤫',
  },
  {
    label: 'Gestures',
    emojis: '👍 👎 👌 ✌️ 🤞 🤟 🤘 👏 🙌 👐 🤝 🙏 💪 👋 🤙 👉 👈 👆 👇 ☝️ ✋ 🖐️ 🫶 ✍️ 👀 🧠 🫠',
  },
  {
    label: 'Symbols',
    emojis: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ✨ ⭐ 🌟 💯 🔥 ⚡ 💥 💡 ✅ ❌ ⚠️ ❓ ❗ ➕ ➖ ➡️ ⬅️ 🔁 🎯 🏆 🎉 🎊',
  },
  {
    label: 'Objects',
    emojis:
      '💻 🖥️ ⌨️ 📱 📷 🎧 🎮 📚 📖 📝 ✏️ 📌 📎 🔍 🔑 🔒 🧩 🛠️ ⚙️ 🧪 🔬 📈 📉 📊 🗂️ 📅 ⏰ ☕ 🍕 🍔 🍰 🍺 🍷',
  },
  {
    label: 'Nature',
    emojis: '🌍 🌙 ☀️ 🌈 ☁️ 🌧️ ❄️ 🌊 🌱 🌳 🌸 🌻 🍀 🍁 🐶 🐱 🦊 🐻 🐼 🐸 🐵 🦉 🐙 🦄 🐝 🦋 🐢 🐍',
  },
];

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** The emoji button: inserts emojis into the message box at the cursor. */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState(loadRecent);
  const [group, setGroup] = useState(() => (loadRecent().length ? -1 : 0));

  const pick = (emoji: string) => {
    onPick(emoji);
    const next = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, MAX_RECENT);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable: recents just won't persist on this device.
    }
  };

  const emojis = group === -1 ? recent : GROUPS[group]!.emojis.split(' ');

  return (
    <div className="relative">
      <button
        className="btn size-7 p-0 text-base"
        onClick={() => setOpen((o) => !o)}
        aria-label="Emoji"
        aria-expanded={open}
        title="Insert an emoji"
      >
        😊
      </button>
      {open && (
        <Popover label="Emoji" onClose={() => setOpen(false)} align="right" className="w-72 p-2">
          <div className="mb-2 flex flex-wrap gap-1" role="tablist">
            {recent.length > 0 && (
              <button
                role="tab"
                aria-selected={group === -1}
                className={`rounded px-2 py-0.5 text-[11px] ${group === -1 ? 'bg-accent text-white' : 'bg-panel-2 text-slate-300'}`}
                onClick={() => setGroup(-1)}
              >
                Recent
              </button>
            )}
            {GROUPS.map((g, i) => (
              <button
                key={g.label}
                role="tab"
                aria-selected={group === i}
                className={`rounded px-2 py-0.5 text-[11px] ${group === i ? 'bg-accent text-white' : 'bg-panel-2 text-slate-300'}`}
                onClick={() => setGroup(i)}
              >
                {g.label}
              </button>
            ))}
          </div>
          <div className="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto" data-testid="emoji-grid">
            {emojis.map((e) => (
              <button
                key={e}
                className="rounded p-1 text-xl leading-none hover:bg-panel-2"
                onClick={() => pick(e)}
                aria-label={`Insert ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
