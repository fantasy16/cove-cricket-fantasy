COVE CRICKET FANTASY — EDITOR REPAIR

Website files
1. Replace script.js, index.html and style.css in the ROOT of your existing GitHub Pages repository with the files in this folder.
2. Commit the changes and wait for GitHub Pages to deploy.
3. Open the site and hard-refresh with Ctrl+F5, then sign in to the configured admin account.

Supabase permissions (one-time)
Run supabase-editor-permissions.sql in Supabase Dashboard > SQL Editor. This enables the new add/remove team controls and safe admin cleanup when deleting player profiles. The database profile for the admin must still have is_admin = true; making the Editor button visible in JavaScript does not bypass database security.

Editor features
- Week number/title and selection open/closed controls.
- Start a new week, including when there is no current week.
- Add/remove club teams and select which teams are playing.
- Choose the 11 weekly players for each team from saved player profiles and set each team's real captain.
- Add/delete player profiles.
- Edit batting, bowling, fielding and the existing winning/captaincy-bonus points field for each assigned player.

Removing a team deletes its weekly team slots and roster assignments for every week. Removing a player deletes that player's weekly entries, points, fantasy-team selection entries and captain references. Both actions ask for confirmation and are permanent.
