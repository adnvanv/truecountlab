// Account API for the page: sign up, sign in, sign out, account changes.
import * as store from './store.js';

async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  let data = {};
  try { data = await r.json(); } catch { /* empty body */ }
  if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: r.status, data });
  return data;
}

let configCache = null;
export async function config() {
  if (!configCache) {
    try { configCache = await api('GET', '/api/auth/config'); } catch { configCache = { providers: {}, passwordReset: false }; }
  }
  return configCache;
}

export async function signUp(displayName, email, password) {
  const { user } = await api('POST', '/api/auth/signup', { displayName, email, password });
  await store.adoptUser(user);
  return user;
}

export async function signIn(email, password) {
  const { user } = await api('POST', '/api/auth/login', { email, password });
  await store.adoptUser(user);
  return user;
}

export async function signOut() {
  try { await api('POST', '/api/auth/logout', {}); } finally { store.signOut(); }
}

export const forgotPassword = (email) => api('POST', '/api/auth/forgot', { email });

export async function resetPassword(token, password) {
  const { user } = await api('POST', '/api/auth/reset', { token, password });
  await store.adoptUser(user);
  return user;
}

export async function update(changes) {
  const { user } = await api('PATCH', '/api/account', changes);
  store.setUser(user);
  return user;
}

export async function disconnect(provider) {
  const { user } = await api('DELETE', `/api/account/identity/${provider}`);
  store.setUser(user);
  return user;
}

export async function deleteAccount(confirmation) {
  await api('DELETE', '/api/account', confirmation);
  store.signOut();
}
