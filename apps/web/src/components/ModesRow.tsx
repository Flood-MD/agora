import { activeSlots, leaderSlot, MAX_SELF_CHAT_ROUNDS, slotDisplayName } from '@agora/shared';
import { useState } from 'react';
import { useStore } from '../store';
import { ArrowUpIcon, CrownIcon, FusionIcon, LockIcon, LoopIcon, MinusIcon, PlusIcon } from './icons';
import { Popover } from './Popover';

const toggle = (on: boolean) => `btn px-2.5 py-1 text-xs ${on ? 'btn-primary' : ''}`;

/**
 * Under the composer: who the message goes to, and the conversation modes
 * (collapsible into a single + with the `-` button, remembered per device).
 */
export function ModesRow({
  target,
  setTarget,
  takeTopic,
}: {
  target: string;
  setTarget: (id: string) => void;
  /** Returns the composer text (used as the Self-Chat topic) and clears it. */
  takeTopic: () => string;
}) {
  const config = useStore((s) => s.session?.config);
  const running = useStore((s) => s.session?.running ?? false);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const updateConfig = useStore((s) => s.updateConfig);
  const selfChat = useStore((s) => s.selfChat);
  const [open, setOpen] = useState<'leader' | 'self-chat' | null>(null);
  const [rounds, setRounds] = useState(prefs.selfChatRounds);

  if (!config) return null;
  const slots = activeSlots(config);
  const leader = leaderSlot(config);
  const startSelfChat = async () => {
    const n = Math.min(MAX_SELF_CHAT_ROUNDS, Math.max(1, Math.round(rounds) || 1));
    setPrefs({ selfChatRounds: n });
    setOpen(null);
    await selfChat(n, takeTopic() || undefined);
  };

  return (
    <div className="mx-auto mt-2 flex max-w-3xl flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs text-muted">
        To
        <select
          className="field w-auto max-w-40 py-1 text-xs"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Send to"
        >
          <option value="">Everyone</option>
          {slots.map((s) => (
            <option key={s.id} value={s.id}>
              {slotDisplayName(s)}
            </option>
          ))}
        </select>
      </label>
      {target && (
        <div className="flex overflow-hidden rounded-md text-xs" role="group" aria-label="Visibility">
          <button
            className={`px-2.5 py-1 ${!prefs.privateDm ? 'bg-accent text-white' : 'bg-panel-2 text-slate-300'}`}
            aria-pressed={!prefs.privateDm}
            onClick={() => setPrefs({ privateDm: false })}
            title="The other models will see this message and the reply"
          >
            Visible
          </button>
          <button
            className={`flex items-center gap-1 px-2.5 py-1 ${
              prefs.privateDm ? 'bg-accent text-white' : 'bg-panel-2 text-slate-300'
            }`}
            aria-pressed={prefs.privateDm}
            onClick={() => setPrefs({ privateDm: true })}
            title="Only this model will ever see the message and its reply"
          >
            <LockIcon size={12} /> Private
          </button>
        </div>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button
          className="btn size-7 p-0"
          onClick={() => setPrefs({ modesCollapsed: !prefs.modesCollapsed })}
          aria-label={prefs.modesCollapsed ? 'Show mode buttons' : 'Hide mode buttons'}
          aria-expanded={!prefs.modesCollapsed}
        >
          {prefs.modesCollapsed ? <PlusIcon size={14} /> : <MinusIcon size={14} />}
        </button>
        {!prefs.modesCollapsed && (
          <>
            <button
              className={toggle(!!config.fusion)}
              aria-pressed={!!config.fusion}
              onClick={() =>
                updateConfig((c) => ({ ...c, fusion: !c.fusion, leader: c.fusion ? c.leader : false }))
              }
              title="After everyone answers, slot 1's model merges the answers into one"
            >
              <FusionIcon size={14} /> Fusion
            </button>

            <div className="relative flex">
              <button
                className={`${toggle(!!config.leader)} rounded-r-none`}
                aria-pressed={!!config.leader}
                onClick={() =>
                  updateConfig((c) => ({ ...c, leader: !c.leader, fusion: c.leader ? c.fusion : false }))
                }
                title={`The others answer first, then ${leader ? slotDisplayName(leader) : 'the leader'} gives the final answer`}
              >
                <CrownIcon size={14} /> Leader
              </button>
              <button
                className={`${toggle(!!config.leader)} rounded-l-none border-l border-black/20 px-2`}
                onClick={() => setOpen(open === 'leader' ? null : 'leader')}
                aria-label="Choose the leader"
                aria-expanded={open === 'leader'}
              >
                <ArrowUpIcon size={14} />
              </button>
              {open === 'leader' && (
                <Popover label="Choose the leader" onClose={() => setOpen(null)}>
                  <p className="mb-2 text-xs font-semibold">Leader</p>
                  {slots.length === 0 && <p className="text-xs text-muted">Add models first.</p>}
                  {slots.map((s) => (
                    <label
                      key={s.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-panel-2"
                    >
                      <input
                        type="radio"
                        name="leader"
                        className="accent-blue-500"
                        checked={leader?.id === s.id}
                        onChange={() => {
                          updateConfig((c) => ({ ...c, leaderSlotId: s.id, leader: true, fusion: false }));
                          setOpen(null);
                        }}
                      />
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                      <span className="truncate">{slotDisplayName(s)}</span>
                    </label>
                  ))}
                </Popover>
              )}
            </div>

            <div className="relative">
              <button
                className="btn px-2.5 py-1 text-xs"
                onClick={() => setOpen(open === 'self-chat' ? null : 'self-chat')}
                disabled={running || slots.length === 0}
                aria-expanded={open === 'self-chat'}
                title="Let the models talk among themselves"
              >
                <LoopIcon size={14} /> Self-Chat!
              </button>
              {open === 'self-chat' && (
                <Popover label="Self-Chat" onClose={() => setOpen(null)}>
                  <p className="mb-1 text-xs font-semibold">Self-Chat</p>
                  <p className="mb-3 text-xs text-muted">
                    The models take turns talking among themselves. Text in the message box is posted first as
                    the topic. Stop ends it early.
                  </p>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      Rounds
                      <input
                        type="number"
                        min={1}
                        max={MAX_SELF_CHAT_ROUNDS}
                        className="field w-16 py-1"
                        value={rounds}
                        onChange={(e) => setRounds(Number(e.target.value))}
                      />
                    </label>
                    <button className="btn btn-primary ml-auto" onClick={() => void startSelfChat()}>
                      Start
                    </button>
                  </div>
                </Popover>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
