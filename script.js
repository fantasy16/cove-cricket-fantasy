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

  const { data, error } = await getSupabaseClient()
    .from("week_teams")
    .select(`
      id,
      playing,
      captain_player_id,
      team_id,
      club_teams (id, name, sort_order)
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

    let captainName = "Captain not set";
    if (row.captain_player_id) {
      const { data: captainRow } = await getSupabaseClient()
        .from("players")
        .select("id, full_name")
        .eq("id", row.captain_player_id)
        .maybeSingle();
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

function renderEditor() {
  if (!editorNav || !editorSection) return;

  // Only an authenticated admin gets the Editor tab and page.
  editorNav.classList.toggle("hidden", !isAdmin);
  if (!isAdmin || !currentUser || !currentWeek) {
    editorSection.classList.add("hidden");
    return;
  }

  document.getElementById("editWeekNumber").value = currentWeek.week_number ?? 1;
  document.getElementById("editWeekTitle").value = currentWeek.title ?? "";
  document.getElementById("editSelectionsOpen").checked = !!currentWeek.selections_open;

  const adminBadge = editorSection.querySelector(".pill");
  if (adminBadge) adminBadge.textContent = "Admin access";

  const teamChecks = document.getElementById("editorTeams");
  teamChecks.innerHTML = teams.length
    ? teams.map(team => `
      <div class="editor-team-card">
        <label class="check-row">
          <input type="checkbox" data-editor-team="${escapeHtml(team.id)}" ${team.playing ? "checked" : ""}>
          <strong>${escapeHtml(team.name)}</strong>
        </label>
        <label>Real team captain
          <select data-editor-captain="${escapeHtml(team.id)}">
            <option value="">Choose captain</option>
            ${team.players.map(p => `<option value="${escapeHtml(p.id)}" ${p.id === team.captainId ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
          </select>
        </label>
        <div class="roster-note">${team.players.length} / 11 players in this week's roster</div>
      </div>
    `).join("")
    : `<div class="notice"><strong>No week teams exist yet.</strong><span>Use “Start new week” to create the five team slots.</span></div>`;

  const teamSelect = document.getElementById("newPlayerTeam");
  teamSelect.innerHTML = teams.map(t => `<option value="${escapeHtml(t.weekTeamId)}">${escapeHtml(t.name)}</option>`).join("");

  const roster = document.getElementById("editorRoster");
  roster.innerHTML = teams.map(team => `
    <div class="roster-group">
      <strong>${escapeHtml(team.name)}</strong>
      ${team.players.length ? team.players.map(p => `<span>${escapeHtml(p.name)}</span>`).join("") : `<span class="muted">No players yet</span>`}
    </div>
  `).join("");

  const points = document.getElementById("editorPoints");
  const allPlayers = teams.flatMap(team => team.players.map(p => ({...p, teamName: team.name})));
  points.innerHTML = allPlayers.length
    ? allPlayers.map(p => `
      <div class="point-row" data-point-player="${escapeHtml(p.id)}">
        <div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.teamName)}</small></div>
        <input type="number" min="0" step="1" data-point="batting" placeholder="Batting" aria-label="${escapeHtml(p.name)} batting points">
        <input type="number" min="0" step="1" data-point="bowling" placeholder="Bowling" aria-label="${escapeHtml(p.name)} bowling points">
        <input type="number" min="0" step="1" data-point="fielding" placeholder="Fielding" aria-label="${escapeHtml(p.name)} fielding points">
        <input type="number" min="0" step="1" data-point="winning" placeholder="Winning" aria-label="${escapeHtml(p.name)} winning points">
      </div>
    `).join("")
    : `<div class="notice"><strong>No players are assigned to this week.</strong><span>Add player profiles above, then assign them to a week's team.</span></div>`;

  loadCurrentPointValues(allPlayers);
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
  const { data: existing, error } = await getSupabaseClient()
    .from("week_teams")
    .select("team_id")
    .eq("week_id", weekId);
  if (error) throw error;

  const existingIds = new Set((existing || []).map(x => x.team_id));
  const { data: clubTeams, error: teamError } = await getSupabaseClient()
    .from("club_teams")
    .select("id, name, sort_order")
    .order("sort_order");
  if (teamError) throw teamError;

  const missing = (clubTeams || []).filter(t => !existingIds.has(t.id)).slice(0, 5);
  if (missing.length) {
    const { error: insertError } = await getSupabaseClient()
      .from("week_teams")
      .insert(missing.map(t => ({ week_id: weekId, team_id: t.id, playing: false })));
    if (insertError) throw insertError;
  }
}

async function saveEditorSettings() {
  if (!isAdmin || !currentWeek) {
    editorMessage("You need Admin access to use the Editor.", true);
    return;
  }
  editorMessage("Saving…");
  try {
    const weekNumber = Math.max(1, Math.min(999, Number(document.getElementById("editWeekNumber").value) || 1));
    const title = document.getElementById("editWeekTitle").value.trim() || `Week ${weekNumber}`;
    const selectionsOpen = document.getElementById("editSelectionsOpen").checked;
    const { error } = await getSupabaseClient().from("weeks").update({
      week_number: weekNumber, title, selections_open: selectionsOpen
    }).eq("id", currentWeek.id);
    if (error) throw error;

    for (const checkbox of document.querySelectorAll("[data-editor-team]")) {
      const teamId = checkbox.getAttribute("data-editor-team");
      const captain = document.querySelector(`[data-editor-captain="${CSS.escape(teamId)}"]`);
      const payload = { playing: checkbox.checked, captain_player_id: captain?.value || null };
      const { error: teamError } = await getSupabaseClient().from("week_teams")
        .update(payload).eq("week_id", currentWeek.id).eq("team_id", teamId);
      if (teamError) throw teamError;
    }

    editorMessage("✅ Week settings, playing teams and captains saved.");
    await loadWeek();
    await loadWeekTeams();
    renderEditor();
  } catch (error) {
    console.error(error);
    editorMessage(error?.message || "Could not save week settings.", true);
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
    editorMessage(`✅ ${title} created. Select the playing teams and add the 11-player rosters.`);
    await loadWeek();
    await loadWeekTeams();
    renderEditor();
  } catch (error) {
    console.error(error);
    editorMessage(error?.message || "Could not create the new week.", true);
  }
}

async function addPlayerProfile() {
  if (!isAdmin) return editorMessage("You need Admin access to add player profiles.", true);
  const name = document.getElementById("newPlayerName").value.trim();
  const weekTeamId = document.getElementById("newPlayerTeam").value;
  if (!name || !weekTeamId) return editorMessage("Enter a player name and choose a team.", true);
  editorMessage("Adding player…");
  try {
    const client = getSupabaseClient();
    const { data: player, error: playerError } = await client.from("players")
      .insert({ full_name: name }).select("id, full_name").single();
    if (playerError) throw playerError;
    const { error: rosterError } = await client.from("week_players")
      .insert({ week_team_id: weekTeamId, player_id: player.id });
    if (rosterError) throw rosterError;
    document.getElementById("newPlayerName").value = "";
    editorMessage(`✅ ${name} added to this week's roster.`);
    await loadWeekTeams();
    renderEditor();
  } catch (error) {
    console.error(error);
    editorMessage(error?.message || "Could not add player profile.", true);
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
  } catch (error) {
    console.error(error);
    editorMessage(error?.message || "Could not save player points.", true);
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
document.getElementById("addPlayerBtn").addEventListener("click", addPlayerProfile);
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
}

start();
