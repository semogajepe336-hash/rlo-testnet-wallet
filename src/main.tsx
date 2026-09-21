import React,{useEffect,useMemo,useState}from"react";
import{createRoot}from"react-dom/client";
import{Keypair,Mnemonic,PublicKey,TransactionBuilder,transferInstruction,createRialoClient,getDefaultRialoClientConfig,KELVIN_PER_RLO,SYSTEM_PROGRAM_ID}from"@rialo/ts-cdk";
import"./styles.css";
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
 const[testBal,setTestBal]=useState<string|null>(null),[swapDir,setSwapDir]=useState<"test2rialo"|"rialo2test">("test2rialo"),[swapAmt,setSwapAmt]=useState(""),[swapOpen,setSwapOpen]=useState(false),[sendOpen,setSendOpen]=useState(false),[confirmBox,setConfirmBox]=useState<any>(null);
 const[wallets,setWallets]=useState<any[]>([]),[activeWallet,setActiveWallet]=useState<string|null>(null);
 const[vaultPassword,setVaultPassword]=useState("");
 const[vaultExists,setVaultExists]=useState(false);
 const[vaultUnlocked,setVaultUnlocked]=useState(false);
 const[showVaultPassword,setShowVaultPassword]=useState(false);
 const[menuOpen,setMenuOpen]=useState(false);
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
 if(kp.publicKey.toString()!=="Ec94FMM7w7XRj2xdRLsFgwJyyN5r2uwMepy2D5Y5qmHQ"){setStatus("Swap only works for the test wallet for now.");return}
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
 A(P("Hp3itcS1yLWvCeMMxVt833iDSxC4kXegAYC4AN6R4cgg"),true),
 A(P("EB8MZ8usqZSjh6TNJwEEnEurH4ojFXnNTzrAaZPDuG9b"),true),
 A(P("BV7xahNAH9vnwE3bNzNf1iHpuokk8cdj8iMoka7DnM1M"),false),
 A(P("CvbVJTpgDixPoCPVNBbbKdjcSo4awnC6rMCpQSBzACY4"),true),
 A(P("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),false),
 A(SYS,false)]};
 const prefix=await client.getConfigHashPrefix();
 const tx=TransactionBuilder.create().setPayer(kp.publicKey).setValidFrom(BigInt(Date.now())).setConfigHashPrefix(prefix).addInstruction(ix).build();
 setStatus("Signing and submitting swap…");
 const res:any=await client.sendAndConfirmTransaction(tx.sign(kp).serialize());
 if(res.executed===true&&!res.err){setStatus("Swap successful.");setSwapAmt("");await refresh(kp.publicKey);await loadTest(kp.publicKey)}else{setStatus("Swap failed on-chain.")}
 }catch(e:any){setStatus("Swap error: "+(e?.message||e))}finally{setBusy(false)}
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
 setConfirmBox({title:"Confirm Send",rows:[["To",d.toString()],["Amount",n+" RIALO"],["Network fee","~0.000005 RIALO"]],run:send});
 }catch(e:any){setStatus("Send failed: "+(e?.message||e))}
 }
 async function loadTest(pub=kp?.publicKey){
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
  }catch(e:any){
    console.error("Faucet error:",e);
    setStatus(`Faucet failed on ${network==="devnet"?"DevNet":"Testnet"}: ${e?.message||String(e)}`);
  }finally{
    setBusy(false);
  }
}

async function send(){
  if(!kp)return;setBusy(true);setStatus("Building transaction…");
  try{
   const dest=PublicKey.fromString(to.trim()),n=Number(amount);
   if(!Number.isFinite(n)||n<=0)throw Error("Enter a valid amount.");
   const prefix=await client.getConfigHashPrefix();
   const tx=TransactionBuilder.create().setPayer(kp.publicKey).setValidFrom(BigInt(Date.now())).setConfigHashPrefix(prefix)
    .addInstruction(transferInstruction(kp.publicKey,dest,BigInt(Math.round(n*KELVIN_PER_RLO)))).build();
   setStatus("Signing and submitting…");const sig=await client.sendAndConfirmTransaction(tx.sign(kp).serialize());
   setStatus("Sent: "+(sig.signature?.toString?.()||sig.toString()));setAmount("");await refresh()
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

 return <main>
  <header>
  <b>RIALO Wallet</b>
  <div className="header-actions">
    <select
      className="network-select"
      value={network}
      onChange={e=>{
        const next=e.target.value as "testnet"|"devnet";
        setNetwork(next);
        setBal(null);
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

  {menuOpen&&(
    <section className="card wallet-menu">
      <div className="wallet-menu-header">
        <small>WALLET MENU</small>
        <button
          className="ghost menu-close"
          onClick={()=>{
            setMenuOpen(false);
            setRecoveryOpen(false);
 setKeyOpen(false);
 setShowKey(false);
          }}
          aria-label="Close menu"
        >
          ×
        </button>
      </div>

      {keyOpen ? (
        <>
          <small style={{display:"block",marginTop:"14px"}}>PRIVATE KEY</small>
          <h2>Key Backup</h2>
          <p className="warning">Anyone with this key can control the wallet. Never share it.</p>
          <div className="phrase" style={{wordBreak:"break-all"}}>
            {showKey&&kp?bytesToHex(kp.secretKeyBytes()):"•••• •••• •••• •••• •••• •••• •••• ••••"}
          </div>
          <div className="row">
            <button className="ghost" onClick={()=>setShowKey(!showKey)}>{showKey?"Hide":"Show"}</button>
            <button onClick={copyKey}>Copy</button>
          </div>
          <button className="ghost" onClick={()=>{setKeyOpen(false);setShowKey(false)}} style={{marginTop:"10px",width:"100%"}}>Back</button>
        </>
      ) : !recoveryOpen ? (
<>
<button
          className="ghost"
          disabled={!phrase}
          onClick={()=>setRecoveryOpen(true)}
          style={{width:"100%",marginTop:"12px"}}
        >
          View Recovery Phrase
        </button>
<button className="ghost" disabled={!kp} onClick={()=>setKeyOpen(true)} style={{width:"100%",marginTop:"10px"}}>View Private Key</button>
</>
) : (
        <>
          <small style={{display:"block",marginTop:"14px"}}>RECOVERY PHRASE</small>
          <h2>Wallet Backup</h2>

          <p className="warning">
            Anyone with this phrase can control the wallet. Never share it.
          </p>

          <div className="phrase">
            {show
              ? phrase
              : "•••• •••• •••• •••• •••• •••• •••• •••• •••• •••• •••• ••••"}
          </div>

          <div className="row">
            <button
              className="ghost"
              disabled={!phrase}
              onClick={()=>setShow(!show)}
            >
              {show?"Hide":"Show"}
            </button>

            <button
              disabled={!phrase}
              onClick={copy}
            >
              Copy
            </button>
          </div>

          <button
            className="ghost"
            onClick={()=>setRecoveryOpen(false)}
            style={{marginTop:"10px",width:"100%"}}
          >
            Back
          </button>
        </>
      )}
    </section>
  )}

  <section className="hero"><small>RIALO TESTNET</small><h1>A simple wallet for the Rialo testnet.</h1><p>Create, manage, and send Rialo on-chain.</p></section>
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
   <section className="card wallet-manager">
    <div className="row" style={{justifyContent:"space-between",alignItems:"center"}}>
      <div>
        <small>WALLET</small>
        <h2>Wallet Manager</h2>
      </div>

      <button
        disabled={busy}
        onClick={()=>setAddWalletOpen(!addWalletOpen)}
      >
        + Add Wallet
      </button>
    </div>

    {addWalletOpen&&<div className="card" style={{marginTop:"14px"}}>
      <small>ADD WALLET</small>
      <h3>Choose an option</h3>

      <div className="row" style={{marginTop:"12px"}}>
        <button
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
          onClick={()=>{setImportMode("phrase");setImp("");setAddWalletOpen(false);setImporting(true);}}
        >
 Import Recovery Phrase
 </button>
 <button type="button" className="ghost" disabled={busy} onClick={()=>{setImportMode("key");setImp("");setAddWalletOpen(false);setImporting(true);}}>
 Import Private Key
 </button>
      </div>
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

    <div className="row" style={{marginTop:"14px",alignItems:"center"}}>
      <select
      value={activeWallet||""}
      disabled={busy}
      onChange={async e=>{
        const id=e.target.value;
        const w=wallets.find((x:any)=>x.id===id);
        if(!w)return;

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
          setStatus(`Switched to ${w.name}.`);
          await refresh(k.publicKey);
        }catch(e:any){
          setStatus("Error: "+(e?.message||e));
        }
      }}
      style={{flex:1}}
    >
        {wallets.map((w:any)=>(
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>


    </div>
   </section>

   <section className="grid">
    <div className="card">
      <small>BALANCE</small>
      <div className="balance">{bal}<em> Rialo</em></div>
      {network!=="devnet"&&testBal!==null&&<div className="balance">{testBal}<em> TEST</em></div>}
      <div className="address-row">
        <code>{short(addr)}</code>
        <button
          className="copy-address"
          disabled={busy||!addr}
          onClick={copyAddress}
          title="Copy wallet address"
          aria-label="Copy wallet address"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
      </div>
      <div className="row">
        <button disabled={busy} onClick={()=>refresh()}>Refresh</button>
        <button className="ghost" disabled={busy} onClick={faucet}>Claim Faucet</button>
      </div>
    </div>
   </section>

   {confirmBox&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:50,padding:"20px"}}>
<div className="card" style={{width:"100%",maxWidth:"420px",background:"#fafaf8"}}>
<h2 style={{marginTop:0}}>{confirmBox.title}</h2>
{confirmBox.rows.map((r:any,i:number)=><div key={i} className="row" style={{justifyContent:"space-between",margin:"10px 0",gap:"12px"}}><small>{r[0]}</small><strong style={{wordBreak:"break-all",textAlign:"right"}}>{r[1]}</strong></div>)}
<div className="row" style={{marginTop:"16px",justifyContent:"flex-end"}}>
<button type="button" className="ghost" onClick={()=>setConfirmBox(null)}>Cancel</button>
<button type="button" onClick={()=>{const r=confirmBox.run;setConfirmBox(null);r()}}>Confirm</button>
</div>
</div>
</div>}
{network!=="devnet"&&<section className="card swap" style={{marginTop:"14px"}}>
<div onClick={()=>setSwapOpen(!swapOpen)} style={{cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div><small>SWAP</small><h2 style={{margin:0}}>Swap TEST ⇄ RIALO</h2></div>
<span style={{fontSize:"22px"}}>{swapOpen?"▴":"▾"}</span>
</div>
{swapOpen&&<div>
<div className="card" style={{marginTop:"12px"}}>
<div className="row" style={{justifyContent:"space-between",alignItems:"center"}}>
<strong>{swapDir==="test2rialo"?"TEST":"RIALO"}</strong>
<button type="button" className="ghost" disabled={busy} onClick={()=>{const b=swapDir==="test2rialo"?parseFloat((testBal||"0").replace(/,/g,"")):Math.max(0,parseFloat(bal||"0")-0.001);setSwapAmt(String(b))}}>Max</button>
</div>
<small>Balance: {swapDir==="test2rialo"?(testBal||"0"):(bal||"0")}</small>
<input value={swapAmt} onChange={e=>setSwapAmt(e.target.value)} inputMode="decimal" placeholder="0" style={{width:"100%",fontSize:"36px",fontWeight:700,border:"none",background:"transparent",marginTop:"8px"}}/>
</div>
<div style={{display:"flex",justifyContent:"center",margin:"-10px 0"}}><button type="button" className="ghost" disabled={busy} style={{borderRadius:"50%",width:"44px",height:"44px",padding:0}} onClick={()=>{setSwapDir(swapDir==="test2rialo"?"rialo2test":"test2rialo");setSwapAmt("")}}>⇅</button></div>
<div className="card">
<strong>{swapDir==="test2rialo"?"RIALO":"TEST"}</strong>
<div style={{fontSize:"36px",fontWeight:700,marginTop:"8px"}}>{(()=>{const n=parseFloat(swapAmt);return n>0?String(+(n*(swapDir==="test2rialo"?0.1:10)).toFixed(6)):"0"})()}</div>
</div>
<small>{swapDir==="test2rialo"?"1 TEST ≈ 0.1 RIALO":"1 RIALO ≈ 10 TEST"}</small>
<button disabled={busy||!(parseFloat(swapAmt)>0)} onClick={askSwap}>{busy?"Processing…":"Swap"}</button>
</div>}
</section>}

   <section className="card send" style={{marginTop:"14px"}}>
    <div onClick={()=>setSendOpen(!sendOpen)} style={{cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<div><small>SEND RIALO</small><h2 style={{margin:0}}>Transfer on Rialo {network==="devnet"?"DevNet":"Testnet"}</h2></div>
<span style={{fontSize:"22px"}}>{sendOpen?"▴":"▾"}</span>
</div>
{sendOpen&&<div>

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
      <b>Rialo</b>
    </div>

    <button
      disabled={busy||!to||!amount}
      onClick={askSend}
    >
      {busy?"Processing…":"Send Rialo"}
    </button>
    </div>}
   </section>

   <div className="status">{status}</div><button className="danger" disabled={busy||!activeWallet} onClick={deleteActiveWallet}>Delete Wallet</button>
  </>}
  <footer>Rialo Testnet ·</footer>
 </main>
}
createRoot(document.getElementById("root")!).render(<App/>);
