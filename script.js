const SUPABASE_URL = "https://buappkzwllmfyevvdmfi.supabase.co";
const SUPABASE_KEY = "sb_publishable_a0MvZqJwZAbd5FyruLEH7A_QQBcXYY1";

let supabaseClient = null;

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    throw new Error("Supabase could not be loaded. Check your internet connection and make sure the Supabase script is allowed to load.");
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return supabaseClient;
}

let currentUser = null;
let currentWeek = null;
let selected = new Map();
let fantasyCaptain = null;
let teams = [];
let authMode = "login";

const teamsEl = document.getElementById("teams");
const capsEl = document.getElementById("captains");
const toast = document.getElementById("toast");
const authModal = document.getElementById("authModal");
const authMessage = document.getElementById("authMessage");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function notify(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

async function loadWeek() {
  const { data, error } = await getSupabaseClient()
    .from("weeks")
    .select("*")
    .eq("is_current", true)
    .maybeSingle();

  if (error) {
    notify("Could not load the current week: " + error.message);
    return;
  }

  if (!data) {
    notify("No current fantasy week has been created yet.");
    return;
  }

  currentWeek = data;
  document.getElementById("weekNumber").textContent = "Week " + data.week_number;
  document.getElementById("leaderboardWeek").textContent = "Week " + data.week_number;
  document.getElementById("weekStatus").textContent =
    data.selections_open ? "Selections are open" : "Selections are locked";
  document.getElementById("weekOpen").textContent =
    data.selections_open ? "● Open" : "● Locked";
  document.getElementById("weekOpen").className =
    data.selections_open ? "open" : "team-off";
}

async function loadWeekTeams() {
  if (!currentWeek) return;

  const { data, error } = await getSupabaseClient()
    .from("week_teams")
    .select(`
      id,
      playing,
      captain_player_id,
      team_id,
      club_teams (id, name, sort_order),
      captain:players!week_teams_captain_player_id_fkey (id, full_name)
    `)
    .eq("week_id", currentWeek.id)
    .order("team_id");

  if (error) {
    notify("Could not load teams: " + error.message);
    teams = [];
    render();
    return;
  }

  const rows = data || [];

  if (!rows.length) {
    teams = [];
    render();
    return;
  }

  const teamObjects = [];

  for (const row of rows) {
    let playerRows = [];

    const { data: wp, error: wpError } = await getSupabaseClient()
      .from("week_players")
      .select(`
        id,
        player_id,
        players (id, full_name)
      `)
      .eq("week_team_id", row.id);

    if (wpError) {
      notify("Could not load players: " + wpError.message);
      continue;
    }

    playerRows = (wp || []).map((item) => ({
      id: item.player_id,
      name: item.players?.full_name || "Unnamed player"
    }));

    teamObjects.push({
      id: row.team_id,
      weekTeamId: row.id,
      name: row.club_teams?.name || "Team",
      sortOrder: row.club_teams?.sort_order || 99,
      playing: !!row.playing,
      captainId: row.captain_player_id,
      captainName: row.captain?.full_name || "Captain not set",
      players: playerRows
    });
  }

  teams = teamObjects.sort((a,b) => a.sortOrder - b.sortOrder);
  render();
}

async function loadSavedTeam() {
  if (!currentUser || !currentWeek) return;

  const { data: saved, error } = await getSupabaseClient()
    .from("fantasy_teams")
    .select("id, captain_player_id")
    .eq("user_id", currentUser.id)
    .eq("week_id", currentWeek.id)
    .maybeSingle();

  if (error) {
    notify("Could not load your saved team: " + error.message);
    return;
  }

  selected.clear();
  fantasyCaptain = saved?.captain_player_id || null;

  if (saved) {
    const { data: items, error: itemsError } = await getSupabaseClient()
      .from("fantasy_team_players")
      .select("player_id")
      .eq("fantasy_team_id", saved.id);

    if (!itemsError) {
      for (const item of items || []) selected.set(item.player_id, item.player_id);
    }
  }

  render();
}

function render() {
  teamsEl.innerHTML = "";
  capsEl.innerHTML = "";

  teams.forEach((team) => {
    const card = document.createElement("div");
    card.className = "team";

    const head = document.createElement("div");
    head.className = "team-head";
    head.innerHTML = `
      <span>${escapeHtml(team.name)}</span>
      <small>${team.playing ? "Select 2" : "Not playing"}</small>
    `;
    card.appendChild(head);

    if (!team.playing) {
      const off = document.createElement("div");
      off.className = "player";
      off.innerHTML = `<div class="team-off">This team is not playing this week.</div>`;
      card.appendChild(off);
    } else if (!team.players.length) {
      const empty = document.createElement("div");
      empty.className = "player";
      empty.innerHTML = `<div class="team-off">Players have not been added yet.</div>`;
      card.appendChild(empty);
    } else {
      team.players.forEach((player) => {
        const row = document.createElement("div");
        const isSelected = selected.has(player.id);
        row.className = "player" + (isSelected ? " selected" : "");
        row.innerHTML = `
          <div class="player-info">
            <div class="player-name">${escapeHtml(player.name)}</div>
            <div class="role">${team.name}</div>
          </div>
        `;

        const button = document.createElement("button");
        button.className = isSelected ? "primary" : "secondary";
        button.textContent = isSelected ? "Selected" : "Select";
        button.disabled = !currentWeek?.selections_open;
        button.addEventListener("click", () => togglePlayer(team, player));

        row.appendChild(button);
        card.appendChild(row);
      });
    }

    teamsEl.appendChild(card);
  });

  teams.forEach((team) => {
    const captain = document.createElement("button");
    captain.type = "button";
    captain.className =
      "captain-card" + (fantasyCaptain === team.captainId ? " selected" : "");
    captain.disabled = !team.playing || !team.captainId || !currentWeek?.selections_open;
    captain.innerHTML = `
      <div class="cap-badge">C</div>
      <div class="cap-name">${escapeHtml(team.captainName)}</div>
      <div class="cap-team">${escapeHtml(team.name)}</div>
    `;
    captain.addEventListener("click", () => {
      fantasyCaptain = fantasyCaptain === team.captainId ? null : team.captainId;
      render();
    });
    capsEl.appendChild(captain);
  });

  const playingTeams = teams.filter(t => t.playing);
  const expected = playingTeams.length * 2;

  document.getElementById("selectedText").textContent =
    `${selected.size} player${selected.size === 1 ? "" : "s"} selected`;
  document.getElementById("captainText").textContent =
    fantasyCaptain
      ? `Captain: ${findCaptainName(fantasyCaptain)}`
      : "Captain: not chosen";
  document.getElementById("captainStatus").textContent =
    fantasyCaptain ? findCaptainTeam(fantasyCaptain) : "No captain";
  document.getElementById("counter").textContent =
    `${selected.size} / ${expected} players`;

  document.getElementById("loginNotice").classList.toggle("hidden", !!currentUser);
  document.getElementById("loginBtn").textContent =
    currentUser ? "Account" : "Sign in";
}

function findCaptainName(id) {
  for (const team of teams) {
    if (team.captainId === id) return team.captainName;
  }
  return "Selected captain";
}

function findCaptainTeam(id) {
  for (const team of teams) {
    if (team.captainId === id) return team.name;
  }
  return "Captain";
}

function teamSelectedCount(team) {
  return team.players.filter(p => selected.has(p.id)).length;
}

function togglePlayer(team, player) {
  if (!currentWeek?.selections_open) {
    notify("Selections are locked.");
    return;
  }

  if (selected.has(player.id)) {
    selected.delete(player.id);
  } else {
    if (teamSelectedCount(team) >= 2) {
      notify(`You can only select 2 players from ${team.name}.`);
      return;
    }
    selected.set(player.id, player.id);
  }

  render();
}

async function saveTeam() {
  if (!currentUser) {
    openAuth("login");
    notify("Sign in before saving your team.");
    return;
  }

  if (!currentWeek) {
    notify("There is no current week.");
    return;
  }

  if (!currentWeek.selections_open) {
    notify("Selections are locked.");
    return;
  }

  const playingTeams = teams.filter(t => t.playing);

  for (const team of playingTeams) {
    if (teamSelectedCount(team) !== 2) {
      notify(`Select exactly 2 players from ${team.name}.`);
      return;
    }
  }

  if (fantasyCaptain === null) {
    notify("Choose one of the playing team captains.");
    return;
  }

  const captainTeam = teams.find(t => t.captainId === fantasyCaptain);
  if (!captainTeam || !captainTeam.playing) {
    notify("Your fantasy captain must be a captain of a playing team.");
    return;
  }

  const { data: existing, error: existingError } = await getSupabaseClient()
    .from("fantasy_teams")
    .select("id")
    .eq("user_id", currentUser.id)
    .eq("week_id", currentWeek.id)
    .maybeSingle();

  if (existingError) {
    notify(existingError.message);
    return;
  }

  let fantasyTeamId = existing?.id;

  if (fantasyTeamId) {
    const { error } = await getSupabaseClient()
      .from("fantasy_teams")
      .update({ captain_player_id: fantasyCaptain })
      .eq("id", fantasyTeamId);

    if (error) {
      notify(error.message);
      return;
    }

    const { error: deleteError } = await getSupabaseClient()
      .from("fantasy_team_players")
      .delete()
      .eq("fantasy_team_id", fantasyTeamId);

    if (deleteError) {
      notify(deleteError.message);
      return;
    }
  } else {
    const { data, error } = await getSupabaseClient()
      .from("fantasy_teams")
      .insert({
        user_id: currentUser.id,
        week_id: currentWeek.id,
        captain_player_id: fantasyCaptain
      })
      .select("id")
      .single();

    if (error) {
      notify(error.message);
      return;
    }

    fantasyTeamId = data.id;
  }

  const rows = [...selected.keys()].map(playerId => ({
    fantasy_team_id: fantasyTeamId,
    player_id: playerId
  }));

  const { error: insertError } = await getSupabaseClient()
    .from("fantasy_team_players")
    .insert(rows);

  if (insertError) {
    notify(insertError.message);
    return;
  }

  notify("✅ Team saved to Supabase.");
}

function openAuth(mode) {
  authMode = mode;
  authModal.classList.remove("hidden");
  authModal.setAttribute("aria-hidden", "false");
  authMessage.textContent = "";
  document.getElementById("authTitle").textContent =
    mode === "login" ? "Sign in" : "Create an account";
  document.getElementById("authSubtitle").textContent =
    mode === "login"
      ? "Sign in to save your fantasy team."
      : "Create an account so your fantasy team can be saved.";
  document.getElementById("authPrimary").textContent =
    mode === "login" ? "Sign in" : "Create account";
  document.getElementById("authSwitch").textContent =
    mode === "login" ? "Create account" : "I already have an account";
}

function closeAuth() {
  authModal.classList.add("hidden");
  authModal.setAttribute("aria-hidden", "true");
}

async function submitAuth(event) {
  if (event) event.preventDefault();

  const emailInput = document.getElementById("authEmail");
  const passwordInput = document.getElementById("authPassword");
  const primary = document.getElementById("authPrimary");
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !email.includes("@")) {
    authMessage.textContent = "Enter a valid email address.";
    emailInput.focus();
    return;
  }
  if (password.length < 6) {
    authMessage.textContent = "Password must be at least 6 characters.";
    passwordInput.focus();
    return;
  }

  primary.disabled = true;
  authMessage.textContent = "Signing in…";

  try {
    const client = getSupabaseClient();
    let result;

    if (authMode === "login") {
      result = await client.auth.signInWithPassword({ email, password });
    } else {
      result = await client.auth.signUp({ email, password });
    }

    if (result.error) {
      authMessage.textContent = result.error.message || "Sign in failed.";
      return;
    }

    if (authMode === "signup" && !result.data.session) {
      authMessage.textContent = "Account created. Email confirmation may be required in Supabase before you can sign in.";
      return;
    }

    closeAuth();
    notify(authMode === "login" ? "✅ Signed in." : "✅ Account created and signed in.");
    await refreshUser();
  } catch (error) {
    console.error(error);
    authMessage.textContent = error?.message || "Something went wrong while connecting to Supabase.";
  } finally {
    primary.disabled = false;
  }
}

async function refreshUser() {
  try {
    const { data, error } = await getSupabaseClient().auth.getUser();
    if (error) throw error;
    currentUser = data.user || null;

    if (currentUser) await loadSavedTeam();
    render();
  } catch (error) {
    currentUser = null;
    render();
    console.error(error);
  }
}

document.getElementById("saveBtn").addEventListener("click", saveTeam);

document.getElementById("loginBtn").addEventListener("click", () => {
  if (currentUser) {
    const shouldLogout = window.confirm ? window.confirm("Log out of Cove Cricket Fantasy?") : true;
    if (!shouldLogout) return;
    getSupabaseClient().auth.signOut().then(({ error }) => {
      if (error) { notify("Could not log out: " + error.message); return; }
      currentUser = null;
      selected.clear();
      fantasyCaptain = null;
      notify("You have been logged out.");
      render();
    }).catch(error => notify(error?.message || "Could not log out."));
    return;
  }
  openAuth("login");
});

document.getElementById("closeAuth").addEventListener("click", closeAuth);
document.getElementById("authForm").addEventListener("submit", submitAuth);
document.getElementById("authSwitch").addEventListener("click", () => {
  openAuth(authMode === "login" ? "signup" : "login");
});

authModal.addEventListener("click", (event) => {
  if (event.target === authModal) closeAuth();
});

try {
  getSupabaseClient().auth.onAuthStateChange(() => {
    setTimeout(() => { refreshUser().catch(error => console.error(error)); }, 0);
  });
} catch (error) {
  console.error(error);
}

async function start() {
  await loadWeek();
  await loadWeekTeams();
  await refreshUser();
  render();
}

start();
