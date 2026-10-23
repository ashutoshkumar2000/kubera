# KUBERA — Teammate Setup Guide

This guide gets a teammate's local KUBERA development environment running after cloning or pulling the repository.

## 1. Prerequisites

Install:

- **Git**
- **Node.js 22.x** (the project has been developed with Node `v22.23.4`)
- **npm** (comes with Node.js; npm `10.x` is appropriate for this setup)
- **VS Code** or another editor

Verify your versions:

```bash
node --version
npm --version
git --version
```

Use Node 22.x for consistency with the project. If you use `nvm` on macOS/Linux:

```bash
nvm install 22
nvm use 22
```

## 2. Clone or update the repository

### First time cloning

```bash
git clone https://github.com/ashutoshkumar2000/kubera.git
cd kubera
```

### If you already cloned it

Run these commands from the repository directory, after saving or committing any local work:

```bash
git switch main
git pull --rebase origin main
```

If you have uncommitted changes, check `git status` first and commit or safely stash them before pulling.

## 3. Install dependencies

Run this **from the repository root** (the directory containing the root `package.json`):

```bash
npm install
```

KUBERA uses npm workspaces for its apps. Install dependencies at the repository root rather than running separate installs inside each app.

## 4. Configure the backend environment

Create a local environment file at:

`apps/api/.env`

Example for the current single-account sandbox setup:

```dotenv
PORT=3000
AIRWALLEX_BASE_URL=https://api.sandbox.airwallex.com
AIRWALLEX_CLIENT_ID=replace_with_your_sandbox_client_id
AIRWALLEX_API_KEY=replace_with_your_sandbox_scoped_api_key
AIRWALLEX_ACCOUNT_ID=replace_with_your_sandbox_account_id
```

Use your own authorized **Airwallex Sandbox** credentials and account ID, or get access instructions from the project owner. The scoped API key must be linked to—and have permission to access—the account being used.

Important:

- Use only the sandbox API URL shown above for local hackathon development.
- Do not use production credentials or a production API URL.
- Never commit `.env`, paste credentials into chat, or put secrets in Angular/frontend code.
- Do not send API keys or access tokens to teammates over Git. Use an approved secure method if credentials need to be shared.
- The repository `.gitignore` should ignore `.env` files. You can verify the local file is ignored with:

  ```bash
  git check-ignore apps/api/.env
  ```

If the backend's validated environment schema changes in a later commit—for example, if the project switches from `AIRWALLEX_ACCOUNT_ID` to `AIRWALLEX_ACCOUNT_IDS`—follow the variable names in the current `apps/api/src/config/env.ts` and update your local `.env` accordingly.

## 5. Start the backend

From the repository root, open a terminal and run:

```bash
npm run dev:api
```

The API should start on port `3000`.

Check the health endpoint:

<http://localhost:3000/api/health>

Expected response:

```json
{
  "status": "ok",
  "service": "kubera-api"
}
```

Then test the Airwallex sandbox balance endpoint:

<http://localhost:3000/api/airwallex/balances>

A successful response should contain the account ID and the validated sandbox balance data. This endpoint requires working Sandbox credentials and permissions.

Keep the backend terminal running while using the app.

## 6. Start the frontend

Open a **second terminal** at the repository root and run:

```bash
npm run dev:web
```

Open the local URL printed by Angular (currently expected to be `http://localhost:4200`). Keep both frontend and backend terminals running.

## 7. Current backend layout

The API is built with Express, TypeScript, and Zod. The source layout includes:

```text
apps/api/src/
├── config/
│   └── env.ts
├── integrations/
│   └── airwallex/
│       ├── airwallex.client.ts
│       └── airwallex.schemas.ts
├── middleware/
│   ├── app-error.ts
│   └── error-handler.ts
├── modules/
│   └── balances/
│       ├── balances.routes.ts
│       ├── balances.schema.ts
│       └── balances.service.ts
└── server.ts
```

- `config/env.ts` validates environment variables at startup and restricts the base URL to Sandbox.
- `integrations/airwallex/` contains the external API client and Zod schemas for Airwallex responses.
- `modules/balances/` contains the balance feature's routes, service, and schemas.
- `middleware/` contains shared API error handling.
- `server.ts` wires middleware and routes together.

## 8. Troubleshooting

### `401` from Airwallex

Check that the Client ID and scoped API key belong to the **Sandbox**, that the key is active, and that it has permission for the selected sandbox account. A rotated key must be replaced in your local `.env`.

### `403` from Airwallex

The key may not have the required resource permission, or the selected account may not be available to that key. Confirm the account is linked to the key and check the needed read scope.

### `502` from `/api/airwallex/balances`

Look at the backend terminal for the sanitized server-side error. Verify the Sandbox credentials, account ID, and network connectivity. Do not print or share access tokens or API keys when debugging.

### Port already in use

Stop the other process using port `3000` (backend) or `4200` (frontend), or coordinate with the team before changing the port. If you change the backend port, update any frontend API configuration that assumes port `3000`.

### Missing module or workspace errors

Return to the repository root, verify Node is version 22.x, then run:

```bash
npm install
```

## 9. Before opening a PR or pushing changes

Review your changes and confirm no secrets are included:

```bash
git status
git check-ignore apps/api/.env
```

Stage only the intended files, then commit and push your branch. For example, to commit only this guide:

```bash
git add KUBERA_TEAMMATE_SETUP.md
git commit -m "docs: add teammate setup guide"
git push origin main
```

If you also need to push application changes, review `git status` and stage those intended files explicitly before committing. Never use a commit that includes `.env` files.
