import { useEffect, useState } from 'react';
import LocalTuneViewer from './LocalTuneViewer';
import PublishedTunePage from './PublishedTunePage';
import TuneHub from './TuneHub';
import SubmitTune from './SubmitTune';
import DefinitionHub from './DefinitionHub';
import SubmitDefinition from './SubmitDefinition';
import TuneCompare from './TuneCompare';
import AuthorPage from './AuthorPage';
import CollectionPage, { type CollectionView } from './CollectionPage';

type Route =
  | { kind: 'hub' }
  | { kind: 'local' }
  | { kind: 'submit' }
  | { kind: 'edit'; id: string }
  | { kind: 'revision'; id: string }
  | { kind: 'author'; author: string }
  | { kind: 'collection'; view: CollectionView }
  | { kind: 'definitions' }
  | { kind: 'submitDefinition' }
  | { kind: 'compare' }
  | {
      kind: 'published';
      id: string;
      tab: 'info' | 'tune' | 'lineage' | 'download' | 'share';
    };

const publishedTabs = new Set(['info', 'tune', 'lineage', 'download', 'share']);

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

  if (parts[0] === 'browse') {
    const decode = (value: string | undefined): string => {
      if (!value) return '';
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    };

    if (parts.length === 1) {
      return { kind: 'collection', view: { kind: 'overview' } };
    }
    if (parts[1] === 'base-maps') {
      return { kind: 'collection', view: { kind: 'baseMaps' } };
    }
    if (parts[1] === 'vehicles') {
      return { kind: 'collection', view: { kind: 'vehicles' } };
    }
    if (parts[1] === 'vehicle' && parts[2]) {
      return {
        kind: 'collection',
        view: {
          kind: 'vehicle',
          make: decode(parts[2]),
          ...(parts[3] ? { model: decode(parts[3]) } : {}),
        },
      };
    }
    if (parts[1] === 'engines') {
      return { kind: 'collection', view: { kind: 'engines' } };
    }
    if (parts[1] === 'engine' && parts[2] && parts[3]) {
      return {
        kind: 'collection',
        view: {
          kind: 'engine',
          make: decode(parts[2]) === '~' ? '' : decode(parts[2]),
          code: decode(parts[3]) === '~' ? '' : decode(parts[3]),
        },
      };
    }
    if (parts[1] === 'ecus') {
      return { kind: 'collection', view: { kind: 'ecus' } };
    }
    if (parts[1] === 'ecu' && parts[2]) {
      return {
        kind: 'collection',
        view: { kind: 'ecu', target: decode(parts[2]) },
      };
    }
    if (parts[1] === 'authors') {
      return { kind: 'collection', view: { kind: 'authors' } };
    }

    return { kind: 'collection', view: { kind: 'overview' } };
  }

  if (parts[0] === 'author' && parts[1]) {
    let author = parts[1];
    try {
      author = decodeURIComponent(author);
    } catch {
      // Keep the raw value so the author page can show a useful empty state.
    }
    return { kind: 'author', author };
  }

  if (parts[0] === 't' && parts[1] && parts[2] === 'edit') {
    let id = parts[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      // Keep the raw id so the editor can show a useful not-found state.
    }
    return { kind: 'edit', id };
  }

  if (parts[0] === 't' && parts[1] && parts[2] === 'revision') {
    let id = parts[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      // Keep the raw id so the revision form can show a useful not-found state.
    }
    return { kind: 'revision', id };
  }

  if (parts[0] === 't' && parts[1]) {
    let id = parts[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      // Keep the raw id so the not-found page can handle malformed links safely.
    }

    const requestedTab = parts[2] ?? 'info';
    const tab = publishedTabs.has(requestedTab)
      ? requestedTab as 'info' | 'tune' | 'lineage' | 'download' | 'share'
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
            className={
              route.kind === 'hub'
              || route.kind === 'author'
              || route.kind === 'collection'
                ? 'active'
                : ''
            }
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
            className={
              route.kind === 'submit'
              || route.kind === 'edit'
              || route.kind === 'revision'
                ? 'active'
                : ''
            }
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
      {route.kind === 'collection' && <CollectionPage view={route.view} navigate={navigate} />}
      {route.kind === 'author' && <AuthorPage author={route.author} navigate={navigate} />}
      {route.kind === 'local' && <LocalTuneViewer />}
      {route.kind === 'compare' && <TuneCompare navigate={navigate} />}
      {route.kind === 'submit' && <SubmitTune navigate={navigate} />}
      {route.kind === 'edit' && <SubmitTune navigate={navigate} editId={route.id} />}
      {route.kind === 'revision' && <SubmitTune navigate={navigate} revisionOfId={route.id} />}
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
