const SB_URL=process.env.SUPABASE_URL;
const SB_KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY=process.env.RESEND_API_KEY;
const RESEND_FROM=process.env.RESEND_FROM||'UK Barber Shop Cancun <onboarding@resend.dev>';
const SITE_URL=(process.env.SITE_URL||process.env.URL||process.env.DEPLOY_PRIME_URL||'').replace(/\/$/,'');

const pad=n=>String(n).padStart(2,'0');

const esc=s=>String(s||'').replace(
  /[&<>"']/g,
  m=>({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#039;'
  }[m])
);

function cancunDate(offset=0){
  const p=new Intl.DateTimeFormat('en-CA',{
    timeZone:'America/Cancun',
    year:'numeric',
    month:'2-digit',
    day:'2-digit'
  }).formatToParts(new Date());

  const v={};

  p.forEach(x=>{
    if(x.type!=='literal')v[x.type]=x.value
  });

  const d=new Date(
    Date.UTC(+v.year,+v.month-1,+v.day)
  );

  d.setUTCDate(d.getUTCDate()+offset);

  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
}

function niceDate(v){
  try{
    return new Intl.DateTimeFormat('en-US',{
      weekday:'long',
      day:'numeric',
      month:'long',
      year:'numeric',
      timeZone:'America/Cancun'
    }).format(new Date(`${v}T12:00:00Z`))
  }catch{
    return v;
  }
}

async function sb(path,opts={}){
  if(!SB_URL||!SB_KEY)
    throw new Error('Database is not configured');

  const r=await fetch(
    `${SB_URL}/rest/v1/${path}`,
    {
      ...opts,
      headers:{
        apikey:SB_KEY,
        ...(SB_KEY.startsWith('sb_')?{}:{
          Authorization:`Bearer ${SB_KEY}`
        }),
        'Content-Type':'application/json',
        Prefer:'return=representation'
      }
    }
  );

  const t=await r.text();
  let d;

  try{
    d=t?JSON.parse(t):null
  }catch{
    d=t
  }

  if(!r.ok)
    throw new Error(d?.message||`DB ${r.status}`);

  return d;
}

async function send(to,subject,html){
  if(!RESEND_KEY||!to)
    return false;

  const r=await fetch(
    'https://api.resend.com/emails',
    {
      method:'POST',
      headers:{
        Authorization:`Bearer ${RESEND_KEY}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        from:RESEND_FROM,
        to:[to],
        subject,
        html
      })
    }
  );

  return r.ok;
}

export default async()=>{
  try{
    if(!SB_URL||!SB_KEY||!RESEND_KEY)
      return new Response(
        JSON.stringify({
          ok:false,
          error:'Reminder service not configured'
        }),
        {
          status:200,
          headers:{
            'Content-Type':'application/json'
          }
        }
      );

    const tomorrow=cancunDate(1);

    const rows=await sb(
      `barber_bookings?booking_date=eq.${tomorrow}&reminder_sent_at=is.null&select=*&order=booking_time.asc`,
      {method:'GET'}
    );

    let sent=0;

    for(const b of rows||[]){
      if(
        ['Cancelled','No Show'].includes(b.status)
        || !b.email
      )continue;

      const cancel=`${SITE_URL}/cancel.html?token=${encodeURIComponent(b.cancel_token)}`;

      const html=`
        <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#191919">
          <h1>Reminder: your barber appointment is tomorrow</h1>

          <p>Hi ${esc(b.name)},</p>

          <div style="padding:18px;background:#f5f1ec;border-radius:12px;line-height:1.7">
            <b>${esc(b.service)}</b><br>
            ${esc(niceDate(b.booking_date))}<br>
            ${esc(b.booking_time)} – 45 minutes
          </div>

          <p>
            <b>UK Barber Shop Cancun</b><br>
            Pabellón Cumbres<br>
            Cancún, Quintana Roo, Mexico
          </p>

          <p>
            <a href="${cancel}"
            style="display:inline-block;background:#b79a68;color:#111;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">
            Cancel appointment
            </a>
          </p>
        </div>
      `;

      if(
        await send(
          b.email,
          'UK Barber Shop Cancun — reminder for tomorrow',
          html
        )
      ){
        await sb(
          `barber_bookings?id=eq.${b.id}`,
          {
            method:'PATCH',
            body:JSON.stringify({
              reminder_sent_at:new Date().toISOString()
            })
          }
        );

        sent++;
      }
    }

    return new Response(
      JSON.stringify({
        ok:true,
        date:tomorrow,
        sent
      }),
      {
        status:200,
        headers:{
          'Content-Type':'application/json'
        }
      }
    );

  }catch(e){
    return new Response(
      JSON.stringify({
        ok:false,
        error:e.message
      }),
      {
        status:500,
        headers:{
          'Content-Type':'application/json'
        }
      }
    );
  }
};

export const config={
  schedule:'0 14 * * *'
};
