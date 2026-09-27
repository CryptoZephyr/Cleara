# Cleara web app

The Cleara frontend and Devnet demo API. See the [root README](../README.md) for the product, the demo walkthrough,
environment variables and the program.

```bash
npm install
npm run dev        # UI only; use `npx vercel dev` to also serve /api/demo
npm run typecheck
npm run lint
npm run build
npm run build:api  # regenerate api/demo.js after changing server/
```
