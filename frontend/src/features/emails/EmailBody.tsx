'use client';

import { useRef, useState } from 'react';

// Renders an email's HTML in a sandboxed frame: no scripts run, and its styles
// can't leak into the app. Height follows the content.
export function EmailBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<style>
  body { margin: 0; font: 14px/1.6 Inter, ui-sans-serif, system-ui, sans-serif; color: #111; overflow-wrap: anywhere; }
  blockquote { margin: 0 0 0 .8em; padding-left: .8em; border-left: 3px solid #e5e5e5; color: #555; }
  img { max-width: 100%; height: auto; }
  p { margin: 0 0 .75em; }
</style></head><body>${html}</body></html>`;

  return (
    <iframe
      ref={ref}
      title="Email content"
      sandbox="allow-same-origin allow-popups"
      srcDoc={doc}
      style={{ height }}
      className="w-full border-0"
      onLoad={() => {
        const body = ref.current?.contentDocument?.body;
        if (body) setHeight(body.scrollHeight + 8);
      }}
    />
  );
}
