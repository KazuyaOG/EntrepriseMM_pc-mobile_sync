import React, { useEffect, useState } from 'react';
import {
  RefreshCw, Wifi, WifiOff, Smartphone, Monitor, CheckCircle2, AlertCircle,
  Server, Copy, Link2, RadioTower, ShieldCheck, Eraser
} from 'lucide-react';
import { normalizeServerUrl, DEFAULT_PORT, isLoopbackUrl } from './protocol.js';
import { isDemoData } from './merge.js';
import './sync.css';

const dateTime = value => (value ? new Date(value).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais');

const STATUS = {
  online: { tone: 'ok', icon: CheckCircle2, label: 'Synchronisé' },
  syncing: { tone: 'busy', icon: RefreshCw, label: 'Synchronisation…' },
  connecting: { tone: 'busy', icon: RefreshCw, label: 'Connexion…' },
  offline: { tone: 'warn', icon: WifiOff, label: 'Hors ligne' },
  error: { tone: 'error', icon: AlertCircle, label: 'Erreur' },
  off: { tone: 'idle', icon: WifiOff, label: 'Désactivée' }
};

/**
 * Réglages de synchronisation PC ↔ mobile.
 *
 * @param {object} props
 * @param {object} props.session  session renvoyée par createSyncSession
 * @param {(text: string) => void} [props.notify]
 * @param {boolean} [props.compact]  version réduite pour l'accueil
 */
export default function SyncPanel({ session, notify, compact = false }) {
  const [status, setStatus] = useState(session.value());
  const config = session.config;
  const [address, setAddress] = useState(config.url || '');
  const [room, setRoom] = useState(config.room || 'gestion-mm');
  const [deviceName, setDeviceName] = useState(config.deviceName || '');
  const [enabled, setEnabled] = useState(Boolean(config.enabled));
  // Le commutateur suit la configuration réellement enregistrée.
  useEffect(() => { setEnabled(Boolean(session.config.enabled)); }, [session, status.status]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [copied, setCopied] = useState('');
  const [host, setHost] = useState(null);
  const [demo, setDemo] = useState(false);

  useEffect(() => session.subscribe(setStatus), [session]);
  useEffect(() => {
    let alive = true;
    window.mmDesktop?.syncInfo?.().then(info => { if (alive) setHost(info); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    setDemo(isDemoData(session.getData?.()));
    const timer = setInterval(() => setDemo(isDemoData(session.getData?.())), 4000);
    return () => clearInterval(timer);
  }, [session]);

  const view = STATUS[status.status] || STATUS.off;
  const Icon = view.icon;
  const online = status.status === 'online' || status.status === 'syncing';

  const save = event => {
    event?.preventDefault();
    const url = normalizeServerUrl(address, DEFAULT_PORT);
    if (!url) { setError('Entrez une adresse valide, par exemple 192.168.0.20:8765.'); return; }
    setError('');
    session.saveConfig({ url, room, deviceName, enabled });
    setSaved(enabled ? 'Réglages enregistrés. Connexion en cours…' : 'Synchronisation désactivée.');
    notify?.(enabled ? 'Synchronisation PC ↔ mobile configurée.' : 'Synchronisation désactivée.');
    setTimeout(() => setSaved(''), 5000);
  };

  const copy = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(''), 2500);
    } catch {
      setCopied('');
      notify?.('Copie impossible : sélectionnez le texte manuellement.');
    }
  };

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    session.saveConfig({ enabled: next, url: normalizeServerUrl(address, DEFAULT_PORT) || config.url, room, deviceName });
    notify?.(next ? 'Synchronisation activée.' : 'Synchronisation désactivée.');
  };

  return <section className={'sync-panel' + (compact ? ' compact' : '')} aria-labelledby="sync-title">
    <header className="sync-head">
      <div>
        <h3 id="sync-title"><RadioTower size={18} />Synchronisation PC ↔ mobile</h3>
        {!compact && <p className="muted">Les mêmes clients, rendez-vous, factures et dépenses sur tous vos appareils. Le PC garde les données sur votre réseau; rien ne passe par Internet.</p>}
      </div>
      <span className={'sync-pill ' + view.tone} role="status" aria-live="polite">
        <Icon size={14} className={view.tone === 'busy' ? 'sync-spin' : ''} />
        {status.label}
      </span>
    </header>

    <div className="sync-meta">
      <span><b>Appareil</b>{status.deviceName}</span>
      <span><b>Salle</b>{status.room}</span>
      <span><b>Appareils connectés</b>{status.peers || (online ? 1 : 0)}</span>
      <span><b>Dernière synchronisation</b>{dateTime(status.lastSyncAt)}</span>
    </div>

    {status.lastError && <p className="sync-alert" role="alert"><AlertCircle size={15} />{status.lastError}</p>}

    {host && <div className={'sync-host ' + (host.running ? 'ok' : 'warn')}>
      <Server size={16} />
      <div>
        <b>{host.running ? 'Serveur de synchronisation actif sur cet ordinateur' : 'Serveur de synchronisation arrêté'}</b>
        <p>{host.running
          ? <>Adresse pour le téléphone : {host.addresses.length
            ? host.addresses.map(address => <code key={address} className="copyable" onClick={() => copy(address.replace(/^ws:\/\//, '').replace(/\/sync$/, ''), 'adresse')}>{address.replace(/^ws:\/\//, '').replace(/\/sync$/, '')}</code>)
            : <code>localhost:{host.port}</code>} · le téléphone doit être sur le même Wi-Fi.</>
          : <>{host.message || 'Lancez « npm run sync » ou redémarrez l’application.'}</>}</p>
      </div>
    </div>}
    <form className="sync-form" onSubmit={save}>
      <label className="field">
        <span>Adresse du PC (serveur de synchronisation)</span>
        <input
          value={address}
          onChange={e => setAddress(e.target.value)}
          placeholder="192.168.0.20:8765"
          inputMode="url"
          spellCheck={false}
          aria-label="Adresse du PC"
        />
      </label>
      <div className="sync-grid">
        <label className="field">
          <span>Nom de cet appareil</span>
          <input value={deviceName} onChange={e => setDeviceName(e.target.value)} maxLength={40} aria-label="Nom de cet appareil" />
        </label>
        <label className="field">
          <span>Salle de synchronisation</span>
          <input value={room} onChange={e => setRoom(e.target.value)} maxLength={48} aria-label="Salle de synchronisation" />
        </label>
      </div>
      <div className="setting-row sync-toggle">
        <div>
          <h3>Synchroniser automatiquement</h3>
          <p>À chaque modification, sur cet appareil comme sur l’autre.</p>
        </div>
        <input
          type="checkbox"
          role="switch"
          aria-label="Synchroniser automatiquement"
          checked={enabled}
          onChange={toggle}
        />
      </div>
      {error && <p className="sync-alert" role="alert"><AlertCircle size={15} />{error}</p>}
      {saved && <p className="sync-ok" role="status"><CheckCircle2 size={15} />{saved}</p>}
      <div className="form-actions">
        <button className="primary" type="submit"><Link2 size={17} />Enregistrer et connecter</button>
        <button className="secondary" type="button" onClick={() => session.syncNow()} disabled={!enabled}>
          <RefreshCw size={16} />Synchroniser maintenant
        </button>
      </div>
    </form>

    {demo && <div className="sync-demo">
      <div>
        <b>Données de démonstration détectées</b>
        <p>Les clients, factures et rendez-vous d’exemple sont encore présents. Ils seront synchronisés avec le PC comme de vraies données.</p>
      </div>
      <button className="secondary" type="button" onClick={() => {
        if (!window.confirm('Remplacer toutes les données par la fiche d’entreprise seulement? Les clients, factures, rendez-vous, dépenses et rappels d’exemple seront supprimés. Action définitive.')) return;
        session.resetToBlank?.();
        setDemo(false);
        notify?.('Données de démonstration effacées. La fiche d’entreprise est conservée.');
      }}><Eraser size={16} />Effacer les exemples</button>
    </div>}

    {!compact && <div className="sync-help">
      <h4><Server size={16} />Comment relier le PC et le téléphone</h4>
      <ol>
        <li>Sur le PC, lancez le serveur de synchronisation : <code>npm run sync</code> (l’adresse à utiliser s’affiche dans la fenêtre).</li>
        <li>Sur le téléphone, connectez-le au <b>même réseau Wi-Fi</b> que le PC.</li>
        <li>Entrez l’adresse affichée par le PC (exemple : <code className="copyable" onClick={() => copy('192.168.0.20:8765', 'adresse')}>192.168.0.20:8765</code>) puis enregistrez.</li>
        <li>Le PC se connecte automatiquement au même serveur : les deux appareils affichent « Synchronisé ».</li>
      </ol>
      {isLoopbackUrl(address) && <p className="sync-hint"><Smartphone size={15} />Depuis un téléphone, « localhost » désigne le téléphone lui-même : utilisez l’adresse IP du PC affichée par le serveur.</p>}
      <p className="sync-hint"><Monitor size={15} />Le serveur garde une copie de sécurité de l’état partagé sur le disque du PC. Vos sauvegardes USB fonctionnent comme avant.</p>
      <p className="sync-hint"><ShieldCheck size={15} />Réseau local seulement : aucune donnée n’est envoyée sur Internet. Utilisez un Wi-Fi de confiance.</p>
      <div className="sync-actions">
        <button className="text-button" type="button" onClick={() => copy(status.url, 'adresse complète')}>
          <Copy size={15} />{copied ? `Copié : ${copied}` : 'Copier l’adresse complète'}
        </button>
        <button className="text-button" type="button" onClick={() => copy(status.room, 'salle')}>
          <Wifi size={15} />Copier le nom de la salle
        </button>
      </div>
    </div>}
  </section>;
}
