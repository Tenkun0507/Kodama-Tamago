/* =========================================================
   設定
========================================================= */
let N=7;
let LM=2;
let DM=2;
let moveUnlock="allPieces";
let types={kodama:"human",tamago:"ai"};
let aiLevels={kodama:"normal",tamago:"normal"};

/* =========================================================
   AI設定 v34
   =========================================================

   旧AIの学習重み・ロック専用補正・ゲームごとの作戦癖などは一度廃止。
   AIは次の4層だけで動く。

   1. 絶対ルール: 今勝てるなら勝つ / 次に即負けする手を避ける
   2. 新しく自己対戦から作り直した初期評価
   3. ミニマックス探索
   4. 実戦結果から学ぶオンライン強化学習

   難易度を変えたい場合は AI_DIFFICULTY_SETTINGS だけ調整する。
========================================================= */

const AI_DIFFICULTY_SETTINGS={
  easy:{depth:0,candidateLimit:18,replyLimit:0,nearBestGap:7.0,temperature:3.2,thinkTimeMs:80},
  normal:{depth:1,candidateLimit:24,replyLimit:0,nearBestGap:2.7,temperature:1.2,thinkTimeMs:180},
  hard:{depth:2,candidateLimit:20,replyLimit:9,nearBestGap:0.9,temperature:0.42,thinkTimeMs:520},
  expert:{depth:3,candidateLimit:18,replyLimit:8,nearBestGap:0.28,temperature:0.12,thinkTimeMs:1100}
};

/*
  今回ゼロからやり直した自己対戦の初期評価。
  7x7 / 各文字2 / 濁点2 の2移動条件を旧データから切り離して新規自己対戦で作り直した値。
  これ以前の製品版で追加してきた個別補正は引き継いでいない。
*/
const FRESH_SELFPLAY_PRIOR={
  "7x7_L2_D2_allPieces":{
    kodama:{ownPotential:1.0135810466,enemyPotential:1.4009248562,ownThreat:9.8985506947,enemyThreat:10.2239445139,placeLetter:0.6643197632,placeDakuten:0.5007493252,moveLetter:-0.2161233486,moveDakuten:-0.1349870859,enemyLock:0.3362009624,center:0.2307368161},
    tamago:{ownPotential:1.9944998801,enemyPotential:1.0259426754,ownThreat:6.0909308542,enemyThreat:4.0728046074,placeLetter:0.7998021086,placeDakuten:0.5033893504,moveLetter:-0.1426576330,moveDakuten:-0.2178237110,enemyLock:0.2810767828,center:0.0019489681}
  },
  "7x7_L2_D2_always":{
    kodama:{ownPotential:1.00,enemyPotential:1.05,ownThreat:8.5,enemyThreat:10.0,placeLetter:0.60,placeDakuten:0.45,moveLetter:-0.15,moveDakuten:-0.10,enemyLock:0.35,center:0.12},
    tamago:{ownPotential:1.0379026150,enemyPotential:0.6380892522,ownThreat:7.2205148453,enemyThreat:9.8238661814,placeLetter:0.6543481094,placeDakuten:0.4071165849,moveLetter:-0.2663453012,moveDakuten:-0.0706458692,enemyLock:0.4765291410,center:-0.0665779610}
  }
};

const DEFAULT_PRIOR={
  kodama:{ownPotential:1.00,enemyPotential:1.08,ownThreat:7.5,enemyThreat:9.2,placeLetter:0.52,placeDakuten:0.40,moveLetter:-0.18,moveDakuten:-0.10,enemyLock:0.22,center:0.10},
  tamago:{ownPotential:1.00,enemyPotential:1.08,ownThreat:7.5,enemyThreat:9.2,placeLetter:0.52,placeDakuten:0.40,moveLetter:-0.18,moveDakuten:-0.10,enemyLock:0.22,center:0.10}
};

const AI_TACTICAL_SETTINGS={
  ALWAYS_TAKE_IMMEDIATE_WIN:true,
  repetitionPenalty:18,
  recentRepetitionPenalty:12,
  rlValueScale:12
};

/* =========================================================
   オンライン強化学習
   ---------------------------------------------------------
   AIが実際に対戦した結果を報酬として学ぶ。

   勝ち  = +1
   負け  = -1
   引分  =  0

   学習した値はブラウザの localStorage に条件別・陣営別で保存される。
   リロードしても残るので、対戦を重ねるほど実戦データが蓄積される。

   初期AIを壊しにくいよう、学習部分は「初期評価への補正」として使う。
========================================================= */
const RL_STORAGE_VERSION="kt_rl_v35_lock_neutral";
const RL_FEATURE_COUNT=7;
const RL_LEARNING_RATE=0.018;
const RL_DISCOUNT=0.985;
const RL_WEIGHT_LIMIT=2.5;

function aiProfileKey(){
  return `${N}x${N}_L${LM}_D${DM}_${moveUnlock}`;
}
function getBaseAIWeights(team){
  const p=FRESH_SELFPLAY_PRIOR[aiProfileKey()];
  return p ? p[team] : DEFAULT_PRIOR[team];
}
function rlStorageKey(team){
  return `${RL_STORAGE_VERSION}|${aiProfileKey()}|${team}`;
}
function loadRLRecord(team){
  try{
    const raw=localStorage.getItem(rlStorageKey(team));
    if(!raw)return {weights:Array(RL_FEATURE_COUNT).fill(0),games:0};
    const x=JSON.parse(raw);
    if(!Array.isArray(x.weights)||x.weights.length!==RL_FEATURE_COUNT)throw new Error("bad RL data");
    return {weights:x.weights.map(Number),games:Number(x.games)||0};
  }catch(e){
    return {weights:Array(RL_FEATURE_COUNT).fill(0),games:0};
  }
}
function saveRLRecord(team,record){
  try{localStorage.setItem(rlStorageKey(team),JSON.stringify(record))}catch(e){}
}
function currentRLRecord(team){
  if(!rlRuntime[team] || rlRuntime[team].key!==rlStorageKey(team)){
    rlRuntime[team]={key:rlStorageKey(team),...loadRLRecord(team)};
  }
  return rlRuntime[team];
}
function resetRLRuntimeForGame(){
  aiEpisodeSamples={kodama:[],tamago:[]};
}

function getEffectiveAILevelConfig(team){
  const level=currentAILevel(team);
  const base=AI_DIFFICULTY_SETTINGS[level];
  const actionCount=legalActions(board,hands,team).length;
  const cfg={...base,cap:base.candidateLimit,replyCap:base.replyLimit,timeMs:base.thinkTimeMs};
  if(actionCount>180){cfg.cap=Math.min(cfg.cap,13);cfg.replyCap=Math.min(cfg.replyCap,6)}
  else if(actionCount>110){cfg.cap=Math.min(cfg.cap,16);cfg.replyCap=Math.min(cfg.replyCap,7)}
  return cfg;
}

/* =========================================================
   ゲーム状態
========================================================= */
let board=[],hands={},side="kodama",selected=null,gameOver=false,moves=0;
let snapshots=[],winningCells=[],stateCounts=new Map(),stateHistory=[];
let gameGeneration=0,aiThinking=false;
let rlRuntime={};
let aiEpisodeSamples={kodama:[],tamago:[]};
let statusLock=false;

/* =========================================================
   基本
========================================================= */
function otherSide(s){return s==="kodama"?"tamago":"kodama"}
function teamName(s){return s==="kodama"?"こだま":"たまご"}
function targetWord(s){return s==="kodama"?["こ","だ","ま"]:["た","ま","ご"]}
function emptyCell(){return{letter:null,owner:null,dakutenOwner:null}}
function cloneBoard(b){return b.map(c=>({...c}))}
function cloneHands(h){return{kodama:{...h.kodama},tamago:{...h.tamago}}}
function createHands(){
  return{
    kodama:{こ:LM,た:LM,ま:LM,゛:DM},
    tamago:{こ:LM,た:LM,ま:LM,゛:DM}
  };
}
function displayLetter(c){
  if(!c.letter)return "";
  if(c.dakutenOwner&&c.letter==="こ")return "ご";
  if(c.dakutenOwner&&c.letter==="た")return "だ";
  return c.letter;
}
function allPiecesPlaced(team,h=hands){
  return h[team]["こ"]===0&&h[team]["た"]===0&&h[team]["ま"]===0&&h[team]["゛"]===0;
}
function movementUnlocked(team,h=hands){
  return moveUnlock==="always"||allPiecesPlaced(team,h);
}
function positionText(i){return `${Math.floor(i/N)+1}行${i%N+1}列`}
function currentAILevel(team){return aiLevels[team]}

/* =========================================================
   セットアップ
========================================================= */
function refreshPlayerTypeUI(){
  ["kodama","tamago"].forEach(team=>{
    ["human","ai"].forEach(type=>{
      const btn=document.getElementById(`${team}-${type}`);
      btn.classList.toggle("selected",types[team]===type);
    });

    const aiSelected=types[team]==="ai";
    const box=document.getElementById(`${team}-level-box`);
    box.classList.toggle("disabled",!aiSelected);

    ["easy","normal","hard","expert"].forEach(level=>{
      document.getElementById(`${team}-level-${level}`).disabled=!aiSelected;
    });
  });

  // AI同士の対戦は禁止。
  // 片方がAIなら、もう片方の「AI」ボタンを押せないようにする。
  const kodamaAI=document.getElementById("kodama-ai");
  const tamagoAI=document.getElementById("tamago-ai");

  kodamaAI.disabled=(types.tamago==="ai" && types.kodama!=="ai");
  tamagoAI.disabled=(types.kodama==="ai" && types.tamago!=="ai");
}

function chooseType(team,type){
  // AIを選んだ場合、反対側がAIなら自動でプレイヤーへ戻す。
  // これによりAI vs AIの状態は作れない。
  if(type==="ai"){
    const other=team==="kodama"?"tamago":"kodama";
    types[other]="human";
  }

  types[team]=type;
  refreshPlayerTypeUI();
}
function setAILevel(team,level){
  aiLevels[team]=level;
  ["easy","normal","hard","expert"].forEach(x=>{
    document.getElementById(`${team}-level-${x}`).classList.remove("selected");
  });
  document.getElementById(`${team}-level-${level}`).classList.add("selected");
}
function setBoardSize(size){
  N=size;
  [5,6,7].forEach(n=>document.getElementById(`size-${n}`).classList.remove("selected"));
  document.getElementById(`size-${size}`).classList.add("selected");
}
function setLetterMax(max){
  LM=max;
  [1,2,3,4].forEach(n=>document.getElementById(`letter-${n}`).classList.remove("selected"));
  document.getElementById(`letter-${max}`).classList.add("selected");
}
function setDakutenMax(max){
  DM=max;
  [1,2,3,4].forEach(n=>document.getElementById(`dakuten-${n}`).classList.remove("selected"));
  document.getElementById(`dakuten-${max}`).classList.add("selected");
}
function setMoveUnlock(mode){
  moveUnlock=mode;
  ["always","allPieces"].forEach(x=>document.getElementById(`move-${x}`).classList.remove("selected"));
  document.getElementById(`move-${mode}`).classList.add("selected");
}

/* =========================================================
   開始・終了
========================================================= */
function startGame(){
  closeMoveChoiceModal(false);

  // UI外から状態が変わった場合も、AI同士では開始させない。
  if(types.kodama==="ai" && types.tamago==="ai"){
    alert("AI同士では対戦できません。どちらかをプレイヤーにしてください。");
    return;
  }

  gameGeneration++;
  aiThinking=false;
  board=Array.from({length:N*N},emptyCell);
  hands=createHands();
  side="kodama";
  selected=null;
  gameOver=false;
  moves=0;
  snapshots=[];
  winningCells=[];
  stateCounts=new Map();
  stateHistory=[];
  statusLock=false;

  resetRLRuntimeForGame();

  const modal=document.getElementById("modal");
  if(modal)modal.classList.remove("show");

  document.getElementById("setup").style.display="none";
  document.getElementById("game").style.display="block";
  document.body.classList.add("playing");

  rememberCurrentState();
  render();
  refreshSoundButtons();
  playSE("start");
  if(bgmEnabled)restartBGMFromBeginning();
  beginTurn();
}
function restartGame(){
  if(!confirm("現在のゲームを最初からやり直す？"))return;
  startGame();
}
function backSetup(){
  closeMoveChoiceModal(false);

  gameGeneration++;
  aiThinking=false;
  stopBGM();
  document.body.classList.remove("playing");
  document.getElementById("game").style.display="none";
  document.getElementById("setup").style.display="block";
}
function finishGame(message,winCells=[],winner=null){
  learnFromFinishedGame(winner);
  stopBGM();
  playSE(winner ? "win" : "draw");
  gameGeneration++;
  aiThinking=false;
  gameOver=true;
  winningCells=winCells;
  selected=null;
  statusLock=true;
  render();
  document.getElementById("status").textContent=message;
}

/* =========================================================
   ターン
========================================================= */
function beginTurn(){
  if(gameOver)return;

  closeMoveChoiceModal(false);

  selected=null;
  statusLock=false;
  render();
  updateStatus();

  if(types[side]==="ai"){
    const generation=gameGeneration;
    setTimeout(()=>aiTurn(generation),180);
  }
}
function switchSide(){
  side=otherSide(side);
  beginTurn();
}
function updateStatus(){
  if(statusLock||gameOver)return;
  if(types[side]==="ai"){
    document.getElementById("status").textContent=`${teamName(side)} AIが考え中…`;
  }else{
    const moveText=movementUnlocked(side)?"移動OK":"まずは手持ちを配置";
    document.getElementById("status").textContent=`${teamName(side)}の番 — ${moveText}`;
  }
}
function showStatus(text){
  statusLock=true;
  document.getElementById("status").textContent=text;
  setTimeout(()=>{
    if(!gameOver){
      statusLock=false;
      updateStatus();
    }
  },1000);
}

/* =========================================================
   描画
========================================================= */
function render(){
  renderBoard();
  renderHand();
  const movesEl=document.getElementById("moves");
  if(movesEl)movesEl.textContent=moves;
  const moveStateEl=document.getElementById("moveState");
  if(moveStateEl)moveStateEl.textContent=movementUnlocked(side)?"移動OK":"配置中";

  const undo=document.getElementById("undo");
  undo.disabled=gameOver||aiThinking||!canUndo();
}
function renderBoard(){
  const el=document.getElementById("board");
  el.innerHTML="";
  el.style.gridTemplateColumns=`repeat(${N},1fr)`;

  board.forEach((cell,index)=>{
    const b=document.createElement("button");
    b.className="cell";
    b.disabled=types[side]!=="human"||gameOver||aiThinking;

    if(
      selected &&
      (
        selected.type==="letter" ||
        selected.type==="dakuten" ||
        selected.type==="moveChoice"
      ) &&
      selected.index===index
    ){
      b.classList.add("sel");
    }

    if(
      selected &&
      (
        selected.type==="letter" ||
        selected.type==="dakuten"
      ) &&
      isDestination(index)
    ){
      b.classList.add("target");
    }
    if(winningCells.includes(index))b.classList.add("win");

    if(cell.letter){
      const x=document.createElement("div");
      x.className=`letter ${cell.owner}`;
      x.textContent=displayLetter(cell);
      b.appendChild(x);
    }
    if(cell.dakutenOwner){
      const x=document.createElement("div");
      x.className=`dakuten ${cell.dakutenOwner}`;
      x.innerHTML='<span class="dakuten-mark" aria-hidden="true"><span class="dakuten-glyph">゛</span></span>';
      x.setAttribute("aria-label","濁点");
      b.appendChild(x);
    }

    b.onclick=()=>clickCell(index);
    el.appendChild(b);
  });
}
function renderHand(){
  const el=document.getElementById("hand");
  el.innerHTML="";
  const order=side==="kodama"?["こ","た","ま","゛"]:["た","ま","こ","゛"];

  for(const piece of order){
    const b=document.createElement("button");
    if(selected&&selected.type==="hand"&&selected.piece===piece)b.classList.add("selected");
    b.innerHTML=`${piece}<span class="count">×${hands[side][piece]}</span>`;
    b.disabled=gameOver||aiThinking||types[side]!=="human"||hands[side][piece]<=0;
    b.onclick=()=>{
      statusLock=false;
      if(selected&&selected.type==="hand"&&selected.piece===piece){
        selected=null;
      }else{
        selected={type:"hand",piece};
      }
      render();
      updateStatus();
    };
    el.appendChild(b);
  }
}

/* =========================================================
   人間操作
========================================================= */

/*
  自分の文字に自分の濁点が付いている場合は、

  1. 濁点だけを別の「こ」「た」へ移動
  2. 文字と濁点をセットで空きマスへ移動

  のどちらかを選べる。

  ※ ここでの選択はまだ1手を消費しない。
*/
function ensureMoveChoiceModal(){
  if(document.getElementById("moveChoiceModal"))return;

  const style=document.createElement("style");
  style.id="moveChoiceStyle";
  style.textContent=`
    #moveChoiceModal{
      position:fixed;
      inset:0;
      z-index:9999;
      display:none;
      align-items:center;
      justify-content:center;
      padding:18px;
      background:rgba(43,36,31,.28);
    }
    #moveChoiceModal.show{
      display:flex;
    }
    #moveChoiceCard{
      width:min(92vw,360px);
      background:#fff;
      border:1px solid #d8cbbb;
      border-radius:16px;
      box-shadow:0 14px 34px rgba(42,34,28,.22);
      padding:16px;
    }
    #moveChoiceTitle{
      font-size:15px;
      font-weight:900;
      color:#3a302a;
      text-align:center;
      margin-bottom:6px;
    }
    #moveChoiceNote{
      font-size:11px;
      line-height:1.55;
      color:#75695f;
      text-align:center;
      margin-bottom:12px;
    }
    .move-choice-buttons{
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:8px;
    }
    .move-choice-buttons button{
      min-height:48px;
      border-radius:12px;
      font-size:13px;
      font-weight:850;
    }
    #moveChoiceCancel{
      width:100%;
      min-height:38px;
      margin-top:8px;
      font-size:11px;
    }
  `;
  document.head.appendChild(style);

  const modal=document.createElement("div");
  modal.id="moveChoiceModal";

  modal.innerHTML=`
    <div id="moveChoiceCard">
      <div id="moveChoiceTitle">このピースをどう動かす？</div>
      <div id="moveChoiceNote">
        自分の文字に自分の濁点が付いています
      </div>

      <div class="move-choice-buttons">
        <button id="moveChoiceDakuten" type="button">
          濁点のみ
        </button>
        <button id="moveChoiceTogether" type="button">
          文字ごと
        </button>
      </div>

      <button id="moveChoiceCancel" type="button">
        キャンセル
      </button>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener("click",event=>{
    if(event.target===modal){
      closeMoveChoiceModal(true);
    }
  });
}

function closeMoveChoiceModal(clearSelection=false){
  const modal=document.getElementById("moveChoiceModal");
  if(modal)modal.classList.remove("show");

  if(clearSelection){
    selected=null;
    statusLock=false;
    render();
    updateStatus();
  }
}

/*
  自分の文字 + 自分の濁点をクリックした場合、

  ・濁点のみ
      元の文字は残す。
      濁点だけを別の「こ」「た」へ移動する。

  ・文字ごと
      文字と自分の濁点をセットで、
      空いているマスへ移動する。

  のどちらかを明示的に選択する。
*/
function showOwnDakutenMoveChoice(index){
  ensureMoveChoiceModal();

  selected={
    type:"moveChoice",
    index
  };

  render();

  const modal=document.getElementById("moveChoiceModal");
  const dakutenButton=document.getElementById("moveChoiceDakuten");
  const togetherButton=document.getElementById("moveChoiceTogether");
  const cancelButton=document.getElementById("moveChoiceCancel");

  dakutenButton.onclick=event=>{
    event.stopPropagation();

    closeMoveChoiceModal(false);

    selected={
      type:"dakuten",
      index
    };

    statusLock=true;

    render();

    document.getElementById("status").textContent=
      "濁点だけを移動します。移動先の「こ」か「た」を選んでね";
  };

  togetherButton.onclick=event=>{
    event.stopPropagation();

    closeMoveChoiceModal(false);

    selected={
      type:"letter",
      index
    };

    statusLock=true;

    render();

    document.getElementById("status").textContent=
      "文字と濁点をまとめて移動します。空いているマスを選んでね";
  };

  cancelButton.onclick=event=>{
    event.stopPropagation();
    closeMoveChoiceModal(true);
  };

  modal.classList.add("show");
}

function isDestination(index){
  if(!selected)return false;
  if(selected.type==="letter"){
    return movementUnlocked(side)&&!board[index].letter&&index!==selected.index;
  }
  if(selected.type==="dakuten"){
    return movementUnlocked(side)&&index!==selected.index&&
      (board[index].letter==="こ"||board[index].letter==="た")&&!board[index].dakutenOwner;
  }
  return false;
}
function clickCell(index){
  if(gameOver||aiThinking||types[side]!=="human")return;
  const cell=board[index];

  // 移動元をもう一度押したら選択解除。
  if(
    selected &&
    (
      selected.type==="letter" ||
      selected.type==="dakuten" ||
      selected.type==="moveChoice"
    ) &&
    selected.index===index
  ){
    selected=null;
    statusLock=false;
    render();
    updateStatus();
    return;
  }

  if(!selected){
    if(!movementUnlocked(side)){
      if(cell.owner===side||cell.dakutenOwner===side){
        showStatus("現在の設定ではまだ移動できないよ");
      }
      return;
    }

    /*
      自分の文字 + 自分の濁点
      → 「濁点のみ」か「文字ごと」を選べる。
    */
    if(
      cell.owner===side &&
      cell.letter &&
      cell.dakutenOwner===side
    ){
      showOwnDakutenMoveChoice(index);
      return;
    }

    /*
      自分の濁点が相手文字に付いている場合。
      相手文字そのものは動かせないので、濁点だけを選択する。
    */
    if(cell.dakutenOwner===side){
      selected={
        type:"dakuten",
        index
      };

      render();

      statusLock=true;
      document.getElementById("status").textContent=
        "濁点の移動先を選んでね";
      return;
    }

    /*
      自分の文字。
      相手の濁点が付いていればロックされている。
    */
    if(cell.owner===side&&cell.letter){
      if(
        cell.dakutenOwner &&
        cell.dakutenOwner!==side
      ){
        showStatus("相手の濁点でロックされている！");
        return;
      }

      selected={
        type:"letter",
        index
      };

      render();

      statusLock=true;
      document.getElementById("status").textContent=
        "文字を移動する空きマスを選んでね";
    }

    return;
  }

  if(selected.type==="moveChoice"){
    return;
  }

  if(selected.type==="hand"){
    const piece=selected.piece;

    if(piece==="゛"){
      if((cell.letter==="こ"||cell.letter==="た")&&!cell.dakutenOwner){
        saveSnapshot();
        cell.dakutenOwner=side;
        hands[side]["゛"]--;
        playSE("dakuten");
        finishMove();
      }else{
        showStatus("゛は濁点の付いていない「こ」か「た」に置けるよ");
      }
      return;
    }

    if(!cell.letter){
      saveSnapshot();
      cell.letter=piece;
      cell.owner=side;
      hands[side][piece]--;
      playSE("place");
      finishMove();
    }else{
      showStatus("文字は空いているマスに置いてね");
    }
    return;
  }

  if(selected.type==="dakuten"){
    if(isDestination(index)){
      const from=selected.index;
      saveSnapshot();
      board[from].dakutenOwner=null;
      cell.dakutenOwner=side;
      playSE("dakutenMove");
      finishMove();
    }else{
      showStatus("゛は濁点の付いていない「こ」か「た」に移動できるよ");
    }
    return;
  }

  if(selected.type==="letter"){
    if(isDestination(index)){
      const from=selected.index;
      saveSnapshot();
      const source=board[from];
      board[index].letter=source.letter;
      board[index].owner=source.owner;

      /*
        自分の文字に自分の濁点が付いている場合は、
        「文字ごと」を選んだとき濁点も一緒に移動する。
      */
      board[index].dakutenOwner=
        source.dakutenOwner===side
          ? side
          : null;

      board[from]=emptyCell();

      playSE("move");
      finishMove();
    }else{
      showStatus("文字は空いているマスに移動できるよ");
    }
  }
}

/* =========================================================
   一手戻す
   対AIでは、AIが応答済みなら「直前の自分の手」まで戻す。
========================================================= */
function saveSnapshot(){
  snapshots.push({
    board:cloneBoard(board),
    hands:cloneHands(hands),
    side,
    moves,
    stateCounts:[...stateCounts.entries()],
    stateHistory:[...stateHistory],
    aiEpisodeSamples:{
      kodama:aiEpisodeSamples.kodama.map(x=>[...x]),
      tamago:aiEpisodeSamples.tamago.map(x=>[...x])
    }
  });
  if(snapshots.length>100)snapshots.shift();
}
function canUndo(){
  if(!snapshots.length)return false;
  if(types.kodama==="ai"&&types.tamago==="ai")return false;
  return true;
}
function restoreSnapshot(s){
  closeMoveChoiceModal(false);

  board=cloneBoard(s.board);
  hands=cloneHands(s.hands);
  side=s.side;
  moves=s.moves;
  stateCounts=new Map(s.stateCounts);
  stateHistory=[...(s.stateHistory||[])];
  aiEpisodeSamples=s.aiEpisodeSamples ? {
    kodama:s.aiEpisodeSamples.kodama.map(x=>[...x]),
    tamago:s.aiEpisodeSamples.tamago.map(x=>[...x])
  } : {kodama:[],tamago:[]};
  selected=null;
  winningCells=[];
  gameOver=false;
  statusLock=false;
}
function undoMove(){
  if(!canUndo()||gameOver||aiThinking)return;

  gameGeneration++;
  aiThinking=false;

  let s=snapshots.pop();
  restoreSnapshot(s);

  // Human vs AI: after AI has replied, go back to the human's previous decision.
  if(types[side]==="ai"&&snapshots.length){
    s=snapshots.pop();
    restoreSnapshot(s);
  }

  playSE("undo");
  render();
  beginTurn();
}

/* =========================================================
   手の確定
========================================================= */
function finishMove(){
  closeMoveChoiceModal(false);

  moves++;
  selected=null;
  render();

  const win=findWin(board,side);
  if(win){
    finishGame(`${teamName(side)}の勝ち！`,win,side);
    return;
  }

  const next=otherSide(side);
  const nextActions=legalActions(board,hands,next);
  if(!nextActions.length){
    finishGame("引き分け！");
    return;
  }

  side=next;

  if(rememberCurrentState()>=3){
    finishGame("同じ局面が3回繰り返されたため引き分け！");
    return;
  }

  beginTurn();
}

/* =========================================================
   勝利判定
========================================================= */
const WIN_LINE_CACHE={};

function allLines(){
  if(WIN_LINE_CACHE[N])return WIN_LINE_CACHE[N];

  const r=[];

  for(let row=0;row<N;row++)
    for(let col=0;col<=N-3;col++)
      r.push([row*N+col,row*N+col+1,row*N+col+2]);

  for(let col=0;col<N;col++)
    for(let row=0;row<=N-3;row++)
      r.push([row*N+col,(row+1)*N+col,(row+2)*N+col]);

  for(let row=0;row<=N-3;row++)
    for(let col=0;col<=N-3;col++)
      r.push([row*N+col,(row+1)*N+col+1,(row+2)*N+col+2]);

  for(let row=0;row<=N-3;row++)
    for(let col=2;col<N;col++)
      r.push([row*N+col,(row+1)*N+col-1,(row+2)*N+col-2]);

  WIN_LINE_CACHE[N]=r;
  return r;
}
function arraysEqual(a,b){return a.length===b.length&&a.every((v,i)=>v===b[i])}
function findWin(b,team){
  const w=targetWord(team);
  const rev=[w[2],w[1],w[0]];
  for(const line of allLines()){
    const v=line.map(i=>displayLetter(b[i]));
    if(arraysEqual(v,w)||arraysEqual(v,rev))return line;
  }
  return null;
}

/* =========================================================
   合法手
========================================================= */
function legalActions(b,h,team){
  const actions=[];
  const empties=[];

  for(let i=0;i<b.length;i++){
    if(!b[i].letter)empties.push(i);
  }

  for(const p of ["こ","た","ま"]){
    if(h[team][p]>0){
      for(const to of empties)actions.push({type:"place",piece:p,to});
    }
  }

  if(h[team]["゛"]>0){
    for(let i=0;i<b.length;i++){
      if((b[i].letter==="こ"||b[i].letter==="た")&&!b[i].dakutenOwner){
        actions.push({type:"placeDakuten",to:i});
      }
    }
  }

  if(movementUnlocked(team,h)){
    for(let from=0;from<b.length;from++){
      const c=b[from];
      if(c.owner!==team||!c.letter)continue;
      if(c.dakutenOwner&&c.dakutenOwner!==team)continue;

      for(const to of empties){
        if(to!==from){
          /*
            自分の文字に自分の濁点が付いている場合も
            move は「文字 + 濁点をまとめて移動」として扱う。
          */
          actions.push({
            type:"move",
            from,
            to
          });
        }
      }
    }

    for(let from=0;from<b.length;from++){
      if(b[from].dakutenOwner!==team)continue;

      for(let to=0;to<b.length;to++){
        if(to!==from&&(b[to].letter==="こ"||b[to].letter==="た")&&!b[to].dakutenOwner){
          /*
            moveDakuten は濁点だけを移動。
            元の文字はその場に残る。
          */
          actions.push({
            type:"moveDakuten",
            from,
            to
          });
        }
      }
    }
  }

  return actions;
}
function applyAction(b,h,team,a){
  const nb=cloneBoard(b);
  const nh=cloneHands(h);

  if(a.type==="place"){
    nb[a.to].letter=a.piece;
    nb[a.to].owner=team;
    nh[team][a.piece]--;
  }else if(a.type==="placeDakuten"){
    nb[a.to].dakutenOwner=team;
    nh[team]["゛"]--;
  }else if(a.type==="move"){
    const s=nb[a.from];

    nb[a.to].letter=s.letter;
    nb[a.to].owner=s.owner;

    /*
      自分の濁点が付いた自分の文字を move した場合は、
      濁点も文字とセットで移動する。
    */
    nb[a.to].dakutenOwner=
      s.dakutenOwner===team
        ? team
        : null;

    nb[a.from]=emptyCell();

  }else if(a.type==="moveDakuten"){
    /*
      濁点だけを移動。
      元の文字は盤面に残る。
    */
    nb[a.from].dakutenOwner=null;
    nb[a.to].dakutenOwner=team;
  }

  return{board:nb,hands:nh};
}

/* =========================================================
   AI評価 + 新AI戦略
========================================================= */
function linePatternScore(v,t){
  let m=0,e=0;
  for(let i=0;i<3;i++){
    if(v[i]===t[i])m++;
    else if(v[i]==="")e++;
    else return 0;
  }
  if(m===3)return 100;
  if(m===2&&e===1)return 1;
  if(m===1&&e===2)return .06;
  return 0;
}

function features(b,team){
  const enemy=otherSide(team);
  const tw=targetWord(team),tr=[tw[2],tw[1],tw[0]];
  const ew=targetWord(enemy),er=[ew[2],ew[1],ew[0]];
  let ownPotential=0,enemyPotential=0,ownThreat=0,enemyThreat=0,enemyLock=0,center=0;

  for(const line of allLines()){
    const v=line.map(i=>displayLetter(b[i]));
    const op=Math.max(linePatternScore(v,tw),linePatternScore(v,tr));
    const ep=Math.max(linePatternScore(v,ew),linePatternScore(v,er));
    ownPotential+=op;
    enemyPotential+=ep;
    if(op>=1&&op<100)ownThreat++;
    if(ep>=1&&ep<100)enemyThreat++;
  }

  const mid=(N-1)/2;
  for(let i=0;i<b.length;i++){
    const c=b[i];
    if(c.dakutenOwner===team&&c.owner&&c.owner!==team)enemyLock++;
    if(c.owner===team){
      const y=Math.floor(i/N),x=i%N;
      center+=Math.max(0,N-(Math.abs(y-mid)+Math.abs(x-mid)));
    }
  }

  return{ownPotential,enemyPotential,ownThreat,enemyThreat,enemyLock,center};
}

function rlFeatureVector(b,h,team){
  const f=features(b,team);
  const enemy=otherSide(team);

  const lineCount=Math.max(
    1,
    allLines().length
  );

  const initial=Math.max(
    1,
    3*LM+DM
  );

  const myLeft=
    h[team]["こ"]+
    h[team]["た"]+
    h[team]["ま"]+
    h[team]["゛"];

  const enemyLeft=
    h[enemy]["こ"]+
    h[enemy]["た"]+
    h[enemy]["ま"]+
    h[enemy]["゛"];

  return [
    1,

    // 自分の勝ち筋
    f.ownPotential/
      Math.max(1,lineCount*.22),

    // 相手の勝ち筋
    -f.enemyPotential/
      Math.max(1,lineCount*.22),

    // 自分の強い脅威
    f.ownThreat/
      Math.max(1,lineCount*.12),

    // 相手の強い脅威
    -f.enemyThreat/
      Math.max(1,lineCount*.12),

    // 中央・位置取り
    f.center/
      Math.max(1,N*N*.55),

    // 残りピース差
    (enemyLeft-myLeft)/initial
  ];
}

function dot(a,b){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s}
function rlValue(b,h,team){
  const rec=currentRLRecord(team);
  return Math.tanh(dot(rec.weights,rlFeatureVector(b,h,team)));
}

function evaluateState(b,h,team){
  if(findWin(b,team))return 1e8;
  if(findWin(b,otherSide(team)))return -1e8;

  const f=features(b,team);
  const w=getBaseAIWeights(team);

  /*
    ロック数そのものには直接点を与えない。

    ロックによって
    ・自分の勝ち筋が増える
    ・相手の勝ち筋が減る
    ・探索上、相手の有力な移動が消える
    などの実利が出た場合に、その結果を通して評価する。

    これにより
    「相手の た / こ を見たら、とりあえず濁点」
    という固定戦術を学びにくくする。
  */
  let s=
    f.ownPotential*w.ownPotential-
    f.enemyPotential*w.enemyPotential+
    f.ownThreat*w.ownThreat-
    f.enemyThreat*w.enemyThreat+
    f.center*w.center;

  const myLeft=
    h[team]["こ"]+
    h[team]["た"]+
    h[team]["ま"]+
    h[team]["゛"];

  const en=otherSide(team);

  const enemyLeft=
    h[en]["こ"]+
    h[en]["た"]+
    h[en]["ま"]+
    h[en]["゛"];

  s+=(enemyLeft-myLeft)*0.03;

  // 実戦から学んだ価値関数は、初期評価を壊さない範囲で補正として加える。
  s+=
    AI_TACTICAL_SETTINGS.rlValueScale*
    rlValue(b,h,team);

  return s;
}

function actionBias(b,a,team){
  const w=getBaseAIWeights(team);

  if(a.type==="place"){
    return w.placeLetter;
  }

  if(a.type==="placeDakuten"){
    const target=b[a.to];

    const locksEnemy=
      target &&
      target.owner &&
      target.owner!==team;

    /*
      相手文字への濁点は
      「相手をロックした」という理由だけでは
      placeDakuten の基礎ボーナスを与えない。

      ただし
      ・た→だ / こ→ご で勝ち筋が伸びる
      ・相手の勝ち筋が崩れる
      ・探索上、相手の有効な移動が減る
      という効果は evaluateState() / minimax 側で評価される。
    */
    if(locksEnemy){
      return 0;
    }

    return w.placeDakuten;
  }

  if(a.type==="move"){
    return w.moveLetter;
  }

  if(a.type==="moveDakuten"){
    return w.moveDakuten;
  }

  return 0;
}

function findImmediateWinningActions(b,h,team){
  const wins=[];
  for(const a of legalActions(b,h,team)){
    const n=applyAction(b,h,team,a);
    if(findWin(n.board,team))wins.push(a);
  }
  return wins;
}
function findImmediateWinningAction(b,h,team){
  const x=findImmediateWinningActions(b,h,team);
  return x.length?x[0]:null;
}
function countImmediateWins(b,h,team,stopAt=99){
  let c=0;
  for(const a of legalActions(b,h,team)){
    const n=applyAction(b,h,team,a);
    if(findWin(n.board,team)){
      c++;
      if(c>=stopAt)break;
    }
  }
  return c;
}

function repetitionPenaltyFor(b,h,nextSide){
  const key=stateKey(b,h,nextSide);
  const count=stateCounts.get(key)||0;
  let p=count*AI_TACTICAL_SETTINGS.repetitionPenalty;
  const lookback=Math.min(10,stateHistory.length);
  for(let d=1;d<=lookback;d++){
    if(stateHistory[stateHistory.length-d]===key){
      p+=AI_TACTICAL_SETTINGS.recentRepetitionPenalty*(lookback-d+1)/lookback;
      break;
    }
  }
  return p;
}

function cheapActionScore(b,h,team,a){
  const n=applyAction(b,h,team,a);

  if(findWin(n.board,team)){
    return 1e9;
  }

  return (
    evaluateState(
      n.board,
      n.hands,
      team
    )
    +
    actionBias(
      b,
      a,
      team
    )
    -
    repetitionPenaltyFor(
      n.board,
      n.hands,
      otherSide(team)
    )
  );
}
function rankActions(b,h,team,actions){
  return actions.map(a=>({a,s:cheapActionScore(b,h,team,a)})).sort((x,y)=>y.s-x.s).map(x=>x.a);
}

function getSafeActionsTopLevel(team,actions,cfg){
  const enemy=otherSide(team);
  const enemyThreatNow=findImmediateWinningAction(board,hands,enemy);

  // 相手に現在即勝ちがある時だけ、全合法手を使って防御を厳密確認。
  if(enemyThreatNow){
    let min=Infinity,best=[];
    for(const a of actions){
      const n=applyAction(board,hands,team,a);
      const c=countImmediateWins(n.board,n.hands,enemy,3);
      if(c<min){min=c;best=[a]}
      else if(c===min)best.push(a);
    }
    return best;
  }

  // 平常時は有望候補を先に絞ってから「自分から即負けを作らない」ことだけ確認。
  const pre=rankActions(board,hands,team,actions).slice(0,Math.min(actions.length,Math.max(cfg.cap*2,28)));
  const safe=[];
  for(const a of pre){
    const n=applyAction(board,hands,team,a);
    if(!findImmediateWinningAction(n.board,n.hands,enemy))safe.push(a);
  }
  return safe.length?safe:pre;
}

function chooseNearBest(scored,levelName){
  if(!scored.length)return null;
  scored.sort((a,b)=>b.s-a.s);
  const cfg=AI_DIFFICULTY_SETTINGS[levelName];
  const best=scored[0].s;
  const pool=scored.filter(x=>best-x.s<=cfg.nearBestGap);
  if(pool.length===1)return pool[0].a;
  const temp=Math.max(.01,cfg.temperature);
  const ws=pool.map(x=>Math.exp((x.s-best)/temp));
  let r=Math.random()*ws.reduce((a,b)=>a+b,0);
  for(let i=0;i<pool.length;i++){
    r-=ws[i];
    if(r<=0)return pool[i].a;
  }
  return pool[0].a;
}

function minimaxLearned(b,h,turn,depth,alpha,beta,root,cfg,deadline){
  if(findWin(b,root))return 1e8+depth*1000;
  if(findWin(b,otherSide(root)))return -1e8-depth*1000;
  if(performance.now()>deadline||depth<=0)return evaluateState(b,h,root);

  const winNow=findImmediateWinningAction(b,h,turn);
  if(winNow)return turn===root?5e7+depth*1000:-5e7-depth*1000;

  let acts=legalActions(b,h,turn);
  if(!acts.length)return evaluateState(b,h,root);
  acts=rankActions(b,h,turn,acts).slice(0,Math.min(cfg.replyCap||6,acts.length));

  const maxing=turn===root;
  if(maxing){
    let v=-Infinity;
    for(const a of acts){
      if(performance.now()>deadline)break;
      const n=applyAction(b,h,turn,a);
      v=Math.max(v,minimaxLearned(n.board,n.hands,otherSide(turn),depth-1,alpha,beta,root,cfg,deadline));
      alpha=Math.max(alpha,v);
      if(beta<=alpha)break;
    }
    return Number.isFinite(v)?v:evaluateState(b,h,root);
  }else{
    let v=Infinity;
    for(const a of acts){
      if(performance.now()>deadline)break;
      const n=applyAction(b,h,turn,a);
      v=Math.min(v,minimaxLearned(n.board,n.hands,otherSide(turn),depth-1,alpha,beta,root,cfg,deadline));
      beta=Math.min(beta,v);
      if(beta<=alpha)break;
    }
    return Number.isFinite(v)?v:evaluateState(b,h,root);
  }
}

function chooseAIAction(team){
  const levelName=currentAILevel(team);
  const cfg=getEffectiveAILevelConfig(team);
  const deadline=performance.now()+cfg.timeMs;
  let actions=legalActions(board,hands,team);
  if(!actions.length)return null;

  // 1. 今勝てるなら他の評価を一切見ず勝つ。
  const wins=findImmediateWinningActions(board,hands,team);
  if(wins.length)return wins[0];

  // 2. 次に即負けする候補を先に落とす。
  actions=getSafeActionsTopLevel(team,actions,cfg);

  // 3. 評価の良い候補だけ深く読む。
  actions=rankActions(board,hands,team,actions).slice(0,Math.min(cfg.cap,actions.length));

  if(cfg.depth<=0){
    return chooseNearBest(actions.map(a=>({a,s:cheapActionScore(board,hands,team,a)})),levelName)||actions[0];
  }

  const scored=[];
  for(const a of actions){
    if(performance.now()>deadline)break;
    const n=applyAction(board,hands,team,a);
    const s=minimaxLearned(n.board,n.hands,otherSide(team),cfg.depth-1,-Infinity,Infinity,team,cfg,deadline);
    scored.push({a,s});
  }
  return chooseNearBest(scored,levelName)||actions[0];
}

function fallbackAIAction(team){
  const wins=findImmediateWinningActions(board,hands,team);
  if(wins.length)return wins[0];
  let actions=legalActions(board,hands,team);
  if(!actions.length)return null;
  const cfg=getEffectiveAILevelConfig(team);
  actions=getSafeActionsTopLevel(team,actions,cfg);
  return rankActions(board,hands,team,actions)[0]||actions[0];
}

/* =========================================================
   実戦結果からのオンライン強化学習
========================================================= */
function rememberAISample(team,b,h){
  if(types[team]!=="ai")return;
  aiEpisodeSamples[team].push(rlFeatureVector(b,h,team));
  if(aiEpisodeSamples[team].length>60)aiEpisodeSamples[team].shift();
}

function learnFromFinishedGame(winner){
  for(const team of ["kodama","tamago"]){
    if(types[team]!=="ai")continue;
    const samples=aiEpisodeSamples[team]||[];
    if(!samples.length)continue;

    const rec=currentRLRecord(team);
    const reward=winner===team?1:(winner===null?0:-1);

    for(let i=samples.length-1;i>=0;i--){
      const x=samples[i];
      const distance=samples.length-1-i;
      const target=reward*Math.pow(RL_DISCOUNT,distance);
      const pred=Math.tanh(dot(rec.weights,x));
      const grad=(1-pred*pred);

      for(let j=0;j<rec.weights.length;j++){
        rec.weights[j]+=RL_LEARNING_RATE*(target-pred)*grad*x[j];
        rec.weights[j]*=.9995;
        rec.weights[j]=Math.max(-RL_WEIGHT_LIMIT,Math.min(RL_WEIGHT_LIMIT,rec.weights[j]));
      }
    }

    rec.games=(rec.games||0)+1;
    saveRLRecord(team,rec);
  }
}

/* =========================================================
   AIターン
========================================================= */
function aiTurn(generation){
  if(gameOver||generation!==gameGeneration||types[side]!=="ai"||aiThinking)return;

  aiThinking=true;
  render();
  document.getElementById("status").textContent=`${teamName(side)} AIが考え中…`;

  setTimeout(()=>{
    if(gameOver||generation!==gameGeneration||types[side]!=="ai"){
      aiThinking=false;
      return;
    }

    const team=side;
    let action=null;

    // 最終安全装置: AI戦略に不具合やランダム性があっても、
    // 今この手で勝てるなら戦略処理へ入る前に勝ち手を確定する。
    if(AI_TACTICAL_SETTINGS.ALWAYS_TAKE_IMMEDIATE_WIN){
      action=findImmediateWinningAction(board,hands,team);
    }

    if(!action){
      try{
        action=chooseAIAction(team);
      }catch(err){
        console.error("AI error:", err);
        action=fallbackAIAction(team);
      }
    }

    if(!action){
      action=fallbackAIAction(team);
    }

    // 念のため、選ばれた手より勝ち手を常に優先する。
    // これにより difficulty / variety / learned weights の設定に関係なく即勝ちする。
    if(AI_TACTICAL_SETTINGS.ALWAYS_TAKE_IMMEDIATE_WIN){
      const forcedWin=findImmediateWinningAction(board,hands,team);
      if(forcedWin)action=forcedWin;
    }

    if(!action){
      aiThinking=false;
      finishGame("引き分け！");
      return;
    }

    saveSnapshot();
    const n=applyAction(board,hands,team,action);
    rememberAISample(team,n.board,n.hands);
    board=n.board;
    hands=n.hands;
    playActionSE(action);
    moves++;
    aiThinking=false;

    const win=findWin(board,team);
    if(win){
      finishGame(`${teamName(team)}の勝ち！`,win,team);
      return;
    }

    side=otherSide(team);

    if(!legalActions(board,hands,side).length){
      finishGame("引き分け！");
      return;
    }

    if(rememberCurrentState()>=3){
      finishGame("同じ局面が3回繰り返されたため引き分け！");
      return;
    }

    beginTurn();
  },60);
}

/* =========================================================
   反復局面
========================================================= */
function stateKey(b,h,team){
  return team+"|"+
    b.map(c=>(c.letter||"-")+"/"+(c.owner||"-")+"/"+(c.dakutenOwner||"-")).join(";")+"|"+
    ["こ","た","ま","゛"].map(p=>h.kodama[p]).join(",")+"|"+
    ["こ","た","ま","゛"].map(p=>h.tamago[p]).join(",");
}
function rememberCurrentState(){
  const key=stateKey(board,hands,side);
  const n=(stateCounts.get(key)||0)+1;

  stateCounts.set(key,n);
  stateHistory.push(key);

  // AIの反復回避に必要なのは直近だけ。
  // 引き分け判定用の stateCounts は全履歴を保持する。
  if(stateHistory.length>40){
    stateHistory.shift();
  }

  return n;
}

/* =========================================================
   モーダル
========================================================= */
document.addEventListener("keydown",e=>{
  if(
    e.key==="Escape" &&
    document.getElementById("moveChoiceModal")?.classList.contains("show")
  ){
    closeMoveChoiceModal(true);
    return;
  }

  if(e.key==="Escape" && selected && !gameOver){
    selected=null;
    statusLock=false;
    render();
    updateStatus();
  }
});

function openRules(){document.getElementById("modal").classList.add("show")}
function closeRules(){document.getElementById("modal").classList.remove("show")}

/* =========================================================
   初期値
========================================================= */
chooseType("kodama","human");
chooseType("tamago","ai");
setAILevel("kodama","normal");
setAILevel("tamago","normal");
setBoardSize(7);
setLetterMax(2);
setDakutenMax(2);
setMoveUnlock("allPieces");
refreshSoundButtons();
