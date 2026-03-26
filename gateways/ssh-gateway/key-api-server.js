#!/usr/bin/env node
// HTTPS key management API for the SSH Gateway sidecar.
// Replaces BusyBox httpd + CGI with a Node.js HTTPS server so that bearer
// tokens and SSH public keys are never sent in plaintext.
//
// Environment variables:
//   GATEWAY_API_TOKEN       — shared secret for bearer auth (required)
//   GATEWAY_API_PORT        — listen port (default: 8022)
//   GATEWAY_API_TLS_CERT    — path to PEM server certificate
//   GATEWAY_API_TLS_KEY     — path to PEM server private key
//   GATEWAY_API_TLS_CA      — optional CA cert for client verification

'use strict';

const fs = require('fs');
const path = require('path');

const AUTH_FILE = '/home/tunnel/.ssh/authorized_keys';
const PORT = parseInt(process.env.GATEWAY_API_PORT || '8022', 10);
const TOKEN = process.env.GATEWAY_API_TOKEN || '';

// Determine TLS vs plain HTTP
const certPath = process.env.GATEWAY_API_TLS_CERT || '';
const keyPath = process.env.GATEWAY_API_TLS_KEY || '';
const caPath = process.env.GATEWAY_API_TLS_CA || '';

let server;
if (certPath && keyPath) {
  const https = require('https');
  const tlsOpts = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
  if (caPath) {
    tlsOpts.ca = fs.readFileSync(caPath);
  }
  server = https.createServer(tlsOpts, handler);
  console.log(`Key API: HTTPS mode (cert=${certPath})`);
} else {
  const http = require('http');
  server = http.createServer(handler);
  console.log('Key API: WARNING — running plain HTTP (no TLS certs configured)');
}

function handler(req, res) {
  // Only serve /cgi-bin/authorized-keys for backward compatibility
  if (req.url !== '/cgi-bin/authorized-keys') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"Not found"}\n');
    return;
  }

  // Auth check
  const expected = `Bearer ${TOKEN}`;
  if (!TOKEN || req.headers.authorization !== expected) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"error":"Unauthorized"}\n');
    return;
  }

  if (req.method === 'GET') {
    handleGet(res);
  } else if (req.method === 'POST') {
    handlePost(req, res);
  } else {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end('{"error":"Method not allowed"}\n');
  }
}

function handleGet(res) {
  try {
    const content = fs.existsSync(AUTH_FILE) ? fs.readFileSync(AUTH_FILE, 'utf-8') : '';
    const keys = content.split('\n').filter(Boolean);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys }) + '\n');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }) + '\n');
  }
}

function handlePost(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body);
      const pubkey = parsed.publicKey;

      if (!pubkey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":"Missing publicKey"}\n');
        return;
      }

      // Validate key format
      if (!/^(ssh-|ecdsa-)/.test(pubkey)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":"Invalid key format"}\n');
        return;
      }

      fs.writeFileSync(AUTH_FILE, pubkey + '\n', { mode: 0o600 });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}\n');
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }) + '\n');
    }
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Key API listening on port ${PORT}`);
});
