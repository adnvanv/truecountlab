// Account page: sign in / create account / reset password, or your account when signed in.
import { h, head, toast } from '../ui.js';
import * as store from '../store.js';
import * as account from '../account.js';

const NAME = { google: 'Google', discord: 'Discord' };
// The providers' own marks: Google's four-colour G and Discord's logo.
const LOGO = {
  google: '<svg viewBox="0 0 48 48" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
  discord: '<svg viewBox="0 0 127.14 96.36" focusable="false"><path fill="currentColor" d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69Z"/></svg>',
};
const mark = (p) => { const el = h('span', { class: `oauth-mark ${p}`, 'aria-hidden': 'true' }); el.innerHTML = LOGO[p]; return el; };
const ERRORS = {
  cancelled: () => 'Sign-in was cancelled.',
  expired: () => 'That sign-in timed out or was started in another browser. Please try again.',
  failed: (p) => `Couldn't finish signing in with ${NAME[p] || 'that provider'}. Please try again.`,
  'email-exists': (p) => `An account with your ${NAME[p]} email already exists. Sign in with your email and password, then connect ${NAME[p]} below.`,
  'linked-elsewhere': (p) => `That ${NAME[p]} login is already connected to a different account.`,
  'signin-first': () => 'Sign in first, then connect another login.',
};

const input = (attrs) => h('input', { class: 'text-input', ...attrs });
const fieldRow = (label, control, hint) => h('label', { class: 'auth-field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);

// Wire a form: disable while working, show the server's error inline.
function form(attrs, onSubmit, ...kids) {
  const err = h('div', { class: 'form-error', role: 'alert' });
  const el = h('form', {
    ...attrs,
    onsubmit: async (e) => {
      e.preventDefault();
      const btn = el.querySelector('button[type=submit]');
      const label = btn?.textContent;
      err.textContent = '';
      if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
      try { await onSubmit(new FormData(el)); } catch (x) { err.textContent = x.message; } finally {
        if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; }
      }
    },
  }, ...kids, err);
  return el;
}

export function mount(root) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const resetToken = location.hash.startsWith('#reset') ? params.get('token') : null;
  let mode = resetToken ? 'reset' : params.get('mode') === 'signup' ? 'signup' : 'signin';
  let cfg = { providers: {}, passwordReset: false };
  let notice = null;
  const err = params.get('error');
  if (err && ERRORS[err]) notice = { kind: 'bad', text: ERRORS[err](params.get('provider')) };
  if (params.get('linked')) notice = { kind: 'good', text: `${NAME[params.get('linked')] || 'That login'} is connected. You can use it to sign in now.` };
  if (params.get('welcome')) notice = { kind: 'good', text: 'Welcome! Your account is ready, and your progress now saves to it.' };
  // Tidy the address bar so a refresh doesn't repeat the message (or keep a reset token around).
  if (params.toString()) history.replaceState(null, '', '#account');

  let alive = true;
  account.config().then((c) => { cfg = c; if (alive) draw(); });

  const noticeEl = () => (notice ? h('div', { class: `notice ${notice.kind}` }, notice.text) : null);
  const go = (hash, msg) => { if (msg) toast(msg); location.hash = hash; };

  function oauthButtons(linkMode = false) {
    const on = Object.entries(cfg.providers || {}).filter(([, v]) => v).map(([k]) => k);
    if (!on.length) return null;
    return h('div', { class: 'oauth' }, on.map((p) => h('a', { class: `btn oauth-btn ${p}`, href: `/auth/${p}/start${linkMode ? '?mode=link' : ''}` },
      mark(p), `Continue with ${NAME[p]}`)));
  }

  function signedOut() {
    const tabs = h('div', { class: 'seg auth-tabs', role: 'tablist' },
      [['signin', 'Sign in'], ['signup', 'Create account']].map(([m, label]) => h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(mode === m), class: `btn sm${mode === m ? ' on' : ''}`,
        onclick: () => { mode = m; draw(); },
      }, label)));

    let body;
    if (mode === 'reset') {
      body = form({ class: 'auth-form' }, async (fd) => {
        const u = await account.resetPassword(resetToken, fd.get('password'));
        go('#home', `Password updated. Welcome back, ${u.displayName}!`);
      },
      h('p', { class: 'muted' }, 'Choose a new password for your account.'),
      fieldRow('New password', input({ type: 'password', name: 'password', autocomplete: 'new-password', minlength: 8, required: true }), 'At least 8 characters.'),
      h('button', { class: 'btn primary wide-btn', type: 'submit' }, 'Set new password'));
    } else if (mode === 'forgot') {
      body = form({ class: 'auth-form' }, async (fd) => {
        await account.forgotPassword(fd.get('email'));
        notice = { kind: 'good', text: 'If an account uses that email, a reset link is on its way. It works for one hour.' };
        mode = 'signin';
        draw();
      },
      h('p', { class: 'muted' }, "Enter your account's email and we'll send you a link to set a new password."),
      fieldRow('Email', input({ type: 'email', name: 'email', autocomplete: 'email', required: true })),
      h('button', { class: 'btn primary wide-btn', type: 'submit' }, 'Email me a reset link'),
      h('button', { type: 'button', class: 'link', onclick: () => { mode = 'signin'; draw(); } }, 'Back to sign in'));
    } else if (mode === 'signup') {
      body = form({ class: 'auth-form' }, async (fd) => {
        const u = await account.signUp(fd.get('displayName'), fd.get('email'), fd.get('password'));
        go('#home', `Welcome, ${u.displayName}! Your progress now saves to your account.`);
      },
      fieldRow('Display name', input({ name: 'displayName', autocomplete: 'nickname', minlength: 3, maxlength: 20, required: true }), 'Shown on tables and leaderboards. 3–20 letters, numbers, spaces, . - _'),
      fieldRow('Email', input({ type: 'email', name: 'email', autocomplete: 'email', required: true })),
      fieldRow('Password', input({ type: 'password', name: 'password', autocomplete: 'new-password', minlength: 8, required: true }), 'At least 8 characters.'),
      h('button', { class: 'btn primary wide-btn', type: 'submit' }, 'Create account'),
      h('p', { class: 'fine' }, 'Your email is only used to sign in and reset your password. ', h('a', { href: '/privacy' }, 'Privacy')));
    } else {
      body = form({ class: 'auth-form' }, async (fd) => {
        const u = await account.signIn(fd.get('email'), fd.get('password'));
        go('#home', `Welcome back, ${u.displayName}!`);
      },
      fieldRow('Email', input({ type: 'email', name: 'email', autocomplete: 'email', required: true })),
      fieldRow('Password', input({ type: 'password', name: 'password', autocomplete: 'current-password', required: true })),
      h('button', { class: 'btn primary wide-btn', type: 'submit' }, 'Sign in'),
      cfg.passwordReset ? h('button', { type: 'button', class: 'link', onclick: () => { mode = 'forgot'; draw(); } }, 'Forgot your password?') : null);
    }

    const oauth = mode === 'signin' || mode === 'signup' ? oauthButtons() : null;
    return h('section', { class: 'view account' },
      head('Your account', 'Sign in to save your progress and stats to your account, so they follow you to any device. As a guest, progress stays in this browser only.'),
      noticeEl(),
      h('div', { class: 'auth-card' },
        mode === 'signin' || mode === 'signup' ? tabs : null,
        oauth,
        oauth ? h('div', { class: 'or' }, h('span', {}, 'or with email')) : null,
        body));
  }

  function signedIn(u) {
    const since = new Date(u.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const nameForm = form({ class: 'inline-form' }, async (fd) => {
      await account.update({ displayName: fd.get('displayName') });
      notice = { kind: 'good', text: 'Display name saved.' };
      draw();
    }, input({ name: 'displayName', value: u.displayName, minlength: 3, maxlength: 20, required: true, 'aria-label': 'Display name' }),
    h('button', { class: 'btn', type: 'submit' }, 'Save'));

    const pwForm = form({ class: 'stack-form' }, async (fd) => {
      await account.update({ currentPassword: fd.get('currentPassword'), newPassword: fd.get('newPassword'), email: fd.get('email') || undefined });
      notice = { kind: 'good', text: u.hasPassword ? 'Password changed. Other devices were signed out.' : 'Password set. You can now sign in with your email and password.' };
      draw();
    },
    u.hasPassword ? fieldRow('Current password', input({ type: 'password', name: 'currentPassword', autocomplete: 'current-password', required: true })) : null,
    !u.email ? fieldRow('Email', input({ type: 'email', name: 'email', autocomplete: 'email', required: true }), 'Needed to sign in with a password.') : null,
    fieldRow(u.hasPassword ? 'New password' : 'Password', input({ type: 'password', name: 'newPassword', autocomplete: 'new-password', minlength: 8, required: true }), 'At least 8 characters.'),
    h('button', { class: 'btn', type: 'submit' }, u.hasPassword ? 'Change password' : 'Set password'));

    const providers = ['google', 'discord'].filter((p) => cfg.providers?.[p] || u.providers.includes(p));
    const providerRows = providers.map((p) => {
      const connected = u.providers.includes(p);
      return h('div', { class: 'method-row' },
        mark(p),
        h('div', { class: 'method-text' }, h('strong', {}, NAME[p]), h('span', { class: 'muted' }, connected ? 'Connected' : 'Not connected')),
        connected
          ? h('button', {
            class: 'btn sm', type: 'button',
            onclick: async () => {
              try { await account.disconnect(p); notice = { kind: 'good', text: `${NAME[p]} disconnected.` }; } catch (x) { notice = { kind: 'bad', text: x.message }; }
              draw();
            },
          }, 'Disconnect')
          : h('a', { class: 'btn sm', href: `/auth/${p}/start?mode=link` }, 'Connect'));
    });

    const delForm = form({ class: 'stack-form' }, async (fd) => {
      if (!confirm('Delete your account and all of its saved progress? This cannot be undone.')) return;
      await account.deleteAccount(u.hasPassword ? { password: fd.get('password') } : { confirm: fd.get('confirm') });
      go('#home', 'Your account and its progress were deleted.');
    },
    u.hasPassword
      ? fieldRow('Your password', input({ type: 'password', name: 'password', autocomplete: 'current-password', required: true }))
      : fieldRow(`Type your display name (${u.displayName}) to confirm`, input({ name: 'confirm', required: true })),
    h('button', { class: 'btn danger', type: 'submit' }, 'Delete my account forever'));

    return h('section', { class: 'view account' },
      head('Your account', 'Your progress and stats save to your account automatically, on every device you sign in on.'),
      noticeEl(),
      h('div', { class: 'profile-card' },
        h('div', { class: 'avatar big', 'aria-hidden': 'true' }, u.displayName.slice(0, 1).toUpperCase()),
        h('div', {},
          h('div', { class: 'profile-name' }, u.displayName),
          h('div', { class: 'muted' }, u.email || 'No email on this account'),
          h('div', { class: 'muted small' }, `Member since ${since} · `, h('span', { class: 'sync-dot' }), ' Progress synced')),
        h('button', { class: 'btn', type: 'button', onclick: async () => { await account.signOut(); go('#home', 'Signed out.'); } }, 'Sign out')),
      h('div', { class: 'account-grid' },
        h('div', { class: 'panel' }, h('h2', {}, 'Display name'), h('p', { class: 'muted' }, 'Shown on tables and leaderboards.'), nameForm),
        h('div', { class: 'panel' }, h('h2', {}, 'Sign-in methods'),
          h('div', { class: 'method-row' },
            h('span', { class: 'oauth-mark email', 'aria-hidden': 'true' }, '@'),
            h('div', { class: 'method-text' }, h('strong', {}, 'Email & password'), h('span', { class: 'muted' }, u.hasPassword ? 'On' : 'Not set up'))),
          pwForm,
          providerRows),
        h('div', { class: 'panel' }, h('h2', {}, 'Your data'),
          h('p', { class: 'muted' }, 'Download everything saved to your account (account details and all progress) as a JSON file.'),
          h('a', { class: 'btn', href: '/api/account/export', download: '' }, 'Download my data'),
          h('p', { class: 'muted small' }, h('a', { href: '/privacy' }, 'How your data is handled'))),
        h('details', { class: 'panel danger-zone' },
          h('summary', {}, 'Delete account'),
          h('p', { class: 'muted' }, 'This permanently deletes your account, your sign-in methods and all saved progress.'),
          delForm)));
  }

  function draw() {
    if (!alive) return;
    const u = store.currentUser();
    root.replaceChildren(u ? signedIn(u) : signedOut());
  }
  draw();

  return () => { alive = false; };
}
