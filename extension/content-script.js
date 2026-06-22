// ─── Content Script for Activity Tracking ───
// This script runs in the context of visited websites

let pageStartTime = Date.now();
let lastUserInteractionAt = Date.now();
let idlePopupVisible = false;
let idleAutoCloseTimer = null;

const IDLE_TIMEOUT_MS = 60000;
const IDLE_CHECK_INTERVAL_MS = 5000;
const IDLE_AUTO_CLOSE_MS = 30000;

console.log('[IdleDebug] content-script.js loaded', {
  href: window.location.href,
  protocol: window.location.protocol,
  pathname: window.location.pathname
});
console.log('IDLE POPUP VERSION 3 LOADED');

function isAdminOrHrPage() {
  const { pathname, protocol } = window.location;
  if (protocol === 'chrome:') {
    return true;
  }

  return /\/admin(?:\/|$|\?)/i.test(pathname) || /\/hr(?:\/|$|\?)/i.test(pathname);
}

function updateLastUserInteraction() {
  lastUserInteractionAt = Date.now();
}

function markIdleLocally() {
  lastUserInteractionAt = Date.now();
}

function closeIdlePopup() {
  const popup = document.getElementById('employee-idle-popup');
  if (popup) {
    popup.remove();
    console.log('[IdleDebug] popup removed');
  }

  idlePopupVisible = false;

  if (idleAutoCloseTimer) {
    window.clearTimeout(idleAutoCloseTimer);
    idleAutoCloseTimer = null;
  }
}

function buildIdlePopup() {
  const overlay = document.createElement('div');
  overlay.id = 'employee-idle-popup';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'background:rgba(15,23,42,0.46)',
    'backdrop-filter:blur(8px)',
    'padding:24px',
    'box-sizing:border-box',
    'font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
  ].join(';');

  overlay.innerHTML = `
    <div style="
      width:min(100%, 440px);
      border-radius:20px;
      background:#ffffff;
      box-shadow:0 24px 80px rgba(15,23,42,0.28);
      border:1px solid rgba(148,163,184,0.22);
      padding:28px;
      text-align:center;
    ">
      <div style="
        width:56px;
        height:56px;
        margin:0 auto 16px;
        border-radius:16px;
        background:linear-gradient(135deg,#0f172a,#334155);
        color:#fff;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:24px;
        font-weight:700;
      ">!</div>
      <h2 style="
        margin:0 0 10px;
        font-size:22px;
        line-height:1.2;
        color:#0f172a;
        font-weight:700;
      ">Are you working or sleeping?</h2>
      <p style="
        margin:0 0 22px;
        color:#475569;
        font-size:14px;
        line-height:1.6;
      ">No activity has been detected for the last 60 seconds.</p>
      <div style="
        display:flex;
        gap:12px;
        justify-content:center;
        flex-wrap:wrap;
      ">
        <button data-idle-action="working" style="
          min-width:140px;
          border:none;
          border-radius:12px;
          padding:12px 16px;
          background:#0f172a;
          color:#fff;
          font-size:14px;
          font-weight:600;
          cursor:pointer;
        ">I'm Working</button>
        <button data-idle-action="break" style="
          min-width:140px;
          border:1px solid #cbd5e1;
          border-radius:12px;
          padding:12px 16px;
          background:#fff;
          color:#0f172a;
          font-size:14px;
          font-weight:600;
          cursor:pointer;
        ">Take a Break</button>
      </div>
    </div>
  `;

  const panel = overlay.firstElementChild;
  const workingButton = overlay.querySelector('[data-idle-action="working"]');
  const breakButton = overlay.querySelector('[data-idle-action="break"]');

  workingButton?.addEventListener('click', () => {
    updateLastUserInteraction();
    closeIdlePopup();
  });

  breakButton?.addEventListener('click', () => {
    markIdleLocally();
    closeIdlePopup();
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      event.preventDefault();
    }
  });

  panel?.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  return overlay;
}

function showIdlePopup() {
  if (idlePopupVisible || isAdminOrHrPage()) {
    console.log('[IdleDebug] showIdlePopup skipped', {
      idlePopupVisible,
      isAdminOrHrPage: isAdminOrHrPage(),
      href: window.location.href
    });
    return;
  }

  console.log('[IdleDebug] showIdlePopup called', {
    href: window.location.href,
    idleDurationMs: Date.now() - lastUserInteractionAt
  });
  idlePopupVisible = true;
  const popup = buildIdlePopup();
  document.documentElement.appendChild(popup);
  console.log('[IdleDebug] popup appended to document.documentElement', {
    parentNode: popup.parentNode?.nodeName || null,
    isConnected: popup.isConnected,
    childCount: document.documentElement.childElementCount
  });

  const popupObserver = new MutationObserver(() => {
    if (!document.getElementById('employee-idle-popup')) {
      console.log('[IdleDebug] popup no longer present in DOM after append');
      popupObserver.disconnect();
    }
  });
  popupObserver.observe(document.documentElement, { childList: true, subtree: true });

  idleAutoCloseTimer = window.setTimeout(() => {
    if (!idlePopupVisible) {
      console.log('[IdleDebug] auto-close timer fired but popup already hidden');
      return;
    }

    console.log('[IdleDebug] auto-closing popup after 30s');
    markIdleLocally();
    closeIdlePopup();
  }, IDLE_AUTO_CLOSE_MS);
}

function checkIdleState() {
  if (isAdminOrHrPage()) {
    console.log('[IdleDebug] checkIdleState skipped on admin/hr/chrome page', {
      href: window.location.href,
      protocol: window.location.protocol
    });
    return;
  }

  const idleFor = Date.now() - lastUserInteractionAt;
  console.log('[IdleDebug] checkIdleState tick', {
    href: window.location.href,
    idleForMs: idleFor,
    idlePopupVisible,
    lastUserInteractionAt
  });
  if (idleFor >= IDLE_TIMEOUT_MS && !idlePopupVisible) {
    showIdlePopup();
  }
}

function handleRealUserActivity() {
  console.log('Popup visible state:', idlePopupVisible);
  updateLastUserInteraction();
}

document.addEventListener('mousemove', handleRealUserActivity, true);
document.addEventListener('mousedown', handleRealUserActivity, true);
document.addEventListener('click', handleRealUserActivity, true);
document.addEventListener('keydown', handleRealUserActivity, true);
document.addEventListener('scroll', handleRealUserActivity, true);
document.addEventListener('touchstart', handleRealUserActivity, true);

window.setInterval(checkIdleState, IDLE_CHECK_INTERVAL_MS);

window.addEventListener('error', (event) => {
  console.error('[IdleDebug] window error', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error?.message || String(event.error || '')
  });
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[IdleDebug] unhandled rejection', {
    reason: event.reason?.message || String(event.reason || '')
  });
});

console.log('[ContentScript] Activity tracking initialized');
