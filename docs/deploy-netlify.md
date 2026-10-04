# Test deployment: GitHub + Netlify + Supabase

Use this for a quick assessment environment. Production guidance remains in the README.

## 1. Supabase (database, login, file storage) - free tier is fine
1. Create a project at supabase.com (region: closest allowed, e.g. London).
2. Install the Supabase CLI, then from this folder:
   ```bash
   supabase link --project-ref YOUR_REF
   supabase db push                                   # applies supabase/migrations
   psql "YOUR_DATABASE_URL" -f supabase/seed.sql      # master checklist + reference data
   ```
   (Alternatively paste each file in supabase/migrations, in order, then seed.sql, into the SQL editor.)
3. Authentication > Providers > Email: turn OFF "Allow new users to sign up" (invite only).
4. Authentication > URL configuration: Site URL = your Netlify URL; add `https://YOUR-SITE.netlify.app/**` to Redirect URLs.
5. Authentication > Email templates: paste supabase/templates/invite.html, magic_link.html, recovery.html.
6. Project Settings > API: copy the URL, anon key and service_role key.

Emails: the free built-in mailer only sends a few emails per hour. For testing with real colleagues, set Authentication > SMTP to a firm mailbox.

## 2. Demo data (optional, recommended for assessment)
Create `.env.local` with the three Supabase values, then:
```bash
npm install
npm run seed:demo      # demo staff, Adebayo Group clients, engagements, files
```
All demo users get the password in DEMO_PASSWORD (default DemoPass#2026). See README for the account list.

## 3. GitHub
```bash
git remote add origin https://github.com/YOUR-USER/kp-pbc-portal.git
git push -u origin main
```
Make the repository **private**.

## 4. Netlify
1. Add new site > Import an existing project > GitHub > pick the repo. Netlify detects Next.js; netlify.toml sets Node 22.
2. Site configuration > Environment variables:
   | Key | Value |
   |---|---|
   | NEXT_PUBLIC_SUPABASE_URL | from Supabase |
   | NEXT_PUBLIC_SUPABASE_ANON_KEY | from Supabase |
   | SUPABASE_SERVICE_ROLE_KEY | from Supabase (mark as secret) |
   | NEXT_PUBLIC_SITE_URL | https://YOUR-SITE.netlify.app |
   | NEXT_PUBLIC_FIRM_NAME | Kreston Pedabo |
   | CLIENT_DIRECTORY_MODE | mock |
   | STORAGE_PROVIDER | supabase |
   | SUPABASE_STORAGE_BUCKET | pbc-files |
3. Deploy. Then put the final Netlify URL into Supabase Site URL / Redirect URLs (step 1.4) if it changed.

## 5. First administrator (if you did not run the demo seed)
Supabase > Authentication > Users > Invite user (your email), accept the email, then in the SQL editor:
```sql
update public.profiles set app_role = 'super_admin' where email = 'you@krestonpedabo.com';
```

## Notes for a test environment
- Use dummy or anonymised client documents only; this is not a production setup (no SharePoint, default Supabase backups).
- Serverless functions on Netlify have response size and time limits, so very large "Download all as ZIP" requests may fail there; normal test volumes are fine.
