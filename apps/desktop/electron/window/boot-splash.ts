const BOOT_SPLASH_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      html,body{margin:0;width:100%;height:100%;background:#0b0b0d;color:#ededef}
      body{display:grid;place-items:center;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-app-region:drag}
      .box{display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid rgba(255,255,255,.1);background:#151518;box-shadow:0 18px 50px rgba(0,0,0,.18)}
      .mark{width:32px;height:32px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.08);background:rgba(245,181,68,.2);color:#f5b544;font-weight:700;font-size:15px}
      .title{font-weight:600;font-size:13px;line-height:1.25}
      .status{display:flex;align-items:center;gap:8px;margin-top:3px;color:#a6a6ae;font-size:12px;line-height:1.3}
      .spinner{width:12px;height:12px;border-radius:999px;border:2px solid rgba(245,181,68,.22);border-top-color:#f5b544;box-sizing:border-box;animation:spin .9s linear infinite}
      @keyframes spin{to{transform:rotate(1turn)}}
      @media (prefers-reduced-motion:reduce){.spinner{animation:none}}
    </style>
  </head>
  <body>
    <div class="box" role="status" aria-live="polite">
      <div class="mark" aria-hidden="true">K</div>
      <div>
        <div class="title">KodaX Space</div>
        <div class="status"><span class="spinner" aria-hidden="true"></span><span data-boot-status>Starting up</span></div>
      </div>
    </div>
  </body>
</html>`;

export const BOOT_SPLASH_URL_PREFIX = 'data:text/html;charset=utf-8,';

export function createBootSplashUrl(): string {
  return `${BOOT_SPLASH_URL_PREFIX}${encodeURIComponent(BOOT_SPLASH_HTML)}`;
}

export function describeUrlForLog(url: string): string {
  if (url.startsWith(BOOT_SPLASH_URL_PREFIX)) return 'data:boot-splash';
  if (url.length <= 240) return url;
  return `${url.slice(0, 237)}...`;
}

export function bootStatusScript(message: string): string {
  return `
    (() => {
      const target = document.querySelector('[data-boot-status]');
      if (target) target.textContent = ${JSON.stringify(message)};
    })();
  `;
}
