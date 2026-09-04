COVE CRICKET FANTASY

This version connects the front end to the Supabase project.

Supabase project:
https://buappkzwllmfyevvdmfi.supabase.co

Current features:
- Supabase email/password sign in
- Account creation
- Current fantasy week loaded from Supabase
- Only teams marked as playing are selectable
- Exactly 2 players per playing team
- One fantasy captain chosen from the playing team captains
- Saved fantasy teams stored in Supabase
- Previous saved team is loaded when the user signs in

IMPORTANT:
The database schema from Step 1 must already be installed.

Next stage:
- Add real Cove players
- Set weekly teams/captains
- Add Editor/admin controls
- Add batting/bowling/fielding/winning points
- Build the live global leaderboard
- Build persistent player profiles and weekly history
- Add secure server-side validation for fantasy team rules

The browser uses the Supabase publishable key only. Never put a Supabase secret/service_role key into these files.


Sign-in troubleshooting
- In Supabase Authentication, make sure Email provider is enabled.
- If email confirmation is enabled, create an account, confirm the email, then sign in.
- Use the same email/password that was registered in this Supabase project.
