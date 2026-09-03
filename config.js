// ============================================================
//  Textile Manager — настройки подключения
//  Заполните две строки ниже. Где их взять — см. README.md, шаг 3.
//  Этот ключ публичный (publishable): он предназначен для браузера,
//  а доступ к данным ограничивают правила RLS на стороне базы.
// ============================================================

window.TM_CONFIG = {
  SUPABASE_URL: 'https://vphmucupsnsutfxgucta.supabase.co',       // напр. https://abcdefgh.supabase.co
  SUPABASE_ANON_KEY: 'sb_publishable_4VqoSUqg-4d998aK8T3qGw_mRiqroID', // начинается с sb_publishable_...
                                           // (на старых проектах — длинная строка eyJ...)

  // Домен для служебных адресов входа: сотрудники вводят имя и PIN,
  // а система подставляет служебный адрес вида zinaida@textile.local.
  // Менять не требуется.
  LOGIN_DOMAIN: 'textile.local',
};
