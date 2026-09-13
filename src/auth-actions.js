/** Anonymous accounts must verify their email before adding a password. */
export async function requestEmailLink(client,email,redirectTo) {
  const {error}=await client.auth.updateUser({email:email.trim()},{emailRedirectTo:redirectTo});
  if(error)throw error;
}
export async function setVerifiedPassword(client,user,password) {
  if(!user?.email||user.is_anonymous||!user.email_confirmed_at)throw new Error('请先确认邮箱，再设置登录密码。');
  if(typeof password!=='string'||password.length<8)throw new Error('密码至少需要 8 位。');
  const {error}=await client.auth.updateUser({password});
  if(error)throw error;
}
