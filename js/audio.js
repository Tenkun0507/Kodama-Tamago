/* =========================================================
   サウンド設定
   =========================================================

   ★ 音量を変えたいときは、基本的にここだけ触ればOK ★

   masterVolume
     全体の音量。BGMとSEの両方にかかる。
     例: 0.8 = 全体を80%

   bgmVolume
     BGMだけの音量。
     大きくするとBGMが大きくなる。

   seVolume
     SEだけの音量。
     大きくすると駒を置く音などが大きくなる。

   ※ BGMは埋め込みWAVをループ再生しているため、
      テンポを変えたい場合はBGMデータ自体を作り直す。

   ※ まず音量だけ触るなら
      masterVolume / bgmVolume / seVolume
      の3つだけ見ればOK。
========================================================= */
const AUDIO_SETTINGS={
  masterVolume:1.00,
  bgmVolume:0.03,
  seVolume:4.00,

  // 各SEの基準音量
  seBaseVolume:{
    place:0.044,
    dakuten:0.042,
    move:0.035,
    dakutenMove:0.038,
    undo:0.033,
    win:0.050,
    draw:0.038,
    start:0.032
  },

};


/* =========================================================
   サウンド ON / OFF
   ---------------------------------------------------------
   保存データが無い最初の起動時は、BGM・SEともにON。
========================================================= */
const storedBGM=localStorage.getItem("kodamaTamago_bgm");
const storedSE=localStorage.getItem("kodamaTamago_se");

let bgmEnabled=storedBGM===null ? true : storedBGM==="on";
let seEnabled=storedSE===null ? true : storedSE==="on";

const BGM_FILE="assets/bgm.wav";

let audioCtx=null;

/*
  BGMはWeb AudioのsetInterval式ではなく、
  HTMLAudioのループ再生を使用する。
  これによりChrome等の自動再生制限で止まりにくくする。
*/
const bgmAudio=new Audio();
bgmAudio.src=BGM_FILE;
bgmAudio.loop=true;
bgmAudio.preload="auto";
bgmAudio.playsInline=true;


/* =========================================================
   Web Audio 初期化
   ---------------------------------------------------------
   Chrome / Safari等では、最初にユーザーが画面を触るまでは
   音を鳴らせないことがある。
   unlockAudio() で明示的にAudioContextを開始する。
========================================================= */
function ensureAudioContext(){
  if(!audioCtx){
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;
    if(!AudioContextClass)return null;
    audioCtx=new AudioContextClass();
  }
  return audioCtx;
}

async function unlockAudio(){
  const ctx=ensureAudioContext();
  if(!ctx)return null;

  if(ctx.state==="suspended"){
    try{
      await ctx.resume();
    }catch(e){
      return null;
    }
  }

  return ctx;
}


/* =========================================================
   1音を鳴らす共通処理
   channel:
     "bgm" = BGM音量を使用
     "se"  = SE音量を使用
========================================================= */
function tone(freq,start,duration,baseVolume=0.03,type="sine",channel="se"){
  const ctx=audioCtx;
  if(!ctx || ctx.state!=="running")return;

  const channelVolume=
    channel==="bgm"
      ? AUDIO_SETTINGS.bgmVolume
      : AUDIO_SETTINGS.seVolume;

  const finalVolume=Math.min(
    0.22,
    Math.max(
      0.0002,
      baseVolume *
      AUDIO_SETTINGS.masterVolume *
      channelVolume
    )
  );

  const osc=ctx.createOscillator();
  const gain=ctx.createGain();

  osc.type=type;
  osc.frequency.setValueAtTime(freq,start);

  gain.gain.setValueAtTime(0.0001,start);
  gain.gain.exponentialRampToValueAtTime(finalVolume,start+0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001,start+duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(start);
  osc.stop(start+duration+0.035);
}


/* =========================================================
   SE
========================================================= */
async function playSE(kind){
  if(!seEnabled)return;

  const ctx=await unlockAudio();
  if(!ctx)return;

  const t=ctx.currentTime+0.008;
  const v=AUDIO_SETTINGS.seBaseVolume;

  if(kind==="place"){
    tone(440,t,0.085,v.place,"triangle","se");

  }else if(kind==="dakuten"){
    tone(570,t,0.060,v.dakuten,"triangle","se");
    tone(710,t+0.052,0.075,v.dakuten*0.92,"triangle","se");

  }else if(kind==="move"){
    tone(330,t,0.060,v.move,"sine","se");
    tone(410,t+0.046,0.075,v.move*0.95,"sine","se");

  }else if(kind==="dakutenMove"){
    tone(520,t,0.055,v.dakutenMove,"triangle","se");
    tone(650,t+0.047,0.068,v.dakutenMove*0.95,"triangle","se");

  }else if(kind==="undo"){
    tone(420,t,0.058,v.undo,"sine","se");
    tone(330,t+0.052,0.080,v.undo*0.90,"sine","se");

  }else if(kind==="win"){
    tone(523.25,t,0.16,v.win,"triangle","se");
    tone(659.25,t+0.11,0.18,v.win*0.95,"triangle","se");
    tone(783.99,t+0.22,0.30,v.win,"triangle","se");

  }else if(kind==="draw"){
    tone(440,t,0.11,v.draw,"sine","se");
    tone(392,t+0.10,0.11,v.draw*0.92,"sine","se");
    tone(349.23,t+0.20,0.20,v.draw*0.88,"sine","se");

  }else if(kind==="start"){
    tone(392,t,0.085,v.start,"triangle","se");
    tone(523.25,t+0.075,0.13,v.start,"triangle","se");
  }
}

function playActionSE(action){
  if(!action)return;

  if(action.type==="place")playSE("place");
  else if(action.type==="placeDakuten")playSE("dakuten");
  else if(action.type==="move")playSE("move");
  else if(action.type==="moveDakuten")playSE("dakutenMove");
}


/* =========================================================
   BGM
========================================================= */
function applyBGMVolume(){
  bgmAudio.volume=Math.max(
    0,
    Math.min(
      1,
      AUDIO_SETTINGS.masterVolume*AUDIO_SETTINGS.bgmVolume
    )
  );
}

function startBGM(){
  if(!bgmEnabled || gameOver)return;

  applyBGMVolume();

  /*
    startGame() のクリックイベント内から直接呼ばれる。
    play()が失敗した場合でも、次のユーザー操作で再試行する。
  */
  const p=bgmAudio.play();
  if(p && typeof p.catch==="function"){
    p.catch(()=>{
      // 自動再生制限などで止められた場合は、
      // 次のpointerdownでhandleAudioInteraction()が再試行する。
    });
  }
}

function stopBGM(){
  bgmAudio.pause();
}

function restartBGMFromBeginning(){
  try{ bgmAudio.currentTime=0; }catch(e){}
  startBGM();
}

/* =========================================================
   BGM / SE ON-OFF
========================================================= */
function toggleBGM(){
  bgmEnabled=!bgmEnabled;
  localStorage.setItem("kodamaTamago_bgm",bgmEnabled?"on":"off");

  if(
    bgmEnabled &&
    document.body.classList.contains("playing") &&
    !gameOver
  ){
    startBGM();
  }else{
    stopBGM();
  }

  refreshSoundButtons();
}

function toggleSE(){
  seEnabled=!seEnabled;
  localStorage.setItem("kodamaTamago_se",seEnabled?"on":"off");

  if(seEnabled)playSE("start");
  refreshSoundButtons();
}

function refreshSoundButtons(){
  document.querySelectorAll('[data-sound="bgm"]').forEach(btn=>{
    btn.textContent=`BGM：${bgmEnabled?"ON":"OFF"}`;
    btn.classList.toggle("sound-on",bgmEnabled);
  });

  document.querySelectorAll('[data-sound="se"]').forEach(btn=>{
    btn.textContent=`SE：${seEnabled?"ON":"OFF"}`;
    btn.classList.toggle("sound-on",seEnabled);
  });
}


/* =========================================================
   ブラウザの自動再生制限対策
   ---------------------------------------------------------
   最初のタップ / クリック / キー入力でAudioContextを解禁する。
   プレイ中かつBGM ONなら、その時点でBGMも開始する。
========================================================= */
async function handleAudioInteraction(){
  await unlockAudio();

  if(
    bgmEnabled &&
    document.body.classList.contains("playing") &&
    !gameOver &&
    bgmAudio.paused
  ){
    startBGM();
  }
}

/*
  BGMがブラウザに止められても、次の操作で再試行できる。
*/
document.addEventListener(
  "pointerdown",
  handleAudioInteraction,
  {capture:true}
);

document.addEventListener(
  "keydown",
  handleAudioInteraction,
  {capture:true}
);
