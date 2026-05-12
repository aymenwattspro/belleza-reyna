# 🚀 Supabase Setup Guide — Belleza Reyna Inventory Suite

Follow these steps **in order** to connect the app to Supabase so all users share the same database.

---

## Step 1 — Create a Supabase Project

1. Go to **[https://supabase.com](https://supabase.com)** and sign in (or create a free account).
2. Click **"New Project"**.
3. Choose an **Organization** (or create one).
4. Fill in:
   - **Name**: `belleza-reyna` (or anything you like)
   - **Database Password**: pick a strong password and **save it** somewhere safe
   - **Region**: choose the closest to you (e.g. US East, EU West, SA East)
5. Click **"Create new project"** — it takes ~2 minutes to provision.

---

## Step 2 — Get your API Keys

Once the project is ready:

1. Go to **Settings** (gear icon, left sidebar) → **API**.
2. Copy two values:
   - **Project URL** → looks like `https://abcdefghijkl.supabase.co`
   - **anon / public key** → a long JWT string starting with `eyJ...`

---

## Step 3 — Create your `.env.local` file

In the root of this project (`c:\Users\aymen\OneDrive\Desktop\reina\`), create a file called **`.env.local`** with:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_PUBLIC_KEY
```

Replace the placeholder values with the ones from Step 2.

> ⚠️ **Never commit `.env.local` to git** — it is already listed in `.gitignore`.

---

## Step 4 — Run the Database Schema

1. In your Supabase Dashboard, go to **SQL Editor** (left sidebar).
2. Click **"New Query"**.
3. Open the file `supabase-schema.sql` from the root of this project.
4. **Copy the entire file contents** and paste them into the SQL Editor.
5. Click **"Run"** (or press `Ctrl+Enter`).

This will create 5 tables:
| Table | Purpose |
|---|---|
| `inventory_snapshots` | Each file import event |
| `inventory_products` | Products within each snapshot |
| `product_settings` | Stock targets per product (shared) |
| `confirmed_orders` | Confirmed purchase orders |
| `order_items` | Line items per order |

---

## Step 4b — Run the User Approval Migration ⚠️ REQUIRED

> **This step is required** for the user access control system to work. Without it, new accounts will always be blocked from accessing the app.

1. In your Supabase Dashboard, go to **SQL Editor** (left sidebar).
2. Click **"New Query"**.
3. Open the file **`supabase-approval-migration.sql`** from the root of this project.
4. **Copy the entire file contents** and paste them into the SQL Editor.
5. Click **"Run"**.

This creates:
| Object | Purpose |
|---|---|
| `profiles` table | Stores each user's approval status (`approved = false` by default) |
| Auto-create trigger | Automatically creates a profile row for every new signup with `approved = false` |
| RLS policy | Each user can read only their own profile |

### 🔐 How to approve a user

After a user signs up, they will see a **"Access Pending Approval"** screen. To grant them access:

1. Go to your **Supabase Dashboard** → **Table Editor** → `profiles` table.
2. Find the row for the user you want to approve (check the `email` column).
3. Click the row to edit it.
4. Set the `approved` column to **`true`**.
5. Click **Save**.

The user will be able to access the app on their next page load (or immediately if they are already on the pending screen).

> 💡 **Tip**: You can also run this SQL to approve a specific user quickly:
> ```sql
> UPDATE public.profiles SET approved = true WHERE email = 'user@example.com';
> ```

---

## Step 5 — Configure Email Confirmation (Optional)

By default, Supabase sends a confirmation email when a user signs up.

**Option A — Keep email confirmation ON** *(recommended for production)*
- Users receive an email, click the link, then can sign in.

**Option B — Disable email confirmation** *(easier for testing)*
1. Go to **Authentication** → **Providers** → **Email**
2. Toggle off **"Confirm email"**
3. Users can sign in immediately after signing up.

---

## Step 6 — Start the App

```bash
npm run dev
```

Open **http://localhost:3000** — you will be redirected to the login page.

1. Click **"Sign Up"** tab
2. Enter your email, name, and password
3. (If email confirmation is on, check your inbox first)
4. Sign in — you're connected to the shared database!

---

## Step 7 — Invite Other Users

Any person with access to the app can create their own account via the **Sign Up** tab on the login page. All accounts share **the same inventory data, orders, and settings** — there is no per-user isolation.

If you want to restrict who can sign up (invite-only), go to **Authentication** → **Settings** and disable **"Enable Signups"** after your team has registered — then only your existing users can log in.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| "Invalid API key" error | Double-check your `.env.local` values match the Supabase dashboard |
| "relation does not exist" error | Make sure you ran the schema SQL in Step 4 |
| Users not redirected after signup | Disable email confirmation (Step 5 Option B) |
| Data not saving | Check RLS policies were created correctly (re-run the schema SQL) |
| Build fails | Run `npm run build` and check the error — most likely a missing env variable |

---

## Architecture Summary

```
Browser → Next.js App → Supabase (PostgreSQL)
                 ↕
          @supabase/ssr   ← handles auth cookies automatically
          @supabase/supabase-js  ← database queries
```

- **Auth**: Supabase handles JWT sessions via secure cookies
- **Database**: PostgreSQL with Row Level Security (RLS)
- **Real-time** (future): Supabase supports real-time subscriptions if you want live updates across multiple tabs/users

---

*Guide generated for Belleza Reyna Inventory Suite — Powered by Supabase*
