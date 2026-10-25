import { env } from './config.js';
export async function sendLink(to:string,subject:string,path:string,token:string){
  const url=new URL(env.FRONTEND_URL);
  const base=url.pathname.replace(/\/$/,'');
  url.pathname=base+'/';
  url.hash='/auth/'+path+'?token='+encodeURIComponent(token);
  if(!env.RESEND_API_KEY||!env.MAIL_FROM){
    if(env.NODE_ENV==='production')throw Object.assign(new Error('Mail provider not configured'),{statusCode:503});
    console.info('[development] Email delivery skipped: provider not configured.');
    return;
  }
  const result=await fetch('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({from:env.MAIL_FROM,to:[to],subject,html:`<p>PokeList: <a href="${url.toString()}">abrir link</a></p><p>Se você não solicitou, ignore este e-mail.</p>`}),
    signal:AbortSignal.timeout(8000)
  });
  if(!result.ok)throw Object.assign(new Error('Failed to send email'),{statusCode:503});
}
