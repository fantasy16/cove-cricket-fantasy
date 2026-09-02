const teams=[
{name:"4th Men's",captain:"4th Men's Captain",players:["4th Player A","4th Player B","4th Player C","4th Player D"],roles:["Batter","Bowler","All-rounder","Wicketkeeper"]},
{name:"3rd Men's",captain:"3rd Men's Captain",players:["3rd Player A","3rd Player B","3rd Player C","3rd Player D"],roles:["Batter","Bowler","All-rounder","Batter"]},
{name:"2nd Men's",captain:"2nd Men's Captain",players:["2nd Player A","2nd Player B","2nd Player C","2nd Player D"],roles:["Batter","Bowler","All-rounder","Wicketkeeper"]},
{name:"1st Men's",captain:"1st Men's Captain",players:["1st Player A","1st Player B","1st Player C","1st Player D"],roles:["Batter","Bowler","All-rounder","Batter"]},
{name:"1st Women's",captain:"1st Women's Captain",players:["Women's Player A","Women's Player B","Women's Player C","Women's Player D"],roles:["Batter","Bowler","All-rounder","Bowler"]}
];

const selected=new Map();
let fantasyCaptain=null;
const teamsEl=document.getElementById("teams");
const capsEl=document.getElementById("captains");
const toast=document.getElementById("toast");

function notify(text){
toast.textContent=text;
toast.classList.add("show");
clearTimeout(window.toastTimer);
window.toastTimer=setTimeout(()=>toast.classList.remove("show"),3000);
}

function render(){
teamsEl.innerHTML="";
capsEl.innerHTML="";

teams.forEach((team,ti)=>{
const card=document.createElement("div");
card.className="team";
card.innerHTML=`<div class="team-head"><span>${team.name}</span><small>Select 2</small></div>`;

team.players.forEach((name,pi)=>{
const key=`${ti}-${pi}`;
const row=document.createElement("div");
row.className="player"+(selected.has(key)?" selected":"");
row.innerHTML=`<div class="player-info"><div class="player-name">${name}</div><div class="role">${team.roles[pi]}</div></div>`;

const button=document.createElement("button");
button.className=selected.has(key)?"primary":"secondary";
button.textContent=selected.has(key)?"Selected":"Select";

button.onclick=()=>{
const count=[...selected.keys()].filter(k=>k.startsWith(ti+"-")).length;
if(selected.has(key)){selected.delete(key)}
else{
if(count>=2){notify("You can only select 2 players from "+team.name+".");return}
selected.set(key,name);
}
render();
};

row.appendChild(button);
card.appendChild(row);
});
teamsEl.appendChild(card);

const captain=document.createElement("button");
captain.type="button";
captain.className="captain-card"+(fantasyCaptain===ti?" selected":"");
captain.innerHTML=`<div class="cap-badge">C</div><div class="cap-name">${team.captain}</div><div class="cap-team">${team.name}</div>`;
captain.onclick=()=>{
fantasyCaptain=fantasyCaptain===ti?null:ti;
render();
};
capsEl.appendChild(captain);
});

document.getElementById("selectedText").textContent=`${selected.size} player${selected.size===1?"":"s"} selected`;
document.getElementById("captainText").textContent=fantasyCaptain===null?"Captain: not chosen":`Captain: ${teams[fantasyCaptain].captain}`;
document.getElementById("captainStatus").textContent=fantasyCaptain===null?"No captain":teams[fantasyCaptain].name;
document.getElementById("counter").textContent=`${selected.size} / 10 players`;
}

document.getElementById("saveBtn").onclick=()=>{
if(selected.size!==10){notify("Select exactly 2 players from each of the 5 teams.");return}
if(fantasyCaptain===null){notify("Choose one of the 5 team captains.");return}
notify("Team saved! Supabase connection comes next.");
};

document.getElementById("loginBtn").onclick=()=>{
notify("Sign-in will be connected to Supabase next.");
};

render();
