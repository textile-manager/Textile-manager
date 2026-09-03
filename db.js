/* ============================================================
   Textile Manager — слой данных (Supabase)
   Версия 2.6 · 03.09.2026

   Приложение работает с теми же структурами, что и прототип.
   Этот файл отвечает за четыре вещи:
     1) вход по имени + PIN через сервис авторизации;
     2) загрузку всех данных при старте;
     3) сохранение изменений после каждого действия — методом
        сравнения состояния «до» и «после» (dbSyncDiff);
     4) выдачу новых идентификаторов (dbNewId).

   Подписи ставит сервер: имя исполнителя в истории и автора
   комментария проставляют триггеры stamp_actor / stamp_author,
   поэтому подделать их из браузера нельзя.

   Что изменилось против 2.3:
     · швея передаётся идентификатором, а не именем (была потеря
       швеи при сохранении);
     · этап чека вычисляется функцией stageOf, которую передаёт
       приложение (раньше читалось несуществующее поле c.stage);
     · у записей истории появился идентификатор (без него в базу
       уходила только первая запись);
     · добавлены: цвета швей и «Без пошива», признак «без пошива»
       у чека, поля замены и поздних позиций, лента комментариев;
     · запись идёт этапами, а не одной пачкой: ссылки между
       записями требуют порядка.
   ============================================================ */

const TM = window.TM_CONFIG || {};
let sb = null;
let dbReady = false;
let myUserId = null;                 // id текущего сотрудника в таблице users

const dbNewId = () => (window.crypto && crypto.randomUUID)
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
      const r = Math.random() * 16 | 0;
      return (ch === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });

/* --- служебный адрес входа: имя сотрудника → адрес учётной записи --- */
/* приставка TM_ обязательна: в index.html есть свой TRANSLIT для поиска,
   а оба файла живут в одном глобальном пространстве имён */
const TM_TRANSLIT = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',
  н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
function loginSlug(name){
  const s = String(name).toLowerCase().split('').map(ch => TM_TRANSLIT[ch] !== undefined ? TM_TRANSLIT[ch] : ch).join('');
  return s.replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'user';
}
function loginEmail(name){ return loginSlug(name) + '@' + (TM.LOGIN_DOMAIN || 'textile.local'); }

function dbInit(){
  if (!TM.SUPABASE_URL || TM.SUPABASE_URL.startsWith('ВСТАВЬТЕ')){
    return {ok:false, error:'Не заполнен файл config.js — укажите адрес проекта и ключ (см. README, шаг 3).'};
  }
  if (typeof supabase === 'undefined'){
    return {ok:false, error:'Не загрузилась библиотека подключения. Проверьте интернет и обновите страницу.'};
  }
  sb = supabase.createClient(TM.SUPABASE_URL, TM.SUPABASE_ANON_KEY, {
    auth: {persistSession: true, autoRefreshToken: true}
  });
  dbReady = true;
  return {ok:true};
}

/* ---------- вход ---------- */
async function dbSignIn(name, pin){
  const {error} = await sb.auth.signInWithPassword({email: loginEmail(name), password: pin});
  if (error) return {ok:false, error:'Неверный PIN-код.'};
  return {ok:true};
}
async function dbSignOut(){ myUserId = null; try { await sb.auth.signOut(); } catch(e){} }

/* Назначение и сброс PIN. Выполняется серверной функцией set-pin:
   изменять чужие учётные данные из браузера нельзя — это делается
   ключом service_role, который в браузер не попадает. */
async function dbSetPin(name, pin){
  try {
    const {data, error} = await sb.functions.invoke('set-pin', {body: {full_name: name, pin}});
    if (error) throw error;
    if (data && data.error) return {ok:false, error: data.error};
    return {ok:true};
  } catch(e){
    return {ok:false, error:
      'Не удалось назначить PIN автоматически: серверная функция set-pin не установлена (см. README, шаг 6).\n\n' +
      'Пока её нет, PIN назначается вручную: панель Supabase → Authentication → Users → ' +
      loginEmail(name) + ' → Reset password.'};
  }
}
async function dbSession(){ const {data} = await sb.auth.getSession(); return data && data.session; }

/* ---------- загрузка ---------- */
const pick = (r, e) => { if (e) throw new Error(e.message); return r || []; };

/* 'DD.MM HH:MM' в местном времени — тот же вид, что даёт now() в приложении */
function fmtTs(iso){
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const z = n => String(n).padStart(2, '0');
  return `${z(d.getDate())}.${z(d.getMonth()+1)} ${z(d.getHours())}:${z(d.getMinutes())}`;
}
function fmtDay(iso){
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
}

async function dbLoadAll(){
  const [st, us, sw, pr, sk, or_, it, ac, cm] = await Promise.all([
    sb.from('stores').select('*').order('created_at'),
    sb.from('users').select('*').order('created_at'),
    sb.from('seamstresses').select('*').order('created_at'),
    sb.from('products').select('*').order('name'),
    sb.from('stocks').select('*'),
    sb.from('orders').select('*').order('created_at'),
    sb.from('order_items').select('*').order('created_at'),
    sb.from('order_actions').select('*').order('performed_at'),
    sb.from('order_comments').select('*').order('created_at'),
  ]);

  const userRows = pick(us.data, us.error);
  const session  = await dbSession();
  const authId   = session && session.user && session.user.id;
  myUserId = (userRows.find(u => u.auth_id === authId) || {}).id || null;

  const stores = pick(st.data, st.error).map(s => ({id:s.id, name:s.name, active:s.is_active}));
  const users  = userRows.map(u => ({id:u.id, name:u.full_name, role:u.role,
                                     owner:!!u.is_owner, active:u.is_active}));

  /* швеи — объекты с цветом; «Без пошива» приходит отдельной записью */
  const seamRows = pick(sw.data, sw.error);
  const seamstresses = seamRows.map(s => ({
    id: s.id, name: s.full_name, color: s.color || null,
    noSewing: !!s.no_sewing, active: s.is_active !== false
  }));

  const stockRows = pick(sk.data, sk.error);
  const products = pick(pr.data, pr.error).map(p => {
    const stocks = {};
    stockRows.filter(r => r.product_id === p.id)
             .forEach(r => { stocks[r.store_id] = (r.pieces || []).map(Number); });
    return {id:p.id, name:p.name, unit:p.unit, stocks};
  });

  const items    = pick(it.data, it.error);
  const actions  = pick(ac.data, ac.error);
  const comments = pick(cm.data, cm.error);
  const userName = id => (users.find(u => u.id === id) || {}).name || '—';

  const MANUAL = ['assembled','in_sewing','ready_to_issue','issued','cancelled'];

  const checks = pick(or_.data, or_.error).map(o => ({
    id: o.id,
    num: o.receipt_number,
    store: o.store_id,
    client: o.client_name || '',
    createdBy: userName(o.created_by),
    createdAt: fmtDay(o.created_at),
    archivedAt: fmtDay(o.issued_at || o.cancelled_at),
    confirmed: !!o.availability_confirmed,
    seamstressId: o.seamstress_id || null,
    skippedSewing: !!o.skipped_sewing,
    manual: MANUAL.includes(o.current_stage) ? o.current_stage : null,
    cancelReason: o.cancel_reason || null,
    items: items.filter(i => i.order_id === o.id).map(i => ({
      id: i.id, mark: i.product_marking, qty: Number(i.quantity), unit: i.unit,
      status: i.status, src: i.source_store_id || null,
      deducted: !!i.deducted_from, deductedFrom: i.deducted_from || null,
      fromQty: (i.from_qty === null || i.from_qty === undefined) ? null : Number(i.from_qty),
      addedLate: !!i.added_late,
      prevStatus: i.prev_status || null,
      replacedBy: i.replaced_by || null,
      replaces: i.replaces || null,
    })),
    comments: comments.filter(k => k.order_id === o.id).map(k => ({
      id: k.id, itemId: k.item_id || null, text: k.body,
      user: userName(k.created_by), ts: fmtTs(k.created_at), d: fmtDay(k.created_at),
    })),
    history: actions.filter(a => a.order_id === o.id).map(a => ({
      id: a.id, ts: fmtTs(a.performed_at), d: fmtDay(a.performed_at),
      user: userName(a.performed_by), text: a.comment || '', kind: a.action_type,
    })),
  }));

  return {stores, users, seamstresses, products, checks};
}

/* ---------- сохранение изменений ----------
   Сравниваем состояние до и после действия и отправляем разницу.

   Порядок обязателен: ссылки между записями требуют, чтобы сначала
   появились справочники, потом чеки, потом позиции, и только затем
   связи «заменена → замена», комментарии к позициям и история.

   Третий аргумент — функция расчёта этапа чека из приложения.        */
async function dbSyncDiff(before, after, stageOf){
  if (!dbReady) return {ok:true};
  const errs = [];
  const byId = arr => new Map((arr || []).filter(x => x && x.id).map(x => [x.id, x]));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  async function run(jobs, label){
    if (!jobs.length) return;
    const res = await Promise.allSettled(jobs);
    res.forEach(r => {
      if (r.status === 'rejected') errs.push({label, error: r.reason});
      else if (r.value && r.value.error) errs.push({label, error: r.value.error});
    });
  }

  /* ---- этап 1: справочники ---- */
  const j1 = [];

  const b1 = byId(before.stores), a1 = byId(after.stores);
  after.stores.forEach(s => { const p = b1.get(s.id);
    if (!p || p.name !== s.name || p.active !== s.active)
      j1.push(sb.from('stores').upsert({id:s.id, name:s.name, is_active:s.active}, {onConflict:'id'})); });
  before.stores.forEach(s => { if (!a1.has(s.id)) j1.push(sb.from('stores').delete().eq('id', s.id)); });

  const b2 = byId(before.users), a2 = byId(after.users);
  after.users.forEach(u => { const p = b2.get(u.id);
    if (!p || p.name !== u.name || p.role !== u.role || p.owner !== u.owner || p.active !== u.active)
      j1.push(sb.from('users').upsert({id:u.id, full_name:u.name, role:u.role,
        is_owner:!!u.owner, is_active:u.active !== false}, {onConflict:'id'})); });
  before.users.forEach(u => { if (!a2.has(u.id)) j1.push(sb.from('users').delete().eq('id', u.id)); });

  /* швеи: объекты с цветом и признаком «Без пошива».
     Исчезнувшая швея не удаляется, а гасится: на неё могут ссылаться чеки. */
  const b3 = byId(before.seamstresses), a3 = byId(after.seamstresses);
  after.seamstresses.forEach(s => { const p = b3.get(s.id);
    if (!p || p.name !== s.name || p.color !== s.color || p.active !== s.active || p.noSewing !== s.noSewing)
      j1.push(sb.from('seamstresses').upsert({id:s.id, full_name:s.name,
        color: s.noSewing ? null : (s.color || null),
        no_sewing: !!s.noSewing, is_active: s.active !== false}, {onConflict:'id'})); });
  before.seamstresses.forEach(s => { if (!a3.has(s.id) && !s.noSewing)
    j1.push(sb.from('seamstresses').update({is_active:false}).eq('id', s.id)); });

  const b4 = byId(before.products), a4 = byId(after.products);
  after.products.forEach(p => { const q = b4.get(p.id);
    if (!q || q.name !== p.name || q.unit !== p.unit)
      j1.push(sb.from('products').upsert({id:p.id, name:p.name, unit:p.unit}, {onConflict:'id'})); });

  await run(j1, 'справочники');

  /* ---- этап 2: остатки, затем удаление товаров ---- */
  const j2 = [];
  after.products.forEach(p => {
    const prev = b4.get(p.id), prevStocks = prev ? prev.stocks : {};
    Object.keys(p.stocks).forEach(sid => {
      if (!same(prevStocks[sid], p.stocks[sid]))
        j2.push(sb.from('stocks').upsert({product_id:p.id, store_id:sid, pieces:p.stocks[sid],
          updated_by: myUserId, updated_at:new Date().toISOString()}, {onConflict:'product_id,store_id'}));
    });
    Object.keys(prevStocks).forEach(sid => {
      if (!(sid in p.stocks))
        j2.push(sb.from('stocks').delete().eq('product_id', p.id).eq('store_id', sid));
    });
  });
  before.products.forEach(p => { if (!a4.has(p.id)) j2.push(sb.from('products').delete().eq('id', p.id)); });
  await run(j2, 'остатки');

  /* ---- этап 3: чеки ---- */
  const stageOfSafe = c => { try { return stageOf ? stageOf(c) : 'awaiting_check'; }
                             catch(e){ return 'awaiting_check'; } };
  const nowIso = new Date().toISOString();
  const STAMP = {assembled:'assembled', in_sewing:'sent_to_sewing', ready_to_issue:'completed',
                 issued:'issued', cancelled:'cancelled'};

  const b5 = byId(before.checks), a5 = byId(after.checks);
  const j3 = [];
  const changed = [];
  after.checks.forEach(c => {
    const p = b5.get(c.id);
    const stage = stageOfSafe(c);
    const head = x => ({num:x.num, store:x.store, client:x.client, confirmed:x.confirmed,
                        seamstressId:x.seamstressId, skippedSewing:x.skippedSewing,
                        manual:x.manual, cancelReason:x.cancelReason});
    const headChanged = !p || !same(head(p), head(c));
    const stageChanged = !p || stageOfSafe(p) !== stage;
    if (headChanged || stageChanged){
      const row = {
        id: c.id, store_id: c.store, receipt_number: c.num,
        client_name: c.client || null,
        seamstress_id: c.seamstressId || null,
        skipped_sewing: !!c.skippedSewing,
        availability_confirmed: !!c.confirmed,
        cancel_reason: c.cancelReason || null,
        current_stage: stage,
      };
      if (!p) row.created_by = myUserId;
      // отметка времени ставится один раз — при первом входе в этап
      if (stageChanged && STAMP[stage]){
        row[STAMP[stage] + '_at'] = nowIso;
        row[STAMP[stage] + '_by'] = myUserId;
      }
      if (stageChanged && stage === 'ready_to_assemble' && c.confirmed){
        row.availability_confirmed_at = nowIso;
        row.availability_confirmed_by = myUserId;
      }
      j3.push(sb.from('orders').upsert(row, {onConflict:'id'}));
    }
    changed.push({c, p});
  });
  await run(j3, 'чеки');

  /* ---- этап 4: позиции без ссылок замены ---- */
  const j4 = [], linkJobs = [], delItems = [];
  changed.forEach(({c, p}) => {
    const pi = byId(p ? p.items : []), ai = byId(c.items);
    c.items.forEach(i => {
      const q = pi.get(i.id);
      if (!q || !same(q, i)){
        j4.push(sb.from('order_items').upsert({
          id:i.id, order_id:c.id, product_marking:i.mark, quantity:i.qty, unit:i.unit,
          status:i.status, prev_status:i.prevStatus || null, added_late: !!i.addedLate,
          source_store_id:i.src || null, deducted_from:i.deductedFrom || null,
          from_qty:i.fromQty, updated_by: myUserId, updated_at:nowIso}, {onConflict:'id'}));
        if ((q ? q.replacedBy : null) !== (i.replacedBy || null) ||
            (q ? q.replaces   : null) !== (i.replaces   || null))
          linkJobs.push(sb.from('order_items')
            .update({replaced_by:i.replacedBy || null, replaces:i.replaces || null})
            .eq('id', i.id));
      }
    });
    (p ? p.items : []).forEach(i => { if (!ai.has(i.id))
      delItems.push(sb.from('order_items').delete().eq('id', i.id)); });
  });
  await run(j4, 'позиции');

  /* ---- этап 5: связи замены, комментарии, история ---- */
  const j5 = [...linkJobs];
  changed.forEach(({c, p}) => {
    const pc = byId(p ? p.comments : []), ac2 = byId(c.comments);
    c.comments.forEach(k => { if (!pc.has(k.id))
      j5.push(sb.from('order_comments').insert({id:k.id, order_id:c.id,
        item_id:k.itemId || null, body:k.text})); });
    (p ? p.comments : []).forEach(k => { if (!ac2.has(k.id))
      j5.push(sb.from('order_comments').delete().eq('id', k.id)); });

    const ph = new Set((p ? p.history : []).map(h => h.id).filter(Boolean));
    c.history.forEach(h => { if (h.id && !ph.has(h.id))
      j5.push(sb.from('order_actions').insert({id:h.id, order_id:c.id,
        action_type:h.kind || 'other', comment:h.text})); });
  });
  await run(j5, 'комментарии и история');

  /* ---- этап 6: удаления ---- */
  const j6 = [...delItems];
  before.checks.forEach(c => { if (!a5.has(c.id)) j6.push(sb.from('orders').delete().eq('id', c.id)); });
  await run(j6, 'удаления');

  if (errs.length){
    console.error('Ошибки сохранения:', errs);
    return {ok:false, count:errs.length, where:[...new Set(errs.map(e => e.label))].join(', ')};
  }
  return {ok:true};
}

window.TM_DB = {dbInit, dbSignIn, dbSignOut, dbSession, dbLoadAll, dbSyncDiff,
                dbSetPin, dbNewId, loginEmail, myId: () => myUserId};
