const SUPABASE_URL = "https://buappkzwllmfyevvdmfi.supabase.co";
const SUPABASE_KEY = "sb_publishable_a0MvZqJwZAbd5FyruLEH7A_QQBcXYY1";

// The account configured as the Cove Cricket Fantasy admin in Supabase.
const CONFIGURED_ADMIN_USER_ID = "f80258d7-24dd-4ac7-9c6e-5ffc908471db";

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
let editorWeek = null;
let selected = new Map();
let fantasyCaptain = null;
let teams = [];
let authMode = "login";
let isAdmin = false;
let publicPlayerCache = [];
let publicHistoryCache = new Map();
let publicAssignmentsCache = new Map();
let savedFantasyTeamId = null;
let showSavedTeam = false;
let myTeamPointsCache = new Map();

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
    currentWeek = null;
    const weekNumberLabel = document.getElementById("weekNumber");
    const leaderboardWeekLabel = document.getElementById("leaderboardWeek");
    const weekStatusLabel = document.getElementById("weekStatus");
    const weekOpenLabel = document.getElementById("weekOpen");
    if (weekNumberLabel) weekNumberLabel.textContent = "No week yet";
    if (leaderboardWeekLabel) leaderboardWeekLabel.textContent = "No week yet";
    if (weekStatusLabel) weekStatusLabel.textContent = "Create a week in the Editor";
    if (weekOpenLabel) { weekOpenLabel.textContent = "● Locked"; weekOpenLabel.className = "team-off"; }
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

async function loadWeekTeams(weekOverride = null) {
  const weekToLoad = weekOverride || currentWeek;
  const shouldUpdatePublicTeams = !weekOverride || weekToLoad?.id === currentWeek?.id;
  if (!weekToLoad) {
    if (shouldUpdatePublicTeams) teams = [];
    return [];
  }

  if (isAdmin) {
    try {
      await ensureWeekTeams(weekToLoad.id);
    } catch (error) {
      notify("Could not prepare this week's teams: " + error.message);
      if (shouldUpdatePublicTeams) teams = [];
      return [];
    }
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("week_teams")
    .select(`id, playing, captain_player_id, team_id, club_teams (id, name, sort_order)`)
    .eq("week_id", weekToLoad.id);

  if (error) {
    notify("Could not load teams: " + error.message);
    if (shouldUpdatePublicTeams) teams = [];
    return [];
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

  const sortedTeams = teamObjects.sort((a,b) => a.sortOrder - b.sortOrder);
  if (shouldUpdatePublicTeams) teams = sortedTeams;
  return sortedTeams;
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

  savedFantasyTeamId = saved?.id || null;
  showSavedTeam = false;
  selected.clear();
  fantasyCaptain = saved?.captain_player_id || null;
  myTeamPointsCache = new Map();

  if (saved) {
    const { data: items, error: itemsError } = await getSupabaseClient()
      .from("fantasy_team_players")
      .select("player_id")
      .eq("fantasy_team_id", saved.id);

    if (itemsError) {
      notify("Could not load your saved players: " + itemsError.message);
      return;
    }

    for (const item of items || []) selected.set(item.player_id, item.player_id);

    const playerIds = [...selected.keys()];
    if (playerIds.length) {
      const { data: pointRows, error: pointsError } = await getSupabaseClient()
        .from("player_week_points")
        .select("player_id, batting, bowling, fielding, winning")
        .eq("week_id", currentWeek.id)
        .in("player_id", playerIds);

      if (pointsError) {
        notify("Could not load your team points: " + pointsError.message);
      } else {
        for (const row of pointRows || []) myTeamPointsCache.set(row.player_id, row);
      }
    }
  }

  render();
}
function render() {
  teamsEl.innerHTML = "";
  capsEl.innerHTML = "";

  const savebar = document.querySelector(".savebar");
  if (savebar) {
    savebar.innerHTML = `<div>
      <b id="selectedText">0 players selected</b>
      <small id="captainText">Captain: not chosen</small>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      ${currentUser && savedFantasyTeamId ? '<button id="viewMyTeamBtn" class="secondary" type="button">View my team</button>' : ''}
      <button id="saveBtn" class="primary" type="button">Save team</button>
    </div>`;
    const saveButton = document.getElementById("saveBtn");
    if (saveButton) saveButton.addEventListener("click", saveTeam);

    const viewButton = document.getElementById("viewMyTeamBtn");
    if (viewButton) viewButton.addEventListener("click", showMyTeamOverlay);
  }

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

  const selectedTextEl = document.getElementById("selectedText");
  const captainTextEl = document.getElementById("captainText");
  const captainStatusEl = document.getElementById("captainStatus");
  const counterEl = document.getElementById("counter");
  const loginNoticeEl = document.getElementById("loginNotice");
  const loginBtnEl = document.getElementById("loginBtn");

  if (selectedTextEl) selectedTextEl.textContent =
    `${selected.size} player${selected.size === 1 ? "" : "s"} selected`;
  if (captainTextEl) captainTextEl.textContent =
    fantasyCaptain
      ? `Captain: ${findCaptainName(fantasyCaptain)}`
      : "Captain: not chosen";
  if (captainStatusEl) captainStatusEl.textContent =
    fantasyCaptain ? findCaptainTeam(fantasyCaptain) : "No captain";
  if (counterEl) counterEl.textContent =
    `${selected.size} / ${expected} players`;
  if (loginNoticeEl) loginNoticeEl.classList.toggle("hidden", !!currentUser);
  if (loginBtnEl) loginBtnEl.textContent = currentUser ? "Account" : "Sign in";
  renderEditor();
}

function showMyTeamOverlay() {
  if (!currentUser || !savedFantasyTeamId || !currentWeek) {
    notify("Save your team first.");
    return;
  }

  const old = document.getElementById("myTeamOverlay");
  if (old) old.remove();

  const overlay = document.createElement("div");
  overlay.id = "myTeamOverlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.cssText = [
    "position:fixed","inset:0","background:rgba(7,27,47,.55)",
    "z-index:100","display:grid","place-items:center","padding:20px"
  ].join(";");

  const card = document.createElement("div");
  card.style.cssText = [
    "position:relative","width:min(760px,100%)","max-height:90vh",
    "overflow:auto","background:#fff","border-radius:14px",
    "padding:28px","border:1px solid #dce4ee"
  ].join(";");

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close my team");
  close.style.cssText = "position:absolute;right:12px;top:8px;background:transparent;color:#687789;font-size:28px;padding:6px 10px";
  close.addEventListener("click", () => overlay.remove());

  const title = document.createElement("h2");
  title.textContent = "My Team";
  title.style.margin = "0 0 4px";

  const subtitle = document.createElement("p");
  subtitle.className = "muted";
  subtitle.textContent = `Week ${currentWeek.week_number}`;

  // Display the fantasy captain separately so they remain visible even when
  // they are not one of the selected player slots.
  const captainPanel = document.createElement("div");
  captainPanel.style.cssText = "display:flex;align-items:center;gap:12px;margin:14px 0;padding:14px 16px;border:1px solid #b9d8ff;border-radius:12px;background:#eef6ff";
  captainPanel.innerHTML = '<div aria-hidden="true" style="width:42px;height:42px;flex:0 0 42px;border-radius:50%;background:#071b2f;color:white;display:grid;place-items:center;font-size:21px">C</div><div><div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#1760a9;font-weight:800">Your fantasy captain</div><strong id="myTeamCaptainName">Loading captain…</strong><div id="myTeamCaptainClub" style="font-size:12px;color:#687789;margin-top:3px"></div></div>';

  const total = document.createElement("div");
  total.style.cssText = "margin:16px 0;padding:15px;border:1px solid #dce4ee;border-radius:10px;background:#f7f9fc;font-weight:800";
  total.textContent = "Loading your points…";

  const list = document.createElement("div");
  list.style.cssText = "display:grid;gap:10px";

  card.append(close, title, subtitle, captainPanel, total, list);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });

  (async () => {
    try {
      const client = getSupabaseClient();

      const { data: saved, error: savedError } = await client
        .from("fantasy_teams")
        .select("id, captain_player_id")
        .eq("id", savedFantasyTeamId)
        .maybeSingle();
      if (savedError) throw savedError;
      if (!saved) throw new Error("Your saved team could not be found.");

      const captainNameEl = captainPanel.querySelector("#myTeamCaptainName");
      const captainClubEl = captainPanel.querySelector("#myTeamCaptainClub");
      if (saved.captain_player_id) {
        const [{ data: captainPlayer, error: captainPlayerError }] = await Promise.all([
          client.from("players").select("id, full_name").eq("id", saved.captain_player_id).maybeSingle()
        ]);
        if (captainPlayerError) throw captainPlayerError;
        const captainTeam = teams.find(team => team.captainId === saved.captain_player_id);
        if (captainNameEl) captainNameEl.textContent = captainPlayer?.full_name || captainTeam?.captainName || "Selected captain";
        if (captainClubEl) captainClubEl.textContent = captainTeam?.name || "Club captain";
      } else {
        if (captainNameEl) captainNameEl.textContent = "Captain not chosen";
        if (captainClubEl) captainClubEl.textContent = "Choose a captain on the team selection page.";
      }

      const { data: items, error: itemsError } = await client
        .from("fantasy_team_players")
        .select("player_id")
        .eq("fantasy_team_id", savedFantasyTeamId);
      if (itemsError) throw itemsError;

      const ids = (items || []).map(x => x.player_id);
      if (!ids.length) {
        total.textContent = "0 points this week";
        list.innerHTML = '<div class="notice"><strong>No players saved.</strong></div>';
        return;
      }

      const [{ data: players, error: playerError }, { data: points, error: pointsError }] = await Promise.all([
        client.from("players").select("id, full_name").in("id", ids),
        client.from("player_week_points").select("player_id, batting, bowling, fielding, winning").eq("week_id", currentWeek.id).in("player_id", ids)
      ]);
      if (playerError) throw playerError;
      if (pointsError) throw pointsError;

      const playerMap = new Map((players || []).map(p => [p.id, p]));
      const pointMap = new Map((points || []).map(p => [p.player_id, p]));

      let grandTotal = 0;

      list.innerHTML = ids.map(id => {
        const name = playerMap.get(id)?.full_name || "Unnamed player";
        const row = pointMap.get(id) || {};
        const batting = Number(row.batting || 0);
        const bowling = Number(row.bowling || 0);
        const fielding = Number(row.fielding || 0);
        const winning = id === saved.captain_player_id ? Number(row.winning || 0) : 0;
        const playerTotal = batting + bowling + fielding + winning;
        grandTotal += playerTotal;

        return `<div style="display:flex;justify-content:space-between;gap:14px;align-items:center;padding:13px 15px;border:1px solid #dce4ee;border-radius:10px;background:#fff">
          <div>
            <strong>${escapeHtml(name)}</strong>
            ${id === saved.captain_player_id ? '<div style="font-size:11px;color:#1760a9;font-weight:800;margin-top:3px">⭐ Fantasy Captain</div>' : ''}
          </div>
          <div style="text-align:right;font-size:12px;color:#687789">
            Bat ${batting} · Bowl ${bowling} · Field ${fielding}${winning ? ` · Win ${winning}` : ""}
            <br><strong style="color:#071b2f;font-size:16px">${playerTotal} pts</strong>
          </div>
        </div>`;
      }).join("");

      total.textContent = `${grandTotal} points this week`;
    } catch (error) {
      console.error("Could not load my team", error);
      total.textContent = "Points unavailable";
      list.innerHTML = `<div class="notice"><strong>Could not load your team.</strong><span>${escapeHtml(error?.message || "Please try again.")}</span></div>`;
    }
  })();
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

  savedFantasyTeamId = fantasyTeamId;
  showSavedTeam = false;
  myTeamPointsCache = new Map();
  const { data: pointRows } = await getSupabaseClient()
    .from("player_week_points")
    .select("player_id, batting, bowling, fielding, winning")
    .eq("week_id", currentWeek.id)
    .in("player_id", [...selected.keys()]);
  for (const row of pointRows || []) myTeamPointsCache.set(row.player_id, row);
  notify("✅ Team saved to Supabase.");
  render();
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

    // Confirm that Supabase actually has an active session before changing the UI.
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;

    currentUser = sessionData?.session?.user || result.data?.user || null;

    if (!currentUser) {
      throw new Error("Login succeeded but no active session was found. Please refresh and try again.");
    }

    await loadAdminStatus();
    await loadSavedTeam();

    closeAuth();
    render();
    notify(authMode === "login" ? "✅ Signed in." : "✅ Account created and signed in.");
  } catch (error) {
    console.error(error);
    authMessage.textContent = error?.message || "Something went wrong while connecting to Supabase.";
  } finally {
    primary.disabled = false;
  }
}

async function loadAdminStatus() {
  if (!currentUser) {
    isAdmin = false;
    return;
  }

  // This account was explicitly configured as the project's admin. Keep the
  // Editor available for it if the profile read is briefly delayed or fails.
  const configuredAdmin = currentUser.id === CONFIGURED_ADMIN_USER_ID;
  try {
    const { data, error } = await getSupabaseClient()
      .from("profiles")
      .select("id, username, display_name, is_admin")
      .eq("id", currentUser.id)
      .maybeSingle();
    if (error) throw error;
    isAdmin = data?.is_admin === true || configuredAdmin;
    if (configuredAdmin && data?.is_admin !== true) {
      console.warn("The configured admin account is recognised in the UI, but its profiles.is_admin value should also be true for Supabase write policies.");
    }
  } catch (error) {
    console.error("Could not load admin profile", error);
    isAdmin = configuredAdmin;
  }
}

function editorMessage(text, error = false) {
  const el = document.getElementById("editorMessage");
  if (!el) return;
  el.textContent = text;
  el.style.color = error ? "#b42318" : "#687789";
}

function getNextWeekNumber(weekRows, startAt = null) {
  const used = new Set((weekRows || []).map(row => Number(row.week_number)).filter(Number.isFinite));
  const highest = Math.max(0, ...used);
  let candidate = Number.isInteger(Number(startAt)) && Number(startAt) > 0
    ? Number(startAt)
    : highest + 1;
  candidate = Math.max(1, candidate);
  while (used.has(candidate) && candidate <= 999) candidate += 1;
  if (candidate > 999) throw new Error("All week numbers from 1 to 999 are already in use.");
  return candidate;
}

async function fetchWeekNumberRows() {
  const { data, error } = await getSupabaseClient()
    .from("weeks")
    .select("id, week_number, title, is_current, selections_open")
    .order("week_number");
  if (error) throw error;
  return data || [];
}

function isGenericWeekTitle(title) {
  return !title || /^week\s*\d+$/i.test(title.trim());
}

async function renderEditor() {
  if (!editorNav || !editorSection) return;
  editorNav.classList.toggle("hidden", !isAdmin);
  if (!isAdmin || !currentUser) {
    editorSection.classList.add("hidden");
    return;
  }

  editorSection.classList.remove("hidden");
  const client = getSupabaseClient();
  const statusNotice = document.getElementById("editorStatusNotice");

  try {
    const [profilesResult, clubTeamsResult, weekRowsResult] = await Promise.all([
      client.from("players").select("id, full_name").order("full_name"),
      client.from("club_teams").select("id, name, sort_order").order("sort_order"),
      client.from("weeks").select("id, week_number, title, is_current, selections_open").order("week_number")
    ]);
    if (profilesResult.error) throw new Error("Could not load player profiles: " + profilesResult.error.message);
    if (clubTeamsResult.error) throw new Error("Could not load club teams: " + clubTeamsResult.error.message);
    if (weekRowsResult.error) throw new Error("Could not load weeks: " + weekRowsResult.error.message);

    const profileList = profilesResult.data || [];
    const clubTeams = clubTeamsResult.data || [];
    const existingWeekRows = weekRowsResult.data || [];
    if (!editorWeek || !existingWeekRows.some(row => row.id === editorWeek.id)) {
      editorWeek = existingWeekRows.find(row => row.id === currentWeek?.id)
        || existingWeekRows.find(row => row.is_current === true)
        || existingWeekRows[existingWeekRows.length - 1]
        || null;
    } else {
      // Keep the selected week record up to date after settings are saved/reset.
      editorWeek = existingWeekRows.find(row => row.id === editorWeek.id) || editorWeek;
    }

    const weekPicker = document.getElementById("editorWeekPicker");
    if (weekPicker) {
      weekPicker.innerHTML = existingWeekRows.length
        ? existingWeekRows.map(row => `<option value="${escapeHtml(row.id)}">Week ${escapeHtml(row.week_number)} — ${escapeHtml(row.title || `Week ${row.week_number}`)}${row.is_current ? " (current site week)" : ""}</option>`).join("")
        : `<option value="">No weeks created yet</option>`;
      weekPicker.value = editorWeek?.id || "";
      weekPicker.disabled = !existingWeekRows.length;
    }

    const currentWeekFields = ["editWeekNumber", "editWeekTitle", "editSelectionsOpen", "saveEditor", "saveAssignmentsBtn", "savePointsBtn"];
    currentWeekFields.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !editorWeek;
    });
    if (statusNotice) {
      statusNotice.classList.toggle("hidden", !!editorWeek);
      statusNotice.innerHTML = editorWeek
        ? ""
        : "<strong>No weeks have been created yet.</strong><span>Start a new week below. Permanent teams and player profiles can still be managed here.</span>";
    }

    const weekNumberInput = document.getElementById("editWeekNumber");
    const weekTitleInput = document.getElementById("editWeekTitle");
    const openInput = document.getElementById("editSelectionsOpen");
    if (weekNumberInput) weekNumberInput.value = editorWeek?.week_number ?? "";
    if (weekTitleInput) weekTitleInput.value = editorWeek?.title ?? "";
    if (openInput) openInput.checked = !!editorWeek?.selections_open;

    const newWeekNumberInput = document.getElementById("newWeekNumber");
    const newWeekTitleInput = document.getElementById("newWeekTitle");
    const suggestedWeekNumber = getNextWeekNumber(existingWeekRows);
    if (newWeekNumberInput) {
      const entered = Number(newWeekNumberInput.value);
      if (!newWeekNumberInput.value.trim() || !Number.isInteger(entered) || entered < 1 || entered > 999) {
        newWeekNumberInput.value = String(suggestedWeekNumber);
      }
    }
    if (newWeekTitleInput && (!newWeekTitleInput.value.trim() || isGenericWeekTitle(newWeekTitleInput.value))) {
      newWeekTitleInput.value = `Week ${newWeekNumberInput?.value || suggestedWeekNumber}`;
    }

    let editorTeamsForWeek = [];
    if (editorWeek) {
      await ensureWeekTeams(editorWeek.id);
      editorTeamsForWeek = await loadWeekTeams(editorWeek);
    }

    const teamChecks = document.getElementById("editorTeams");
    if (teamChecks) {
      if (!editorWeek) {
        teamChecks.innerHTML = clubTeams.length ? clubTeams.map(team => `
          <div class="editor-team-card">
            <div class="team-management-row"><strong>${escapeHtml(team.name)}</strong><button type="button" class="danger" data-remove-team="${escapeHtml(team.id)}" data-remove-team-name="${escapeHtml(team.name)}">Remove team</button></div>
            <p class="muted">Create a week to select this team’s playing status and weekly squad.</p>
          </div>`).join("") : `<div class="notice"><strong>No teams have been added yet.</strong><span>Use the Add team box above.</span></div>`;
      } else {
        teamChecks.innerHTML = editorTeamsForWeek.map(team => {
          const ids = team.players.map(p => p.id);
          const rosterOptions = Array.from({length: 11}, (_, i) => {
            const selectedId = ids[i] || "";
            const options = [`<option value="">Choose player ${i + 1}</option>`]
              .concat(profileList.map(p => `<option value="${escapeHtml(p.id)}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(p.full_name || "Unnamed player")}</option>`));
            return `<label class="roster-slot"><span>Player ${i + 1}</span><select data-roster-team="${escapeHtml(team.weekTeamId)}" data-roster-slot="${i}">${options.join("")}</select></label>`;
          }).join("");
          const captainOptions = [`<option value="">Choose captain from this squad</option>`]
            .concat(profileList.map(p => `<option value="${escapeHtml(p.id)}" ${p.id === team.captainId ? "selected" : ""}>${escapeHtml(p.full_name || "Unnamed player")}</option>`));
          return `<div class="editor-team-card">
            <div class="team-management-row"><label class="check-row"><input type="checkbox" data-editor-team="${escapeHtml(team.id)}" ${team.playing ? "checked" : ""}><strong>${escapeHtml(team.name)}</strong><span class="playing-status">${team.playing ? "Playing" : "Not playing"}</span></label><button type="button" class="danger" data-remove-team="${escapeHtml(team.id)}" data-remove-team-name="${escapeHtml(team.name)}">Remove team</button></div>
            <label>Real team captain (must be one of the 11 selected players)<select data-editor-captain="${escapeHtml(team.id)}">${captainOptions.join("")}</select></label>
            <div class="roster-grid">${rosterOptions}</div>
            <div class="roster-note" data-roster-count="${escapeHtml(team.weekTeamId)}">${ids.filter(Boolean).length} / 11 players selected</div>
          </div>`;
        }).join("");
      }
    }

    if (editorWeek) {
      document.querySelectorAll(".editor-team-card").forEach(card => {
        const rosterSelects = [...card.querySelectorAll("select[data-roster-team]")];
        const captainSelect = card.querySelector("select[data-editor-captain]");
        const countEl = card.querySelector("[data-roster-count]");
        if (!rosterSelects.length || !captainSelect) return;
        const refreshSquadControls = () => {
          const selectedIds = rosterSelects.map(select => select.value).filter(Boolean);
          const uniqueCount = new Set(selectedIds).size;
          rosterSelects.forEach(select => {
            const ownValue = select.value;
            const usedElsewhere = new Set(rosterSelects.filter(other => other !== select).map(other => other.value).filter(Boolean));
            [...select.options].forEach(option => {
              option.disabled = !!option.value && usedElsewhere.has(option.value) && option.value !== ownValue;
            });
          });
          if (countEl) countEl.textContent = `${uniqueCount} / 11 players selected`;
          const oldCaptainId = captainSelect.value;
          const candidates = selectedIds.length ? profileList.filter(player => selectedIds.includes(player.id)) : profileList;
          captainSelect.innerHTML = `<option value="">Choose captain from this squad</option>` + candidates.map(player =>
            `<option value="${escapeHtml(player.id)}">${escapeHtml(player.full_name || "Unnamed player")}</option>`
          ).join("");
          if (oldCaptainId && candidates.some(player => player.id === oldCaptainId)) captainSelect.value = oldCaptainId;
          else if (oldCaptainId && selectedIds.length) captainSelect.value = "";
        };
        rosterSelects.forEach(select => select.addEventListener("change", refreshSquadControls));
        refreshSquadControls();
      });
    }

    const points = document.getElementById("editorPoints");
    const playingTeams = editorWeek ? editorTeamsForWeek.filter(team => team.playing).sort((a,b) => a.sortOrder - b.sortOrder) : [];
    const allPlayers = playingTeams.flatMap(team => team.players.map(p => ({...p, teamName: team.name})));
    if (points) {
      points.innerHTML = editorWeek
        ? (allPlayers.length ? `
          <div class="point-row point-headings"><strong>Player</strong><strong>Batting</strong><strong>Bowling</strong><strong>Fielding</strong><strong>Captaincy / winning bonus</strong></div>
          ${playingTeams.map(team => `
            <div class="points-team-group">
              <h4>${escapeHtml(team.name)}</h4>
              ${team.players.map(p => `<div class="point-row" data-point-player="${escapeHtml(p.id)}">
                <div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(team.name)}</small></div>
                <input aria-label="${escapeHtml(p.name)} batting points" type="number" min="0" step="1" data-point="batting" placeholder="Batting" value="0">
                <input aria-label="${escapeHtml(p.name)} bowling points" type="number" min="0" step="1" data-point="bowling" placeholder="Bowling" value="0">
                <input aria-label="${escapeHtml(p.name)} fielding points" type="number" min="0" step="1" data-point="fielding" placeholder="Fielding" value="0">
                <input aria-label="${escapeHtml(p.name)} captaincy or winning bonus points" type="number" min="0" step="1" data-point="winning" placeholder="Captaincy / bonus" value="0">
              </div>`).join("")}
            </div>`).join("")}`
          : `<div class="notice"><strong>No players assigned to playing teams.</strong><span>Tick the teams that are playing, select 11 players from the existing profile database, and save the weekly rosters before entering points.</span></div>`)
        : `<div class="notice"><strong>Points are unavailable until a week exists.</strong><span>Create a week below first.</span></div>`;
    }
    await loadCurrentPointValues(allPlayers, editorWeek);

    document.querySelectorAll("[data-editor-team]").forEach(checkbox => {
      checkbox.addEventListener("change", async () => {
        if (!isAdmin || !editorWeek) return;
        const selectedWeekId = editorWeek.id;
        const teamId = checkbox.getAttribute("data-editor-team");
        const status = checkbox.closest(".check-row")?.querySelector(".playing-status");
        const wanted = checkbox.checked;
        if (status) status.textContent = wanted ? "Playing" : "Not playing";
        checkbox.disabled = true;
        try {
          const { error } = await client.from("week_teams")
            .update({ playing: wanted })
            .eq("week_id", selectedWeekId)
            .eq("team_id", teamId);
          if (error) throw error;
          editorMessage(`✅ ${wanted ? "Team marked as playing." : "Team marked as not playing."} for ${editorWeek.title || `Week ${editorWeek.week_number}`}.`);
          if (currentWeek?.id === selectedWeekId) {
            await loadWeekTeams();
            render();
          }
          await renderEditor();
        } catch (error) {
          checkbox.checked = !wanted;
          if (status) status.textContent = checkbox.checked ? "Playing" : "Not playing";
          editorMessage(error?.message || "Could not save the playing-team setting.", true);
        } finally {
          checkbox.disabled = false;
        }
      });
    });

    const profileLibrary = document.getElementById("editorProfileLibrary");
    if (profileLibrary) {
      profileLibrary.innerHTML = profileList.length
        ? profileList.map(p => `<div class="profile-row"><strong>${escapeHtml(p.full_name || "Unnamed player")}</strong><span>Permanent profile</span><button type="button" class="danger profile-remove" data-remove-player="${escapeHtml(p.id)}" data-remove-player-name="${escapeHtml(p.full_name || "Unnamed player")}">Remove</button></div>`).join("")
        : `<div class="notice"><strong>No player profiles yet.</strong><span>Create them once below. After that, use the dropdowns above every week.</span></div>`;
    }
    document.querySelectorAll("[data-remove-player]").forEach(button => {
      button.addEventListener("click", () => removePlayerProfile(button.getAttribute("data-remove-player"), button.getAttribute("data-remove-player-name")));
    });
    document.querySelectorAll("[data-remove-team]").forEach(button => {
      button.addEventListener("click", () => removeClubTeam(button.getAttribute("data-remove-team"), button.getAttribute("data-remove-team-name")));
    });
  } catch (error) {
    console.error("Could not render Editor", error);
    editorMessage(error?.message || "Could not load the Editor. Check the browser console for details.", true);
  }
}

async function addClubTeam() {
  if (!isAdmin || !currentUser) return editorMessage("You need Admin access to add teams.", true);
  const input = document.getElementById("newClubTeamName");
  const name = input?.value?.trim();
  if (!name) return editorMessage("Enter a team name first.", true);
  editorMessage("Adding team…");
  try {
    const client = getSupabaseClient();
    const { data: existing, error: readError } = await client.from("club_teams").select("name, sort_order");
    if (readError) throw readError;
    if ((existing || []).some(team => (team.name || "").trim().toLowerCase() === name.toLowerCase())) {
      throw new Error("A team with that name already exists.");
    }
    const sortOrder = Math.max(0, ...(existing || []).map(team => Number(team.sort_order) || 0)) + 1;
    const { data: team, error } = await client.from("club_teams").insert({name, sort_order: sortOrder}).select("id, name, sort_order").single();
    if (error) throw error;
    if (editorWeek) {
      const { error: weekTeamError } = await client.from("week_teams").insert({week_id: editorWeek.id, team_id: team.id, playing: false, captain_player_id: null});
      if (weekTeamError) throw weekTeamError;
    }
    if (input) input.value = "";
    editorMessage(`✅ Team “${name}” added.`);
    if (editorWeek) await loadWeekTeams(editorWeek);
    if (currentWeek) { await ensureWeekTeams(currentWeek.id); await loadWeekTeams(); render(); }
    await renderEditor();
  } catch (error) {
    console.error(error);
    editorMessage(error?.message || "Could not add team.", true);
  }
}

async function removeClubTeam(teamId, teamName) {
  if (!isAdmin || !currentUser) return editorMessage("You need Admin access to remove teams.", true);
  if (!teamId) return;
  const accepted = confirm(`Remove “${teamName}” permanently? This will delete its weekly team slots and roster assignments from every week. Player profiles and fantasy points remain, but this action cannot be undone.`);
  if (!accepted) return;
  editorMessage(`Removing ${teamName}…`);
  try {
    const client = getSupabaseClient();
    const { data: weekRows, error: weekRowsError } = await client.from("week_teams").select("id").eq("team_id", teamId);
    if (weekRowsError) throw weekRowsError;
    for (const row of weekRows || []) {
      const { error } = await client.from("week_players").delete().eq("week_team_id", row.id);
      if (error) throw error;
    }
    const { error: deleteWeekTeamsError } = await client.from("week_teams").delete().eq("team_id", teamId);
    if (deleteWeekTeamsError) throw deleteWeekTeamsError;
    const { error } = await client.from("club_teams").delete().eq("id", teamId);
    if (error) throw error;
    editorMessage(`✅ Team “${teamName}” removed.`);
    if (currentWeek) { await loadWeekTeams(); render(); }
    await loadPublicProfiles();
    await renderEditor();
  } catch (error) {
    console.error(error);
    editorMessage(error?.message || "Could not remove team.", true);
  }
}

async function savePlayerAssignments() {
  if (!isAdmin || !editorWeek) return editorMessage("You need Admin access and a selected week to assign player profiles.", true);
  const weekForEdit = editorWeek;
  editorMessage(`Checking weekly team rosters for Week ${weekForEdit.week_number}…`);
  try {
    const client = getSupabaseClient();
    await ensureWeekTeams(weekForEdit.id);
    const teamsForEdit = await loadWeekTeams(weekForEdit);
    const rosterRows = [];
    const captainByTeam = new Map();
    const allAssigned = [];

    for (const team of teamsForEdit) {
      const selects = [...document.querySelectorAll(`[data-roster-team="${CSS.escape(team.weekTeamId)}"]`)];
      const ids = selects.map(select => select.value).filter(Boolean);
      if (team.playing && ids.length !== 11) {
        throw new Error(`${team.name} is marked as playing. Choose exactly 11 players (currently ${ids.length}).`);
      }
      if (new Set(ids).size !== ids.length) throw new Error(`${team.name} has the same player selected more than once.`);
      const captain = document.querySelector(`[data-editor-captain="${CSS.escape(team.id)}"]`)?.value || null;
      if (team.playing && !captain) throw new Error(`${team.name}: choose the real captain from the selected 11 players.`);
      if (captain && !ids.includes(captain)) throw new Error(`${team.name}: the real captain must be one of the selected players.`);
      captainByTeam.set(team.weekTeamId, captain);
      ids.forEach(player_id => {
        rosterRows.push({week_team_id: team.weekTeamId, player_id});
        allAssigned.push(player_id);
      });
    }

    if (new Set(allAssigned).size !== allAssigned.length) {
      throw new Error("A player cannot be assigned to more than one team in the same week. Remove duplicate selections first.");
    }

    const { data: weekTeamRows, error: teamError } = await client.from("week_teams").select("id").eq("week_id", weekForEdit.id);
    if (teamError) throw teamError;
    for (const row of weekTeamRows || []) {
      const { error } = await client.from("week_players").delete().eq("week_team_id", row.id);
      if (error) throw error;
    }
    if (rosterRows.length) {
      const { error } = await client.from("week_players").insert(rosterRows);
      if (error) throw error;
    }
    for (const team of teamsForEdit) {
      const captain = captainByTeam.get(team.weekTeamId) || null;
      const { error } = await client.from("week_teams")
        .update({ captain_player_id: captain })
        .eq("id", team.weekTeamId);
      if (error) throw error;
    }

    editorMessage(`✅ Week ${weekForEdit.week_number}: weekly 11-player squads and real captains saved.`);
    if (currentWeek?.id === weekForEdit.id) {
      await loadWeekTeams();
      render();
    }
    await Promise.all([loadPublicProfiles(), loadLeaderboard()]);
    await renderEditor();
  } catch (error) {
    console.error(error);
    editorMessage(error?.message || "Could not save weekly rosters.", true);
  }
}

async function removePlayerProfile(playerId, playerName) {
  if (!isAdmin || !currentUser) return editorMessage("You need Admin access to remove player profiles.", true);
  if (!playerId) return;
  if (!confirm(`Permanently delete ${playerName}? This will remove the player's weekly squad entries, points, fantasy-team selection entries, and captain references from saved weeks. This cannot be undone.`)) return;
  editorMessage(`Removing ${playerName}…`);
  try {
    const client = getSupabaseClient();
    const { error: weekCaptainError } = await client.from("week_teams").update({captain_player_id: null}).eq("captain_player_id", playerId);
    if (weekCaptainError) throw weekCaptainError;
    const { error: fantasyCaptainError } = await client.from("fantasy_teams").update({captain_player_id: null}).eq("captain_player_id", playerId);
    if (fantasyCaptainError) throw fantasyCaptainError;
    for (const [table, column] of [["week_players","player_id"],["fantasy_team_players","player_id"],["player_week_points","player_id"]]) {
      const { error } = await client.from(table).delete().eq(column, playerId);
      if (error) throw error;
    }
    const { error } = await client.from("players").delete().eq("id", playerId);
    if (error) throw error;
    editorMessage(`✅ ${playerName} profile removed.`);
    if (currentWeek) { await loadWeekTeams(); render(); }
    await renderEditor();
    await Promise.all([loadPublicProfiles(), loadLeaderboard()]);
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

async function loadCurrentPointValues(players, week = editorWeek) {
  if (!week || !players.length) return;
  try {
    const { data, error } = await getSupabaseClient()
      .from("player_week_points")
      .select("player_id, batting, bowling, fielding, winning")
      .eq("week_id", week.id);
    if (error) throw error;
    const byPlayer = new Map((data || []).map(row => [row.player_id, row]));
    document.querySelectorAll("[data-point-player]").forEach(row => {
      const vals = byPlayer.get(row.getAttribute("data-point-player")) || {};
      row.querySelector('[data-point="batting"]').value = vals.batting ?? 0;
      row.querySelector('[data-point="bowling"]').value = vals.bowling ?? 0;
      row.querySelector('[data-point="fielding"]').value = vals.fielding ?? 0;
      row.querySelector('[data-point="winning"]').value = vals.winning ?? 0;
    });
  } catch (error) {
    console.error("Could not load points", error);
    editorMessage(error?.message || "Could not load points for the selected week.", true);
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
  if (!isAdmin || !editorWeek) return editorMessage("You need Admin access and a selected week to change its settings.", true);
  editorMessage("Saving week settings and playing teams…");
  try {
    const client = getSupabaseClient();
    const weekForEdit = editorWeek;
    await ensureWeekTeams(weekForEdit.id);
    const numberValue = Number(document.getElementById("editWeekNumber")?.value);
    if (!Number.isInteger(numberValue) || numberValue < 1 || numberValue > 999) throw new Error("Enter a week number from 1 to 999.");
    const title = document.getElementById("editWeekTitle")?.value.trim() || `Week ${numberValue}`;
    const selectionsOpen = !!document.getElementById("editSelectionsOpen")?.checked;
    const { data: duplicate, error: duplicateError } = await client.from("weeks")
      .select("id, week_number").eq("week_number", numberValue).neq("id", weekForEdit.id).maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) throw new Error(`Week ${numberValue} already exists. Use the week selector to open it, or reset it from “Start a new week”.`);

    const { error } = await client.from("weeks")
      .update({week_number: numberValue, title, selections_open: selectionsOpen})
      .eq("id", weekForEdit.id);
    if (error) throw error;
    for (const checkbox of [...document.querySelectorAll("[data-editor-team]")]) {
      const teamId = checkbox.getAttribute("data-editor-team");
      const { error: teamError } = await client.from("week_teams")
        .update({playing: checkbox.checked}).eq("week_id", weekForEdit.id).eq("team_id", teamId);
      if (teamError) throw teamError;
    }

    editorWeek = {...weekForEdit, week_number: numberValue, title, selections_open: selectionsOpen};
    if (currentWeek?.id === editorWeek.id) {
      currentWeek = {...currentWeek, week_number: numberValue, title, selections_open: selectionsOpen};
      await loadWeek();
      await loadWeekTeams();
      await Promise.all([loadPublicProfiles(), loadLeaderboard()]);
      render();
    }
    editorMessage(`✅ Week ${numberValue} settings and playing teams saved.`);
    await renderEditor();
  } catch (error) {
    console.error(error);
    editorMessage(error?.message || "Could not save week settings and playing teams.", true);
  }
}

async function startNewWeek() {
  if (!isAdmin || !currentUser) {
    notify("Admin access required.");
    editorMessage("You need Admin access to start or reset a week.", true);
    return;
  }
  const numberInput = document.getElementById("newWeekNumber");
  const titleInput = document.getElementById("newWeekTitle");
  const button = document.getElementById("newWeekBtn");
  if (!numberInput || !titleInput) return editorMessage("The new-week fields are missing from the page.", true);

  if (button) button.disabled = true;
  let previousCurrentId = null;
  let previousCurrentWasClosed = false;
  let createdWeekId = null;
  try {
    const client = getSupabaseClient();
    const allWeeks = await fetchWeekNumberRows();
    const enteredNumber = Number(numberInput.value);
    const number = Number.isInteger(enteredNumber) && enteredNumber >= 1 && enteredNumber <= 999
      ? enteredNumber : getNextWeekNumber(allWeeks);
    const existingWeek = allWeeks.find(row => Number(row.week_number) === number);
    const enteredTitle = titleInput.value.trim();
    const title = isGenericWeekTitle(enteredTitle)
      ? (existingWeek && !isGenericWeekTitle(existingWeek.title) ? existingWeek.title : `Week ${number}`)
      : enteredTitle;

    if (existingWeek) {
      const accepted = confirm(
        `Week ${number} already exists. Reset Week ${number} (${existingWeek.title || `Week ${number}`})?\n\n` +
        `This permanently deletes fantasy teams and their player selections, all four player-point categories, and the saved weekly team squads/captains for this week. ` +
        `Permanent player profiles and club-team definitions are kept. Selection will be closed.\n\nContinue?`
      );
      if (!accepted) {
        editorMessage(`Week ${number} was not changed.`);
        return;
      }

      editorMessage(`Resetting Week ${number}…`);
      const { data: fantasyRows, error: fantasyReadError } = await client.from("fantasy_teams")
        .select("id").eq("week_id", existingWeek.id);
      if (fantasyReadError) throw fantasyReadError;
      const fantasyIds = (fantasyRows || []).map(row => row.id);
      if (fantasyIds.length) {
        const { error } = await client.from("fantasy_team_players").delete().in("fantasy_team_id", fantasyIds);
        if (error) throw error;
      }
      const { error: deleteFantasyError } = await client.from("fantasy_teams").delete().eq("week_id", existingWeek.id);
      if (deleteFantasyError) throw deleteFantasyError;
      const { error: deletePointsError } = await client.from("player_week_points").delete().eq("week_id", existingWeek.id);
      if (deletePointsError) throw deletePointsError;
      const { data: weekTeamRows, error: weekTeamReadError } = await client.from("week_teams")
        .select("id").eq("week_id", existingWeek.id);
      if (weekTeamReadError) throw weekTeamReadError;
      for (const row of weekTeamRows || []) {
        const { error } = await client.from("week_players").delete().eq("week_team_id", row.id);
        if (error) throw error;
      }
      const { error: resetTeamsError } = await client.from("week_teams")
        .update({playing: false, captain_player_id: null}).eq("week_id", existingWeek.id);
      if (resetTeamsError) throw resetTeamsError;
      const { data: resetWeekData, error: resetWeekError } = await client.from("weeks")
        .update({title, selections_open: false})
        .eq("id", existingWeek.id)
        .select("*")
        .single();
      if (resetWeekError) throw resetWeekError;

      editorWeek = resetWeekData;
      if (currentWeek?.id === resetWeekData.id) {
        currentWeek = resetWeekData;
        selected.clear();
        fantasyCaptain = null;
        savedFantasyTeamId = null;
        showSavedTeam = false;
        myTeamPointsCache = new Map();
        await loadWeek();
        await loadWeekTeams();
        await loadSavedTeam();
        render();
      }
      await renderEditor();
      await Promise.all([loadPublicProfiles(), loadLeaderboard()]);
      const nextNumber = getNextWeekNumber(allWeeks);
      numberInput.value = String(nextNumber);
      titleInput.value = `Week ${nextNumber}`;
      editorMessage(`✅ Week ${number} has been reset. Its historical record is retained as an empty week, and selections are closed.`);
      notify(`Week ${number} reset.`);
      return;
    }

    const oldCurrent = allWeeks.find(row => row.is_current === true);
    previousCurrentId = oldCurrent?.id || null;
    if (oldCurrent) {
      const { error: closeError } = await client.from("weeks").update({is_current: false}).eq("id", oldCurrent.id);
      if (closeError) throw closeError;
      previousCurrentWasClosed = true;
    }
    const { data, error } = await client.from("weeks")
      .insert({week_number: number, title, is_current: true, selections_open: false})
      .select("*")
      .single();
    if (error) throw error;
    createdWeekId = data.id;
    currentWeek = data;
    editorWeek = data;
    await ensureWeekTeams(data.id);
    selected.clear();
    fantasyCaptain = null;
    savedFantasyTeamId = null;
    showSavedTeam = false;
    myTeamPointsCache = new Map();
    await loadWeek();
    await loadWeekTeams();
    await renderEditor();
    render();
    await Promise.all([loadPublicProfiles(), loadLeaderboard()]);

    const nextNumber = getNextWeekNumber([...allWeeks, data]);
    numberInput.value = String(nextNumber);
    titleInput.value = `Week ${nextNumber}`;
    editorMessage(`✅ ${title} created. Select the playing teams, choose 11 players and a real captain for each team, then save the rosters.`);
    notify(`✅ ${title} created.`);
  } catch (error) {
    console.error("Could not create or reset week", error);
    const client = getSupabaseClient();
    if (createdWeekId && previousCurrentId && previousCurrentWasClosed) {
      const { error: closeNewError } = await client.from("weeks").update({is_current: false}).eq("id", createdWeekId);
      if (closeNewError) console.error("Could not deactivate incomplete week", closeNewError);
    }
    if (previousCurrentId && previousCurrentWasClosed) {
      const { error: restoreError } = await client.from("weeks").update({is_current: true}).eq("id", previousCurrentId);
      if (restoreError) console.error("Could not restore previous current week", restoreError);
      await loadWeek();
      await loadWeekTeams();
      render();
    }
    editorMessage(error?.message || "Could not create or reset the week.", true);
    notify(error?.message || "Could not create or reset the week.");
  } finally {
    if (button) button.disabled = false;
  }
}

async function savePlayerPoints() {
  if (!isAdmin || !editorWeek) return editorMessage("You need Admin access and a selected week to enter points.", true);
  const weekForPoints = editorWeek;
  editorMessage(`Saving points for Week ${weekForPoints.week_number}…`);
  try {
    const client = getSupabaseClient();
    for (const row of document.querySelectorAll("[data-point-player]")) {
      const playerId = row.getAttribute("data-point-player");
      const getNum = key => Math.max(0, Number(row.querySelector(`[data-point="${key}"]`).value) || 0);
      const payload = { batting: getNum("batting"), bowling: getNum("bowling"), fielding: getNum("fielding"), winning: getNum("winning") };
      const { data: existing, error: findError } = await client.from("player_week_points")
        .select("week_id, player_id").eq("week_id", weekForPoints.id).eq("player_id", playerId).maybeSingle();
      if (findError) throw findError;
      if (existing) {
        const { error } = await client.from("player_week_points").update(payload)
          .eq("week_id", weekForPoints.id).eq("player_id", playerId);
        if (error) throw error;
      } else {
        const { error } = await client.from("player_week_points").insert({ week_id: weekForPoints.id, player_id: playerId, ...payload });
        if (error) throw error;
      }
    }
    editorMessage(`✅ Four point categories saved for Week ${weekForPoints.week_number}.`);
    if (currentWeek?.id === weekForPoints.id && currentUser && savedFantasyTeamId && showSavedTeam) {
      myTeamPointsCache = new Map();
      const selectedIds = [...selected.keys()];
      if (selectedIds.length) {
        const { data: myPoints, error: myPointsError } = await client
          .from("player_week_points")
          .select("player_id, batting, bowling, fielding, winning")
          .eq("week_id", weekForPoints.id)
          .in("player_id", selectedIds);
        if (myPointsError) throw myPointsError;
        for (const row of myPoints || []) myTeamPointsCache.set(row.player_id, row);
      }
      render();
    }
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

    container.innerHTML = (players || []).map(player => `
      <button type="button" data-public-player="${escapeHtml(player.id)}"
        aria-label="View profile for ${escapeHtml(player.full_name || "Unnamed player")}"
        style="display:block;width:100%;min-width:0;text-align:left;padding:14px 16px;border:1px solid #dce4ee;border-radius:10px;background:#fff;color:#102235;font:inherit;font-weight:800;cursor:pointer;">
        ${escapeHtml(player.full_name || "Unnamed player")}
      </button>`).join("");

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
    const client = getSupabaseClient();
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;

    currentUser = sessionData?.session?.user || null;

    if (!currentUser) {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      currentUser = userData?.user || null;
    }

    await loadAdminStatus();
    if (currentUser) await loadSavedTeam();
    render();
  } catch (error) {
    console.error("Could not refresh signed-in state:", error);
    // Keep the current user state rather than falsely switching to signed out
    // because a profile/team query failed.
    render();
  }
}

const initialSaveBtn = document.getElementById("saveBtn");
if (initialSaveBtn) initialSaveBtn.addEventListener("click", saveTeam);

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
      savedFantasyTeamId = null;
      showSavedTeam = false;
      myTeamPointsCache = new Map();
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
if (editorNav) {
  editorNav.addEventListener("click", () => {
    if (!isAdmin) { notify("Admin access required."); return; }
    if (editorSection) editorSection.classList.remove("hidden");
    editorSection?.scrollIntoView({ behavior: "smooth", block: "start" });
    renderEditor();
  });
}
document.getElementById("saveEditor").addEventListener("click", saveEditorSettings);
const editorWeekPicker = document.getElementById("editorWeekPicker");
if (editorWeekPicker) editorWeekPicker.addEventListener("change", async () => {
  try {
    const weekRows = await fetchWeekNumberRows();
    editorWeek = weekRows.find(row => row.id === editorWeekPicker.value) || null;
    await renderEditor();
    editorMessage(editorWeek ? `Editing Week ${editorWeek.week_number}. The live site week has not changed.` : "No week selected.");
  } catch (error) {
    console.error(error);
    editorMessage(error?.message || "Could not open the selected week.", true);
  }
});
const newWeekNumberElement = document.getElementById("newWeekNumber");
const newWeekTitleElement = document.getElementById("newWeekTitle");
if (newWeekNumberElement && newWeekTitleElement) {
  newWeekNumberElement.addEventListener("input", () => {
    if (!newWeekTitleElement.value.trim() || isGenericWeekTitle(newWeekTitleElement.value)) {
      newWeekTitleElement.value = `Week ${newWeekNumberElement.value || ""}`.trim();
    }
  });
}
const newWeekBtn = document.getElementById("newWeekBtn");
if (newWeekBtn) newWeekBtn.addEventListener("click", () => { startNewWeek().catch(error => { console.error(error); notify(error?.message || "Could not create the new week."); }); });
document.getElementById("addPlayerProfilesBtn").addEventListener("click", addPlayerProfilesBulk);
const addClubTeamBtn = document.getElementById("addClubTeamBtn");
if (addClubTeamBtn) addClubTeamBtn.addEventListener("click", addClubTeam);
document.getElementById("saveAssignmentsBtn").addEventListener("click", savePlayerAssignments);
document.getElementById("savePointsBtn").addEventListener("click", savePlayerPoints);

document.getElementById("authSwitch").addEventListener("click", () => {
  openAuth(authMode === "login" ? "signup" : "login");
});

authModal.addEventListener("click", (event) => {
  if (event.target === authModal) closeAuth();
});

let authRefreshTimer = null;

try {
  getSupabaseClient().auth.onAuthStateChange((event) => {
    clearTimeout(authRefreshTimer);
    authRefreshTimer = setTimeout(() => {
      refreshUser().catch(error => console.error(error));
    }, event === "SIGNED_IN" ? 50 : 150);
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
