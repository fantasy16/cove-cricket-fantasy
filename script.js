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
let isAdmin = false;
let publicPlayerCache = [];
let publicHistoryCache = new Map();
let publicAssignmentsCache = new Map();

const teamsEl = document.getElementById("teams");
const capsEl = document.getElementById("captains");
const toast = document.getElementById("toast");
const authModal = document.getElementById("authModal");
const authMessage = document.getElementById("authMessage");
const editorNav = document.getElementById("editorNav");
const editorSection = document.getElementById("editor");

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

  if (isAdmin) {
    try {
      await ensureWeekTeams(currentWeek.id);
    } catch (error) {
      notify("Could not prepare this week's teams: " + error.message);
      teams = [];
      return;
    }
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("week_teams")
    .select(`id, playing, captain_player_id, team_id, club_teams (id, name, sort_order)`)
    .eq("week_id", currentWeek.id);

  if (error) {
    notify("Could not load teams: " + error.message);
    teams = [];
    return;
  }

  const teamObjects = [];
  for (const row of data || []) {
    const { data: wp, error: wpError } = await client
      .from("week_players")
      .select("id, player_id")
      .eq("week_team_id", row.id);
    if (wpError) {
      notify("Could not load team players: " + wpError.message);
      continue;
    }

    const playerIds = (wp || []).map(x => x.player_id);
    let playerRows = [];
    if (playerIds.length) {
      const { data: pRows, error: pError } = await client
        .from("players")
        .select("id, full_name")
        .in("id", playerIds);
      if (pError) {
        notify("Could not load player profiles: " + pError.message);
      } else {
        const byId = new Map((pRows || []).map(p => [p.id, p]));
        playerRows = playerIds.map(id => ({ id, name: byId.get(id)?.full_name || "Unnamed player" }));
      }
    }

    let captainName = "Captain not set";
    if (row.captain_player_id) {
      const { data: captainRow } = await client
        .from("players").select("id, full_name").eq("id", row.captain_player_id).maybeSingle();
      captainName = captainRow?.full_name || captainName;
    }

    teamObjects.push({
      id: row.team_id,
      weekTeamId: row.id,
      name: row.club_teams?.name || "Team",
      sortOrder: row.club_teams?.sort_order || 99,
      playing: !!row.playing,
      captainId: row.captain_player_id,
      captainName,
      players: playerRows
    });
  }

  teams = teamObjects.sort((a,b) => a.sortOrder - b.sortOrder);
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
  renderEditor();
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

async function loadAdminStatus() {
  isAdmin = false;
  if (!currentUser) return;
  try {
    const { data, error } = await getSupabaseClient()
      .from("profiles")
      .select("id, username, display_name, is_admin")
      .eq("id", currentUser.id)
      .maybeSingle();
    if (error) throw error;
    isAdmin = data?.is_admin === true;
  } catch (error) {
    console.error("Could not load admin profile", error);
    isAdmin = false;
  }
}

function editorMessage(text, error = false) {
  const el = document.getElementById("editorMessage");
  if (!el) return;
  el.textContent = text;
  el.style.color = error ? "#b42318" : "#687789";
}

async function renderEditor() {
  if (!editorNav || !editorSection) return;
  editorNav.classList.toggle("hidden", !isAdmin);
  if (!isAdmin || !currentUser || !currentWeek) {
    editorSection.classList.add("hidden");
    return;
  }
  editorSection.classList.remove("hidden");

  try { await ensureWeekTeams(currentWeek.id); }
  catch (error) { editorMessage(error?.message || "Could not prepare the five team slots.", true); return; }

  document.getElementById("editWeekNumber").value = currentWeek.week_number ?? 1;
  document.getElementById("editWeekTitle").value = currentWeek.title ?? "";
  document.getElementById("editSelectionsOpen").checked = !!currentWeek.selections_open;

  const client = getSupabaseClient();
  const { data: profiles, error: profilesError } = await client
    .from("players").select("id, full_name").order("full_name");
  if (profilesError) {
    editorMessage("Could not load player profiles: " + profilesError.message, true);
    return;
  }
  const profileList = profiles || [];

  await loadWeekTeams();

  const teamChecks = document.getElementById("editorTeams");
  teamChecks.innerHTML = teams.map(team => {
    const ids = team.players.map(p => p.id);
    const rosterOptions = Array.from({length: 11}, (_, i) => {
      const selectedId = ids[i] || "";
      const options = [`<option value="">Choose player ${i + 1}</option>`]
        .concat(profileList.map(p => `<option value="${escapeHtml(p.id)}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(p.full_name || "Unnamed player")}</option>`));
      return `<label class="roster-slot"><span>Player ${i + 1}</span><select data-roster-team="${escapeHtml(team.weekTeamId)}" data-roster-slot="${i}">${options.join("")}</select></label>`;
    }).join("");
    const captainOptions = [`<option value="">Choose captain</option>`]
      .concat(profileList.map(p => `<option value="${escapeHtml(p.id)}" ${p.id === team.captainId ? "selected" : ""}>${escapeHtml(p.full_name || "Unnamed player")}</option>`));
    return `<div class="editor-team-card">
      <label class="check-row"><input type="checkbox" data-editor-team="${escapeHtml(team.id)}" ${team.playing ? "checked" : ""}><strong>${escapeHtml(team.name)}</strong></label>
      <label>Real team captain<select data-editor-captain="${escapeHtml(team.id)}">${captainOptions.join("")}</select></label>
      <div class="roster-grid">${rosterOptions}</div>
      <div class="roster-note">${team.players.length} / 11 players currently saved</div>
    </div>`;
  }).join("");

  const profileLibrary = document.getElementById("editorProfileLibrary");
  profileLibrary.innerHTML = profileList.length
    ? profileList.map(p => `<div class="profile-row"><strong>${escapeHtml(p.full_name || "Unnamed player")}</strong><span>Permanent profile</span><button type="button" class="danger profile-remove" data-remove-player="${escapeHtml(p.id)}" data-remove-player-name="${escapeHtml(p.full_name || "Unnamed player")}">Remove</button></div>`).join("")
    : `<div class="notice"><strong>No player profiles yet.</strong><span>Create them once below. After that, use the dropdowns above every week.</span></div>`;

  const points = document.getElementById("editorPoints");
  const playingTeams = teams.filter(team => team.playing).sort((a,b) => a.sortOrder - b.sortOrder);
  const allPlayers = playingTeams.flatMap(team => team.players.map(p => ({...p, teamName: team.name})));
  points.innerHTML = allPlayers.length ? playingTeams.map(team => `
    <div class="points-team-group">
      <h4>${escapeHtml(team.name)}</h4>
      ${team.players.map(p => `<div class="point-row" data-point-player="${escapeHtml(p.id)}">
        <div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(team.name)}</small></div>
        <input type="number" min="0" step="1" data-point="batting" placeholder="Batting">
        <input type="number" min="0" step="1" data-point="bowling" placeholder="Bowling">
        <input type="number" min="0" step="1" data-point="fielding" placeholder="Fielding">
        <input type="number" min="0" step="1" data-point="winning" placeholder="Winning">
      </div>`).join("")}
    </div>`).join("") : `<div class="notice"><strong>No playing-team players assigned.</strong><span>Tick the teams that are playing and choose their 11 players above.</span></div>`;
  await loadCurrentPointValues(allPlayers);
  document.querySelectorAll("[data-remove-player]").forEach(button => {
    button.addEventListener("click", () => removePlayerProfile(button.getAttribute("data-remove-player"), button.getAttribute("data-remove-player-name")));
  });
}

async function savePlayerAssignments() {
  if (!isAdmin || !currentWeek) return editorMessage("You need Admin access to assign player profiles.", true);
  editorMessage("Saving weekly team rosters…");
  try {
    const client = getSupabaseClient();
    await ensureWeekTeams(currentWeek.id);
    const rosterRows = [];
    const seenByTeam = new Map();
    for (const team of teams) {
      const selects = [...document.querySelectorAll(`[data-roster-team="${CSS.escape(team.weekTeamId)}"]`)];
      const ids = selects.map(s => s.value).filter(Boolean);
      if (team.playing && ids.length !== 11) throw new Error(`${team.name} is marked as playing, so choose exactly 11 player profiles.`);
      if (new Set(ids).size !== ids.length) throw new Error(`${team.name} has the same player selected more than once.`);
      seenByTeam.set(team.weekTeamId, ids);
      ids.forEach(player_id => rosterRows.push({week_team_id: team.weekTeamId, player_id}));
    }
    const allAssigned = [];
    for (const ids of seenByTeam.values()) allAssigned.push(...ids);
    if (new Set(allAssigned).size !== allAssigned.length) throw new Error("A player cannot be assigned to more than one team in the same week.");

    const { data: weekTeamRows, error: teamError } = await client.from("week_teams").select("id").eq("week_id", currentWeek.id);
    if (teamError) throw teamError;
    for (const row of weekTeamRows || []) {
      const { error } = await client.from("week_players").delete().eq("week_team_id", row.id);
      if (error) throw error;
    }
    if (rosterRows.length) { const { error } = await client.from("week_players").insert(rosterRows); if (error) throw error; }

    // Captains are stored with the team and must be one of that team's selected players.
    for (const team of teams) {
      const captain = document.querySelector(`[data-editor-captain="${CSS.escape(team.id)}"]`)?.value || null;
      const ids = seenByTeam.get(team.weekTeamId) || [];
      if (captain && !ids.includes(captain)) throw new Error(`${team.name}: the real captain must be one of the 11 selected players.`);
      const { error } = await client.from("week_teams").update({captain_player_id: captain}).eq("id", team.weekTeamId);
      if (error) throw error;
    }
    editorMessage("✅ Weekly team rosters and captains saved.");
    await loadWeekTeams();
    await renderEditor();
    await Promise.all([loadPublicProfiles(), loadLeaderboard()]);
  } catch (error) { console.error(error); editorMessage(error?.message || "Could not save weekly rosters.", true); }
}

async function removePlayerProfile(playerId, playerName) {
  if (!isAdmin) return editorMessage("You need Admin access to remove player profiles.", true);
  if (!playerId) return;
  if (!confirm(`Remove the permanent profile for ${playerName}? This only works if the player is not used in saved weekly/fantasy data.`)) return;
  try {
    const client = getSupabaseClient();
    const checks = [["week_players","player_id"],["player_week_points","player_id"],["fantasy_team_players","player_id"]];
    for (const [table, column] of checks) {
      const { data, error } = await client.from(table).select(column).eq(column, playerId).limit(1);
      if (error) throw error;
      if ((data || []).length) throw new Error(`${playerName} is already used in saved fantasy data. Remove those weekly records first.`);
    }
    const { error } = await client.from("players").delete().eq("id", playerId);
    if (error) throw error;
    editorMessage(`✅ ${playerName} profile removed.`);
    await renderEditor();
  } catch (error) {
    console.error(error);
    editorMessage(error?.message || "Could not remove player profile.", true);
  }
}

async function addPlayerProfilesBulk() {
  if (!isAdmin) return editorMessage("You need Admin access to add player profiles.", true);
  const input = document.getElementById("newPlayerNames");
  const names = [...new Set(input.value.split(/\r?\n|,/).map(x => x.trim()).filter(Boolean))];
  if (!names.length) return editorMessage("Enter one or more player names, one per line.", true);
  editorMessage("Creating player profiles…");
  try {
    const client = getSupabaseClient();
    const { data: existing, error: existingError } = await client.from("players").select("full_name");
    if (existingError) throw existingError;
    const existingNames = new Set((existing || []).map(p => (p.full_name || "").trim().toLowerCase()));
    const newNames = names.filter(n => !existingNames.has(n.toLowerCase()));
    if (newNames.length) { const { error } = await client.from("players").insert(newNames.map(full_name => ({full_name}))); if (error) throw error; }
    input.value = "";
    editorMessage(`✅ ${newNames.length} new profile${newNames.length === 1 ? "" : "s"} created. Profiles are permanent.`);
    await renderEditor();
  } catch (error) { console.error(error); editorMessage(error?.message || "Could not create player profiles.", true); }
}

async function loadCurrentPointValues(players) {
  if (!currentWeek || !players.length) return;
  try {
    const { data, error } = await getSupabaseClient()
      .from("player_week_points")
      .select("player_id, batting, bowling, fielding, winning")
      .eq("week_id", currentWeek.id);
    if (error) throw error;
    const byPlayer = new Map((data || []).map(row => [row.player_id, row]));
    document.querySelectorAll("[data-point-player]").forEach(row => {
      const vals = byPlayer.get(row.getAttribute("data-point-player"));
      if (!vals) return;
      row.querySelector('[data-point="batting"]').value = vals.batting ?? 0;
      row.querySelector('[data-point="bowling"]').value = vals.bowling ?? 0;
      row.querySelector('[data-point="fielding"]').value = vals.fielding ?? 0;
      row.querySelector('[data-point="winning"]').value = vals.winning ?? 0;
    });
  } catch (error) {
    console.error("Could not load points", error);
  }
}

async function ensureWeekTeams(weekId) {
  const client = getSupabaseClient();
  const { data: existing, error } = await client
    .from("week_teams")
    .select("team_id")
    .eq("week_id", weekId);
  if (error) throw error;

  const existingIds = new Set((existing || []).map(x => x.team_id));
  const { data: clubTeams, error: teamError } = await client
    .from("club_teams")
    .select("id, name, sort_order")
    .order("sort_order");
  if (teamError) throw teamError;

  const missing = (clubTeams || []).filter(t => !existingIds.has(t.id));
  if (!missing.length) return;

  const { error: insertError } = await client
    .from("week_teams")
    .insert(missing.map(t => ({ week_id: weekId, team_id: t.id, playing: false, captain_player_id: null })));
  if (insertError) throw insertError;
}

async function saveEditorSettings() {
  if (!isAdmin || !currentWeek) return editorMessage("You need Admin access to use the Editor.", true);
  editorMessage("Saving week settings and playing teams…");
  try {
    const client = getSupabaseClient();
    await ensureWeekTeams(currentWeek.id);
    const weekNumber = Math.max(1, Math.min(999, Number(document.getElementById("editWeekNumber").value) || 1));
    const title = document.getElementById("editWeekTitle").value.trim() || `Week ${weekNumber}`;
    const selectionsOpen = document.getElementById("editSelectionsOpen").checked;
    const { error } = await client.from("weeks").update({week_number: weekNumber, title, selections_open: selectionsOpen}).eq("id", currentWeek.id);
    if (error) throw error;

    const checks = [...document.querySelectorAll("[data-editor-team]")];
    for (const checkbox of checks) {
      const teamId = checkbox.getAttribute("data-editor-team");
      const { error: teamError } = await client.from("week_teams")
        .update({ playing: checkbox.checked })
        .eq("week_id", currentWeek.id)
        .eq("team_id", teamId);
      if (teamError) throw teamError;
    }

    editorMessage("✅ Week settings and playing teams saved.");
    await loadWeek();
    await loadWeekTeams();
    await renderEditor();
    await Promise.all([loadPublicProfiles(), loadLeaderboard()]);
  } catch (error) {
    console.error(error);
    editorMessage(error?.message || "Could not save week settings and playing teams.", true);
  }
}

async function startNewWeek() {
  if (!isAdmin) return editorMessage("You need Admin access to start a week.", true);
  const number = Math.max(1, Math.min(999, Number(document.getElementById("newWeekNumber").value) || ((currentWeek?.week_number || 0) + 1)));
  const title = document.getElementById("newWeekTitle").value.trim() || `Week ${number}`;
  editorMessage("Creating new week…");
  try {
    const client = getSupabaseClient();
    const { error: oldError } = await client.from("weeks").update({ is_current: false }).eq("is_current", true);
    if (oldError) throw oldError;
    const { data, error } = await client.from("weeks").insert({
      week_number: number, title, is_current: true, selections_open: false
    }).select("*").single();
    if (error) throw error;
    await ensureWeekTeams(data.id);
    editorMessage(`✅ ${title} created. Select which teams are playing, then choose their 11 player profiles.`);
    await loadWeek();
    await loadWeekTeams();
    renderEditor();
  } catch (error) {
    console.error(error);
    editorMessage(error?.message || "Could not create the new week.", true);
  }
}

async function savePlayerPoints() {
  if (!isAdmin || !currentWeek) return editorMessage("You need Admin access to enter points.", true);
  editorMessage("Saving points…");
  try {
    const client = getSupabaseClient();
    for (const row of document.querySelectorAll("[data-point-player]")) {
      const playerId = row.getAttribute("data-point-player");
      const getNum = key => Math.max(0, Number(row.querySelector(`[data-point="${key}"]`).value) || 0);
      const payload = { batting: getNum("batting"), bowling: getNum("bowling"), fielding: getNum("fielding"), winning: getNum("winning") };
      const { data: existing, error: findError } = await client.from("player_week_points")
        .select("week_id, player_id").eq("week_id", currentWeek.id).eq("player_id", playerId).maybeSingle();
      if (findError) throw findError;
      if (existing) {
        const { error } = await client.from("player_week_points").update(payload)
          .eq("week_id", currentWeek.id).eq("player_id", playerId);
        if (error) throw error;
      } else {
        const { error } = await client.from("player_week_points").insert({ week_id: currentWeek.id, player_id: playerId, ...payload });
        if (error) throw error;
      }
    }
    editorMessage("✅ Player points saved.");
    await loadPublicProfiles();
    await loadLeaderboard();
  } catch (error) {
    console.error(error);
    editorMessage(error?.message || "Could not save player points.", true);
  }
}


async function loadPublicProfiles() {
  const container = document.getElementById("publicProfiles");
  if (!container) return;
  try {
    const client = getSupabaseClient();
    const { data: players, error: pError } = await client
      .from("players")
      .select("id, full_name")
      .order("full_name");
    if (pError) throw pError;

    const { data: points, error: ptsError } = await client
      .from("player_week_points")
      .select("player_id, week_id, batting, bowling, fielding, winning");
    if (ptsError) throw ptsError;

    const { data: weeks, error: weeksError } = await client
      .from("weeks")
      .select("id, week_number, title")
      .order("week_number");
    if (weeksError) throw weeksError;

    const weekMap = new Map((weeks || []).map(w => [w.id, w]));
    publicPlayerCache = players || [];
    const history = new Map();
    for (const row of points || []) {
      const total = Number(row.batting || 0) + Number(row.bowling || 0) + Number(row.fielding || 0) + Number(row.winning || 0);
      if (!history.has(row.player_id)) history.set(row.player_id, []);
      history.get(row.player_id).push({ ...row, total, week: weekMap.get(row.week_id) });
    }

    publicHistoryCache = history;
    const assignments = new Map();
    if (currentWeek) {
      const { data: wtRows } = await client
        .from("week_teams")
        .select("id, team_id, club_teams(id, name, sort_order)")
        .eq("week_id", currentWeek.id);
      for (const wt of wtRows || []) {
        const { data: wpRows } = await client.from("week_players")
          .select("player_id").eq("week_team_id", wt.id);
        for (const wp of wpRows || []) assignments.set(wp.player_id, wt.club_teams?.name || "");
      }
    }

    publicAssignmentsCache = assignments;

    if (!(players || []).length) {
      container.innerHTML = '<div class="notice"><strong>No player profiles yet.</strong><span>The Editor can create the permanent player profiles.</span></div>';
      return;
    }

    container.innerHTML = (players || []).map(player => {
      const rows = (history.get(player.id) || []).sort((a,b) => (b.week?.week_number || 0) - (a.week?.week_number || 0));
      const career = rows.reduce((sum, r) => sum + r.total, 0);
      const current = rows.find(r => r.week_id === currentWeek?.id);
      const team = assignments.get(player.id) || "Not selected this week";
      return `<button type="button" class="public-profile-card" data-public-player="${escapeHtml(player.id)}">
        <div class="profile-main"><div class="profile-avatar">🏏</div><div><h3>${escapeHtml(player.full_name || "Unnamed player")}</h3><p class="muted">${escapeHtml(team)}</p></div></div>
        <div class="profile-summary"><span>${current?.total ?? 0} pts this week</span><span>${career} career pts</span><span>${rows.length} week${rows.length === 1 ? "" : "s"} scored</span></div>
        <span class="profile-view">View stats →</span>
      </button>`;
    }).join("");

    container.querySelectorAll("[data-public-player]").forEach(button => {
      button.addEventListener("click", () => showPlayerProfile(button.getAttribute("data-public-player")));
    });
  } catch (error) {
    console.error("Could not load public player profiles", error);
    container.innerHTML = `<div class="notice"><strong>Could not load player profiles.</strong><span>${escapeHtml(error?.message || "Please refresh and try again.")}</span></div>`;
  }
}

function showPlayerProfile(playerId) {
  const player = publicPlayerCache.find(p => p.id === playerId);
  if (!player) return;
  const rows = (publicHistoryCache.get(playerId) || []).slice().sort((a,b) => (b.week?.week_number || 0) - (a.week?.week_number || 0));
  const team = publicAssignmentsCache.get(playerId) || "Not selected this week";
  const batting = rows.reduce((n,r) => n + Number(r.batting || 0), 0);
  const bowling = rows.reduce((n,r) => n + Number(r.bowling || 0), 0);
  const fielding = rows.reduce((n,r) => n + Number(r.fielding || 0), 0);
  const winning = rows.reduce((n,r) => n + Number(r.winning || 0), 0);
  const total = batting + bowling + fielding + winning;
  const current = rows.find(r => r.week_id === currentWeek?.id);
  const modal = document.getElementById("playerProfileModal");
  const body = document.getElementById("playerProfileBody");
  body.innerHTML = `
    <div class="profile-detail-head"><div class="profile-avatar large">🏏</div><div><h3>${escapeHtml(player.full_name || "Unnamed player")}</h3><p class="muted">${escapeHtml(team)}</p></div></div>
    <div class="profile-detail-grid">
      <div><strong>${current?.total ?? 0}</strong><span>This week</span></div>
      <div><strong>${total}</strong><span>Total points</span></div>
      <div><strong>${rows.length}</strong><span>Weeks scored</span></div>
    </div>
    <h4>Career stats</h4>
    <div class="profile-detail-grid four">
      <div><strong>${batting}</strong><span>Batting</span></div>
      <div><strong>${bowling}</strong><span>Bowling</span></div>
      <div><strong>${fielding}</strong><span>Fielding</span></div>
      <div><strong>${winning}</strong><span>Winning</span></div>
    </div>
    <h4>Weekly history</h4>
    <div class="profile-week-history">${rows.length ? rows.map(r => `<div><span>${escapeHtml(r.week?.title || "Week")}</span><b>${r.total} pts</b></div>`).join("") : '<p class="muted">No points recorded yet.</p>'}</div>`;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closePlayerProfile() {
  const modal = document.getElementById("playerProfileModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function loadLeaderboard() {
  const table = document.getElementById("leaderboardTable");
  if (!table) return;
  try {
    const client = getSupabaseClient();
    const { data: fantasyTeams, error: ftError } = await client
      .from("fantasy_teams")
      .select("id, user_id, week_id, captain_player_id");
    if (ftError) throw ftError;

    const userIds = [...new Set((fantasyTeams || []).map(x => x.user_id))];
    const weekIds = [...new Set((fantasyTeams || []).map(x => x.week_id))];
    const [{ data: profileRows, error: prError }, { data: weekRows, error: wrError }] = await Promise.all([
      userIds.length ? client.from("profiles").select("id, username, display_name").in("id", userIds) : Promise.resolve({data:[],error:null}),
      weekIds.length ? client.from("weeks").select("id, week_number, title").in("id", weekIds) : Promise.resolve({data:[],error:null})
    ]);
    if (prError) throw prError;
    if (wrError) throw wrError;

    const profileMap = new Map((profileRows || []).map(x => [x.id, x.display_name || x.username || "Manager"]));
    const weekMap = new Map((weekRows || []).map(x => [x.id, x]));
    const totals = new Map();

    for (const ft of fantasyTeams || []) {
      const { data: selectedRows, error: spError } = await client.from("fantasy_team_players")
        .select("player_id").eq("fantasy_team_id", ft.id);
      if (spError) throw spError;
      const ids = (selectedRows || []).map(x => x.player_id);
      let score = 0;
      if (ids.length) {
        const { data: pointRows, error: pointError } = await client.from("player_week_points")
          .select("player_id, batting, bowling, fielding, winning").eq("week_id", ft.week_id).in("player_id", ids);
        if (pointError) throw pointError;
        score = (pointRows || []).reduce((sum, r) => sum + Number(r.batting || 0) + Number(r.bowling || 0) + Number(r.fielding || 0) + (r.player_id === ft.captain_player_id ? Number(r.winning || 0) : 0), 0);
      }
      if (!totals.has(ft.user_id)) totals.set(ft.user_id, { name: profileMap.get(ft.user_id) || "Manager", total: 0 });
      totals.get(ft.user_id).total += score;
    }

    const rows = [...totals.values()].sort((a,b) => b.total - a.total);
    table.innerHTML = '<div class="leader-row header"><span>Pos</span><span>Manager</span><span>Weeks</span><span>Total</span></div>' +
      (rows.length ? rows.map((r, i) => `<div class="leader-row"><span>${i + 1}</span><b>${escapeHtml(r.name)}</b><span>Global</span><b>${r.total}</b></div>`).join("") : '<div class="leader-row"><span>—</span><b>No teams saved yet</b><span>—</span><b>0</b></div>');
  } catch (error) {
    console.error("Could not load leaderboard", error);
    table.innerHTML = '<div class="leader-row header"><span>Pos</span><span>Manager</span><span>Weeks</span><span>Total</span></div><div class="leader-row"><span>—</span><b>Leaderboard unavailable</b><span>—</span><b>—</b></div>';
  }
}

async function refreshUser() {
  try {
    const { data, error } = await getSupabaseClient().auth.getUser();
    if (error) throw error;
    currentUser = data.user || null;
    await loadAdminStatus();

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
      isAdmin = false;
      editorSection.classList.add("hidden");
      selected.clear();
      fantasyCaptain = null;
      notify("You have been logged out.");
      render();
    }).catch(error => notify(error?.message || "Could not log out."));
    return;
  }
  openAuth("login");
});

document.getElementById("closePlayerProfile").addEventListener("click", closePlayerProfile);
document.getElementById("playerProfileModal").addEventListener("click", (event) => { if (event.target.id === "playerProfileModal") closePlayerProfile(); });

document.getElementById("closeAuth").addEventListener("click", closeAuth);
document.getElementById("authForm").addEventListener("submit", submitAuth);
editorNav.addEventListener("click", () => {
  if (!isAdmin) { notify("Admin access required."); return; }
  editorSection.classList.remove("hidden");
  editorSection.scrollIntoView({ behavior: "smooth", block: "start" });
  renderEditor();
});
document.getElementById("saveEditor").addEventListener("click", saveEditorSettings);
document.getElementById("newWeekBtn").addEventListener("click", startNewWeek);
document.getElementById("addPlayerProfilesBtn").addEventListener("click", addPlayerProfilesBulk);
document.getElementById("saveAssignmentsBtn").addEventListener("click", savePlayerAssignments);
document.getElementById("savePointsBtn").addEventListener("click", savePlayerPoints);

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
  await Promise.all([loadPublicProfiles(), loadLeaderboard()]);
}

start();
