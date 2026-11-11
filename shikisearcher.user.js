// ==UserScript==
// @name         ShikiSearcher
// @namespace    https://github.com/nokusu-n
// @version      2.8.1
// @description  Кнопка «Смотреть на …» на странице аниме Shikimori
// @author       nokusu-n
// @match        https://shikimori.io/*
// @match        https://shikimori.one/*
// @updateURL    https://raw.githubusercontent.com/nokusu-n/shikisearcher/main/shikisearcher.user.js
// @downloadURL  https://raw.githubusercontent.com/nokusu-n/shikisearcher/main/shikisearcher.user.js
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @license      MIT
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ── Настройка ────────────────────────────────────────────────────────────
  // name — подпись на кнопке
  // url  — поиск; название аниме дописывается в конец (уже url-encoded)
  // adult — показывать на хентай-тайтлах
  const SERVICES = [
    { name: 'AnimeLib', url: 'https://animelib.org/ru/catalog?q=', adult: true },
    { name: 'AnimeGo',  url: 'https://animego.org/search/all?q=', adult: true },
    { name: 'HDRezka',  url: 'https://rezka.ag/search/?do=search&subaction=search&q=', adult: true },
    { name: 'KinoPub',  url: 'https://kino.pub/item/search?query=', adult: true },
    { name: 'Yummy',    url: 'https://yummyanime.tv/search?q=', adult: true },
  ];

  // Максимальная длина названия в поисковом запросе. Длинные тайтлы
  // («Изгнанный читер-чародей…», 190 символов) в поиске промахиваются,
  // а обрезка по этому лимиту находит нужное во всех кинотеатрах.
  const MAX_TITLE = 70;

  const KEY_SERVICE = 'service';
  const KEY_LANG = 'lang';
  const HOST_ID = 'shikisearcher-host';
  const SLOT_ID = 'shikisearcher-slot';

  // Открытые списки всех живых кнопок — чтобы один общий обработчик
  // закрывал их и не плодил слушателей при каждой пересборке.
  const openLists = new Set();

  // ── Хранилище: GM_* если есть, иначе localStorage ────────────────────────
  const store = {
    get(key, fallback) {
      try {
        if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
        const raw = localStorage.getItem('shikisearcher:' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        if (typeof GM_setValue === 'function') return GM_setValue(key, value);
        localStorage.setItem('shikisearcher:' + key, JSON.stringify(value));
      } catch (e) { /* приватный режим — живём без сохранения */ }
    },
  };

  // ── Названия тайтла ──────────────────────────────────────────────────────
  // h1 устроен так: [текст ru] <span>/</span> [текст en]
  //
  // Длинное название режем по лимиту и отступаем назад до пробела, чтобы не
  // получить обрубок слова. По двоеточию НЕ режем: там идёт «франшиза :
  // подзаголовок», и подзаголовок часто единственное, что отличает сезон
  // («Mushoku Tensei II: … Part 2» → «Mushoku Tensei II» — потеря).
  function shortenForSearch(title) {
    if (!title || title.length <= MAX_TITLE) return title;

    let cut = title.slice(0, MAX_TITLE);
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > MAX_TITLE * 0.6) cut = cut.slice(0, lastSpace);

    return cut.replace(/[\s:;,—–\-«»"'.,!?…]+$/u, '').trim();
  }

  function getTitles() {
    const h1 = document.querySelector('header.head > h1');
    if (!h1) return null;

    const parts = [];
    h1.childNodes.forEach((node) => {
      if (node.nodeType !== Node.TEXT_NODE) return;
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (text) parts.push(text);
    });

    const ru = parts[0] || '';
    const en = parts[1] || ru;

    // В ссылку уходит укороченное, в подсказку — полное.
    return { ru: shortenForSearch(ru), en: shortenForSearch(en), ruFull: ru, enFull: en };
  }

  function isAdultTitle() {
    // Жанр 12 — Hentai
    return !!document.querySelector('.b-entry-info a[href*="/genre/12-"]');
  }

  function getLang() {
    // По умолчанию ищем по английскому названию: кинотеатры чаще узнают его.
    return store.get(KEY_LANG, 'en') === 'ru' ? 'ru' : 'en';
  }

  // ── Снимаем оформление с родной кнопки статуса ───────────────────────────
  // Так кнопка наследует и тему сайта, и пользовательский CSS, и будущие
  // изменения вёрстки — вместо захардкоженных цветов.
  function readNativeLook() {
    const ref = document.querySelector('.c-image .b-add_to_list .trigger');
    const fallback = {
      bg: '#445566',
      fg: '#ffffff',
      bgImage: 'none',
      fontFamily: '"Helvetica Neue", Arial, Verdana, sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      letterSpacing: 'normal',
      textTransform: 'none',
      radius: '0px',
      shadow: 'none',
      height: '32px',
      lineHeight: '30px',
      padLeft: '5px',
      padRight: '5px',
    };
    if (!ref) return fallback;

    const cs = getComputedStyle(ref);
    const bg = cs.backgroundColor;
    const isTransparent = !bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';

    return {
      bg: isTransparent ? fallback.bg : bg,
      fg: cs.color || fallback.fg,
      bgImage: cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : 'none',
      fontFamily: cs.fontFamily || fallback.fontFamily,
      fontSize: cs.fontSize || fallback.fontSize,
      fontWeight: cs.fontWeight || fallback.fontWeight,
      letterSpacing: cs.letterSpacing || fallback.letterSpacing,
      textTransform: cs.textTransform || fallback.textTransform,
      radius: cs.borderRadius || fallback.radius,
      shadow: cs.boxShadow || fallback.shadow,
      height: Math.round(ref.getBoundingClientRect().height) + 'px',
      lineHeight: cs.lineHeight && cs.lineHeight !== 'normal' ? cs.lineHeight : fallback.lineHeight,
      // Отступ не копируем: у «Смотрю» и «Добавить в список» внутри разные
      // иконки, и вычисленный inset скачет вместе со статусом. Ровный
      // отступ стабилен в любом состоянии и любой теме.
      padRight: cs.paddingRight || fallback.padRight,
    };
  }

  function buildCss(look) {
    return `
      :host {
        all: initial;
        display: block;
        /* Геометрию даёт сайт: наш блок стоит в том же потоке, что и
           .b-add_to_list, поэтому ширина и отступы считаются его CSS. */
        width: 100%;
        /* Воздух до кнопки статуса — внутренний паддинг, а не margin:
           внешние margin схлопываются с соседним блоком. */
        padding: 10px 0;
      }
      * { box-sizing: border-box; }

      .row {
        display: flex;
        align-items: stretch;
        width: 100%;
        height: ${look.height};
        background-color: ${look.bg};
        background-image: ${look.bgImage};
        border-radius: ${look.radius};
        box-shadow: ${look.shadow};
        color: ${look.fg};
        font-family: ${look.fontFamily};
        font-size: ${look.fontSize};
        font-weight: ${look.fontWeight};
        letter-spacing: ${look.letterSpacing};
        text-transform: ${look.textTransform};
        line-height: ${look.lineHeight};
        overflow: hidden;
      }

      .main {
        flex: 1 1 auto;
        display: flex;
        align-items: center;
        /* Полный текст «Смотреть на …» — по центру, как в старом скрипте. */
        justify-content: center;
        min-width: 0;
        padding-left: ${look.padRight};
        padding-right: ${look.padRight};
        color: inherit;
        text-decoration: none;
        cursor: pointer;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .caret {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: 0;
        /* Отдельного блока больше нет: без рамки и своего фона
           стрелка визуально часть той же кнопки. */
        color: inherit;
        font: inherit;
        letter-spacing: inherit;
        text-transform: inherit;
        cursor: pointer;
        padding: 0 7px 0 2px;
        min-width: 20px;
        /* Приглушённая и мельче, как у родной «Смотрю». */
        font-size: 0.75em;
        opacity: 0.6;
      }
      .caret:hover { text-decoration: none; opacity: 1; }

      .list {
        display: none;
        flex-direction: column;
        margin-top: 3px;
        border-radius: ${look.radius};
        overflow: hidden;
      }
      .list.open { display: flex; }

      .item {
        display: block;
        width: 100%;
        /* Высоту задаёт только текст: min-height и line-height от кнопки
           делали пункты заметно толще родных. */
        padding: 6px ${look.padRight};
        background-color: ${look.bg};
        background-image: ${look.bgImage};
        border: 0;
        border-bottom: 1px solid rgba(128, 128, 128, 0.3);
        color: ${look.fg};
        font-family: ${look.fontFamily};
        font-size: ${look.fontSize};
        font-weight: ${look.fontWeight};
        letter-spacing: ${look.letterSpacing};
        text-transform: ${look.textTransform};
        line-height: 1.4;
        text-align: center;
        cursor: pointer;
      }
      .item:last-child { border-bottom: 0; }
      /* Подсветка только на тексте, как у сайта: подчёркивание ложится
         на буквы и не заливает поле — иначе кастомный CSS выглядит иначе. */
      .main:hover,
      .item:hover,
      .lang-btn:hover { text-decoration: underline; }

      .langs {
        display: flex;
        margin-top: 3px;
        border-radius: ${look.radius};
        overflow: hidden;
      }
      .lang-btn {
        flex: 1 1 0;
        padding: 5px 4px;
        background-color: ${look.bg};
        background-image: ${look.bgImage};
        border: 0;
        border-right: 1px solid rgba(128, 128, 128, 0.3);
        color: ${look.fg};
        font-family: ${look.fontFamily};
        font-size: ${look.fontSize};
        font-weight: ${look.fontWeight};
        line-height: 1.3;
        cursor: pointer;
      }
      .lang-btn:last-child { border-right: 0; }
      .lang-btn.active { filter: brightness(0.9); }
    `;
  }

  // ── Построение кнопки ────────────────────────────────────────────────────
  function buildHost(titles, services, selectedName, lang) {
    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = buildCss(readNativeLook());
    shadow.appendChild(style);

    let current = services.find((s) => s.name === selectedName) || services[0];
    let currentLang = lang;

    const title = () => (currentLang === 'en' ? titles.en : titles.ru) || titles.ru;
    // В подсказке — полное название, в ссылке — укороченное.
    const fullTitle = () => (currentLang === 'en' ? titles.enFull : titles.ruFull) || title();
    const urlFor = (service) => service.url + encodeURIComponent(title());

    const row = document.createElement('div');
    row.className = 'row';

    const main = document.createElement('a');
    main.className = 'main';
    main.target = '_blank';
    main.rel = 'noopener noreferrer';

    const caret = document.createElement('button');
    caret.className = 'caret';
    caret.type = 'button';
    caret.title = 'Выбрать сервис';
    caret.textContent = '▼';
    caret.setAttribute('aria-label', 'Выбрать сервис');
    caret.setAttribute('aria-expanded', 'false');

    const list = document.createElement('div');
    list.className = 'list';

    const items = services.map((service) => {
      const item = document.createElement('button');
      item.className = 'item';
      item.type = 'button';
      item.textContent = service.name;
      // Только выбор, без перехода: переход — по основной кнопке.
      item.addEventListener('click', () => {
        current = service;
        render();
        toggleList(false);
        store.set(KEY_SERVICE, service.name);
      });
      return item;
    });

    items.forEach((item) => list.appendChild(item));

    // Переключатель языка названия — внутри выпадашки, как в старом скрипте.
    const langs = document.createElement('div');
    langs.className = 'langs';

    const langButtons = ['ru', 'en'].map((code) => {
      const btn = document.createElement('button');
      btn.className = 'lang-btn';
      btn.type = 'button';
      btn.textContent = code + ' ↗';
      btn.title = code === 'ru' ? 'Искать по русскому названию' : 'Искать по английскому названию';
      btn.addEventListener('click', () => {
        currentLang = code;
        render();
        store.set(KEY_LANG, code);
      });
      return btn;
    });

    langButtons.forEach((btn) => langs.appendChild(btn));

    // Язык живёт внутри выпадашки: снаружи его не видно, пока список закрыт.
    list.appendChild(langs);

    const render = () => {
      main.href = urlFor(current);
      main.textContent = 'Смотреть на ' + current.name;
      main.title = fullTitle() ? current.name + ' — ' + fullTitle() : current.name;
      main.style.opacity = title() ? '' : '0.6';
      langButtons.forEach((btn, i) => btn.classList.toggle('active', ['ru', 'en'][i] === currentLang));
    };

    const toggleList = (open) => {
      const next = typeof open === 'boolean' ? open : !list.classList.contains('open');
      list.classList.toggle('open', next);
      caret.setAttribute('aria-expanded', String(next));
      if (next) openLists.add(list); else openLists.delete(list);
    };

    caret.addEventListener('click', () => toggleList());

    shadow.addEventListener('click', (e) => e.stopPropagation());

    row.appendChild(main);
    row.appendChild(caret);
    shadow.appendChild(row);
    shadow.appendChild(list);
    render();

    return host;
  }

  // ── Вставка на страницу ──────────────────────────────────────────────────
  function mount() {
    const oldSlot = document.getElementById(SLOT_ID);
    if (oldSlot) oldSlot.remove();
    const oldHost = document.getElementById(HOST_ID);
    if (oldHost) oldHost.remove();

    if (!document.body.classList.contains('p-animes-show')) return;

    const titles = getTitles();
    if (!titles || !titles.ru) return;

    const column = document.querySelector('.c-image');
    if (!column) return;

    const available = SERVICES.filter((s) => s.adult || !isAdultTitle());
    if (!available.length) return;

    const host = buildHost(titles, available, store.get(KEY_SERVICE, available[0].name), getLang());

    // Берём класс родного блока: его CSS задаёт отступы и ширину, поэтому
    // наш блок двигается и сужается вместе с «Смотрю» при ресайзе.
    const native = column.querySelector('.b-user_rate .b-add_to_list');

    if (native && native.parentElement) {
      const slot = document.createElement('div');
      slot.id = SLOT_ID;
      slot.className = 'b-add_to_list';
      // Снимаем возможные ограничения родного контейнера.
      slot.style.cssText = 'height:auto;min-height:0;max-height:none;overflow:visible;background:none;border:0;box-shadow:none;';
      slot.appendChild(host);
      native.parentElement.insertBefore(slot, native);
    } else {
      column.appendChild(host);
    }
  }

  function boot() {
    mount();
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('ShikiSearcher: сбросить сервис', () => {
        store.set(KEY_SERVICE, SERVICES[0].name);
        mount();
      });
    }

    // Один обработчик на всё: закрывает списки по клику вне кнопки и по Esc.
    const closeAll = () => {
      openLists.forEach((list) => list.classList.remove('open'));
      openLists.clear();
      document.querySelectorAll('#' + HOST_ID).forEach((host) => {
        const caret = host.shadowRoot && host.shadowRoot.querySelector('.caret');
        if (caret) caret.setAttribute('aria-expanded', 'false');
      });
    };

    document.addEventListener('click', closeAll);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAll();
    });

    // Тема на сайте переключается без перезагрузки — перечитываем оформление.
    new MutationObserver(mount).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-mode', 'class'],
    });

    // .b-user_rate перерисовывается сайтом при смене статуса и сносит наш
    // блок вместе с собой. Возвращаем на место, но только если его нет —
    // иначе наблюдатель зациклился бы на собственных вставках.
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled || document.getElementById(HOST_ID)) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (!document.getElementById(HOST_ID)) mount();
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  document.addEventListener('turbolinks:load', mount);
  document.addEventListener('turbo:load', mount);
})();
