(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const svg = $('#loopi'), stage = $('#stage');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const arc = (radius, start, end) => {
    const point = angle => [200 + radius * Math.cos(angle * Math.PI / 180), 190 + radius * Math.sin(angle * Math.PI / 180)];
    const a = point(start), b = point(end);
    return 'M' + a.join(' ') + ' A' + radius + ' ' + radius + ' 0 ' + (end - start > 180 ? 1 : 0) + ' 1 ' + b.join(' ');
  };
  $$('.ai-arc', svg).forEach(path => path.setAttribute('d', arc(120, 11.8, 258.2)));
  $$('.human-arc', svg).forEach(path => path.setAttribute('d', arc(120, 284.2, 345.8)));
  $('#ai-edge').setAttribute('d', arc(140, 14, 256));
  $('#human-edge').setAttribute('d', arc(140, 286, 344));
  $('#blue-cue').setAttribute('d', arc(143, 294, 330));

  const moods = {
    idle: {label:'自在待机', line:'嘿，我在这里。', detail:'移近一点，我会看向你。也可以轻轻点我一下。', eye:1, smile:6, curve:0, cheek:0, x:0, y:0},
    listen: {label:'认真听你说', line:'嗯，你接着说。', detail:'慢慢来，我在认真听。', eye:1.12, smile:3, curve:0, cheek:.06, x:0, y:-3},
    work: {label:'专心帮你', line:'这点小事，我来。', detail:'一步一步整理好，重要的选择再交给你。', eye:.78, smile:3, curve:0, cheek:0, x:-2, y:2},
    curious: {label:'有点好奇', line:'咦，这个有点意思。', detail:'想多了解一点，你愿意说说吗？', eye:1.22, smile:0, curve:0, cheek:.06, x:4, y:-3},
    decision: {label:'等你决定', line:'这一步，听你的。', detail:'不着急，你选好再继续。', eye:1.08, smile:5, curve:0, cheek:.04, x:0, y:-1},
    done: {label:'替你开心', line:'搞定！给自己放个小假。', detail:'散散步、见朋友，或者发一会儿呆。', eye:.2, smile:12, curve:1, cheek:.36, x:0, y:-3},
    care: {label:'陪你缓一缓', line:'先缓一缓，我们慢慢来。', detail:'可以先把眼前这一小步交给我。', eye:.86, smile:4, curve:0, cheek:.1, x:0, y:2},
    rest: {label:'安静陪着', line:'你休息，我也安静一点。', detail:'需要我的时候，随时叫我。', eye:.06, smile:4, curve:-1, cheek:0, x:0, y:3}
  };
  const sequence = ['listen', 'work', 'decision', 'done'];
  const duration = [4.5, 5.8, 4.8, 5.2];
  const dayTargets = [0, .8, .8, .8];
  let mood = 'idle', mode = 'free', paused = false, visible = true;
  let t = 0, stateStart = 0, sequenceStart = 0, step = 0, boopAt = -100;
  let lastFrame = null, raf = 0, nextBlink = 2.7, blinkAt = -100, doubleBlink = false;
  let nextGlance = 3.5, glanceUntil = 0, glanceX = 0, glanceY = 0;
  const pointer = {x:0, y:0, active:false};
  const spring = value => ({value, velocity:0});
  const motion = {gazeX:spring(0), gazeY:spring(0), coreX:spring(0), coreY:spring(0), ringX:spring(0), ringY:spring(0), ringAngle:spring(0), squash:spring(1), eye:spring(1), smile:spring(6), curve:spring(0), cheek:spring(0), day:spring(0)};
  const nodes = {
    ring:$('#ring-motion'), core:$('#core-position'), shape:$('#core-shape'), face:$('#face'),
    left:$('#eye-left'), right:$('#eye-right'), mouth:$('#mouth'), cheeks:$('#cheeks'),
    floor:$('#floor'), cue:$('#blue-cue')
  };
  function approach(s, target, dt, stiffness = 170, damping = 23, snap = false) {
    if (snap) { s.value = target; s.velocity = 0; return; }
    s.velocity += ((target - s.value) * stiffness - s.velocity * damping) * dt;
    s.value += s.velocity * dt;
  }
  const value = name => motion[name].value;
  const translate = (x,y) => 'translate(' + x.toFixed(3) + ' ' + y.toFixed(3) + ')';
  function drawEyes(root, openness, curve, blink, wink = 0) {
    const magnitude = Math.abs(curve);
    ['left','right'].forEach((side, i) => {
      const group = $('[id$="eye-' + side + '"]', root);
      const cx = i ? 221 : 179;
      const open = Math.max(.04, openness * (1 - blink) * (1 - (i ? wink : 0)));
      $('.eye-fill',group).setAttribute('ry', (6.2 * open).toFixed(3));
      $('.eye-fill',group).setAttribute('opacity', 1 - magnitude);
      $('.eye-glint',group).setAttribute('opacity', Math.max(0,1 - blink - magnitude - (i ? wink : 0)));
      const path = $('.eye-curve',group);
      path.setAttribute('d', 'M' + (cx-5) + ' 188 Q' + cx + ' ' + (curve < 0 ? 194 : 181) + ' ' + (cx+5) + ' 188');
      path.setAttribute('opacity', magnitude);
    });
  }
  function mouthPath(smile, curious) {
    if (curious) return 'M197 205 C197 201 203 201 203 205 C203 209 197 209 197 205Z';
    return 'M193 207 Q200 ' + (207 + smile).toFixed(3) + ' 207 207';
  }
  function staticFace(root, key) {
    const m = moods[key];
    drawEyes(root,m.eye,m.curve,0);
    $('[id$="mouth"]',root).setAttribute('d',mouthPath(m.smile,key==='curious'));
    $('[id$="cheeks"]',root).setAttribute('opacity',m.cheek);
  }

  // Each thumbnail owns its paint servers; duplicate SVG IDs leak styles between copies.
  Object.entries(moods).forEach(([key,m]) => {
    const button = document.createElement('button');
    button.className = 'emotion'; button.dataset.mood = key;
    button.setAttribute('aria-pressed',String(key===mood));
    button.setAttribute('aria-label',m.label);
    const clone = svg.cloneNode(true);
    clone.removeAttribute('id');
    const markup = clone.outerHTML.replace(/id="([^"]+)"/g, (_,id)=>'id="'+key+'-'+id+'"')
      .replace(/url\(#([^)]+)\)/g, (_,id)=>'url(#'+key+'-'+id+')');
    button.innerHTML = markup + '<span>' + m.label + '</span>';
    staticFace($('svg',button),key);
    $('#emotions').append(button);
    button.onclick = () => { mode='free'; setMood(key); };
  });

  function setMood(key) {
    mood=key; stateStart=t;
    const m=moods[key];
    $('#pause').disabled=reduce.matches;
    $('#pause').textContent=reduce.matches?'减少动态已开启':paused?'继续动态':'暂停动态';
    $('#line').textContent=m.line; $('#detail').textContent=m.detail;
    $('#state-label').textContent=m.label;
    $('#next').hidden=!(reduce.matches&&mode!=='free'&&!(mode==='onboard'&&step>=2));
    $('#approve').hidden=!(mode==='onboard'&&key==='decision');
    $('#restart').hidden=!(mode==='onboard'&&key==='done');
    $$('.emotion').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mood===key)));
    $$('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
    $('#mode-note').textContent=mode==='free'?'视线跟随 · 轻触回应 · 自然眨眼':mode==='website'?'官网理念循环 · 点击表情可自由探索':'初次见面 · 需要你决定时会停下来';
    const currentStep=sequence.indexOf(key);
    $$('.story-steps span').forEach(node=>node.classList.toggle('active',Number(node.dataset.step)===Math.max(0,currentStep)));
    $('#story-title').textContent=['先告诉我，你想做什么。','琐事交给我，慢慢理清楚。','重要的那一步，你来选。','剩下的时间，留给生活。'][Math.max(0,currentStep)];
    if (paused || reduce.matches) draw(0,true);
    ensureFrame();
  }
  function setMode(next) {
    mode=next;step=0;sequenceStart=t;
    setMood(next==='free'?'idle':sequence[0]);
  }
  $$('[data-mode]').forEach(button=>button.onclick=()=>setMode(button.dataset.mode));
  $('#next').onclick=()=>{
    step=(step+1)%sequence.length;sequenceStart=t;setMood(sequence[step]);
    if(mode==='onboard'&&step===2)$('#approve').focus();
  };
  $('#approve').onclick=()=>{step=3;sequenceStart=t;setMood('done');$('#restart').focus()};
  $('#restart').onclick=()=>{setMode('onboard');$('[data-mode="onboard"]').focus()};
  $('#pause').onclick=()=>{
    paused=!paused;$('#pause').textContent=paused?'继续动态':'暂停动态';
    $('#pause').setAttribute('aria-pressed',String(paused));
    if(paused)stopFrame();else ensureFrame();
  };
  stage.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch')return;
    const bounds=stage.getBoundingClientRect();
    pointer.x=clamp((event.clientX-bounds.left)/bounds.width*2-1,-1,1);
    pointer.y=clamp((event.clientY-bounds.top)/bounds.height*2-1,-1,1);
    pointer.active=true;
  });
  stage.addEventListener('pointerleave',()=>{pointer.active=false});
  stage.addEventListener('click',()=>{
    boopAt=t; nextBlink=t+1.5+Math.random()*2;
    if(reduce.matches||paused){
      staticFace(svg,'done');
      $('#state-label').textContent='收到你的小招呼';
    } else ensureFrame();
  });
  function draw(dt,snap=false){
    const m=moods[mood], age=t-stateStart, touch=t-boopAt;
    const quiet=reduce.matches||snap;
    if(!quiet&&t>=nextBlink&&mood!=='rest'&&mood!=='done'){
      blinkAt=t;
      if(!doubleBlink&&Math.random()<.18){nextBlink=t+.27;doubleBlink=true}
      else {nextBlink=t+2.8+Math.random()*3.8;doubleBlink=false}
    }
    if(!quiet&&!pointer.active&&t>=nextGlance){
      glanceX=(Math.random()-.5)*6;glanceY=(Math.random()-.5)*2;
      glanceUntil=t+.8+Math.random()*.7;nextGlance=t+4+Math.random()*5;
    }
    const gazeX=quiet?0:pointer.active?pointer.x*7:t<glanceUntil?glanceX:0;
    const gazeY=quiet?0:pointer.active?pointer.y*4:t<glanceUntil?glanceY:0;
    approach(motion.gazeX,gazeX,dt,370,31,snap);
    approach(motion.gazeY,gazeY,dt,370,31,snap);
    const breath=quiet?0:Math.sin(t*1.42)*.9+Math.sin(t*.73)*.35;
    let jump=0,squash=1;
    if(!quiet&&mood==='done'&&age<1.4){
      if(age<.18){jump=3.5*Math.sin(age/.18*Math.PI/2);squash=.96}
      else if(age<.68){jump=-17*Math.sin((age-.18)/.5*Math.PI);squash=1.035}
      else if(age<.95){jump=2.5*Math.sin((age-.68)/.27*Math.PI);squash=.975}
    }
    const boop=!quiet&&touch>=0&&touch<1;
    if(boop){jump-=4*Math.sin(touch*Math.PI);squash=1-.035*Math.sin(touch*Math.PI*2)}
    // Gaze reacts first, core follows, and the rigid ceramic ring settles last.
    approach(motion.coreX,value('gazeX')*.68+m.x,dt,145,20,snap);
    approach(motion.coreY,value('gazeY')*.52+m.y+breath+jump,dt,160,19,snap);
    approach(motion.ringX,value('coreX')*.25,dt,72,16,snap);
    approach(motion.ringY,value('coreY')*.4,dt,84,17,snap);
    approach(motion.ringAngle,quiet?0:value('coreX')*.14,dt,66,15,snap);
    approach(motion.squash,squash,dt,235,20,snap);
    const wink=boop?Math.pow(Math.sin(Math.PI*clamp(touch/.65,0,1)),2):0;
    approach(motion.eye,m.eye,dt,220,26,snap);
    approach(motion.smile,boop?10:m.smile,dt,150,22,snap);
    approach(motion.curve,m.curve,dt,190,26,snap);
    approach(motion.cheek,boop?.45:m.cheek,dt,100,20,snap);
    const targetDay=mode==='free'?(mood==='idle'||mood==='listen'?0:.8):dayTargets[step];
    approach(motion.day,targetDay,dt,5,5,snap);
    $('#day-ai').setAttribute('stroke-dasharray',(clamp(value('day'),0,1)*238.761).toFixed(3)+' 238.761');
    nodes.ring.setAttribute('transform',translate(value('ringX'),value('ringY'))+' rotate('+value('ringAngle').toFixed(3)+' 200 190)');
    nodes.core.setAttribute('transform',translate(value('coreX'),value('coreY')));
    nodes.shape.setAttribute('transform','translate(200 190) scale('+(2-value('squash')).toFixed(4)+' '+value('squash').toFixed(4)+') translate(-200 -190)');
    nodes.face.setAttribute('transform',translate(value('gazeX'),value('gazeY')));
    const blinkAge=t-blinkAt;
    const blink=quiet?0:blinkAge>=0&&blinkAge<.17?Math.sin(blinkAge/.17*Math.PI):0;
    drawEyes(svg,value('eye'),clamp(value('curve'),-1,1),blink,wink);
    nodes.mouth.setAttribute('d',mouthPath(value('smile'),mood==='curious'&&!boop));
    nodes.cheeks.setAttribute('opacity',clamp(value('cheek'),0,.5).toFixed(3));
    nodes.cue.setAttribute('opacity',mood==='decision'?(quiet?.55:.4+Math.sin(t*1.8)*.15):0);
    nodes.floor.setAttribute('rx',(73+value('ringY')*.25).toFixed(3));
    svg.dataset.mood=mood;
    svg.dataset.faceRotation='0';
    svg.dataset.time=t.toFixed(3);
  }
  function frame(now){
    raf=0;
    if(paused||document.hidden||!visible||reduce.matches){lastFrame=null;return}
    const dt=lastFrame===null?0:Math.min((now-lastFrame)/1000,1/30);
    lastFrame=now;t+=dt;
    if(mode!=='free'&&!(mode==='onboard'&&step>=2)&&t-sequenceStart>duration[step]){
      step=(step+1)%sequence.length;sequenceStart=t;setMood(sequence[step]);
    }
    draw(dt);ensureFrame();
  }
  function stopFrame(){cancelAnimationFrame(raf);raf=0;lastFrame=null}
  function ensureFrame(){if(!raf&&!paused&&!document.hidden&&visible&&!reduce.matches)raf=requestAnimationFrame(frame)}
  document.addEventListener('visibilitychange',()=>{stopFrame();ensureFrame()});
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;stopFrame();ensureFrame()},{rootMargin:'80px'}).observe(stage);
  reduce.addEventListener('change',()=>{stopFrame();setMood(mood);draw(0,true);ensureFrame()});
  setMood('idle');draw(0,true);ensureFrame();
})();
