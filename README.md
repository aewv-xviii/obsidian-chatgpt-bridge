# AI Agent Bridge

Desktop-only Obsidian plugin that exposes an authenticated localhost HTTP API for vault operations.

## What it does

- Lists visible files and folders in the current vault
- Reads file contents
- Creates or overwrites files
- Appends to existing files
- Creates folders recursively
- Moves or renames files and folders
- Trashes files and folders when destructive actions are enabled

The API is intentionally local-only and token-protected. It is a good foundation for a later MCP server or AI Agent App bridge.

## Endpoints

All requests use either:

- `Authorization: Bearer <token>`
- `X-Obsidian-Token: <token>`

Available routes:

- `GET /health`
- `GET /vault/info`
- `POST /vault/list`
- `POST /vault/read`
- `POST /vault/write`
- `POST /vault/append`
- `POST /vault/move`
- `POST /vault/create-folder`
- `POST /vault/delete`

## PowerShell examples

```powershell
$token = "paste-token-here"
$headers = @{
  Authorization = "Bearer $token"
}

Invoke-RestMethod `
  -Method Get `
  -Uri "http://127.0.0.1:27124/health" `
  -Headers $headers

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:27124/vault/write" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body '{"path":"Inbox/test.md","content":"hello from Agent","overwrite":true}'
```

## Development

```powershell
npm install
npm run build
```

Then copy these files into your vault plugin folder:

- `manifest.json`
- `main.js`

For development, you can symlink the project folder into:

`<your-vault>\.obsidian\plugins\obsidian-ai-agent-bridge`

## Git clone install

If you want to install this plugin by `git clone` directly into `.obsidian/plugins/obsidian-ai-agent-bridge`, the repository must contain a built `main.js`.

Obsidian can discover a plugin from `manifest.json`, but it cannot activate the plugin unless `main.js` exists in the same folder.

Two valid approaches:

- Commit `main.js` to the repository and clone it directly into the plugins folder
- Clone the source repo, then run `npm install` and `npm run build` inside the cloned folder before enabling it
