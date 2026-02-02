#!/usr/bin/env node
'use strict';

const http = require('http');
const { URL, URLSearchParams } = require('url');

const CLIENT_ID = process.env.CWS_CLIENT_ID;
const CLIENT_SECRET = process.env.CWS_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set CWS_CLIENT_ID and CWS_CLIENT_SECRET env vars.');
  process.exit(1);
}

const PORT = Number(process.env.CWS_OAUTH_PORT) || 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const AUTH_URL = new URL('https://accounts.google.com/o/oauth2/v2/auth');

AUTH_URL.searchParams.set('client_id', CLIENT_ID);
AUTH_URL.searchParams.set('redirect_uri', REDIRECT_URI);
AUTH_URL.searchParams.set('response_type', 'code');
AUTH_URL.searchParams.set('access_type', 'offline');
AUTH_URL.searchParams.set('prompt', 'consent');
AUTH_URL.searchParams.set('scope', 'https://www.googleapis.com/auth/chromewebstore');

console.log('Open this URL in your browser and approve access:');
console.log(AUTH_URL.toString());

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    if (reqUrl.pathname !== '/oauth2callback') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const code = reqUrl.searchParams.get('code');
    if (!code) {
      res.writeHead(400);
      res.end('Missing code');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Authorization received. You can close this tab.');

    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code'
    });

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const tokenJson = await tokenResp.json();
    if (!tokenJson.refresh_token) {
      console.error('No refresh_token in response:', tokenJson);
      process.exit(1);
    }
    console.log('\nCWS_REFRESH_TOKEN:');
    console.log(tokenJson.refresh_token);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Waiting for OAuth redirect on ${REDIRECT_URI}`);
});
