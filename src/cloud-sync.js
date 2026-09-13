export async function writeUserStateBatch(client,userId,batch) {
  const {data,error}=await client
    .from('user_card_states')
    .upsert(batch.map(e=>({user_id:userId,entry_id:e.entry_id,status:e.status})),{onConflict:'user_id,entry_id'})
    .select('entry_id,status,updated_at')
    .abortSignal(AbortSignal.timeout(12000));
  if(error)throw error;
  return data;
}

export async function readUserStates(client,userId) {
  const {data,error}=await client
    .from('user_card_states')
    .select('entry_id,status,updated_at')
    .eq('user_id',userId)
    .abortSignal(AbortSignal.timeout(12000));
  if(error)throw error;
  return data;
}

export function subscribeUserStates(client,userId,{onChange,onStatus=()=>{}}={}) {
  const channel=client
    .channel(`user-card-states:${userId}:${globalThis.crypto.randomUUID()}`)
    .on('postgres_changes',{
      event:'*',
      schema:'public',
      table:'user_card_states',
      filter:`user_id=eq.${userId}`
    },payload=>onChange?.(payload))
    .subscribe((status,error)=>onStatus(status,error));
  return {channel,unsubscribe:()=>client.removeChannel(channel)};
}
