# Connections Endpoints

> Auto-generated on 2026-03-15 by /docs create api.
> Source of truth is the codebase. Run /docs update api after code changes.

## Connections

All endpoints require authentication.

### `GET /api/connections`

List all connections (own + shared + team).

**Response**: `{ own: [...], shared: [...], team: [...] }`

### `POST /api/connections`

Create a new connection.

**Body**: `{ name, type, host, port, username?, password?, domain?, folderId?, teamId?, description?, sshTerminalConfig?, rdpSettings?, vncSettings?, gatewayId?, enableDrive?, defaultCredentialMode?, credentialSecretId? }`

### `GET /api/connections/:id`

Get a single connection.

### `PUT /api/connections/:id`

Update a connection.

### `DELETE /api/connections/:id`

Delete a connection.

### `PATCH /api/connections/:id/favorite`

Toggle favorite status.

<!-- manual-start -->
<!-- manual-end -->

## Connection Sharing

All endpoints require authentication.

### `POST /api/connections/:id/share`

Share a connection with a user.

**Body**: `{ userId, permission }`

### `POST /api/connections/batch-share`

Share multiple connections at once.

**Body**: `{ connectionIds, userId, permission }`

### `DELETE /api/connections/:id/share/:userId`

Revoke sharing from a user.

### `PUT /api/connections/:id/share/:userId`

Update share permission.

**Body**: `{ permission }`

### `GET /api/connections/:id/shares`

List all shares for a connection.

<!-- manual-start -->
<!-- manual-end -->

## Import/Export

All endpoints require authentication. Mounted under `/api/connections`.

### `POST /api/connections/export`

Export connections to CSV or JSON.

**Body**: `{ connectionIds, format, includeCredentials? }`

### `POST /api/connections/import`

Import connections from CSV, JSON, mRemoteNG, or RDP file format.

**Body**: `{ data, format?, folderId? }`

<!-- manual-start -->
<!-- manual-end -->

## Folders

All endpoints require authentication.

### `GET /api/folders`

List all folders (tree structure).

### `POST /api/folders`

Create a folder.

**Body**: `{ name, parentId?, teamId? }`

### `PUT /api/folders/:id`

Update a folder.

**Body**: `{ name?, parentId?, sortOrder? }`

### `DELETE /api/folders/:id`

Delete a folder (connections moved to root).

<!-- manual-start -->
<!-- manual-end -->
