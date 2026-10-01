import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { FileIcon, FolderIcon, GithubIcon, LockIcon, MicIcon, PaperclipIcon, PlayIcon } from './icons';
import { Modal } from './Modal';
import { Popover } from './Popover';

/** Folder uploads skip dependencies, build output, VCS data and very large files. */
const IGNORED_PATH =
  /(^|\/)(node_modules|\.git|dist|build|out|target|vendor|\.next|\.nuxt|coverage|__pycache__|\.venv|venv|\.idea|\.vscode)(\/|$)/;
const IGNORED_FILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.DS_Store)$/;
const MAX_FOLDER_FILE_BYTES = 1024 * 1024;

type Dialog = 'github' | 'youtube' | 'transcribe' | null;

/** The paperclip: Files, Folders, GitHub, Transcribe and YouTube. */
export function AttachMenu() {
  const attach = useStore((s) => s.attach);
  const transcription = useStore((s) => s.settings?.transcription ?? false);
  const attaching = useStore((s) => s.attaching);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);

  const uploadFiles = (list: FileList | null) => {
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    void attach(picked.length === 1 ? picked[0]!.name : `${picked.length} files`, (id) =>
      api.uploadFiles(
        id,
        picked.map((file) => ({ file, name: file.name })),
      ),
    );
  };

  const uploadFolder = (list: FileList | null) => {
    const all = [...(list ?? [])];
    if (!all.length) return;
    const root = all[0]!.webkitRelativePath.split('/')[0] || 'folder';
    const kept = all
      .map((file) => ({ file, name: file.webkitRelativePath.split('/').slice(1).join('/') || file.name }))
      .filter(
        ({ name, file }) =>
          !IGNORED_PATH.test(name) && !IGNORED_FILE.test(name) && file.size <= MAX_FOLDER_FILE_BYTES,
      );
    if (!kept.length) {
      useStore
        .getState()
        .showToast(`Nothing readable in ${root}/ after skipping dependencies and large files.`);
      return;
    }
    void attach(`${root}/`, (id) => api.uploadFiles(id, kept, root));
  };

  const close = () => setOpen(false);
  function pickFiles() {
    files.current?.click();
  }
  function pickFolder() {
    folder.current?.click();
  }

  return (
    <div className="relative">
      <button
        className="btn size-9 rounded-lg p-0"
        onClick={() => setOpen((o) => !o)}
        disabled={!!attaching}
        aria-label="Attach"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Attach files, folders, a GitHub repo, a recording or a YouTube video"
      >
        <PaperclipIcon size={16} />
      </button>
      {open && (
        <Popover label="Attach" onClose={() => setOpen(false)} align="right" className="w-48 p-1.5">
          <div role="menu">
            <MenuItem icon={<FileIcon size={16} />} label="Files" onSelect={pickFiles} close={close} />
            <MenuItem icon={<FolderIcon size={16} />} label="Folders" onSelect={pickFolder} close={close} />
            <MenuItem
              icon={<GithubIcon size={16} />}
              label="GitHub"
              onSelect={() => setDialog('github')}
              close={close}
            />
            <MenuItem
              icon={<MicIcon size={16} />}
              label="Transcribe"
              onSelect={() =>
                transcription
                  ? setDialog('transcribe')
                  : useStore
                      .getState()
                      .showToast('Transcription needs an OpenAI or Hugging Face key (Settings).')
              }
              close={close}
              extra={
                !transcription && <LockIcon size={13} className="text-amber-400" aria-label="Needs a key" />
              }
            />
            <MenuItem
              icon={<PlayIcon size={16} />}
              label="YouTube"
              onSelect={() => setDialog('youtube')}
              close={close}
            />
          </div>
        </Popover>
      )}
      <input
        ref={files}
        type="file"
        multiple
        className="hidden"
        data-testid="attach-files"
        onChange={(e) => {
          uploadFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={folder}
        type="file"
        className="hidden"
        data-testid="attach-folder"
        {...({ webkitdirectory: '', directory: '' } as object)}
        onChange={(e) => {
          uploadFolder(e.target.files);
          e.target.value = '';
        }}
      />
      {dialog === 'github' && (
        <TextImport
          title="Import from GitHub"
          label="Repository"
          placeholder="owner/repo, owner/repo@branch/folder, or a github.com link"
          help="Imports the readable text files (code, docs, config) as one attachment. Dependencies, lockfiles, binaries and files over 300 KB are skipped. Private repositories need a GitHub token in Settings."
          onClose={() => setDialog(null)}
          onSubmit={(value) => attach(value, (id) => api.importGithub(id, value))}
        />
      )}
      {dialog === 'youtube' && (
        <TextImport
          title="Import a YouTube video"
          label="Video link"
          placeholder="https://www.youtube.com/watch?v=…"
          help="Imports the video’s captions as a transcript. Videos without captions can’t be imported."
          onClose={() => setDialog(null)}
          onSubmit={(value) => attach('YouTube video', (id) => api.importYoutube(id, value))}
        />
      )}
      {dialog === 'transcribe' && <TranscribeDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onSelect,
  close,
  extra,
}: {
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
  close: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <button
      role="menuitem"
      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-panel-2"
      onClick={() => {
        close();
        onSelect();
      }}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {extra}
    </button>
  );
}

function TextImport({
  title,
  label,
  placeholder,
  help,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  placeholder: string;
  help: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!value.trim()) return;
    setBusy(true);
    if (await onSubmit(value.trim())) onClose();
    else setBusy(false);
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !value.trim()}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </>
      }
    >
      <label className="mb-1 block text-sm font-medium" htmlFor="import-value">
        {label}
      </label>
      <input
        id="import-value"
        className="field"
        autoFocus
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        spellCheck={false}
        autoCapitalize="off"
      />
      <p className="mt-2 text-xs text-muted">{help}</p>
    </Modal>
  );
}

/** Record in the browser (needs HTTPS or localhost) or upload an audio file. */
function TranscribeDialog({ onClose }: { onClose: () => void }) {
  const attach = useStore((s) => s.attach);
  const canRecord =
    typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!recorder) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recorder]);

  const send = async (blob: Blob, name: string) => {
    setBusy(true);
    if (await attach(`Transcribing ${name}`, (id) => api.transcribe(id, blob, name))) onClose();
    else setBusy(false);
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        void send(new Blob(chunks, { type }), `Recording ${new Date().toLocaleTimeString()}.${ext}`);
      };
      rec.start();
      setSeconds(0);
      setRecorder(rec);
    } catch (err) {
      useStore.getState().showToast(`Microphone unavailable: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <Modal title="Transcribe" onClose={() => (recorder ? undefined : onClose())}>
      <p className="mb-4 text-sm text-muted">The transcript is attached for every model to read.</p>
      {canRecord ? (
        recorder ? (
          <button className="btn btn-danger w-full" onClick={() => (recorder.stop(), setRecorder(null))}>
            Stop recording · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
          </button>
        ) : (
          <button className="btn btn-primary w-full" onClick={() => void start()} disabled={busy}>
            <MicIcon size={16} /> {busy ? 'Transcribing…' : 'Start recording'}
          </button>
        )
      ) : (
        <p className="rounded-md bg-panel-2 px-3 py-2 text-xs text-muted">
          Recording needs a secure connection (HTTPS or localhost). On this device you can upload an audio
          file instead.
        </p>
      )}
      <div className="mt-3 border-t border-line pt-3">
        <button className="btn w-full" onClick={() => file.current?.click()} disabled={busy || !!recorder}>
          Upload an audio file
        </button>
        <input
          ref={file}
          type="file"
          accept="audio/*,video/webm,video/mp4"
          className="hidden"
          data-testid="transcribe-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void send(f, f.name);
            e.target.value = '';
          }}
        />
      </div>
    </Modal>
  );
}
