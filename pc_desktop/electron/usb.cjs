const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const exec = promisify(execFile);

// Interroger le bus USB, pas seulement les noms ou les lettres de lecteur.
// Les disques internes, lecteurs réseau et dossiers de téléchargement sont exclus.
const powershell = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$disks = @(Get-CimInstance -ClassName Win32_DiskDrive -Filter "InterfaceType='USB'" | ForEach-Object {
  $disk = $_
  Get-CimAssociatedInstance -InputObject $disk -ResultClassName Win32_DiskPartition | ForEach-Object {
    Get-CimAssociatedInstance -InputObject $_ -ResultClassName Win32_LogicalDisk | Where-Object {
      $_.DriveType -eq 2 -and $_.DeviceID -match '^[A-Z]:$'
    } | ForEach-Object {
      [PSCustomObject]@{
        id = [string]$disk.PNPDeviceID + '|' + [string]$_.DeviceID + '|' + [string]$_.VolumeSerialNumber
        letter = [string]$_.DeviceID
        label = if ([string]::IsNullOrWhiteSpace($_.VolumeName)) { 'Clé USB' } else { [string]$_.VolumeName }
        freeBytes = if ($null -eq $_.FreeSpace) { 0 } else { [double]$_.FreeSpace }
        sizeBytes = if ($null -eq $_.Size) { 0 } else { [double]$_.Size }
      }
    }
  }
})
ConvertTo-Json -InputObject $disks -Depth 3 -Compress
`;

function normalizeDrives(output) {
  const parsed = JSON.parse(output.trim() || '[]');
  const value = Array.isArray(parsed) ? parsed : [parsed];
  if (!value.every(d => d && typeof d === 'object')) throw new Error('Réponse de détection USB invalide.');
  const seen = new Set();
  return value.filter(d => {
    if (!d || typeof d.id !== 'string' || !d.id || !/^[A-Z]:$/.test(d.letter) || seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  }).map(d => ({
    id: d.id,
    letter: d.letter,
    root: d.letter + '\\',
    label: String(d.label || 'Clé USB').slice(0, 100),
    freeBytes: Math.max(0, Number(d.freeBytes) || 0),
    sizeBytes: Math.max(0, Number(d.sizeBytes) || 0)
  })).sort((a, b) => a.letter.localeCompare(b.letter));
}

async function listUsbDrives() {
  if (process.platform !== 'win32') {
    const error = new Error('La détection des clés USB nécessite Windows.');
    error.code = 'UNSUPPORTED';
    throw error;
  }
  try {
    const powershellPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    const { stdout } = await exec(powershellPath, [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(powershell, 'utf16le').toString('base64')
    ], { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true });
    return normalizeDrives(stdout);
  } catch (cause) {
    const error = new Error('Impossible de vérifier les clés USB. Réessayez.');
    error.code = 'DETECTION';
    error.cause = cause;
    throw error;
  }
}

module.exports = { listUsbDrives, normalizeDrives };
