import {createClient} from '@supabase/supabase-js';
import {finalizeCatalog,hydrateCatalog} from './catalog-model.js';

// A publishable key is intentionally public. Never put a secret/service_role key here.
export const config={
  url:import.meta.env.VITE_SUPABASE_URL||'https://npqrixancnwbmzcyqafx.supabase.co',
  key:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_ktnbnYd08R8eahv-2qgMQQ_5rrTZog0'
};
export const supabase=createClient(config.url,config.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
export async function loadCatalog(kind,fallback) {
  const backup=finalizeCatalog(structuredClone(fallback));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try {
    const results=await Promise.all([
      supabase.from('job_entries').select('*,companies(name,english_name),entry_links(*),entry_audits(*),job_sources(source_id,position),entry_deadlines(*)').eq('kind',kind).order('sort_order').abortSignal(controller.signal),
      supabase.from('sources').select('*').abortSignal(controller.signal),
      supabase.from('catalog_archives').select('*').eq('kind',kind).single().abortSignal(controller.signal),
      supabase.from('change_logs').select('*').eq('kind',kind).order('position').abortSignal(controller.signal),
      supabase.from('timeline_events').select('*').eq('kind',kind).order('position').abortSignal(controller.signal)
    ]);
    const failure=results.find(r=>r.error);if(failure)throw failure.error;
    const data=hydrateCatalog(kind,...results.map(r=>r.data));
    data.connection='cloud';
    try{localStorage.setItem('recsys:catalog:'+kind,JSON.stringify(data));}catch{}
    return data;
  } catch(error) {
    console.warn('招聘资料读取失败，使用只读备份。',error?.message||'network error');
    try{
      const cache=JSON.parse(localStorage.getItem('recsys:catalog:'+kind)||'null');
      if(cache?.PAGE_KIND===kind && Array.isArray(cache.DATA) && cache.DATA.length) {
        const data=finalizeCatalog(cache);data.connection='cached';return data;
      }
    }catch{}
    backup.connection='fallback';return backup;
  } finally {clearTimeout(timer);}
}
export function readableError(error) {
  const code=error?.code||'', message=String(error?.message||'');
  if(code==='over_email_send_rate_limit'||/rate limit/i.test(message))return '发送或登录过于频繁，请稍后重试。';
  if(code==='email_address_not_authorized'||/email address.*not authorized|Email address.*invalid/i.test(message))return '默认邮件服务只能向项目团队邮箱发送邮件；其他邮箱需要先配置 SMTP。';
  if(/invalid login credentials/i.test(message))return '邮箱或密码不正确，或邮箱尚未确认。';
  if(/Email not confirmed/i.test(message))return '请先打开邮箱中的确认邮件，再登录。';
  if(/Anonymous sign-ins are disabled/i.test(message))return '项目尚未启用匿名云端同步；本机标记仍然可用。';
  if(/already.*registered|already.*been registered|already.*exists/i.test(message))return '这个邮箱已有账号，请使用“登录”，不要重复绑定。';
  if(/fetch|network|timeout|abort/i.test(message)||!navigator.onLine)return '网络暂时不可用，标记已保存在本机。联网后点击重试同步。';
  return message||'操作未完成，数据已保存在本机，请重试。';
}
