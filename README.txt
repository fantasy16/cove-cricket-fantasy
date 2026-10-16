Cove Cricket Fantasy — historical week editor and week reset fix

Files included: script.js and index.html only.

Install:
1. Back up your current root-level script.js and index.html.
2. Replace those two files in your GitHub repository with the files in this ZIP.
3. Commit and wait for GitHub Pages to deploy.
4. Refresh the site with Ctrl+F5 and sign in as admin.

What changed:
- Added an Editor week selector so you can view and edit old weeks without changing which week is live on the public site.
- Entering a week number that already exists now asks whether to reset that week instead of silently skipping to a different number. Resetting deletes that week’s fantasy teams/selections, player_week_points, and weekly squads/captain assignments; permanent player profiles and club-team definitions are kept.
- Creating a genuinely new week still makes it the live/current week and closes the previous live week.
- The Editor’s roster, team playing settings, week settings and four point inputs all operate on the selected Editor week.
- Points categories remain batting, bowling, fielding, and the existing winning/captaincy-bonus database field.

Resetting a week is permanent. The confirmation dialog lists the data that will be deleted. No database schema changes are required.
