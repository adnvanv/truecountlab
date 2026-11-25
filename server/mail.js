// Outgoing email (password resets) through Resend's HTTP API.
// Off until RESEND_API_KEY and MAIL_FROM are set in the server's .env.
'use strict';

const enabled = () => Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

async function sendMail({ to, subject, text, html }) {
  if (!enabled()) throw new Error('Email is not configured');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

module.exports = { enabled, sendMail };
