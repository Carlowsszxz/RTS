# Vercel deployment guide

## Prerequisites

- Push the project to GitHub.
- Use the frontend app in this repository, not the ESP32 firmware files.
- Create Supabase environment variables for the web app:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

## 1) Push to GitHub

If the repo is not already on GitHub:

1. Create a new GitHub repository.
2. Commit and push the current project.

## 2) Import into Vercel

1. Open Vercel.
2. Select Add New > Project.
3. Import the GitHub repository.
4. Let Vercel detect the project as Vite.

## 3) Configure build settings

- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

## 4) Add environment variables

In the Vercel project settings, add:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 5) Deploy

Deploy the project. The included `vercel.json` keeps client-side routing working on refresh.

## 6) Verify

After deployment, test:

- `/`
- `/login`
- `/dashboard`
- `/settings`

If the app shows a blank page or auth errors, re-check the env vars and Supabase RLS policies.