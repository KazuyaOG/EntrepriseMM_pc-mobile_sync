import React, { useEffect, useRef, useState } from 'react';
import { Usb, RefreshCw, CheckCircle2, AlertCircle, ShieldCheck, ArrowRight } from 'lucide-react';
import { Modal } from './UI';
import './usb-backup.css';

const size = bytes => bytes >= 1024 ** 3
  ? `${(bytes / 1024 ** 3).toLocaleString('fr-CA', { maximumFractionDigits: 1 })} Go`
  : `${Math.ceil(bytes / 1024 ** 2).toLocaleString('fr-CA')} Mo`;
const modified = value => new Date(value).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' });
const resultError = result => Object.assign(new Error(result.message || 'L’opération USB a échoué.'), { code: result.code });

export default function UsbBackup({ data, onRestore }) {
  const [mode, setMode] = useState(null);
  return <>
    <section className="usb-settings" aria-labelledby="usb-settings-title">
      <h3 id="usb-settings-title"><Usb size={18} />Sauvegarde sur clé USB</h3>
      <p className="muted">Vos copies de sécurité restent sur votre clé, pas dans le dossier Téléchargements.</p>
      <button className="primary full" onClick={() => setMode('export')}><Usb size={18} />Exporter une copie de sécurité</button>
      <button className="secondary full" onClick={() => setMode('restore')}><RefreshCw size={17} />Restaurer une copie JSON</button>
      <p className="usb-settings-note">Détection des clés et restauration automatique dans l’application Windows. Un navigateur ne peut pas accéder directement aux lecteurs USB.</p>
    </section>
    {mode && <UsbDialog mode={mode} data={data} onRestore={onRestore} onClose={() => setMode(null)} />}
  </>;
}

function DriveChoice({ drives, selected, onSelect, children }) {
  return <fieldset className="usb-choices">
    <legend>Choisissez votre clé USB</legend>
    {drives.map(drive => <label className={'usb-choice' + (selected === drive.id ? ' selected' : '')} key={drive.id}>
      <input type="radio" name="usb-drive" value={drive.id} checked={selected === drive.id} onChange={() => onSelect(drive.id)} />
      <Usb size={21} />
      <span><b>{drive.label} ({drive.letter})</b><small>{size(drive.freeBytes)} libres sur {size(drive.sizeBytes)}</small></span>
    </label>)}
    {children}
  </fieldset>;
}

function UsbDialog({ mode, data, onRestore, onClose }) {
  const bridge = window.mmUSB;
  const exporting = mode === 'export';
  const alive = useRef(true);
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(bridge ? 'detect' : 'unsupported');
  const [drives, setDrives] = useState([]);
  const [drive, setDrive] = useState(null);
  const [files, setFiles] = useState([]);
  const [fileKey, setFileKey] = useState('');
  const [scan, setScan] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const title = exporting ? 'Sauvegarder sur une clé USB' : 'Restaurer depuis une clé USB';

  async function run(task) {
    if (working.current || !alive.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try { await task(); }
    catch (cause) {
      if (!alive.current) return;
      setError(cause.message || 'Vérifiez la clé USB puis réessayez.');
      setPhase(cause.code === 'NO_DRIVE' || cause.code === 'ENOENT' ? 'insert' : 'error');
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function findBackups(selectedDrive) {
    setPhase('scan');
    const result = await bridge.listBackups(selectedDrive.id);
    if (!alive.current) return;
    if (!result.ok) throw resultError(result);
    setFiles(result.files);
    setScan(result);
    setFileKey(result.files.length ? `${result.files[0].location}:${result.files[0].name}` : '');
    setPhase(result.files.length ? 'files' : 'empty');
  }

  async function prepare(selectedDrive) {
    setDrive(selectedDrive);
    if (exporting) setPhase('ready');
    else await findBackups(selectedDrive);
  }

  function detect() {
    return run(async () => {
      setPhase('detect');
      const result = await bridge.list();
      if (!alive.current) return;
      if (!result.ok) throw resultError(result);
      setDrives(result.drives);
      if (!result.drives.length) setPhase('insert');
      else if (result.drives.length === 1) await prepare(result.drives[0]);
      else {
        setDrive(current => result.drives.some(d => d.id === current?.id) ? current : result.drives[0]);
        setPhase('drives');
      }
    });
  }

  useEffect(() => {
    alive.current = true;
    if (bridge) detect();
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (phase !== 'insert' || !bridge) return;
    const timer = setInterval(() => { if (!working.current) detect(); }, 2500);
    return () => clearInterval(timer);
  }, [phase]);

  const selectedFile = files.find(file => `${file.location}:${file.name}` === fileKey);
  const chooseDrive = () => run(() => prepare(drive));
  const exportNow = () => run(async () => {
    setPhase('writing');
    const result = await bridge.exportBackup(drive.id, data);
    if (!alive.current) return;
    if (!result.ok) throw resultError(result);
    setSuccess(result.backup);
    setPhase('success');
  });
  const restoreNow = () => run(async () => {
    setPhase('restoring');
    const result = await bridge.readBackup(drive.id, selectedFile.location, selectedFile.name);
    if (!alive.current) return;
    if (!result.ok) throw resultError(result);
    onRestore(result.data);
    setSuccess(selectedFile);
    setPhase('success');
  });

  return <Modal title={title} onClose={onClose}>
    <div className="modal-body usb-dialog">
      {error && <div className="usb-message error" role="alert"><AlertCircle size={20} /><p>{error}</p></div>}
      {phase === 'unsupported' && <>
        <div className="usb-hero"><Usb size={38} /></div>
        <h3>À utiliser dans l’application Windows</h3>
        <p>Ce navigateur ne peut pas détecter les clés USB ni choisir leur lecteur à votre place. Par sécurité, aucun téléchargement ni importation depuis le disque de l’ordinateur n’est proposé ici.</p>
        <div className="usb-message"><ShieldCheck size={20} /><p>Ouvrez <b>Gestion MM</b> sur Windows, insérez votre clé USB, puis revenez dans <b>Réglages</b>. L’application vous guidera.</p></div>
        <button className="secondary full" onClick={onClose}>Fermer</button>
      </>}
      {phase === 'detect' && <div className="usb-status" role="status"><RefreshCw className="usb-spin" size={28} /><h3>Recherche d’une clé USB…</h3><p>Vérification des lecteurs USB connectés à Windows.</p></div>}
      {phase === 'insert' && <>
        <div className="usb-hero"><Usb size={42} /></div>
        <h3>Insérez une clé USB</h3>
        <p>Branchez une clé USB sur cet ordinateur. Elle doit apparaître dans l’explorateur Windows et être accessible {exporting ? 'en écriture' : 'en lecture'}.</p>
        <p className="muted">La recherche reprend automatiquement. Vous pouvez aussi vérifier maintenant.</p>
        <button className="primary full" disabled={busy} onClick={detect}><RefreshCw size={17} />Vérifier la clé USB</button>
      </>}
      {phase === 'drives' && drive && <DriveChoice drives={drives} selected={drive.id} onSelect={id => setDrive(drives.find(d => d.id === id))}>
        <button className="primary full" disabled={busy} onClick={chooseDrive}>Utiliser cette clé<ArrowRight size={17} /></button>
      </DriveChoice>}
      {phase === 'ready' && drive && <>
        <div className="usb-selected"><Usb size={23} /><div><b>{drive.label} ({drive.letter})</b><small>{size(drive.freeBytes)} disponibles</small></div><CheckCircle2 size={19} /></div>
        <h3>Enregistrer votre copie sur cette clé?</h3>
        <p>La copie sera créée dans le dossier <b>Sauvegardes MM</b>, à la racine de la clé. Une copie existante ne sera jamais écrasée.</p>
        <button className="primary full" disabled={busy} onClick={exportNow}><Usb size={18} />Sauvegarder sur la clé USB</button>
        {drives.length > 1 && <button className="text-button full" onClick={() => setPhase('drives')}>Choisir une autre clé</button>}
      </>}
      {phase === 'scan' && <div className="usb-status" role="status"><RefreshCw className="usb-spin" size={28} /><h3>Recherche de vos sauvegardes…</h3><p>Lecture des fichiers JSON reconnus par Gestion MM sur la clé.</p></div>}
      {phase === 'empty' && <>
        <div className="usb-hero"><Usb size={38} /></div>
        <h3>Aucune sauvegarde reconnue sur cette clé</h3>
        <p>Placez une copie JSON créée par Gestion MM dans le dossier <b>Sauvegardes MM</b> ou directement à la racine de la clé, puis relancez la recherche.</p>
        {!!scan?.ignored && <p className="muted">{scan.ignored} fichier(s) JSON ignoré(s) : format non reconnu, illisible ou trop volumineux.</p>}
        <button className="primary full" disabled={busy} onClick={() => run(() => findBackups(drive))}><RefreshCw size={17} />Rechercher les sauvegardes</button>
        <button className="text-button full" onClick={() => setPhase('drives')}>Choisir une autre clé</button>
      </>}
      {phase === 'files' && <>
        <div className="usb-selected"><Usb size={22} /><div><b>{drive.label} ({drive.letter})</b><small>{files.length} sauvegarde(s) reconnue(s)</small></div></div>
        <fieldset className="usb-choices"><legend>Choisissez la copie à restaurer</legend>
          {files.map(file => {
            const key = `${file.location}:${file.name}`;
            return <label className={'usb-choice file' + (fileKey === key ? ' selected' : '')} key={key}>
              <input type="radio" name="usb-backup" checked={fileKey === key} onChange={() => setFileKey(key)} />
              <span><b>{file.name}</b><small>{modified(file.modifiedAt)} · {file.location === 'root' ? 'Racine de la clé' : 'Sauvegardes MM'}</small><small>{file.clients} client(s) · {file.invoices} facture(s) · {size(file.bytes)}</small></span>
            </label>;
          })}
        </fieldset>
        {scan?.limited && <p className="muted">Les 200 premières copies valides sont affichées. Déplacez les copies plus anciennes dans un sous-dossier si nécessaire.</p>}
        {!!scan?.ignored && <p className="muted">{scan.ignored} fichier(s) JSON non reconnu(s) ont été ignorés.</p>}
        <button className="primary full" disabled={!selectedFile || busy} onClick={() => setPhase('confirm')}>Restaurer cette sauvegarde<ArrowRight size={17} /></button>
        <button className="text-button full" onClick={() => setPhase('drives')}>Choisir une autre clé</button>
      </>}
      {phase === 'confirm' && selectedFile && <>
        <div className="usb-message warning"><AlertCircle size={22} /><div><h3>Remplacer les données actuelles?</h3><p>La copie <b>{selectedFile.name}</b> remplacera vos clients, factures, rendez-vous, dépenses, rappels et réglages sur cet appareil.</p><p>Exportez d’abord vos données actuelles sur une clé si vous souhaitez les conserver.</p></div></div>
        <button className="primary full" disabled={busy} onClick={restoreNow}>Confirmer la restauration</button>
        <button className="secondary full" onClick={() => setPhase('files')}>Revenir aux copies</button>
      </>}
      {(phase === 'writing' || phase === 'restoring') && <div className="usb-status" role="status"><RefreshCw className="usb-spin" size={28} /><h3>{exporting ? 'Écriture sur la clé USB…' : 'Restauration en cours…'}</h3><p>Gardez la clé branchée jusqu’à la confirmation.</p></div>}
      {phase === 'error' && <button className="primary full" disabled={busy} onClick={detect}><RefreshCw size={17} />Vérifier la clé et réessayer</button>}
      {phase === 'success' && <>
        <div className="usb-hero success"><CheckCircle2 size={42} /></div>
        <h3>{exporting ? 'Copie enregistrée sur la clé USB' : 'Sauvegarde restaurée'}</h3>
        {exporting ? <><p className="usb-filename">{success.path}</p><p>Vérifiez le fichier dans l’explorateur Windows avant de retirer la clé. Utilisez « Retirer le périphérique en toute sécurité » lorsque cette option est proposée.</p></> : <p>Vos données ont été remplacées par la copie <b>{success.name}</b> et enregistrées sur cet appareil.</p>}
        <button className="primary full" onClick={onClose}>Terminer</button>
      </>}
    </div>
  </Modal>;
}
