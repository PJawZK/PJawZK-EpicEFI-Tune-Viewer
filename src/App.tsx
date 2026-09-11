import { useEffect, useState } from 'react';
import LocalTuneViewer from './LocalTuneViewer';
import PublishedTunePage from './PublishedTunePage';
import TuneHub from './TuneHub';
import SubmitTune from './SubmitTune';
import DefinitionHub from './DefinitionHub';
import SubmitDefinition from './SubmitDefinition';
import TuneCompare from './TuneCompare';

type Route =
  | { kind: 'hub' }
  | { kind: 'local' }
  | { kind: 'submit' }
  | { kind: 'definitions' }
  | { kind: 'submitDefinition' }
  | { kind: 'compare' }
  | {
      kind: 'published';
      id: string;
      tab: 'info' | 'tune' | 'download' | 'share';
    };

const publishedTabs = new Set(['info', 'tune', 'download', 'share']);

function parseRoute(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const clean = raw.split('?')[0];
  const parts = clean.split('/').filter(Boolean);

  if (parts.length === 0) return { kind: 'hub' };
  if (parts[0] === 'local') return { kind: 'local' };
  if (parts[0] === 'compare') return { kind: 'compare' };
  if (parts[0] === 'submit') return { kind: 'submit' };
  if (parts[0] === 'definitions' && parts[1] === 'submit') {
    return { kind: 'submitDefinition' };
  }
  if (parts[0] === 'definitions') return { kind: 'definitions' };

  if (parts[0] === 't' && parts[1]) {
    let id = parts[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      // Keep the raw id so the not-found page can handle malformed links safely.
    }

    const requestedTab = parts[2] ?? 'info';
    const tab = publishedTabs.has(requestedTab)
      ? requestedTab as 'info' | 'tune' | 'download' | 'share'
      : 'info';

    return {
      kind: 'published',
      id,
      tab,
    };
  }

  return { kind: 'hub' };
}

function navigate(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const next = `#${normalized}`;

  if (window.location.hash === next) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = next;
  }
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute());

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <>
      <nav className="site-nav">
        <button
          type="button"
          className="site-brand"
          onClick={() => navigate('/')}
          aria-label="EpicEFI Tune Viewer home"
        >
          <span>EPICEFI</span>
          <strong>Tune Viewer</strong>
        </button>

        <div className="site-nav-links">
          <button
            type="button"
            className={route.kind === 'hub' ? 'active' : ''}
            onClick={() => navigate('/')}
          >
            Tune Hub
          </button>
          <button
            type="button"
            className={route.kind === 'local' ? 'active' : ''}
            onClick={() => navigate('/local')}
          >
            Local Viewer
          </button>
          <button
            type="button"
            className={route.kind === 'compare' ? 'active' : ''}
            onClick={() => navigate('/compare')}
          >
            Tune Compare
          </button>
          <button
            type="button"
            className={route.kind === 'submit' ? 'active' : ''}
            onClick={() => navigate('/submit')}
          >
            Submit Tune
          </button>
          <button
            type="button"
            className={
              route.kind === 'definitions' || route.kind === 'submitDefinition'
                ? 'active'
                : ''
            }
            onClick={() => navigate('/definitions')}
          >
            Firmware Definitions
          </button>
        </div>
      </nav>

      {route.kind === 'hub' && <TuneHub navigate={navigate} />}
      {route.kind === 'local' && <LocalTuneViewer />}
      {route.kind === 'compare' && <TuneCompare navigate={navigate} />}
      {route.kind === 'submit' && <SubmitTune navigate={navigate} />}
      {route.kind === 'definitions' && <DefinitionHub navigate={navigate} />}
      {route.kind === 'submitDefinition' && <SubmitDefinition navigate={navigate} />}
      {route.kind === 'published' && (
        <PublishedTunePage
          id={route.id}
          tab={route.tab}
          navigate={navigate}
        />
      )}
    </>
  );
}
