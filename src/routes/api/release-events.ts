import {createFileRoute} from "@tanstack/react-router";
import {createClient} from "@supabase/supabase-js";
import crypto from "node:crypto";

function required(name:string){
 const value=String(process.env[name]||"").trim();
 if(!value)throw new Error("Missing server environment variable: "+name);
 return value;
}
function safeEqual(a:string,b:string){
 const aa=Buffer.from(a),bb=Buffer.from(b);
 return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);
}
function service(){
 return createClient(required("SUPABASE_URL"),required("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false,autoRefreshToken:false}});
}
const TYPES=new Set(["rolled_back","rollback_failed","reverted","revert_failed","archived"]);
const RELEASE_TYPES=new Set(["base","update"]);

export const Route=createFileRoute("/api/release-events")({
 server:{
  handlers:{
   POST:async({request})=>{
    try{
     const supplied=String(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim()||String(request.headers.get("x-orbitfs-event-secret")||"").trim();
     const expected=required("DEV_PANEL_EVENT_SECRET");
     if(!supplied||!safeEqual(supplied,expected))return Response.json({error:"UNAUTHORIZED"},{status:401});
     const body:any=await request.json().catch(()=>({}));
     const eventType=String(body.eventType||body.event_type||"").trim().toLowerCase();
     const releaseType=String(body.releaseType||body.release_type||"").trim().toLowerCase();
     const releaseVersion=String(body.releaseVersion||body.release_version||"").trim();
     const reason=String(body.reason||"").trim();
     const eventId=String(body.eventId||body.event_id||"").trim();
     if(!TYPES.has(eventType))return Response.json({error:"INVALID_EVENT_TYPE"},{status:400});
     if(!RELEASE_TYPES.has(releaseType))return Response.json({error:"INVALID_RELEASE_TYPE"},{status:400});
     if(!eventId||!releaseVersion||!reason)return Response.json({error:"eventId, releaseVersion and reason are required"},{status:400});
     const row={
      event_id:eventId,
      event_type:eventType,
      release_id:body.releaseId||body.release_id||null,
      release_version:releaseVersion,
      target_release_id:body.targetReleaseId||body.target_release_id||null,
      target_version:body.targetVersion||body.target_version||null,
      release_type:releaseType,
      channel:String(body.channel||"stable").trim().toLowerCase()||"stable",
      installation_id:body.installationId||body.installation_id||null,
      reason,
      status:String(body.status||"recorded").trim().toLowerCase()||"recorded",
      archived:body.archived!==false,
      source_system:String(body.sourceSystem||body.source_system||"billing_store").trim()||"billing_store",
      metadata:body.metadata&&typeof body.metadata==="object"?body.metadata:{},
      occurred_at:body.occurredAt||body.occurred_at||new Date().toISOString(),
     };
     const db=service();
     const {data,error}=await db.from("panel_release_events").upsert(row,{onConflict:"event_id",ignoreDuplicates:true}).select("*").maybeSingle();
     if(error)throw error;
     return Response.json({ok:true,event:data||row},{headers:{"cache-control":"no-store"}});
    }catch(error){
     return Response.json({error:error instanceof Error?error.message:"Unable to record release event"},{status:500});
    }
   }
  }
 }
});
