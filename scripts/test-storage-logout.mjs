process.env.NEXT_PUBLIC_API_URL='http://x.test'; process.env.NEXT_PUBLIC_FIREBASE_API_KEY='k'
const puts=[]
globalThis.window={addEventListener(){}}
globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}}
globalThis.fetch=async(u,i={})=>{
  const j=(d,s=200)=>({ok:s<300,status:s,json:async()=>d})
  if(u.endsWith('/api/yo'))return j({email:'a@b',esSuperadmin:false})
  if(u.endsWith('/api/empresas'))return j([{id:'E1',nombre:'x',rnc:null,estado:'activa',rol:'admin'}])
  if(i.method==='PUT'){puts.push(u);return j({version:2})}
  return j({})
}
const s=await import(new URL('../src/lib/storage.ts', import.meta.url).href)
await s.initRemoteStore('u1',async()=>'tok')
s.storage.setItem('cielo-empleados::u1','[{"id":"1"}]')
s.resetRemoteStore()          // lo que hace la app al cerrar sesión
await new Promise(r=>setTimeout(r,1500))
console.log('PUT enviados tras cerrar sesión:',puts.length)
if(puts.length!==1){console.error('FALLA: el cambio pendiente se perdió al cerrar sesión');process.exit(1)}
