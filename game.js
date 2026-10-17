/* =========================================================
   生日快乐 · 小解谜  —— 主流程
   四幕：密码锁 → 抽签 → 吹蜡烛 → 黑暗中的聊天
   （一般不用改这个文件；密码看 password.js，聊天看 chat.js）
   ========================================================= */

(function () {
  'use strict';

  /* ---------------- 小工具 ---------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /* =========================================================
     音效：全部用 WebAudio 现场合成，不需要任何音频文件
     ========================================================= */
  const Sound = (function () {
    let ctx = null;
    let muted = false;
    try { muted = localStorage.getItem('bd_muted') === '1'; } catch (e) { /* 忽略 */ }

    function ac() {
      if (muted) return null;
      if (!ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        try { ctx = new Ctor(); } catch (e) { return null; }
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function tone(o) {
      const c = ac(); if (!c) return;
      const t0 = c.currentTime + (o.delay || 0);
      const dur = o.dur || 0.25;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.freq || 440, t0);
      if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(o.gain || 0.14, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.06);
    }

    function noise(o) {
      const c = ac(); if (!c) return;
      const t0 = c.currentTime + (o.delay || 0);
      const dur = o.dur || 0.4;
      const len = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource(); src.buffer = buf;
      const flt = c.createBiquadFilter();
      flt.type = o.type || 'lowpass';
      flt.frequency.value = o.freq || 1000;
      const g = c.createGain();
      g.gain.value = o.gain || 0.1;
      src.connect(flt).connect(g).connect(c.destination);
      src.start(t0);
    }

    return {
      prime() { ac(); },
      isMuted() { return muted; },
      setMuted(v) {
        muted = !!v;
        try { localStorage.setItem('bd_muted', muted ? '1' : '0'); } catch (e) { /* 忽略 */ }
      },
      /* 解锁成功：上行三音 */
      unlock() {
        tone({ freq: 523.25, dur: 0.3, type: 'sine', gain: 0.12 });
        tone({ freq: 659.25, dur: 0.3, type: 'sine', gain: 0.12, delay: 0.11 });
        tone({ freq: 783.99, dur: 0.5, type: 'sine', gain: 0.13, delay: 0.22 });
      },
      /* 按键盘 */
      tap() { tone({ freq: 900, dur: 0.05, type: 'triangle', gain: 0.05 }); },
      /* 抽签：摇筒 */
      shake() {
        noise({ dur: 0.5, freq: 2200, gain: 0.05 });
        tone({ freq: 300, dur: 0.5, type: 'triangle', gain: 0.03, slide: 180 });
      },
      /* 抽签：出签的清脆一响 */
      draw() {
        tone({ freq: 740, dur: 0.22, type: 'triangle', gain: 0.12, slide: 1480 });
        tone({ freq: 1480, dur: 0.3, type: 'sine', gain: 0.06, delay: 0.14 });
      },
      /* 吹蜡烛 */
      blow() {
        noise({ dur: 0.32, freq: 900, gain: 0.11, type: 'lowpass' });
      },
      /* 心跳 */
      heartbeat() {
        tone({ freq: 62, dur: 0.32, type: 'sine', gain: 0.2, slide: 40 });
        tone({ freq: 56, dur: 0.4, type: 'sine', gain: 0.16, slide: 34, delay: 0.34 });
      },
      /* 收到消息 */
      ding() { tone({ freq: 1180, dur: 0.16, type: 'sine', gain: 0.07 }); },
      /* 系统提示 */
      soft() { tone({ freq: 480, dur: 0.3, type: 'sine', gain: 0.05 }); },
      /* 结尾 */
      chime() {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          tone({ freq: f, dur: 0.9, type: 'sine', gain: 0.1, delay: i * 0.14 });
        });
      }
    };
  })();

  /* =========================================================
     场景调度
     ========================================================= */
  const Stage = {
    current: 'lock',
    go(name) {
      if (!name || name === this.current) return;
      this.current = name;
      document.body.dataset.stage = name;
      if (name === 'draw') Draw.enter();
      if (name === 'cake') Cake.enter();
      if (name === 'dark') Dark.enter();
    }
  };

  /* =========================================================
     第一幕 · 密码锁
     ========================================================= */
  const Lock = (function () {
    const cfg = Object.assign({
      title: '请输入密码',
      hint: '',
      length: 4,
      answer: '',
      verify: null,
      onWrong: function () { return '密码不对哦，再想想～'; }
    }, window.PASSWORD_CONFIG || {});

    const card = $('#lockCard');
    const msgEl = $('#lockMsg');
    const dotsEl = $('#pinDots');
    const padEl = $('#keypad');

    let value = '';
    let opened = false;
    let inited = false;

    function render() {
      const dots = dotsEl.children;
      for (let i = 0; i < dots.length; i++) {
        dots[i].className = i < value.length ? 'filled' : '';
      }
    }

    function say(text, ok) {
      msgEl.textContent = text || '';
      msgEl.className = 'lock-msg' + (ok ? ' ok' : '');
    }

    function shake() {
      card.classList.remove('shake');
      void card.offsetWidth;   // 强制重排，让动画能重复播放
      card.classList.add('shake');
    }

    function submit() {
      if (opened) return;
      if (value.length !== cfg.length) {
        say('密码是 ' + cfg.length + ' 位哦');
        shake();
        return;
      }
      let ok = false;
      try {
        ok = cfg.verify ? !!cfg.verify(value) : (value === cfg.answer);
      } catch (err) {
        console.error('[password.js] verify() 出错了：', err);
        say('verify() 报错了，按 F12 看看控制台');
        shake();
        return;
      }
      if (ok) {
        opened = true;
        $('#lockIcon').textContent = '🔓';
        card.classList.add('unlocked');
        say('咔哒——开了。', true);
        Sound.unlock();
        setTimeout(function () { Stage.go('draw'); }, 1150);
      } else {
        let word = '密码不对哦，再想想～';
        try { word = cfg.onWrong(value) || word; } catch (e) { /* 忽略 */ }
        say(word);
        shake();
        value = '';
        render();
      }
    }

    function press(key) {
      if (opened) return;
      if (key === '⌫') {
        value = value.slice(0, -1);
        render();
        return;
      }
      if (key === '✓') { submit(); return; }
      if (value.length >= cfg.length) return;
      value += key;
      render();
      Sound.tap();
    }

    function init() {
      if (inited) return;
      inited = true;

      $('#lockTitle').textContent = cfg.title || '请输入密码';
      const hintEl = $('#lockHint');
      if (cfg.hint) hintEl.textContent = cfg.hint; else hintEl.style.display = 'none';

      dotsEl.innerHTML = '';
      for (let i = 0; i < cfg.length; i++) dotsEl.appendChild(document.createElement('i'));
      render();

      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'];
      padEl.innerHTML = '';
      keys.forEach(function (k) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = k;
        if (k === '⌫') { b.className = 'fn'; b.setAttribute('aria-label', '删除'); }
        if (k === '✓') { b.className = 'ok'; b.setAttribute('aria-label', '确定'); }
        b.addEventListener('click', function () { press(k); });
        padEl.appendChild(b);
      });

      // 键盘也能输
      document.addEventListener('keydown', function (e) {
        if (Stage.current !== 'lock' || opened) return;
        if (/^[0-9]$/.test(e.key)) { press(e.key); }
        else if (e.key === 'Backspace') { e.preventDefault(); press('⌫'); }
        else if (e.key === 'Enter') { press('✓'); }
      });
    }

    return { init: init };
  })();

  /* =========================================================
     第二幕 · 抽签
     ========================================================= */
  const Draw = (function () {
    const TOTAL = 5;

    const slotsEl = $('#slots');
    const countEl = $('#drawCount');
    const tubeEl = $('#tube');
    const stickBox = $('#tubeSticks');
    const cardEl = $('#signCard');
    const signText = $('#signText');
    const btn = $('#drawBtn');
    const nextEl = $('#drawNext');

    let pool = [];
    let drawn = [];
    let busy = false;
    let inited = false;

    function shuffle(a) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }

    function build() {
      // 签筒里的竹签
      stickBox.innerHTML = '';
      for (let i = 0; i < 7; i++) {
        const s = document.createElement('i');
        s.style.left = (6 + i * 12.5 + rand(-3, 3)).toFixed(1) + 'px';
        s.style.transform = 'rotate(' + rand(-7, 7).toFixed(1) + 'deg)';
        stickBox.appendChild(s);
      }

      // 五个坑
      slotsEl.innerHTML = '';
      for (let i = 0; i < TOTAL; i++) {
        const d = document.createElement('div');
        d.className = 'slot';
        const n = document.createElement('span'); n.className = 'n'; n.textContent = String(i + 1);
        const t = document.createElement('span'); t.className = 't'; t.textContent = '还没抽';
        d.appendChild(n); d.appendChild(t);
        slotsEl.appendChild(d);
      }
      countEl.textContent = '0';
      cardEl.classList.remove('flipped');
      cardEl.classList.add('empty');
      signText.textContent = '';
      btn.disabled = false;
      btn.textContent = '抽一支';
      nextEl.hidden = true;
    }

    function popStick() {
      const sticks = $$('i', stickBox);
      if (!sticks.length) return;
      const s = pick(sticks);
      s.style.transition = 'transform .4s cubic-bezier(.2,1.5,.4,1), opacity .4s';
      s.style.transform = 'translateY(-30px) rotate(' + rand(-6, 6).toFixed(1) + 'deg)';
      s.style.opacity = '0';
      setTimeout(function () {
        s.style.transform = 'rotate(' + rand(-7, 7).toFixed(1) + 'deg)';
        s.style.opacity = '';
      }, 900);
    }

    async function drawOne() {
      if (busy || drawn.length >= TOTAL) return;
      busy = true;
      btn.disabled = true;

      tubeEl.classList.add('shake');
      Sound.shake();
      await wait(580);
      tubeEl.classList.remove('shake');
      popStick();

      const text = pool.pop() || '（祝福语不够啦，去 blessings.js 里再加几条吧）';
      drawn.push(text);

      // 把牌翻回正面，再翻出新的
      cardEl.classList.remove('flipped');
      await wait(400);
      cardEl.classList.remove('empty');
      signText.textContent = text;
      cardEl.classList.add('flipped');
      Sound.draw();

      await wait(430);

      const slot = slotsEl.children[drawn.length - 1];
      if (slot) {
        $('.t', slot).textContent = text;
        slot.classList.add('filled', 'fresh');
        setTimeout(function () { slot.classList.remove('fresh'); }, 900);
      }
      countEl.textContent = String(drawn.length);

      if (drawn.length >= TOTAL) {
        btn.textContent = '五支都抽完啦';
        nextEl.hidden = false;
      } else {
        btn.disabled = false;
      }
      busy = false;
    }

    function enter() {
      if (inited) return;
      inited = true;

      const list = (Array.isArray(window.BLESSINGS) && window.BLESSINGS.length)
        ? window.BLESSINGS.slice()
        : ['生日快乐！'];
      pool = shuffle(list);
      build();

      btn.addEventListener('click', drawOne);
      $('#toCakeBtn').addEventListener('click', function () { Stage.go('cake'); });
    }

    return { enter: enter };
  })();

  /* =========================================================
     第三幕 · 蛋糕与 21 根蜡烛
     ========================================================= */
  const Cake = (function () {
    const TOTAL = 21;
    const ROWS = [7, 7, 7];

    const wrap = $('#candles');
    const scene = $('#scene-cake');
    const leftEl = $('#candleLeft');
    const tipEl = $('#cakeTip');

    let candles = [];
    let order = [];        // 熄灭顺序：前排先吹，一排排往里
    let left = TOTAL;
    let busy = false;
    let inited = false;

    function build() {
      wrap.innerHTML = '';
      candles = [];
      order = [];
      left = TOTAL;
      leftEl.textContent = String(TOTAL);
      scene.classList.remove('going-dark');
      tipEl.textContent = '👆 点击蜡烛（或画面空白处）把它们一根根吹灭';

      ROWS.forEach(function (n) {
        const row = document.createElement('div');
        row.className = 'candle-row';
        for (let i = 0; i < n; i++) {
          const c = document.createElement('div');
          c.className = 'candle';
          const f = document.createElement('div');
          f.className = 'flame';
          f.style.animationDelay = (-rand(0, 1.6)).toFixed(2) + 's';
          f.style.animationDuration = rand(1.3, 2.1).toFixed(2) + 's';
          c.appendChild(f);
          row.appendChild(c);
          candles.push(c);
        }
        wrap.appendChild(row);
      });

      // 数组顺序 = DOM 顺序 = 从后排到前排；点火顺序反过来：前排 → 中排 → 后排
      const all = candles.map(function (_, i) { return i; });
      order = all.slice(14, 21).concat(all.slice(7, 14), all.slice(0, 7));
    }

    function blow() {
      if (busy || left <= 0) return;
      const idx = order[TOTAL - left];
      const c = candles[idx];
      if (!c || c.classList.contains('out')) return;

      c.classList.add('out');
      left--;
      leftEl.textContent = String(left);
      Sound.blow();

      const smoke = document.createElement('div');
      smoke.className = 'smoke';
      c.appendChild(smoke);
      setTimeout(function () { smoke.remove(); }, 2100);

      if (left === 0) allOut();
    }

    async function allOut() {
      busy = true;
      tipEl.textContent = '……许的愿望，会被听见的。';
      await wait(700);
      scene.classList.add('going-dark');
      Sound.heartbeat();
      await wait(1500);
      Sound.heartbeat();
      await wait(1500);
      Stage.go('dark');
    }

    function enter() {
      if (inited) return;
      inited = true;
      build();
      scene.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('#darkness')) return;
        if (busy) return;
        blow();
      });
    }

    return { enter: enter };
  })();

  /* =========================================================
     第四幕 · 黑暗中的聊天
     ========================================================= */
  const Dark = (function () {
    const cfg = Object.assign({
      contact: '神秘人',
      avatar: '🎂',
      status: '在线',
      placeholder: '说点什么…',
      messages: [],
      exitAction: 'ending',
      endTitle: '生日快乐',
      endText: ''
    }, window.CHAT_CONFIG || {});

    const phone = $('#phone');
    const body = $('#chatBody');
    const exitBtn = $('#exitBtn');
    const ending = $('#ending');

    let inited = false;
    let cancelled = false;

    function scrollDown() { body.scrollTop = body.scrollHeight; }

    function addMsg(m) {
      const from = (m.from === 'me' || m.from === 'sys') ? m.from : 'them';
      const el = document.createElement('div');
      el.className = 'msg ' + from;
      el.textContent = m.text == null ? '' : String(m.text);
      body.appendChild(el);
      scrollDown();
    }

    function showTyping() {
      const el = document.createElement('div');
      el.className = 'typing';
      el.innerHTML = '<i></i><i></i><i></i>';
      body.appendChild(el);
      scrollDown();
      return el;
    }

    async function play() {
      await wait(900);
      Sound.heartbeat();
      await wait(800);
      if (cancelled) return;
      phone.classList.add('show');
      await wait(1100);

      const list = Array.isArray(cfg.messages) ? cfg.messages : [];
      for (let i = 0; i < list.length; i++) {
        if (cancelled) return;
        const m = list[i] || {};
        const delay = Math.max(150, Number(m.delay) || 1200);
        let typingEl = null;
        if (m.from === 'them') {
          typingEl = showTyping();
          await wait(delay);
          if (cancelled) { typingEl.remove(); return; }
          typingEl.remove();
        } else {
          await wait(delay);
          if (cancelled) return;
        }
        addMsg(m);
        if (m.from === 'sys') Sound.soft(); else Sound.ding();
      }
    }

    function confetti() {
      const box = $('#confetti');
      box.innerHTML = '';
      const colors = ['#f6c96b', '#ff86ae', '#a97bff', '#7fe0c0', '#ffffff', '#ff9a6b'];
      for (let i = 0; i < 64; i++) {
        const p = document.createElement('i');
        p.style.left = rand(0, 100).toFixed(2) + '%';
        p.style.background = pick(colors);
        p.style.animationDuration = rand(2.8, 6).toFixed(2) + 's';
        p.style.animationDelay = rand(0, 2.5).toFixed(2) + 's';
        p.style.width = rand(5, 10).toFixed(1) + 'px';
        p.style.height = rand(9, 17).toFixed(1) + 'px';
        p.style.opacity = rand(0.6, 1).toFixed(2);
        box.appendChild(p);
      }
      setTimeout(function () { box.innerHTML = ''; }, 9500);
    }

    function showEnding() {
      if (!ending.hidden) return;
      $('#endTitle').textContent = cfg.endTitle || '生日快乐';
      $('#endText').textContent = cfg.endText || '';
      phone.classList.remove('show');
      exitBtn.style.display = 'none';
      Sound.chime();
      setTimeout(function () {
        ending.hidden = false;
        confetti();
      }, 480);
    }

    function enter() {
      if (inited) return;
      inited = true;

      $('#chatName').textContent = cfg.contact;
      $('#chatAvatar').textContent = cfg.avatar;
      $('#chatStatus').textContent = cfg.status;
      $('#chatPlaceholder').textContent = cfg.placeholder;

      exitBtn.addEventListener('click', function () {
        cancelled = true;
        if (cfg.exitAction === 'close' && window.opener) {
          window.close();
        }
        showEnding();
      });

      $('#restartBtn').addEventListener('click', function () {
        const clean = location.href.split('?')[0].split('#')[0];
        location.href = clean;
      });

      play();
    }

    return { enter: enter };
  })();

  /* =========================================================
     背景粒子 / 声音开关 / 调试跳转
     ========================================================= */
  function initParticles() {
    const box = $('#particles');
    if (!box) return;
    const emojis = ['✨', '🎈', '🎉', '⭐', '💫', '🕯️'];
    for (let i = 0; i < 22; i++) {
      const el = document.createElement('i');
      if (Math.random() < 0.28) {
        el.className = 'em';
        el.textContent = pick(emojis);
      } else {
        el.style.width = el.style.height = rand(4, 9).toFixed(1) + 'px';
      }
      el.style.left = rand(0, 98).toFixed(2) + '%';
      el.style.setProperty('--dx', rand(-70, 70).toFixed(0) + 'px');
      el.style.animationDuration = rand(14, 30).toFixed(1) + 's';
      el.style.animationDelay = (-rand(0, 24)).toFixed(1) + 's';
      box.appendChild(el);
    }
  }

  function initMute() {
    const btn = $('#muteBtn');
    function paint() {
      btn.textContent = Sound.isMuted() ? '🔇' : '🔊';
      btn.classList.toggle('off', Sound.isMuted());
    }
    btn.addEventListener('click', function () {
      Sound.setMuted(!Sound.isMuted());
      paint();
      if (!Sound.isMuted()) Sound.tap();
    });
    paint();
  }

  function initDevJump() {
    const params = new URLSearchParams(location.search);
    const box = $('#devJump');
    if (params.get('dev') === '1') box.hidden = false;
    $$('button', box).forEach(function (b) {
      b.addEventListener('click', function () { Stage.go(b.dataset.jump); });
    });
    const want = params.get('stage');
    if (want && ['lock', 'draw', 'cake', 'dark'].indexOf(want) >= 0) {
      Lock.init();
      setTimeout(function () { Stage.go(want); }, 60);
      return true;
    }
    return false;
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    initParticles();
    initMute();

    // 第一次交互时把音频上下文点亮（浏览器的自动播放限制）
    const prime = function () {
      Sound.prime();
      document.removeEventListener('pointerdown', prime);
      document.removeEventListener('keydown', prime);
    };
    document.addEventListener('pointerdown', prime);
    document.addEventListener('keydown', prime);

    const jumped = initDevJump();
    if (!jumped) Lock.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
