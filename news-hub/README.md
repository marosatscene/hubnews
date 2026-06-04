# Smart News Hub

Standalone React and Tailwind news-aggregator UI extracted from the admin panel.

Run from the repository root:

```sh
npm run dev:news-hub
npm run build:news-hub
```

The admin panel imports the shared component from `news-hub/src`, while `news-hub/src/main.tsx` runs the same UI as an independent Vite app. The standalone app attempts to read the existing admin APIs when available and falls back to bundled demo news items when it is run without the backend.
