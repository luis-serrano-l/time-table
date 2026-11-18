import { useEffect, useRef, useState } from 'react';
import { actions } from '../store/store';

type Props = { count: number; onClose: () => void };

export function DataDialog({ count, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  function exportLog() {
    const blob = new Blob([actions.exportText()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `time-table-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg({ text: 'Backup saved to your downloads.' });
  }

  async function importLog(f: File | undefined) {
    if (!f) return;
    try {
      const added = await actions.importText(await f.text());
      setMsg({ text: added ? `Imported ${added} new entries.` : 'Nothing new in that backup.' });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'That file could not be imported.', bad: true });
    }
    if (file.current) file.current.value = '';
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <h2>Your data</h2>
      <p>
        The log lives only in this browser on this device: {count} {count === 1 ? 'entry' : 'entries'} so far.
        Clearing the browser's site data erases it, so export a backup now and then.
      </p>
      <div className="dialog-row">
        <button className="btn btn-solid" onClick={exportLog}>
          Export backup
        </button>
        <button className="btn" onClick={() => file.current?.click()}>
          Import backup
        </button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => importLog(e.target.files?.[0])} />
      </div>
      <p className="dialog-note">Importing merges with what is already here. Importing the same file twice changes nothing.</p>
      {msg && (
        <p className={`notice${msg.bad ? ' notice-bad' : ''}`} role="status">
          {msg.text}
        </p>
      )}

      <div className="dialog-row dialog-danger">
        {confirmErase ? (
          <>
            <span>Erase every task and entry on this device?</span>
            <button
              className="btn btn-bad"
              onClick={async () => {
                await actions.eraseAll();
                setConfirmErase(false);
                setMsg({ text: 'Everything was erased.' });
              }}
            >
              Erase everything
            </button>
            <button className="btn" onClick={() => setConfirmErase(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => setConfirmErase(true)} disabled={count === 0}>
            Erase everything
          </button>
        )}
      </div>

      <form method="dialog" className="dialog-close">
        <button className="btn">Close</button>
      </form>
    </dialog>
  );
}
