import React,{useEffect,useMemo,useState}from"react";
import{createRoot}from"react-dom/client";
import{Keypair,Mnemonic,PublicKey,TransactionBuilder,transferInstruction,createRialoClient,getDefaultRialoClientConfig,KELVIN_PER_RLO,SYSTEM_PROGRAM_ID}from"@rialo/ts-cdk";
import"./styles.css";
function Ic({d}:{d:string}){return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:"6px",verticalAlign:"-2px"}}><path d={d}/></svg>}
const TK22=PublicKey.fromString("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const TMINT=PublicKey.fromString("BV7xahNAH9vnwE3bNzNf1iHpuokk8cdj8iMoka7DnM1M");
const ATAP=PublicKey.fromString("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const ataOf=(o:any)=>PublicKey.findProgramAddress([o.toBytes(),TK22.toBytes(),TMINT.toBytes()],ATAP)[0];
const testXfer=(from:any,dest:any,n:number):any[]=>{
 const A=(k:any,w:boolean,s=false)=>({pubkey:k,isSigner:s,isWritable:w});
 const sys:any=typeof SYSTEM_PROGRAM_ID==="string"?PublicKey.fromString(SYSTEM_PROGRAM_ID):SYSTEM_PROGRAM_ID;
 const d=new Uint8Array(10);d[0]=12;new DataView(d.buffer).setBigUint64(1,BigInt(Math.round(n*1e6)),true);d[9]=6;
 return [{programId:ATAP,data:new Uint8Array([1]),accounts:[A(from,true,true),A(ataOf(dest),true),A(dest,false),A(TMINT,false),A(sys,false),A(TK22,false)]},
 {programId:TK22,data:d,accounts:[A(ataOf(from),true),A(TMINT,false),A(ataOf(dest),true),A(from,false,true)]}];
};
const hexToBytes=(h:string)=>{const c=h.trim().replace(/^0x/i,"");if(!/^[0-9a-fA-F]{64}$/.test(c))throw Error("Private key harus 64 karakter hex.");return Uint8Array.from(c.match(/.{2}/g)!.map(b=>parseInt(b,16)))};
const bytesToHex=(b:Uint8Array)=>Array.from(b,x=>x.toString(16).padStart(2,"0")).join("");
async function walletToKeypair(w:any){return w.type==="privateKey"?Keypair.fromSecretKey(hexToBytes(w.secret)):Mnemonic.fromPhrase(w.phrase).toKeypair(0)}



const short=(s:string)=>s.length>18?s.slice(0,9)+"…"+s.slice(-7):s;

const DB_NAME="rlo-wallet-vault";
const DB_VERSION=1;
const STORE_NAME="vault";

function openVaultDB():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB_NAME,DB_VERSION);
  req.onupgradeneeded=()=>{
   if(!req.result.objectStoreNames.contains(STORE_NAME)){
    req.result.createObjectStore(STORE_NAME);
   }
  };
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
 });
}

async function vaultGet(key:string){
 const db=await openVaultDB();
 return new Promise<any>((resolve,reject)=>{
  const tx=db.transaction(STORE_NAME,"readonly");
  const req=tx.objectStore(STORE_NAME).get(key);
  req.onsuccess=()=>{const r=req.result;db.close();resolve(r)};
  req.onerror=()=>{db.close();reject(req.error)};
 });
}

async function vaultSet(key:string,value:any){
 const db=await openVaultDB();
 return new Promise<void>((resolve,reject)=>{
  const tx=db.transaction(STORE_NAME,"readwrite");
  tx.objectStore(STORE_NAME).put(value,key);
  tx.oncomplete=()=>{db.close();resolve()};
  tx.onerror=()=>{db.close();reject(tx.error)};
 });
}

function bytesToBase64(bytes:Uint8Array){
 return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value:string){
 return Uint8Array.from(atob(value),c=>c.charCodeAt(0));
}

async function deriveVaultKey(password:string,salt:Uint8Array){
 const material=await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(password),
  "PBKDF2",
  false,
  ["deriveKey"]
 );
 return crypto.subtle.deriveKey(
  {name:"PBKDF2",salt,iterations:250000,hash:"SHA-256"},
  material,
  {name:"AES-GCM",length:256},
  false,
  ["encrypt","decrypt"]
 );
}

async function encryptVault(value:string,password:string){
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await deriveVaultKey(password,salt);
 const encrypted=await crypto.subtle.encrypt(
  {name:"AES-GCM",iv},
  key,
  new TextEncoder().encode(value)
 );
 return {
  salt:bytesToBase64(salt),
  iv:bytesToBase64(iv),
  data:bytesToBase64(new Uint8Array(encrypted))
 };
}

async function decryptVault(data:any,password:string){
 const salt=base64ToBytes(data.salt);
 const iv=base64ToBytes(data.iv);
 const key=await deriveVaultKey(password,salt);
 const decrypted=await crypto.subtle.decrypt(
  {name:"AES-GCM",iv},
  key,
  base64ToBytes(data.data)
 );
 return new TextDecoder().decode(decrypted);
}


function App(){
 const[network,setNetwork]=useState<"testnet"|"devnet">("testnet");
 const client=useMemo(()=>{
  const config=getDefaultRialoClientConfig(network);

  if(network==="devnet"){
    config.chain.rpcUrl=window.location.origin+"/api/rialo";
  }

  return createRialoClient(config);
},[network]);
 const[kp,setKp]=useState<any>(null),[phrase,setPhrase]=useState(""),[addr,setAddr]=useState(""),[bal,setBal]=useState<string|null>(null);
 const[testBal,setTestBal]=useState<string|null>(null),[swapDir,setSwapDir]=useState<"test2rialo"|"rialo2test">("test2rialo"),[swapAmt,setSwapAmt]=useState(""),[swapOpen,setSwapOpen]=useState(false),[sendOpen,setSendOpen]=useState(false),[confirmBox,setConfirmBox]=useState<any>(null),[xferToken,setXferToken]=useState<"RIALO"|"TEST">("RIALO"),[liq,setLiq]=useState<any>(null),[copiedSig,setCopiedSig]=useState(""),[histOpen,setHistOpen]=useState(false),[histLoading,setHistLoading]=useState(false),[histItems,setHistItems]=useState<any[]>([]),[swapStatus,setSwapStatus]=useState(""),[xferStatus,setXferStatus]=useState("");
 const[wallets,setWallets]=useState<any[]>([]),[activeWallet,setActiveWallet]=useState<string|null>(null),[secretPopup,setSecretPopup]=useState<"phrase"|"key"|null>(null),[showSecret,setShowSecret]=useState(false);
 const[vaultPassword,setVaultPassword]=useState("");
 const[vaultExists,setVaultExists]=useState(false);
 const[vaultUnlocked,setVaultUnlocked]=useState(false);
 const[showVaultPassword,setShowVaultPassword]=useState(false);
 const[menuOpen,setMenuOpen]=useState(false);
const[view,setView]=useState<"home"|"send"|"receive"|"test"|"swap"|"faucet">("home");
const[recoveryOpen,setRecoveryOpen]=useState(false);

 async function initializeVault(){
  try{
   const stored=await vaultGet("wallets");
   setVaultExists(!!stored);
   setVaultUnlocked(false);
   setWallets([]);
   setActiveWallet(null);
  }catch(e){
   console.error("Vault initialization failed:",e);
  }
 }

 useEffect(()=>{
  initializeVault();
 },[]);
 useEffect(()=>{
  if(!kp)return;

  let cancelled=false;

  async function loadBalance(){
   setStatus(`Loading ${network==="devnet"?"DevNet":"Testnet"} balance…`);
   try{
    const b=await client.getBalance(kp.publicKey);

    if(!cancelled){
     setBal((Number(b)/KELVIN_PER_RLO).toFixed(6));loadTest(kp.publicKey);
     setStatus(`Balance loaded from ${network==="devnet"?"DevNet":"Testnet"}.`);
    }
   }catch(e:any){
    if(!cancelled){
     setTestBal(null);setStatus(`Balance error: ${e?.message||e}`);
    }
   }
  }

  loadBalance();

  return()=>{cancelled=true;};
 },[network,kp,client]);


 const[to,setTo]=useState(""),[amount,setAmount]=useState(""),[status,setStatus]=useState("Create a wallet to begin.");
 const[busy,setBusy]=useState(false),[show,setShow]=useState(false),[importing,setImporting]=useState(false),[addWalletOpen,setAddWalletOpen]=useState(false),[imp,setImp]=useState("");
 const[importMode,setImportMode]=useState<"phrase"|"key">("phrase"),[keyOpen,setKeyOpen]=useState(false),[showKey,setShowKey]=useState(false);
 useEffect(()=>{setKeyOpen(false);setShowKey(false)},[addr]);

 useEffect(()=>()=>{try{kp?.dispose?.()}catch{}},[kp]);

 function passwordStrength(password:string){
  if(password.length<8)return "Weak";
  const hasLetter=/[A-Za-z]/.test(password);
  const hasNumber=/[0-9]/.test(password);
  if(hasLetter&&hasNumber&&password.length>=12)return "Strong";
  if(hasLetter&&hasNumber)return "Medium";
  return "Weak";
 }

 function isValidVaultPassword(password:string){
  return password.length>=8 &&
    /[A-Za-z]/.test(password) &&
    /[0-9]/.test(password);
 }

 async function createVault(){
  const password=vaultPassword;

  if(!isValidVaultPassword(password)){
   setStatus("Password must be at least 8 characters and contain both letters and numbers.");
   return;
  }

  try{
   const encrypted=await encryptVault(
    JSON.stringify({wallets:[],activeWallet:null}),
    password
   );

   await vaultSet("wallets",encrypted);
   setVaultExists(true);
   setVaultPassword("");
   setVaultUnlocked(false);
   setWallets([]);
   setActiveWallet(null);
   setStatus("Vault created successfully. Unlock your vault to continue.");
  }catch(e:any){
   setStatus("Vault error: "+(e?.message||e));
  }
 }

 async function refresh(pub=kp?.publicKey){if(!pub)return;try{const b=await client.getBalance(pub);setBal((Number(b)/KELVIN_PER_RLO).toFixed(6))}catch(e:any){setStatus("Balance error: "+(e?.message||e))}}
 async function doSwap(){
 if(!kp)return;
 const n=parseFloat(swapAmt);
 if(!(n>0)){setStatus("Enter a valid swap amount.");return}
 
 setBusy(true);
 try{
 const P=(s:string)=>PublicKey.fromString(s);
 const SYS:any=typeof SYSTEM_PROGRAM_ID==="string"?P(SYSTEM_PROGRAM_ID):SYSTEM_PROGRAM_ID;
 const t2r=swapDir==="test2rialo";
 const data=new Uint8Array(9);
 data[0]=t2r?0:1;
 new DataView(data.buffer).setBigUint64(1,BigInt(Math.round(n*(t2r?1e6:1e9))),true);
 const A=(k:any,w:boolean,s=false)=>({pubkey:k,isSigner:s,isWritable:w});
 const ix:any={programId:P("3kYVsj8TMon5oTaS2udeuc9NfXdAVZmgUSKdpwSN4jUG"),data,accounts:[
 A(kp.publicKey,true,true),
 A(ataOf(kp.publicKey),true),
 A(P("EB8MZ8usqZSjh6TNJwEEnEurH4ojFXnNTzrAaZPDuG9b"),true),
 A(P("BV7xahNAH9vnwE3bNzNf1iHpuokk8cdj8iMoka7DnM1M"),false),
 A(P("CvbVJTpgDixPoCPVNBbbKdjcSo4awnC6rMCpQSBzACY4"),true),
 A(P("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),false),
 A(SYS,false)]};
const mkAta:any={programId:ATAP,data:new Uint8Array([1]),accounts:[A(kp.publicKey,true,true),A(ataOf(kp.publicKey),true),A(kp.publicKey,false),A(TMINT,false),A(SYS,false),A(TK22,false)]};
 const prefix=await client.getConfigHashPrefix();
 const tx=TransactionBuilder.create().setPayer(kp.publicKey).setValidFrom(BigInt(Date.now())).setConfigHashPrefix(prefix).addInstruction(mkAta).addInstruction(ix).build();
 setSwapStatus("Signing and submitting swap…");
 const res:any=await client.sendAndConfirmTransaction(tx.sign(kp).serialize());
 if(res.executed===true&&!res.err){setSwapAmt("");await refresh(kp.publicKey);await loadTest(kp.publicKey);await loadLiq();await loadHistory();setSwapStatus("")}else{setSwapStatus("Swap failed on-chain.")}
 }catch(e:any){setSwapStatus("Swap error: "+(e?.message||e))}finally{setBusy(false)}
 }
 function swapPct(p:number){
 const t2r=swapDir==="test2rialo";
 const b=t2r?parseFloat((testBal||"0").replace(/,/g,"")):Math.max(0,parseFloat(bal||"0")-0.01);
 setSwapAmt(String(+(b*p/100).toFixed(t2r?6:9)));
 }
 async function loadLiq(){
 try{
 const P=(s:string)=>PublicKey.fromString(s);
 const t:any=await client.getTokenAccountBalance(P("EB8MZ8usqZSjh6TNJwEEnEurH4ojFXnNTzrAaZPDuG9b"));
 const r:any=await client.getBalance(P("CvbVJTpgDixPoCPVNBbbKdjcSo4awnC6rMCpQSBzACY4"));
 setLiq({test:parseFloat(t.uiAmountString),rialo:Number(r)/KELVIN_PER_RLO});
 }catch(e:any){setLiq(null)}
 }
 function askSwap(){
 const n=parseFloat(swapAmt);
 if(!(n>0)){setStatus("Enter a valid swap amount.");return}
 const t2r=swapDir==="test2rialo";
 const get=+(n*(t2r?0.1:10)).toFixed(6);
 const rows=[["You pay",n+" "+(t2r?"TEST":"RIALO")],["You receive (est.)",get+" "+(t2r?"RIALO":"TEST")]];
 rows.push(["Rate",t2r?"1 TEST = 0.1 RIALO":"1 RIALO = 10 TEST"],["Network fee","~0.000005 RIALO"]);
 setConfirmBox({title:"Confirm Swap",rows,run:doSwap});
 }
 function askSend(){
 try{
 const d=PublicKey.fromString(to.trim());
 const n=Number(amount);
 if(!Number.isFinite(n)||n<=0)throw Error("Enter a valid amount.");
 setConfirmBox({title:"Confirm Transfer",rows:[["To",d.toString()],["Amount",n+" "+xferToken],["Network fee","~0.000005 RIALO"]],run:send});
 }catch(e:any){setXferStatus("Send failed: "+(e?.message||e))}
 }
 function copySig(sig:string){
  const done=()=>{setCopiedSig(sig);setTimeout(()=>setCopiedSig(""),1200)};
  if(navigator.clipboard?.writeText){
   navigator.clipboard.writeText(sig).then(done).catch(()=>{
    const ta=document.createElement("textarea");
    ta.value=sig;ta.style.position="fixed";ta.style.opacity="0";
    document.body.appendChild(ta);ta.focus();ta.select();
    try{document.execCommand("copy");done()}catch(e){}
    document.body.removeChild(ta);
   });
  }else{
   const ta=document.createElement("textarea");
   ta.value=sig;ta.style.position="fixed";ta.style.opacity="0";
   document.body.appendChild(ta);ta.focus();ta.select();
   try{document.execCommand("copy");done()}catch(e){}
   document.body.removeChild(ta);
  }
 }
 async function loadHistory(pub=kp?.publicKey){
 if(!pub)return;
 setHistLoading(true);
 try{
 const sigs:any[]=await client.getSignaturesForAddress(pub,{limit:10});
 const out=[];
 for(const s of sigs){
 let kind="Other",ok=!s.err;
 try{
 const tx:any=await (client as any).queryClient.call("getTransaction",[{signature:s.signature}]);
 const logs:string[]=tx?.meta?.logMessages||[];
 ok=!tx?.meta?.err;
 if(logs.some(l=>l.includes("3kYVsj8TMon5oTaS2udeuc9NfXdAVZmgUSKdpwSN4jUG")))kind="Swap";
 else if(logs.some(l=>l.includes("TransferChecked")))kind="Transfer TEST";
 else if(logs.length)kind="Transfer RIALO";
 }catch(e){}
 out.push({sig:s.signature,ok,kind,blockTime:s.blockTime?Number(s.blockTime):null});
 }
 setHistItems(out);
 }catch(e:any){setStatus("History error: "+(e?.message||e))}
 finally{setHistLoading(false)}
 }
 async function loadTest(pub=kp?.publicKey){
 if(!pub)return;
 try{
 const a:any=await client.getAccountInfo(ataOf(pub));
 if(!a){setTestBal("0");return}
 const u=Uint8Array.from(atob(a.data[0]),c=>c.charCodeAt(0));
 setTestBal((Number(new DataView(u.buffer).getBigUint64(64,true))/1e6).toLocaleString("en-US",{maximumFractionDigits:6}));
 }catch(e:any){setTestBal("0")}
 }
 async function loadTestOld(pub=kp?.publicKey){
 if(!pub)return;
 try{
 const a:any=await client.getAccountInfo(PublicKey.fromString("Hp3itcS1yLWvCeMMxVt833iDSxC4kXegAYC4AN6R4cgg"));
 const u=Uint8Array.from(atob(a.data[0]),c=>c.charCodeAt(0));
 const dv=new DataView(u.buffer);
 const same=new PublicKey(u.slice(32,64)).toString()===pub.toString();
 setTestBal(same?(Number(dv.getBigUint64(64,true))/1e6).toLocaleString("en-US",{maximumFractionDigits:6}):null);
 }catch(e:any){setTestBal(null)}
 }

 async function create(){
  if(!vaultPassword){
   setStatus("Vault belum terbuka.");
   return;
  }

  setBusy(true);
  setStatus("Generating wallet…");

  try{
   const m=Mnemonic.generate();
   const k=await m.toKeypair(0);

   const wallet={
    id:crypto.randomUUID(),
    name:"Main Wallet",
    phrase:m.toString(),
    address:k.publicKey.toString()
   };

   const current=await vaultGet("wallets");
   let data={wallets:[],activeWallet:null};

   if(current){
    try{
     data=JSON.parse(await decryptVault(current,vaultPassword));
    }catch{
     throw Error("Unable to unlock wallet vault.");
    }
   }

   data.wallets=[...(data.wallets||[]),wallet];
   data.activeWallet=wallet.id;

   const encrypted=await encryptVault(
    JSON.stringify(data),
    vaultPassword
   );

   await vaultSet("wallets",encrypted);

   setWallets(data.wallets);
   setActiveWallet(wallet.id);
   setPhrase(wallet.phrase||"");
   setKp(k);
   setAddr(wallet.address);
   setShow(false);
   setStatus("Wallet created and securely stored.");
   await refresh(k.publicKey);
  }catch(e:any){
   setStatus("Error: "+(e?.message||e));
  }finally{
   setBusy(false);
  }
 }

 async function addWallet(){
  if(!vaultPassword){
    setStatus("Vault is locked.");
    return;
  }

  setBusy(true);
  setStatus("Creating new wallet...");

  try{
    const m=Mnemonic.generate();
    const k=await m.toKeypair(0);

    const wallet={
      id:crypto.randomUUID(),
      name:`Wallet ${wallets.length+1}`,
      phrase:m.toString(),
      address:k.publicKey.toString()
    };

    const current=await vaultGet("wallets");
    const data=JSON.parse(await decryptVault(current,vaultPassword));

    data.wallets=[...(data.wallets||[]),wallet];
    data.activeWallet=wallet.id;

    const encrypted=await encryptVault(
      JSON.stringify(data),
      vaultPassword
    );

    await vaultSet("wallets",encrypted);

    setWallets(data.wallets);
    setActiveWallet(wallet.id);
    setPhrase(wallet.phrase||"");
    setKp(k);
    setAddr(wallet.address);
    setShow(false);
    setStatus("New wallet created.");
    await refresh(k.publicKey);
  }catch(e:any){
    setStatus("Error: "+(e?.message||e));
  }finally{
    setBusy(false);
  }
 }

 async function restoreKey(){
  setBusy(true);
  setStatus("Importing private key…");
  try{
    if(!vaultPassword)throw Error("Vault is locked.");
    const c=imp.trim().replace(/^0x/i,"").toLowerCase();
    const k=Keypair.fromSecretKey(hexToBytes(c));
    const address=k.publicKey.toString();
    const current=await vaultGet("wallets");
    if(!current)throw Error("Wallet vault not found.");
    const data=JSON.parse(await decryptVault(current,vaultPassword));
    const existing=data.wallets||[];
    if(existing.some((w:any)=>w.address===address))throw Error("Wallet ini sudah ada di vault.");
    const wallet={id:crypto.randomUUID(),name:"Wallet "+(existing.length+1),type:"privateKey",secret:c,address};
    data.wallets=[...existing,wallet];
    data.activeWallet=wallet.id;
    await vaultSet("wallets",await encryptVault(JSON.stringify(data),vaultPassword));
    setWallets(data.wallets);
    setActiveWallet(wallet.id);
    setPhrase("");
    setKp(k);
    setAddr(address);
    setImporting(false);
    setImp("");
    setStatus("Private key imported and securely stored.");
    await refresh(k.publicKey);
  }catch(e:any){
    setStatus("Error: "+(e?.message||e));
  }finally{
    setBusy(false);
  }
}
function copyKey(){
  if(!kp)return;
  navigator.clipboard?.writeText(bytesToHex(kp.secretKeyBytes()));
  setStatus("Private key copied. Store it offline and never share it.");
}

 async function restore(){
  setBusy(true);
  setStatus("Restoring wallet…");

  try{
    const p=imp.trim().replace(/\s+/g," ");

    if(!Mnemonic.isValid(p)){
      throw Error("Invalid mnemonic.");
    }

    if(!vaultPassword){
      throw Error("Vault is locked.");
    }

    const m=Mnemonic.fromPhrase(p);
    const k=await m.toKeypair(0);

    const current=await vaultGet("wallets");
    if(!current){
      throw Error("Wallet vault not found.");
    }

    const data=JSON.parse(
      await decryptVault(current,vaultPassword)
    );

    const existing=data.wallets||[];

    const wallet={
      id:crypto.randomUUID(),
      name:`Wallet ${existing.length+1}`,
      phrase:p,
      address:k.publicKey.toString()
    };

    data.wallets=[...existing,wallet];
    data.activeWallet=wallet.id;

    await vaultSet(
      "wallets",
      await encryptVault(
        JSON.stringify(data),
        vaultPassword
      )
    );

    setWallets(data.wallets);
    setActiveWallet(wallet.id);
    setPhrase(wallet.phrase||"");
    setKp(k);
    setAddr(wallet.address);
    setImporting(false);
    setImp("");
    setStatus("Wallet imported and securely stored.");
    await refresh(k.publicKey);

  }catch(e:any){
    setStatus("Error: "+(e?.message||e));
  }finally{
    setBusy(false);
  }
 }

 async function faucet(){
  if(!kp)return;

  const publicKey=kp.publicKey;
  setBusy(true);
  setStatus(`Requesting 1 Rialo from ${network==="devnet"?"DevNet":"Testnet"}…`);

  try{
    const sig=await client.requestAirdrop(
      publicKey,
      BigInt(KELVIN_PER_RLO)
    );

    setStatus(`Faucet requested on ${network==="devnet"?"DevNet":"Testnet"}: ${sig.toString()}`);
    for(let i=0;i<6;i++){
      await new Promise(r=>setTimeout(r,2000));
      await refresh(publicKey);
    }
    await refresh(publicKey);
    await loadTest(publicKey);
    await loadHistory(publicKey);
    setStatus("");
  }catch(e:any){
    console.error("Faucet error:",e);
    setStatus(`Faucet failed on ${network==="devnet"?"DevNet":"Testnet"}: ${e?.message||String(e)}`);
  }finally{
    setBusy(false);
  }
}

async function send(){
  if(!kp)return;setBusy(true);setXferStatus("Building transaction…");
  try{
   const dest=PublicKey.fromString(to.trim()),n=Number(amount);
   if(!Number.isFinite(n)||n<=0)throw Error("Enter a valid amount.");
   const prefix=await client.getConfigHashPrefix();
   const ixs:any[]=xferToken==="TEST"?testXfer(kp.publicKey,dest,n):[transferInstruction(kp.publicKey,dest,BigInt(Math.round(n*KELVIN_PER_RLO)))];
   let tb:any=TransactionBuilder.create().setPayer(kp.publicKey).setValidFrom(BigInt(Date.now())).setConfigHashPrefix(prefix);
   for(const i of ixs)tb=tb.addInstruction(i);
   const tx=tb.build();
   setXferStatus("Signing and submitting…");const sig=await client.sendAndConfirmTransaction(tx.sign(kp).serialize());
   const r:any=sig;if(!(r.executed===true&&!r.err))throw Error("Transfer failed on-chain.");setXferStatus("Sent: "+(sig.signature?.toString?.()||sig.toString()));setAmount("");await refresh();await loadTest();await loadHistory()
  }catch(e:any){setStatus("Send failed: "+(e?.message||e))}finally{setBusy(false)}
 }
 async function deleteActiveWallet(){
  const wallet=wallets.find((w:any)=>w.id===activeWallet);
  if(!wallet)return;

  const confirmed=window.confirm(
    `Are you sure you want to delete "${wallet.name}"?\\n\\nThis wallet will be removed from this vault. Make sure you have backed up its recovery phrase.`
  );

  if(!confirmed)return;

  try{
    const remaining=wallets.filter((w:any)=>w.id!==activeWallet);

    const current=await vaultGet("wallets");
    const data=JSON.parse(await decryptVault(current,vaultPassword));

    data.wallets=remaining;

    const next=remaining[0]||null;
    data.activeWallet=next?.id||null;

    await vaultSet(
      "wallets",
      await encryptVault(JSON.stringify(data),vaultPassword)
    );

    try{kp?.dispose?.()}catch{}

    setWallets(remaining);
    setActiveWallet(next?.id||null);

    if(next){
      const k=await walletToKeypair(next);

      setPhrase(next.phrase||"");
      setKp(k);
      setAddr(next.address);
      setShow(false);
      setStatus(`Deleted ${wallet.name}. Switched to ${next.name}.`);
      await refresh(k.publicKey);
    }else{
      setKp(null);
      setPhrase("");
      setAddr("");
      setBal("0");
      setShow(false);
      setStatus(`Deleted ${wallet.name}. You can create or import a new wallet.`);
    }
  }catch(e:any){
    setStatus("Delete error: "+(e?.message||e));
  }
}
 async function resetVault(){
  const confirmed=window.confirm(
    "Forgot your password?\n\nResetting the vault will permanently delete all wallets stored on this device. Make sure you have your recovery phrase before continuing."
  );

  if(!confirmed)return;

  try{
    await new Promise<void>((resolve,reject)=>{
      const req=indexedDB.deleteDatabase("rlo-wallet-vault");
      req.onsuccess=()=>resolve();
      req.onerror=()=>reject(req.error);
      req.onblocked=()=>reject(new Error("Vault is still in use."));
    });

    setVaultExists(false);
    setVaultUnlocked(false);
    setVaultPassword("");
    setWallets([]);
    setActiveWallet(null);
    setKp(null);
    setPhrase("");
    setAddr("");
    setBal("0");
    setStatus("Vault reset. You can create a new vault.");
  }catch(e:any){
    setStatus("Reset failed: "+(e?.message||e));
  }
}

function copy(){
  navigator.clipboard?.writeText(phrase);
  setStatus("Recovery phrase copied. Store it offline and never share it.");
}

function copyAddress(){
  if(!addr)return;
  navigator.clipboard?.writeText(addr);
  setStatus("Wallet address copied.");
}

 return <>
  <header>
  <b className="rialo-brand">RIALO Wallet</b>
  <div className="header-actions">
    <select
      className="network-select"
      value={network}
      onChange={e=>{
        const next=e.target.value as "testnet"|"devnet";
        setNetwork(next);
        setBal(null);
        if(next==="devnet" && view==="swap") setView("home");
        setStatus(`Switched to ${next==="devnet"?"DevNet":"Testnet"}.`);
      }}
      aria-label="Network"
    >
      <option value="testnet">Testnet</option>
      <option value="devnet">DevNet</option>
    </select>

    <button
      className="ghost menu-button"
      onClick={()=>setMenuOpen(!menuOpen)}
      aria-label="Open menu"
    >
      ☰
    </button>
  </div>
</header>

<main
  onClick={e=>{
    if(menuOpen && !(e.target as HTMLElement).closest(".wallet-menu")){
      setMenuOpen(false);
    }
  }}
>

  {menuOpen&&(
    <section className="card wallet-menu"
      onTouchStart={e=>{
        e.currentTarget.dataset.swipeX=String(e.touches[0].clientX);
      }}
      onTouchEnd={e=>{
        const start=Number(e.currentTarget.dataset.swipeX||0);
        const end=e.changedTouches[0].clientX;
        if(start-end>60) setMenuOpen(false);
      }}>
      <div className="wallet-menu-header">
        <small>MENU</small>
        <button
          className="ghost menu-close"
          onClick={()=>setMenuOpen(false)}
          aria-label="Close menu"
        >
          ×
        </button>
      </div>

      <div className="wallet-nav">
        <button
          className={view==="home"?"wallet-nav-active":""}
          onClick={()=>{setView("home");setMenuOpen(false);}}
        >
          <span>Wallet</span>
          <span>›</span>
        </button>

        <button
          onClick={async()=>{
            setMenuOpen(false);
            setView("swap");
            await loadLiq();
          }}
        >
          <span>Swap</span>
          <span>›</span>
        </button>

        <button
          onClick={()=>{
            setMenuOpen(false);
            setView("faucet");
          }}
        >
          <span>Faucet</span>
          <span>›</span>
        </button>

        <button
          onClick={async()=>{
            setMenuOpen(false);
            setView("home");
            setHistOpen(true);
            if(kp) await loadHistory(kp.publicKey);
          }}
        >
          <span>History</span>
          <span>›</span>
        </button>

        <button
          className={view==="settings"?"wallet-nav-active":""}
          onClick={()=>{setView("settings");setMenuOpen(false);}}
        >
          <span>Settings</span>
          <span>›</span>
        </button>
      </div>
    </section>
  )}

  
  {!vaultExists?<section className="card center"><div className="logo">◎</div><h2>Create Your Vault</h2><p>Your wallet data will be encrypted and stored securely on this device.</p><div className="password-box"><input type={showVaultPassword?"text":"password"} placeholder="Create vault password" value={vaultPassword} onChange={e=>setVaultPassword(e.target.value)}/><button type="button" className="ghost" onClick={()=>setShowVaultPassword(!showVaultPassword)}>{showVaultPassword?"Hide":"Show"}</button></div><small>Use at least 8 characters with both letters and numbers.</small>{vaultPassword&&<div className="password-strength"><span>Password strength:</span><strong>{passwordStrength(vaultPassword)}</strong></div>}<button disabled={busy||!isValidVaultPassword(vaultPassword)} onClick={createVault}>{busy?"Creating...":"Create Vault"}</button></section>:
  !vaultUnlocked?<section className="card center"><div className="logo">◎</div><h2>Unlock Your Vault</h2><p>Your wallets are stored in an encrypted vault on this device.</p><div className="password-box"><input type={showVaultPassword?"text":"password"} placeholder="Vault password" value={vaultPassword} onChange={e=>setVaultPassword(e.target.value)}/><button type="button" className="ghost" onClick={()=>setShowVaultPassword(!showVaultPassword)}>{showVaultPassword?"Hide":"Show"}</button></div><button disabled={!vaultPassword} onClick={async()=>{try{const data=await vaultGet("wallets");const plain=await decryptVault(data,vaultPassword);const parsed=JSON.parse(plain);
const list=parsed.wallets||[];
const activeId=parsed.activeWallet||null;
const active=list.find((w:any)=>w.id===activeId)||list[0]||null;

setWallets(list);
setActiveWallet(active?.id||null);

if(active){
  const k=await walletToKeypair(active);
  setPhrase(active.phrase||"");
  setKp(k);
  setAddr(k.publicKey.toString());
  setStatus("Vault unlocked.");
  await refresh(k.publicKey);
}else{
  setStatus("Vault unlocked. Create or import a wallet to continue.");
}

setVaultUnlocked(true);}catch{setStatus("Incorrect password. Please try again.");}}}>Unlock Vault</button><button type="button" className="forgot-password" onClick={resetVault}>Forgot Password?</button>{status==="Incorrect password. Please try again."&&<p className="unlock-error">Incorrect password. Please try again.</p>}</section>:
  !kp?<section className="card center"><div className="logo">◎</div><h2>Rialo Wallet</h2><p>Your vault is unlocked. Create or import a wallet to continue.</p><button disabled={busy} onClick={create}>{busy?"Creating...":"Create Wallet"}</button><button className="ghost" onClick={()=>{setImportMode("phrase");setImp("");setImporting(importMode!=="phrase"||!importing)}}>Import Mnemonic</button><button className="ghost" onClick={()=>{setImportMode("key");setImp("");setImporting(importMode!=="key"||!importing)}}>Import Private Key</button>{importing&&<div style={{marginTop:"14px"}}>
<textarea value={imp} onChange={e=>setImp(e.target.value)} placeholder={importMode==="key"?"64-character hex private key":"Enter your recovery phrase"} autoCapitalize="off" autoCorrect="off" spellCheck={false} rows={4} style={{width:"100%"}}/>
<button disabled={busy||!imp.trim()} onClick={importMode==="key"?restoreKey:restore}>{busy?"Importing...":"Import Wallet"}</button>
</div>}<div className="status">{status}</div></section>:
  <>
   {view==="home"&&<>
   <section className="card wallet-manager">
    <button
      className="main-wallet-header"
      type="button"
      disabled={busy}
      onClick={()=>setAddWalletOpen(!addWalletOpen)}
    >
      <div>
        <small>WALLET</small>
        <h2>Main Wallet</h2>
      </div>
      <span className="main-wallet-arrow">{addWalletOpen?"⌄":"›"}</span>
    </button>

    {!addWalletOpen&&<div className="main-wallet-address">
      <code>{short(addr)}</code>
      <button
        className="copy-address"
        disabled={busy||!addr}
        onClick={(e)=>{e.stopPropagation();copyAddress()}}
        title="Copy wallet address"
        aria-label="Copy wallet address"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="11" height="11" rx="2"/>
          <path d="M5 15H4a2 2 0 0 1 2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </button>
    </div>}

    {importing&&<div className="card" style={{marginTop:"14px"}}>
      <div>
        <small>IMPORT</small>
        <h3>{importMode==="key"?"Import Private Key":"Import Recovery Phrase"}</h3>
        <p style={{margin:"6px 0 14px",fontSize:"13px",color:"#777773"}}>
          {importMode==="key"?"Enter your 64-character hex private key.":"Restore an existing Rialo wallet using its recovery phrase."}
        </p>
      </div>

      <textarea
        value={imp}
        onChange={e=>setImp(e.target.value)}
        placeholder={importMode==="key"?"64-character hex private key":"Enter your recovery phrase"} autoCapitalize="off" autoCorrect="off" spellCheck={false}
        rows={4}
        style={{width:"100%",resize:"vertical"}}
      />

      <div className="row" style={{marginTop:"10px",justifyContent:"flex-end"}}>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={()=>{
            setImporting(false);
            setImp("");
          }}
        >
          Cancel
        </button>

        <button
          type="button"
          disabled={busy||!imp.trim()}
          onClick={importMode==="key"?restoreKey:restore}
        >
          {busy?"Importing...":"Import Wallet"}
        </button>
      </div>
    </div>}

    {addWalletOpen&&<div className="wallet-picker">
      <small>WALLETS</small>

      <div className="wallet-list">
        {wallets.map((w:any)=>(
          <button
            key={w.id}
            type="button"
            className={w.id===activeWallet?"wallet-option wallet-option-active":"wallet-option"}
            disabled={busy}
            onClick={async()=>{
              if(w.id===activeWallet){
                setAddWalletOpen(false);
                return;
              }

              try{
                const k=await walletToKeypair(w);
                const current=await vaultGet("wallets");
                const data=JSON.parse(await decryptVault(current,vaultPassword));
                data.activeWallet=w.id;

                await vaultSet(
                  "wallets",
                  await encryptVault(JSON.stringify(data),vaultPassword)
                );

                setActiveWallet(w.id);
                setPhrase(w.phrase||"");
                setKp(k);
                setAddr(w.address);
                setShow(false);
                setAddWalletOpen(false);
                setStatus(`Switched to ${w.name}.`);
                await refresh(k.publicKey);
                await loadTest(k.publicKey);
                if(swapOpen)await loadLiq();
                if(histOpen)await loadHistory(k.publicKey);
              }catch(e:any){
                setStatus("Error: "+(e?.message||e));
              }
            }}
          >
            <span className="wallet-option-info">
              <span className="wallet-name-line">
                <strong>{w.name}</strong>
                <button
                  type="button"
                  className="wallet-edit-name"
                  disabled={busy}
                  onClick={(e)=>{
                    e.stopPropagation();
                    const name=window.prompt("Wallet name",w.name);
                    if(!name?.trim()||name.trim()===w.name)return;

                    (async()=>{
                      try{
                        const current=await vaultGet("wallets");
                        const data=JSON.parse(await decryptVault(current,vaultPassword));
                        const target=data.wallets?.find((x:any)=>x.id===w.id);
                        if(!target)return;

                        target.name=name.trim();

                        await vaultSet(
                          "wallets",
                          await encryptVault(JSON.stringify(data),vaultPassword)
                        );

                        setWallets(data.wallets);
                        setStatus("Wallet name updated.");
                      }catch(e:any){
                        setStatus("Error: "+(e?.message||e));
                      }
                    })();
                  }}
                  aria-label="Edit wallet name"
                >
                  ✎
                </button>
              </span>
              <small>{short(w.address)}</small>
            </span>
            <span>{w.id===activeWallet?"✓":"›"}</span>
          </button>
        ))}
      </div>

      {addWalletOpen&&<div className="add-wallet-options">
        <button
          type="button"
          disabled={busy}
          onClick={()=>{
            setAddWalletOpen(false);
            addWallet();
          }}
        >
          Create New Wallet
        </button>

        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={()=>{
            setImportMode("phrase");
            setImp("");
            setAddWalletOpen(false);
            setImporting(true);
          }}
        >
          Import Recovery Phrase
        </button>

        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={()=>{
            setImportMode("key");
            setImp("");
            setAddWalletOpen(false);
            setImporting(true);
          }}
        >
          Import Private Key
        </button>
      </div>}
    </div>}
   </section>

    <section className="grid">
      <div className="card balance-card">

        <small className="balance-label">BALANCE</small>

        <div className="balance" style={{marginTop:"10px"}}>
          {bal ?? "—"}<em> RIALO</em>
        </div>

    

        <div className="wallet-actions wallet-actions-modern">
          <button
            disabled={busy}
            onClick={()=>{setXferToken("RIALO");setView("send")}}
          >
            <span className="action-icon action-icon-send">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14"/>
                <path d="m13 6 6 6-6 6"/>
              </svg>
            </span>
            <small>SEND</small>
          </button>

          <button
            disabled={busy||!addr}
            onClick={()=>{setXferToken("RIALO");setView("receive")}}
          >
            <span className="action-icon action-icon-receive">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v13"/>
                <path d="m6 10 6 6 6-6"/>
              </svg>
            </span>
            <small>RECEIVE</small>
          </button>
        </div>
      </div>
    </section>

    <section className="assets-section">
      <div className="section-title">ASSETS</div>

      {network!=="devnet"&&testBal!==null&&
        <div
          className="test-asset-row"
          onClick={()=>setView("test")}
        >
          <div>
            <div className="asset-name">TEST</div>
            <div className="asset-symbol">Test Token</div>
          </div>
          <div className="asset-value">{testBal}</div>
        </div>
      }
    </section>

    <section
      className="activity-section"
      onClick={async()=>{
        const o=!histOpen;
        setHistOpen(o);
        if(o&&kp) await loadHistory(kp.publicKey);
      }}
    >
      <div className="section-title activity-title">
        <span>ACTIVITY</span>
        <span>{histOpen?"▴":"›"}</span>
      </div>

      {histOpen&&
        <div className="activity-list">
          {histLoading&&<small>Loading…</small>}

          {!histLoading&&histItems.length===0&&
            <small>No transactions yet.</small>
          }

          {histItems.map((h:any,i:number)=>
            <div
              key={i}
              className="activity-row"
              onClick={e=>e.stopPropagation()}
            >
              <div>
                <div style={{fontWeight:650}}>
                  {h.kind}
                  {!h.ok&&<span style={{color:"#c0392b"}}> · Failed</span>}
                </div>
                <small>{h.blockTime?new Date(h.blockTime).toLocaleString():"—"}</small>
              </div>

              <button
                type="button"
                className="ghost"
                onClick={(e)=>{e.stopPropagation();copySig(h.sig)}}
              >
                {copiedSig===h.sig?"Copied!":h.sig.slice(0,6)+"…"+h.sig.slice(-6)}
              </button>
            </div>
          )}
        </div>
      }
    </section>
   </>}

   {view==="settings"&&
    <section className="card page-card settings-page">
      <button className="ghost back-button" onClick={()=>setView("home")}>
        Back
      </button>

      <small>SETTINGS</small>
      <h2>Wallet Settings</h2>

      <div className="settings-group">
        <small>SECURITY</small>

        <button
          className="settings-item"
          disabled={busy||!phrase}
          onClick={()=>{setSecretPopup("phrase");setShowSecret(false)}}
        >
          <span>Recovery Phrase</span>
          <span>›</span>
        </button>

        <button
          className="settings-item"
          disabled={busy||!kp}
          onClick={()=>{setSecretPopup("key");setShowSecret(false)}}
        >
          <span>Private Key</span>
          <span>›</span>
        </button>
      </div>

      {secretPopup&&
        <div
          style={{
            position:"fixed",
            inset:0,
            zIndex:1000,
            background:"rgba(0,0,0,.35)",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            padding:"20px"
          }}
          onClick={()=>setSecretPopup(null)}
        >
          <div
            className="card"
            style={{
              width:"100%",
              maxWidth:"420px",
              background:"#fff",
              padding:"22px",
              borderRadius:"18px",
              boxShadow:"0 20px 60px rgba(0,0,0,.18)"
            }}
            onClick={e=>e.stopPropagation()}
          >
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"18px"}}>
              <h3 style={{margin:0}}>
                {secretPopup==="phrase"?"Recovery Phrase":"Private Key"}
              </h3>
              <button
                type="button"
                className="ghost"
                onClick={()=>setSecretPopup(null)}
              >
                ×
              </button>
            </div>

            <div
              style={{
                padding:"14px",
                border:"1px solid #e5e5e0",
                borderRadius:"12px",
                background:"#fafaf8",
                wordBreak:"break-word",
                fontFamily:"monospace",
                fontSize:"13px",
                lineHeight:"1.6",
                minHeight:"54px"
              }}
            >
              {showSecret
                ? secretPopup==="phrase"
                  ? phrase
                  : (kp?.secretKey ? Array.from(kp.secretKey).map((b:any)=>b.toString(16).padStart(2,"0")).join("") : "")
                : "••••••••••••••••••••••••"}
            </div>

            <div style={{display:"flex",gap:"10px",marginTop:"16px"}}>
              <button
                type="button"
                className="ghost"
                onClick={()=>setShowSecret(!showSecret)}
              >
                {showSecret?"Hide":"Show"}
              </button>

              <button
                type="button"
                className="primary"
                onClick={async()=>{
                  try{
                    const value=secretPopup==="phrase"
                      ? phrase
                      : (kp?.secretKey ? Array.from(kp.secretKey).map((b:any)=>b.toString(16).padStart(2,"0")).join("") : "");
                    if(!value) throw new Error("Secret unavailable");
                    await navigator.clipboard.writeText(value);
                    setStatus(secretPopup==="phrase"?"Recovery phrase copied.":"Private key copied.");
                  }catch{
                    setStatus(secretPopup==="phrase"?"Unable to copy recovery phrase.":"Unable to copy private key.");
                  }
                }}
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      }

      <div className="settings-group">
        <small>WALLET</small>

        <button
          className="settings-item danger-setting"
          disabled={busy||!activeWallet}
          onClick={deleteActiveWallet}
        >
          <span>Delete Wallet</span>
          <span>›</span>
        </button>
      </div>
    </section>
   }

   {view==="send"&&
    <section className="card page-card">
      <button className="ghost back-button" onClick={()=>setView("home")}>
        Back
      </button>

      <small>SEND RIALO</small>
      <h2>Send RIALO</h2>
      <p>Transfer RIALO to another Rialo address.</p>

      <label>Recipient address</label>
      <input
        value={to}
        onChange={e=>setTo(e.target.value)}
        placeholder="Rialo address…"
      />

      <label>Amount</label>
      <div className="amount">
        <input
          type="number"
          min="0"
          step="0.000001"
          value={amount}
          onChange={e=>setAmount(e.target.value)}
          placeholder="0.0"
        />
        <b>RIALO</b>
        <button
          type="button"
          className="ghost max-button"
          disabled={busy||!bal}
          onClick={()=>{
  const b=parseFloat(String(bal||"0").replace(/,/g,""));
  const fee=0.000005;
  setAmount(String(Math.max(0,b-fee)));
}}
        >
          MAX
        </button>
      </div>

      <small>Available: {bal||"0"} RIALO</small>

      <button
        style={{width:"100%",marginTop:"18px"}}
        disabled={busy||!to||!amount}
        onClick={askSend}
      >
        {busy?"Processing…":"Send RIALO"}
      </button>

      {xferStatus&&<div className="status">{xferStatus}</div>}
    </section>
   }

   {view==="receive"&&
    <section className="card page-card">
      <button className="ghost back-button" onClick={()=>setView("home")}>
        Back
      </button>

      <small>RECEIVE {xferToken}</small>
      <h2>Receive {xferToken}</h2>
      <p>Share this address to receive {xferToken}.</p>

      <div className="receive-address">
        <code>{addr}</code>
        <button onClick={copyAddress}>
          COPY ADDRESS
        </button>
      </div>

      <div className="receive-placeholder">
        <div>◎</div>
        <small>QR CODE</small>
      </div>
    </section>
   }

   {view==="test"&&
    <section className="card page-card">
      <button className="ghost back-button" onClick={()=>setView("home")}>
        Back
      </button>

      <h2 style={{marginTop:"12px"}}>TEST</h2>

      <div className="asset-big-balance">
        {testBal||"0"} <em>TEST</em>
      </div>

      <small>Test Token</small>

      <div className="wallet-actions" style={{marginTop:"22px"}}>
        <button
          disabled={busy}
          onClick={()=>{
            setXferToken("TEST");
            setView("test");
            setSendOpen(true);
          }}
        >
          SEND
        </button>

        <button
          className="ghost"
          disabled={busy||!addr}
          onClick={()=>{setXferToken("TEST");setView("receive")}}
        >
          RECEIVE
        </button>
      </div>

      {sendOpen&&
        <div style={{marginTop:"24px"}}>
          <label>Recipient address</label>
          <input
            value={to}
            onChange={e=>setTo(e.target.value)}
            placeholder="Rialo address…"
          />

          <label>Amount</label>
          <div className="amount">
            <input
              type="number"
              min="0"
              step="0.000001"
              value={amount}
              onChange={e=>setAmount(e.target.value)}
              placeholder="0.0"
            />
            <b>TEST</b>
            <button
              type="button"
              className="ghost max-button"
              disabled={busy||!testBal}
              onClick={()=>setAmount(testBal||"0")}
            >
              MAX
            </button>
          </div>

          <small>Available: {testBal||"0"} TEST</small>

          <button
            style={{width:"100%",marginTop:"18px"}}
            disabled={busy||!to||!amount}
            onClick={askSend}
          >
            {busy?"Processing…":"Send TEST"}
          </button>

          {xferStatus&&<div className="status">{xferStatus}</div>}
        </div>
      }
    </section>
   }

   {view==="faucet"&&
    <section className="card faucet-page">
      <button className="ghost back-button" onClick={()=>setView("home")}>
        Back
      </button>

      <div className="faucet-page-content">
        
        <h2>RIALO Faucet</h2>
        <p>Get RIALO tokens for testing on Rialo Testnet.</p>

        <button
          className="primary faucet-claim-button"
          disabled={busy||!addr}
          onClick={faucet}
        >
          {busy?"Claiming…":"Claim Faucet"}
        </button>
      </div>
    </section>
   }

   {view==="swap"&&
    <section className="card page-card">
      <button className="ghost back-button" onClick={()=>setView("home")}>
        Back
      </button>

      <small>SWAP</small>
      
      

      {(()=>{
        const t2r=swapDir==="test2rialo";
        const tk=t2r?"TEST":"RIALO";
        const tk2=t2r?"RIALO":"TEST";
        const n=parseFloat(swapAmt);
        const have=parseFloat(
          (t2r?(testBal||"0"):(bal||"0")).replace(/,/g,"")
        );
        const get=n>0?+(n*(t2r?0.1:10)).toFixed(6):0;
        const poolOut=t2r?(liq?.rialo??Infinity):(liq?.test??Infinity);
        const noLiq=!!liq&&n>0&&get>poolOut;
        const label=!liq
          ?"Loading liquidity…"
          :!(n>0)
          ?"Enter an amount"
          :n>have
          ?"Insufficient "+tk
          :noLiq
          ?"Insufficient liquidity"
          :busy
          ?"Processing…"
          :"Swap";
        const off=busy||!liq||!(n>0)||n>have||noLiq;



  return <>
          <div className="swap-box">
            <div className="swap-box-top">
              <small>You pay</small>
              <small>Balance: {have}</small>
            </div>

            <div className="swap-input-row">
              <input
                value={swapAmt}
                onChange={e=>setSwapAmt(e.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
              <strong>{tk}</strong>
            </div>

            <div className="swap-percent">
              {[25,50,75,100].map(p=>
                <button
                  key={p}
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={()=>swapPct(p)}
                >
                  {p===100?"MAX":p+"%"}
                </button>
              )}
            </div>
          </div>

          <div className="swap-switch">
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={()=>{
                setSwapDir(t2r?"rialo2test":"test2rialo");
                setSwapAmt("");
              }}
            >
              ⇅
            </button>
          </div>

          <div className="swap-box">
            <small>You receive</small>
            <div className="swap-input-row">
              <span>{get||"0"}</span>
              <strong>{tk2}</strong>
            </div>
          </div>

          <div className="swap-info">
            <div><small>Rate</small><span>{t2r?"1 TEST = 0.1 RIALO":"1 RIALO = 10 TEST"}</span></div>
            <div><small>Slippage</small><span>0%</span></div>
            <div><small>Network fee</small><span>~0.000005 RIALO</span></div>
            <div>
              <small>Pool liquidity</small>
              <span>
                {liq
                  ? `${Number(liq.test).toLocaleString(undefined,{maximumFractionDigits:6})} TEST / ${Number(liq.rialo).toLocaleString(undefined,{maximumFractionDigits:6})} RIALO`
                  : "Loading…"}
              </span>
            </div>
          </div>

          <button
            style={{width:"100%",marginTop:"16px"}}
            disabled={off}
            onClick={askSwap}
          >
            {label}
          </button>

          {swapStatus&&<div className="status">{swapStatus}</div>}
        </>
      })()}
    </section>
   }

   <div className="status">{status}</div>


   </>}
  {confirmBox&&
    <div className="confirm-overlay">
      <div className="confirm-modal">

        <div className="confirm-kicker">CONFIRM</div>
        <h2>{confirmBox.title}</h2>

        <div className="confirm-rows">
          {confirmBox.rows?.map((r:any,i:number)=>
            <div className="confirm-row" key={i}>
              <small>{r[0]}</small>
              <span>{r[1]}</span>
            </div>
          )}
        </div>

        <div className="confirm-actions">
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={()=>setConfirmBox(null)}
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={async()=>{
              const run=confirmBox.run;
              setConfirmBox(null);
              await run();
            }}
          >
            {busy?"Processing…":"Confirm"}
          </button>
        </div>

      </div>
    </div>
  }

  <footer>Rialo Testnet ·</footer>
 </main>
</>
}
createRoot(document.getElementById("root")!).render(<App/>);
