import JSZip from 'jszip';
import { useEffect, useMemo, useState } from 'react';
import {
  loadDefinitionRegistry,
  type DefinitionRegistryEntry,
} from './definitionRegistry';
import { parseIni } from './ini';
import type { ParsedIni } from './model';

type SubmitDefinitionProps = {
  navigate: (path: string) => void;
};

type FormState = {
  id: string;
  ecuTarget: string;
  label: string;
  source: string;
};

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function inferEcuTarget(signature: string): string {
  const mega = signature.match(/\b(MEGA[0-9A-Z_-]+)\b/i);
  if (mega) return mega[1].toUpperCase();

  const parts = signature.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1] ?? '')) {
    return parts[parts.length - 2]?.toUpperCase() ?? '';
  }

  return '';
}

function suggestDefinitionId(signature: string, ecuTarget: string): string {
  const date = signature.match(/\b(\d{4})\.(\d{2})\.(\d{2})\b/);
  const parts = signature.split('.').map((part) => part.trim()).filter(Boolean);
  const build = /^\d+$/.test(parts[parts.length - 1] ?? '')
    ? parts[parts.length - 1]
    : '';

  const components = [
    ecuTarget || 'epicefi',
    date ? `${date[1]}-${date[2]}-${date[3]}` : '',
    build,
  ].filter(Boolean);

  return slugify(components.join('-'));
}

function suggestLabel(signature: string, ecuTarget: string): string {
  const date = signature.match(/\b(\d{4})\.(\d{2})\.(\d{2})\b/);
  const parts = signature.split('.').map((part) => part.trim()).filter(Boolean);
  const build = /^\d+$/.test(parts[parts.length - 1] ?? '')
    ? parts[parts.length - 1]
    : '';

  return [
    ecuTarget || 'EpicEFI',
    date ? `${date[1]}-${date[2]}-${date[3]}` : '',
    build,
  ].filter(Boolean).join(' · ');
}

function downloadBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export default function SubmitDefinition({ navigate }: SubmitDefinitionProps) {
  const [iniFile, setIniFile] = useState<File | null>(null);
  const [iniText, setIniText] = useState('');
  const [parsed, setParsed] = useState<ParsedIni | null>(null);
  const [form, setForm] = useState<FormState>({
    id: '',
    ecuTarget: '',
    label: '',
    source: '',
  });
  const [idTouched, setIdTouched] = useState(false);
  const [labelTouched, setLabelTouched] = useState(false);
  const [fileError, setFileError] = useState('');
  const [registry, setRegistry] = useState<DefinitionRegistryEntry[]>([]);
  const [registryError, setRegistryError] = useState('');
  const [packaging, setPackaging] = useState(false);
  const [packageError, setPackageError] = useState('');

  useEffect(() => {
    let active = true;

    loadDefinitionRegistry()
      .then((loaded) => {
        if (!active) return;
        setRegistry(loaded.definitions);
      })
      .catch((caught) => {
        if (!active) return;
        setRegistryError(
          caught instanceof Error
            ? caught.message
            : 'Unable to check the current firmware registry.',
        );
      });

    return () => {
      active = false;
    };
  }, []);

  const duplicateSignature = useMemo(
    () => parsed
      ? registry.find((entry) => entry.signature === parsed.signature) ?? null
      : null,
    [parsed, registry],
  );

  const duplicateId = useMemo(() => {
    const id = form.id.trim();
    if (!id) return null;

    return registry.find(
      (entry) => entry.path.includes(`/${id}/definition-pack.json.gz`),
    ) ?? null;
  }, [form.id, registry]);

  const metadata = useMemo(() => {
    if (!parsed) return null;

    return {
      ecuTarget: form.ecuTarget.trim(),
      label: form.label.trim(),
      source: form.source.trim() || 'Submitted EpicEFI mainController.ini',
      expectedSignature: parsed.signature,
    };
  }, [form, parsed]);

  const validationErrors = useMemo(() => {
    const errors: string[] = [];

    if (!iniFile || !parsed) errors.push('Load a valid EpicEFI mainController.ini.');
    if (!form.id.trim()) {
      errors.push('Definition ID is required.');
    } else if (!/^[a-z0-9][a-z0-9._-]*$/.test(form.id.trim())) {
      errors.push('Definition ID may contain lowercase letters, digits, ".", "_" and "-" only.');
    }
    if (!form.ecuTarget.trim()) errors.push('ECU target is required.');
    if (!form.label.trim()) errors.push('Definition label is required.');
    if (duplicateSignature) errors.push('This exact firmware signature is already registered.');
    if (duplicateId) errors.push('This definition ID is already used by the registry.');

    return errors;
  }, [duplicateId, duplicateSignature, form, iniFile, parsed]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function loadIni(file: File | undefined) {
    if (!file) return;

    setFileError('');
    setPackageError('');

    try {
      const raw = await file.text();
      const result = parseIni(raw);
      const target = inferEcuTarget(result.signature);

      setIniFile(file);
      setIniText(raw);
      setParsed(result);
      setForm((current) => ({
        ...current,
        ecuTarget: current.ecuTarget || target,
        id: idTouched
          ? current.id
          : suggestDefinitionId(result.signature, current.ecuTarget || target),
        label: labelTouched
          ? current.label
          : suggestLabel(result.signature, current.ecuTarget || target),
      }));
    } catch (caught) {
      setIniFile(null);
      setIniText('');
      setParsed(null);
      setFileError(
        caught instanceof Error
          ? caught.message
          : 'Unable to parse this firmware definition.',
      );
    }
  }

  function changeTarget(value: string) {
    setForm((current) => {
      const next = { ...current, ecuTarget: value };
      if (parsed && !idTouched) {
        next.id = suggestDefinitionId(parsed.signature, value);
      }
      if (parsed && !labelTouched) {
        next.label = suggestLabel(parsed.signature, value);
      }
      return next;
    });
  }

  async function createPackage() {
    if (!parsed || !metadata || validationErrors.length || !iniFile) return;

    setPackaging(true);
    setPackageError('');

    try {
      const zip = new JSZip();
      const folder = zip.folder(form.id.trim());
      if (!folder) throw new Error('Unable to create definition source folder.');

      folder.file('mainController.ini', iniText);
      folder.file('metadata.json', JSON.stringify(metadata, null, 2) + '\n');
      folder.file(
        'SUBMISSION.txt',
        [
          'EpicEFI Tune Viewer firmware definition submission',
          '',
          `Definition ID: ${form.id.trim()}`,
          `ECU target: ${metadata.ecuTarget}`,
          `Firmware signature: ${parsed.signature}`,
          '',
          'To publish during the GitHub prototype phase:',
          `1. Add this folder under definitions/sources/${form.id.trim()}/ in the repository.`,
          '2. Open a pull request.',
          '3. GitHub Actions parses the INI with the same parser as the browser.',
          '4. The build rejects duplicate signatures and validates expectedSignature.',
          '5. The build regenerates the compressed definition pack and public registry automatically.',
          '',
          'Do not edit public/definitions/registry.json or generated definition packs manually.',
        ].join('\n'),
      );

      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
      });
      downloadBlob(
        blob,
        `${form.id.trim()}-epicefi-definition-submission.zip`,
      );
    } catch (caught) {
      setPackageError(
        caught instanceof Error
          ? caught.message
          : 'Unable to create firmware definition package.',
      );
    } finally {
      setPackaging(false);
    }
  }

  return (
    <main>
      <header className="hub-hero submit-hero">
        <div>
          <p className="eyebrow">EpicEFI Firmware Definitions</p>
          <h1>Prepare definition submission</h1>
          <p className="lede">
            Parse any EpicEFI <code>mainController.ini</code> locally, verify its exact firmware
            identity, and create a source package for the public multi-firmware registry. Nothing is
            uploaded from this page.
          </p>
        </div>

        <button
          type="button"
          className="open-button secondary button-reset"
          onClick={() => navigate('/definitions')}
        >
          Back to definitions
        </button>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Step 1</p>
            <h2>Firmware definition</h2>
          </div>
          <span className={`badge ${parsed && !duplicateSignature ? 'badge-ok' : ''}`}>
            {!parsed
              ? 'INI required'
              : duplicateSignature
                ? 'Already registered'
                : 'Definition parsed'}
          </span>
        </div>

        <label className="submit-file-card definition-file-card">
          <span>mainController.ini · required</span>
          <strong>{iniFile?.name || 'Choose EpicEFI firmware definition'}</strong>
          <input
            type="file"
            accept=".ini,text/plain"
            onChange={(event) => void loadIni(event.target.files?.[0])}
          />
        </label>

        {fileError && <div className="mismatch">{fileError}</div>}

        {parsed && (
          <>
            <div className="details-grid definition-parse-summary">
              <div className="detail">
                <span>Signature</span>
                <strong>{parsed.signature}</strong>
              </div>
              <div className="detail">
                <span>Settings</span>
                <strong>{parsed.constants.length.toLocaleString()}</strong>
              </div>
              <div className="detail">
                <span>Tables</span>
                <strong>{parsed.tables.length}</strong>
              </div>
              <div className="detail">
                <span>Curves</span>
                <strong>{parsed.curves.length}</strong>
              </div>
              <div className="detail">
                <span>Dialogs</span>
                <strong>{parsed.dialogs.length}</strong>
              </div>
              <div className="detail">
                <span>Menus</span>
                <strong>{parsed.menus.length}</strong>
              </div>
            </div>

            {duplicateSignature && (
              <div className="mismatch">
                This exact signature is already registered as <strong>{duplicateSignature.label}</strong>.
                A second definition with the same firmware signature is intentionally rejected.
              </div>
            )}
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Step 2</p>
            <h2>Registry identity</h2>
          </div>
        </div>

        <div className="submit-grid two">
          <label className="submit-field">
            <span>Definition ID <em>required</em></span>
            <input
              value={form.id}
              onChange={(event) => {
                setIdTouched(true);
                update('id', slugify(event.target.value));
              }}
              placeholder="mega144h7-2026-08-26-2273317132"
            />
            <small>Used as the source-folder identity in GitHub.</small>
          </label>

          <label className="submit-field">
            <span>ECU target <em>required</em></span>
            <input
              value={form.ecuTarget}
              onChange={(event) => changeTarget(event.target.value)}
              placeholder="MEGA144H7"
            />
          </label>

          <label className="submit-field">
            <span>Definition label <em>required</em></span>
            <input
              value={form.label}
              onChange={(event) => {
                setLabelTouched(true);
                update('label', event.target.value);
              }}
              placeholder="MEGA144H7 · 2026-08-26 · 2273317132"
            />
          </label>

          <label className="submit-field">
            <span>Source / provenance</span>
            <input
              value={form.source}
              onChange={(event) => update('source', event.target.value)}
              placeholder="EpicEFI release / development branch / build source"
            />
          </label>
        </div>

        {duplicateId && (
          <div className="mismatch">
            Definition ID <code>{form.id}</code> is already in use by {duplicateId.label}.
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Step 3</p>
            <h2>Review and create package</h2>
          </div>
          <span className={`badge ${validationErrors.length === 0 ? 'badge-ok' : ''}`}>
            {validationErrors.length === 0
              ? 'Ready to package'
              : `${validationErrors.length} item(s) required`}
          </span>
        </div>

        {registryError && (
          <div className="mismatch">
            Registry check failed: {registryError}. Duplicate detection may be incomplete until the
            public registry is reachable.
          </div>
        )}

        {validationErrors.length > 0 && (
          <ul className="submit-errors">
            {validationErrors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        )}

        {parsed && metadata && (
          <>
            <div className="submission-preview">
              <div>
                <span>Definition ID</span>
                <strong>{form.id || '—'}</strong>
              </div>
              <div>
                <span>ECU target</span>
                <strong>{metadata.ecuTarget || '—'}</strong>
              </div>
              <div>
                <span>Settings</span>
                <strong>{parsed.constants.length.toLocaleString()}</strong>
              </div>
              <div>
                <span>Tables / Curves</span>
                <strong>{parsed.tables.length} / {parsed.curves.length}</strong>
              </div>
              <div className="submission-preview-wide">
                <span>Expected signature guard</span>
                <strong>{metadata.expectedSignature}</strong>
              </div>
            </div>

            <details className="metadata-preview">
              <summary>Preview metadata.json</summary>
              <pre>{JSON.stringify(metadata, null, 2)}</pre>
            </details>
          </>
        )}

        {packageError && <div className="mismatch">{packageError}</div>}

        <div className="submission-actions">
          <button
            type="button"
            className="open-button button-reset"
            disabled={validationErrors.length > 0 || packaging}
            onClick={() => void createPackage()}
          >
            {packaging ? 'Creating package…' : 'Download definition ZIP'}
          </button>

          <a
            className="open-button secondary"
            href="https://github.com/PJawZK/PJawZK-EpicEFI-Tune-Viewer/tree/main/definitions/sources"
            target="_blank"
            rel="noreferrer"
          >
            Open GitHub definition sources
          </a>
        </div>

        <p className="table-note">
          The ZIP contains one folder ready for <code>definitions/sources/&lt;definition-id&gt;/</code>.
          GitHub Actions creates the compressed pack and registry entry; generated files are never
          edited by hand.
        </p>
      </section>

      <footer>
        Definition builder — firmware INI contents remain local until you explicitly publish the generated package.
      </footer>
    </main>
  );
}
