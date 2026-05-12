import { redirect } from 'next/navigation';

// Root page — instant server-side redirect to /login.
// AppLayout and the login page's useEffect handle onward routing:
//   • Logged-in + approved  → login page redirects to /inventory-hub
//   • Logged-in, pending    → login page shows pending approval screen
//   • Not logged in         → login page is shown
export default function RootPage() {
  redirect('/login');
}
