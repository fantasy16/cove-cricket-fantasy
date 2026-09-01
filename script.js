const teams=[
{name:"Team 1",players:["Player 1A","Player 1B","Player 1C","Player 1D"],roles:["Batter","Bowler","All-rounder","Wicketkeeper"]},
{name:"Team 2",players:["Player 2A","Player 2B","Player 2C","Player 2D"],roles:["Batter","Bowler","All-rounder","Batter"]},
{name:"Team 3",players:["Player 3A","Player 3B","Player 3C","Player 3D"],roles:["Batter","Bowler","All-rounder","Wicketkeeper"]},
{name:"Team 4",players:["Player 4A","Player 4B","Player 4C","Player 4D"],roles:["Batter","Bowler","All-rounder","Batter"]},
{name:"Mens",players:["Mens Player A","Mens Player B","Mens Player C","Mens Player D"],roles:["Batter","Bowler","All-rounder","Wicketkeeper"]},
{name:"Womens",players:["Womens Player A","Womens Player B","Womens Player C","Womens Player D"],roles:["Batter","Bowler","All-rounder","Bowler"]}
];
const selected=new Map(),captains=new Set(),grid=document.getElementById("teams"),toast=document.getElementById("toast");
function notify(text){toast.textContent=text;toast.classList.add("show");clearTimeout(window.tt);window.tt=setTimeout(()=>toast.classList.remove("show"),3000)}
function render(){
 grid.innerHTML="";
 teams.forEach((team,ti)=>{
  const card=document.createElement("div");card.className="team";
  card.innerHTML=`<div class="team-head"><span>${team.name}</span><small>Select 2</small></div>`;
  team.players.forEach((name,pi)=>{
   const key=`${ti}-${pi}`,row=document.createElement("div");
   row.className="player"+(selected.has(key)?" selected":"")+(captains.has(key)?" captain":"");
   row.innerHTML=`<div class="player-info"><div class="player-name">${name}</div><div class="role">${team.roles[pi]}</div></div>`;
   const pick=document.createElement("button");pick.className="btn "+(selected.has(key)?"primary":"light");pick.textContent=selected.has(key)?"Selected":"Select";
   pick.onclick=()=>{const keys=[...selected.keys()].filter(k=>k.startsWith(ti+"-"));if(selected.has(key)){selected.delete(key);captains.delete(key)}else{if(keys.length>=2){notify("You can only select 2 players from "+team.name+".");return}selected.set(key,name)}render()};
   row.appendChild(pick);
   if(selected.has(key)){
    const cap=document.createElement("button");cap.className="btn "+(captains.has(key)?"primary":"outline");cap.textContent=captains.has(key)?"Captain":"Captain?";
    cap.onclick=()=>{const old=[...captains].find(k=>k.startsWith(ti+"-"));if(old&&old!==key)captains.delete(old);captains.has(key)?captains.delete(key):captains.add(key);render()};row.appendChild(cap)
   }
   card.appendChild(row)
  });grid.appendChild(card)
 });
 document.getElementById("selectedCount").textContent=`${selected.size} player${selected.size===1?"":"s"} selected`;
 document.getElementById("captainCount").textContent=`${captains.size} / ${teams.length} captains`;
 document.getElementById("count").textContent=`${selected.size} / ${teams.length*2} players`;
}
document.getElementById("saveBtn").onclick=()=>{
 const missing=teams.some((_,ti)=>[...selected.keys()].filter(k=>k.startsWith(ti+"-")).length!==2);
 const missingCap=teams.some((_,ti)=>![...captains].some(k=>k.startsWith(ti+"-")));
 if(missing){notify("Select 2 players from every team before saving.");return}
 if(missingCap){notify("Choose a captain for every team before saving.");return}
 notify("Team saved! Database connection comes next.")
};
document.getElementById("loginBtn").onclick=()=>notify("Supabase sign-in will be connected next.");
render();
