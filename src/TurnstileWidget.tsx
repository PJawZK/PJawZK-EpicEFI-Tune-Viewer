import { useEffect, useRef, useState } from 'react';

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      theme?: 'auto' | 'light' | 'dark';
      size?: 'normal' | 'flexible' | 'compact';
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = 'epicefi-turnstile-script';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function ensureScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Unable to load Turnstile.')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Unable to load Turnstile.')), {
      once: true,
    });
    document.head.appendChild(script);
  });
}

export default function TurnstileWidget({
  siteKey,
  resetKey,
  onToken,
}: {
  siteKey: string;
  resetKey: number;
  onToken: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;
    let widgetId = '';

    onToken('');
    setLoadError('');

    ensureScript()
      .then(() => {
        if (!active || !containerRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action: 'submit_tune',
          theme: 'auto',
          size: 'flexible',
          callback: (token) => {
            if (active) onToken(token);
          },
          'expired-callback': () => {
            if (active) onToken('');
          },
          'error-callback': () => {
            if (active) {
              onToken('');
              setLoadError('Anti-bot verification could not start. Refresh the challenge or page.');
            }
          },
        });
      })
      .catch((error) => {
        if (!active) return;
        onToken('');
        setLoadError(error instanceof Error ? error.message : 'Unable to load anti-bot verification.');
      });

    return () => {
      active = false;
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          // Widget may already have been removed by navigation.
        }
      }
    };
  }, [onToken, resetKey, siteKey]);

  return (
    <div className="turnstile-wrap">
      <div ref={containerRef} />
      {loadError && <div className="mismatch">{loadError}</div>}
    </div>
  );
}
