Cove Cricket Fantasy — fixed Editor + fantasy captain schema

IMPORTANT:
1. Run supabase-fix.sql in your Supabase SQL Editor.
2. In that SQL file, set the admin account with the final UPDATE statement.
3. Replace your old website files with index.html, style.css and script.js.
4. Sign in and refresh. The Editor button is now visible whenever signed in.
5. If the account is not an admin, the Editor page explains that admin access is required.

The website uses fantasy_teams.captain_player_id for the fantasy captain. The SQL migration also converts an older fantasy_captain or "fantasy captain" column if one exists.
