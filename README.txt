Cove Cricket Fantasy — Admin Editor version

1. Run the Supabase SQL below once to make your account an admin:

update public.profiles p
set is_admin = true
from auth.users u
where p.id = u.id
  and u.email = 'YOUR ACCOUNT EMAIL';

2. Replace YOUR ACCOUNT EMAIL with the email you use to sign in.
3. Open index.html.
4. Sign in. The Editor button will appear in the top navigation when profiles.is_admin is true.

The Editor currently lets the admin change the current week's number/title, open or lock selections, and choose which club teams are playing.

Do not put a Supabase service-role/secret key in the browser. This project uses the publishable key only.
