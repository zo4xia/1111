const http=require('http');
function api(m,p,b,t){return new Promise((res,rej)=>{const d=b?JSON.stringify(b):null;const h={'Content-Type':'application/json'};if(t)h.Authorization='Bearer '+t;if(d)h['Content-Length']=Buffer.byteLength(d);const r=http.request({hostname:'127.0.0.1',port:8080,path:p,method:m,headers:h},x=>{let s='';x.on('data',c=>s+=c);x.on('end',()=>res({s:x.statusCode,d:s}))});r.on('error',rej);if(d)r.write(d);r.end()})}
(async()=>{
  const lg=await api('POST','/api/login',{phone:'13800000001',password:'123456'});
  const t=JSON.parse(lg.d).data.token;
  for(const route of ['/api/organizations','/api/orgs']){
    const r=await api('GET',route,null,t);
    let parsed; try{parsed=JSON.parse(r.d)}catch{parsed=r.d}
    const arr=parsed.data;
    console.log(route,'status',r.s,'isArray',Array.isArray(arr),'len',Array.isArray(arr)?arr.length:'-');
    if(Array.isArray(arr)&&arr[0]) console.log('first item keys:',Object.keys(arr[0]).join(','),'\nfirst:',JSON.stringify(arr[0]).slice(0,300));
  }
})().catch(e=>{console.error(e);process.exit(1)});
