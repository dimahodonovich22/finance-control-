(()=>{
  'use strict';

  const CONFIG_KEY='finance-control-ai-config-v1';
  const MAX_FILE_BYTES=10*1024*1024;
  const AI_BATCH_SIZE=55;
  const REVIEW_PAGE_SIZE=120;
  const PREPARED_FORMAT='finance-control-prepared';
  const PREPARED_VERSION=1;
  const CATEGORIES=['Зарплата','Прочий доход','Еда','Рестораны','Аренда/Жильё','Коммунальные','Транспорт','Топливо','Авто','Покупки','Развлечения','Подписки','Здоровье','Спорт','Путешествия','Страхование','Налоги/Сборы','Переводы','Возвраты','Погашение долга','Наличные','Другое'];
  const KINDS=[
    ['expense','Расход'],['income','Доход'],['transfer','Перевод между своими счетами'],['refund','Возврат'],['debt_payment','Погашение долга']
  ];
  const $=id=>document.getElementById(id);
  const qsa=sel=>Array.from(document.querySelectorAll(sel));
  const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const money=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  let csv={headers:[],rows:[],fileName:'',delimiter:';'};
  let prepared=[];
  let reviewed=[];
  let reviewFilter='all';
  let reviewVisible=REVIEW_PAGE_SIZE;
  let analyzing=false;
  let importSource='bank';

  function loadConfig(){
    try{return JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}')||{}}catch{return{}}
  }
  function saveConfig(){
    const value={functionUrl:$('aiFunctionUrl')?.value.trim()||'',accessToken:$('aiAccessToken')?.value.trim()||''};
    localStorage.setItem(CONFIG_KEY,JSON.stringify(value));
    updateConnectionBadges('idle','Сохранено');
    window.FinanceControl?.showToast?.('AI подключение сохранено локально');
    return value;
  }
  function hydrateConfig(){
    const c=loadConfig();
    if($('aiFunctionUrl'))$('aiFunctionUrl').value=c.functionUrl||'';
    if($('aiAccessToken'))$('aiAccessToken').value=c.accessToken||'';
  }
  function updateConnectionBadges(status,text){
    for(const id of ['aiConnectionBadge','settingsConnectionBadge']){
      const el=$(id);if(!el)continue;
      el.classList.remove('ok','bad');
      if(status==='ok')el.classList.add('ok');
      if(status==='bad')el.classList.add('bad');
      el.lastChild.textContent=text;
    }
  }

  function cleanFunctionUrl(url){return String(url||'').trim().replace(/\/+$/,'')}
  async function callEdge(payload,{timeout=45000}={}){
    const c=loadConfig();
    const url=cleanFunctionUrl(c.functionUrl);
    if(!/^https:\/\/.+\/functions\/v1\/.+/i.test(url))throw new Error('Укажи полный HTTPS URL Supabase Edge Function');
    if(!c.accessToken)throw new Error('Укажи личный access token');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response=await fetch(url,{
        method:'POST',
        headers:{'Content-Type':'application/json','X-Finance-Access':c.accessToken},
        body:JSON.stringify(payload),signal:controller.signal
      });
      const text=await response.text();
      let data={};try{data=text?JSON.parse(text):{}}catch{data={error:text||`HTTP ${response.status}`}}
      if(!response.ok)throw new Error(data.error||data.message||`Supabase вернул HTTP ${response.status}`);
      return data;
    }catch(error){
      if(error.name==='AbortError')throw new Error('Запрос занял слишком много времени');
      throw error;
    }finally{clearTimeout(timer)}
  }

  async function testConnection(){
    updateConnectionBadges('idle','Проверка…');
    const btn=$('testAiBtn');if(btn)btn.disabled=true;
    try{
      const data=await callEdge({operation:'ping'},{timeout:15000});
      updateConnectionBadges('ok',data.model?`Готово · ${data.model}`:'Готово');
      window.FinanceControl?.showToast?.('Supabase AI подключён');
    }catch(error){
      updateConnectionBadges('bad','Ошибка');
      window.FinanceControl?.showToast?.(error.message||'Не удалось подключиться');
    }finally{if(btn)btn.disabled=false}
  }

  async function readTextFile(file){
    const buffer=await file.arrayBuffer();
    try{return new TextDecoder('utf-8',{fatal:true}).decode(buffer)}
    catch{return new TextDecoder('windows-1252').decode(buffer)}
  }

  function countUnquoted(line,delimiter){
    let q=false,n=0;
    for(let i=0;i<line.length;i++){
      if(line[i]==='"')q=!q;
      else if(!q&&line[i]===delimiter)n++;
    }
    return n;
  }
  function detectDelimiter(text){
    const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).slice(0,8);
    const candidates=[';','\t',',','|'];
    let best=';',score=-1;
    for(const d of candidates){
      const counts=lines.map(l=>countUnquoted(l,d));
      const nonzero=counts.filter(Boolean);
      if(!nonzero.length)continue;
      const avg=nonzero.reduce((a,b)=>a+b,0)/nonzero.length;
      const stable=1/(1+(Math.max(...nonzero)-Math.min(...nonzero)));
      const s=avg*stable*(nonzero.length/Math.max(1,lines.length));
      if(s>score){score=s;best=d}
    }
    return best;
  }
  function parseCSV(text,delimiter){
    text=String(text||'').replace(/^\uFEFF/,'');
    const rows=[];let row=[],field='',quoted=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quoted){
        if(ch==='"'&&text[i+1]==='"'){field+='"';i++}
        else if(ch==='"')quoted=false;
        else field+=ch;
      }else{
        if(ch==='"')quoted=true;
        else if(ch===delimiter){row.push(field);field=''}
        else if(ch==='\n'){row.push(field);rows.push(row);row=[];field=''}
        else if(ch==='\r'){}
        else field+=ch;
      }
    }
    if(field.length||row.length){row.push(field);rows.push(row)}
    return rows.filter(r=>r.some(v=>String(v).trim()!==''));
  }
  function normalizeHeader(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zа-яё0-9]+/g,' ').trim()}
  function guessHeader(headers,aliases){
    const normalized=headers.map(normalizeHeader);
    for(const alias of aliases){
      const a=normalizeHeader(alias);
      let i=normalized.findIndex(h=>h===a);if(i>=0)return i;
      i=normalized.findIndex(h=>h.includes(a)||a.includes(h));if(i>=0)return i;
    }
    return -1;
  }
  function headerGuesses(headers){
    return{
      date:guessHeader(headers,['date','datum','boekingsdatum','transaction date','booking date','value date','valutadatum','дата','дата операции']),
      description:guessHeader(headers,['description','omschrijving','mededeling','details','communication','message','tegenpartij','counterparty','beneficiary','name','merchant','описание','назначение','контрагент']),
      amount:guessHeader(headers,['amount','bedrag','montant','transaction amount','sum','сумма']),
      debit:guessHeader(headers,['debit','debet','af','withdrawal','outgoing','expense','uitgave','расход','списание']),
      credit:guessHeader(headers,['credit','krediet','bij','deposit','incoming','income','inkomst','доход','зачисление'])
    };
  }
  function fillSelect(select,headers,value,{allowBlank=true,label='Не использовать'}={}){
    if(!select)return;
    const options=[];
    if(allowBlank)options.push(`<option value="">${esc(label)}</option>`);
    headers.forEach((h,i)=>options.push(`<option value="${i}">${esc(h||`Колонка ${i+1}`)}</option>`));
    select.innerHTML=options.join('');
    select.value=value>=0?String(value):'';
  }
  function parseMoney(value){
    let s=String(value??'').trim().replace(/\u00a0/g,' ').replace(/[^0-9,.'+\-()]/g,'').replace(/'/g,'');
    if(!s)return NaN;
    let negative=/^\(.*\)$/.test(s);s=s.replace(/[()]/g,'');
    if(s.startsWith('-'))negative=true;
    s=s.replace(/[+\-]/g,'');
    const lastComma=s.lastIndexOf(','),lastDot=s.lastIndexOf('.');
    if(lastComma>=0&&lastDot>=0){
      const decimal=lastComma>lastDot?',':'.';
      const thousands=decimal===','?'.':',';
      s=s.split(thousands).join('');
      if(decimal===',')s=s.replace(',','.');
    }else if(lastComma>=0){
      const after=s.length-lastComma-1;
      if(after===1||after===2)s=s.replace(',','.');else s=s.replace(/,/g,'');
    }else if(lastDot>=0){
      const after=s.length-lastDot-1;
      if(!(after===1||after===2))s=s.replace(/\./g,'');
    }
    const n=Number(s);return Number.isFinite(n)?(negative?-n:n):NaN;
  }
  function parseDate(value){
    const s=String(value??'').trim();if(!s)return'';
    let m=s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if(m)return `${m[1]}-${String(+m[2]).padStart(2,'0')}-${String(+m[3]).padStart(2,'0')}`;
    m=s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
    if(m){let y=+m[3];if(y<100)y+=2000;return `${y}-${String(+m[2]).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}`}
    const d=new Date(s);if(Number.isNaN(d.getTime()))return'';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function hashText(text){
    let h=2166136261;
    for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}
    return (h>>>0).toString(36);
  }
  function redactSensitive(value){
    return String(value||'')
      .replace(/\b[A-Z]{2}\s?\d{2}(?:\s?[A-Z0-9]){10,30}\b/gi,'[IBAN]')
      .replace(/\b(?:\d[ -]*?){13,19}\b/g,'[CARD/ID]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[EMAIL]')
      .replace(/\s+/g,' ').trim().slice(0,240);
  }
  function formatShortDate(s){
    const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}.${m[2]}.${m[1]}`:s;
  }

  function clamp01(value, fallback=1){
    const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback;
  }
  function preparedSignature(date,signed,description,merchant){
    return `${date}|${Number(signed).toFixed(2)}|${String(merchant||description||'').toLowerCase().replace(/\s+/g,' ').trim()}|${String(description||'').toLowerCase().replace(/\s+/g,' ').trim()}`;
  }
  function normalizePreparedTransaction(raw,index,occurrence){
    if(!raw||typeof raw!=='object')return{error:`Строка ${index+1}: не объект`};
    const date=parseDate(raw.date);
    const signed=typeof raw.amount==='number'?raw.amount:parseMoney(raw.amount);
    const description=String(raw.description??raw.note??raw.merchant??'').trim();
    const merchant=String(raw.merchant??description).trim().slice(0,100);
    if(!date)return{error:`Строка ${index+1}: некорректная дата`};
    if(!Number.isFinite(signed)||Math.abs(signed)<0.005)return{error:`Строка ${index+1}: некорректная сумма`};
    if(!description&&!merchant)return{error:`Строка ${index+1}: нет описания`};
    const allowedKinds=new Set(KINDS.map(x=>x[0]));
    let kind=allowedKinds.has(raw.kind)?raw.kind:(signed>0?'income':'expense');
    let category=CATEGORIES.includes(raw.category)?raw.category:(kind==='income'?'Прочий доход':'Другое');
    if(kind==='transfer')category='Переводы';
    if(kind==='refund')category='Возвраты';
    if(kind==='debt_payment')category='Погашение долга';
    if(kind==='income'&&category==='Другое')category='Прочий доход';
    const signature=preparedSignature(date,signed,description,merchant);
    const count=(occurrence.get(signature)||0)+1;occurrence.set(signature,count);
    const suppliedExternal=String(raw.external_id??raw.externalId??'').trim().slice(0,180);
    const externalId=suppliedExternal||`prepared:${hashText(`${signature}|${count}`)}`;
    const confidence=clamp01(raw.confidence,1);
    const needsReview=Boolean(raw.needs_review??raw.needsReview)||!allowedKinds.has(raw.kind??kind)||!CATEGORIES.includes(raw.category??category);
    return{
      id:String(raw.id||`p${index+1}-${hashText(signature)}`).slice(0,120),rowIndex:index,date,
      description:description||merchant,redactedDescription:redactSensitive(description||merchant),
      signedAmount:signed,amount:Math.abs(signed),externalId,kind,category,merchant:merchant||description,
      confidence,needsReview,reason:String(raw.reason||'Подготовлено заранее').slice(0,120),selected:true,
      classificationSource:'prepared'
    };
  }
  async function loadPreparedFile(file){
    if(!file)return;
    if(file.size>MAX_FILE_BYTES){window.FinanceControl?.showToast?.('Файл больше 10 МБ');return}
    try{
      const text=await readTextFile(file);
      const data=JSON.parse(text);
      if(!data||typeof data!=='object')throw new Error('Некорректный JSON');
      if(data.format!==PREPARED_FORMAT)throw new Error('Это не Finance Control Prepared Import файл');
      if(Number(data.version)!==PREPARED_VERSION)throw new Error(`Неподдерживаемая версия файла: ${data.version}`);
      if(!Array.isArray(data.transactions)||!data.transactions.length)throw new Error('В файле нет транзакций');
      if(data.transactions.length>20000)throw new Error('Слишком много транзакций в одном файле');
      const occurrence=new Map();const out=[];const errors=[];
      data.transactions.forEach((raw,i)=>{
        const normalized=normalizePreparedTransaction(raw,i,occurrence);
        if(normalized.error){if(errors.length<8)errors.push(normalized.error);return}
        out.push(normalized);
      });
      if(!out.length)throw new Error(errors[0]||'Не удалось прочитать транзакции');
      importSource='prepared';prepared=[];reviewed=out;reviewVisible=REVIEW_PAGE_SIZE;
      for(const r of reviewed){if(window.FinanceControl?.hasExternalId?.(r.externalId)){r.duplicate=true;r.selected=false}}
      $('preparedFileLabel').textContent=file.name;
      const dates=reviewed.map(x=>x.date).sort();
      const income=reviewed.filter(x=>x.signedAmount>0).reduce((s,x)=>s+x.amount,0);
      const expense=reviewed.filter(x=>x.signedAmount<0).reduce((s,x)=>s+x.amount,0);
      $('preparedFileSummary').innerHTML=`<div class="file-stat"><span>Операций</span><strong>${reviewed.length}</strong></div><div class="file-stat"><span>Поступления</span><strong>${money(income)}</strong></div><div class="file-stat"><span>Списания</span><strong>${money(expense)}</strong></div><div class="file-stat"><span>Период</span><strong>${esc(formatShortDate(dates[0]))} — ${esc(formatShortDate(dates[dates.length-1]))}</strong></div>`+(errors.length?`<div class="import-warning" style="grid-column:1/-1">Пропущено ${data.transactions.length-reviewed.length} строк. ${esc(errors.join(' · '))}</div>`:'');
      $('preparedFileSummary').classList.remove('hidden');
      $('preparedSection').classList.add('hidden');
      renderReview();$('reviewSection').classList.remove('hidden');
      window.FinanceControl?.showToast?.(`Готовый файл: ${reviewed.length} операций`);
      setTimeout(()=>$('reviewSection').scrollIntoView({behavior:'smooth',block:'start'}),120);
    }catch(error){
      $('preparedFile').value='';$('preparedFileLabel').textContent='Выбрать готовый JSON';$('preparedFileSummary').classList.add('hidden');
      window.FinanceControl?.showToast?.(error.message||'Не удалось прочитать готовый JSON');
    }
  }
  function downloadPreparedTemplate(){
    const template={
      format:PREPARED_FORMAT,version:PREPARED_VERSION,currency:'EUR',created_at:new Date().toISOString().slice(0,10),
      note:'amount is signed: positive = incoming, negative = outgoing',
      transactions:[
        {date:'2026-08-01',amount:-63.74,kind:'expense',category:'Топливо',merchant:'Shell',description:'SHELL STATION',confidence:0.99,needs_review:false},
        {date:'2026-08-02',amount:814.32,kind:'income',category:'Зарплата',merchant:'Employer',description:'SALARY PAYMENT',confidence:0.99,needs_review:false}
      ]
    };
    const blob=new Blob([JSON.stringify(template,null,2)],{type:'application/json'});const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download='finance-control-prepared-template.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),500);
  }

  async function loadBankFile(file){
    if(!file)return;
    if(file.size>MAX_FILE_BYTES){window.FinanceControl?.showToast?.('Файл больше 10 МБ');return}
    try{
      const text=await readTextFile(file);
      const delimiter=detectDelimiter(text);
      const table=parseCSV(text,delimiter);
      if(table.length<2)throw new Error('В файле не найдены строки данных');
      const width=Math.max(...table.slice(0,20).map(r=>r.length));
      const headers=Array.from({length:width},(_,i)=>String(table[0][i]||`Колонка ${i+1}`).trim()||`Колонка ${i+1}`);
      const rows=table.slice(1).map(r=>Array.from({length:width},(_,i)=>r[i]??''));
      importSource='bank';csv={headers,rows,fileName:file.name,delimiter};prepared=[];reviewed=[];
      $('bankFileLabel').textContent=file.name;
      const d=delimiter==='\t'?'TAB':delimiter;
      $('fileSummary').innerHTML=`<div class="file-stat"><span>Строк</span><strong>${rows.length}</strong></div><div class="file-stat"><span>Колонок</span><strong>${headers.length}</strong></div><div class="file-stat"><span>Разделитель</span><strong>${esc(d)}</strong></div><div class="file-stat"><span>Размер</span><strong>${file.size>=1024*1024?`${(file.size/1024/1024).toFixed(1)} MB`:`${(file.size/1024).toFixed(1)} KB`}</strong></div>`;
      $('fileSummary').classList.remove('hidden');
      const g=headerGuesses(headers);
      fillSelect($('mapDate'),headers,g.date,{allowBlank:false});
      fillSelect($('mapDescription'),headers,g.description,{allowBlank:false});
      fillSelect($('mapAmount'),headers,g.amount);
      fillSelect($('mapDebit'),headers,g.debit);
      fillSelect($('mapCredit'),headers,g.credit);
      $('mappingPanel').classList.remove('hidden');
      $('preparedSection').classList.add('hidden');$('reviewSection').classList.add('hidden');
    }catch(error){window.FinanceControl?.showToast?.(error.message||'Не удалось прочитать CSV')}
  }

  function idx(id){const v=$(id)?.value;return v===''?-1:Number(v)}
  function prepareOperations(){
    if(!csv.rows.length)return window.FinanceControl?.showToast?.('Сначала выбери CSV');
    const dateI=idx('mapDate'),descI=idx('mapDescription'),amountI=idx('mapAmount'),debitI=idx('mapDebit'),creditI=idx('mapCredit');
    if(dateI<0||descI<0)return window.FinanceControl?.showToast?.('Выбери колонки даты и описания');
    if(amountI<0&&debitI<0&&creditI<0)return window.FinanceControl?.showToast?.('Выбери сумму или отдельные Debit/Credit');
    const occurrence=new Map();const out=[];let invalid=0;
    csv.rows.forEach((r,rowIndex)=>{
      const date=parseDate(r[dateI]);
      const description=String(r[descI]||'').trim();
      let signed=NaN;
      if(amountI>=0)signed=parseMoney(r[amountI]);
      else{
        const debit=debitI>=0?Math.abs(parseMoney(r[debitI])||0):0;
        const credit=creditI>=0?Math.abs(parseMoney(r[creditI])||0):0;
        signed=credit-debit;
      }
      if(!date||!description||!Number.isFinite(signed)||Math.abs(signed)<0.005){invalid++;return}
      const signature=`${date}|${signed.toFixed(2)}|${description.toLowerCase().replace(/\s+/g,' ').trim()}`;
      const count=(occurrence.get(signature)||0)+1;occurrence.set(signature,count);
      out.push({id:`r${rowIndex+1}-${hashText(signature)}`,rowIndex,date,description,redactedDescription:redactSensitive(description),signedAmount:signed,amount:Math.abs(signed),externalId:`bank:${hashText(`${signature}|${count}`)}`});
    });
    if(!out.length)return window.FinanceControl?.showToast?.('Не удалось получить операции — проверь выбранные колонки');
    prepared=out;reviewed=[];reviewVisible=REVIEW_PAGE_SIZE;
    renderPrepared(invalid);
    $('preparedSection').classList.remove('hidden');$('reviewSection').classList.add('hidden');
    $('preparedSection').scrollIntoView({behavior:'smooth',block:'start'});
  }

  function renderPrepared(invalid=0){
    const income=prepared.filter(x=>x.signedAmount>0).reduce((s,x)=>s+x.amount,0);
    const expense=prepared.filter(x=>x.signedAmount<0).reduce((s,x)=>s+x.amount,0);
    const dates=prepared.map(x=>x.date).sort();
    $('importStats').innerHTML=`<div class="import-stat"><span>Операций</span><strong>${prepared.length}</strong></div><div class="import-stat"><span>Поступления</span><strong class="income">${money(income)}</strong></div><div class="import-stat"><span>Списания</span><strong class="expense">${money(expense)}</strong></div><div class="import-stat"><span>Период</span><strong style="font-size:12px">${formatShortDate(dates[0])}<br>— ${formatShortDate(dates[dates.length-1])}</strong></div>`;
    const first=prepared.slice(0,100);
    $('rawPreview').innerHTML=(invalid?`<div class="import-warning">Пропущено ${invalid} строк: не удалось определить дату, описание или сумму.</div>`:'')+first.map(x=>`<div class="raw-row"><div class="raw-date">${esc(formatShortDate(x.date))}</div><div class="raw-description"><strong>${esc(x.description)}</strong><span>${x.redactedDescription!==x.description?'Чувствительные фрагменты будут скрыты перед AI':'Готово к AI-анализу'}</span></div><div class="raw-amount ${x.signedAmount>0?'pos':'neg'}">${x.signedAmount>0?'+':'−'}${money(x.amount)}</div></div>`).join('')+(prepared.length>100?`<div class="empty-state">Показаны первые 100 из ${prepared.length}. AI обработает все операции.</div>`:'');
  }

  function setProgress(done,total,label='AI анализирует операции…'){
    const pct=total?Math.round(done/total*100):0;
    $('analysisProgress').classList.remove('hidden');$('analysisProgressText').textContent=label;$('analysisProgressPct').textContent=`${pct}%`;$('analysisProgressBar').style.width=`${pct}%`;
  }
  function classificationFallback(row){
    return{id:row.id,kind:row.signedAmount>0?'income':'expense',category:row.signedAmount>0?'Прочий доход':'Другое',merchant:row.redactedDescription.slice(0,80),confidence:0,needs_review:true,reason:'AI не вернул классификацию'};
  }
  function normalizeClassification(row,c){
    const allowedKinds=new Set(KINDS.map(x=>x[0]));
    const kind=allowedKinds.has(c?.kind)?c.kind:(row.signedAmount>0?'income':'expense');
    let category=CATEGORIES.includes(c?.category)?c.category:'Другое';
    if(kind==='transfer')category='Переводы';
    if(kind==='refund')category='Возвраты';
    if(kind==='debt_payment')category='Погашение долга';
    if(kind==='income'&&category==='Другое')category='Прочий доход';
    const confidence=Math.max(0,Math.min(1,Number(c?.confidence)||0));
    return{...row,kind,category,merchant:String(c?.merchant||row.redactedDescription).slice(0,100),confidence,needsReview:Boolean(c?.needs_review)||confidence<0.78,reason:String(c?.reason||'').slice(0,120),selected:true,classificationSource:'ai'};
  }

  async function analyzeWithAI(){
    if(analyzing||!prepared.length)return;
    const c=loadConfig();
    if(!c.functionUrl||!c.accessToken){window.FinanceControl?.showToast?.('Сначала настрой Supabase подключение');openAiSettings();return}
    analyzing=true;$('analyzeAiBtn').disabled=true;
    const results=new Map();let done=0;
    setProgress(0,prepared.length);
    try{
      for(let i=0;i<prepared.length;i+=AI_BATCH_SIZE){
        const batch=prepared.slice(i,i+AI_BATCH_SIZE);
        const payload={operation:'classify',transactions:batch.map(x=>({id:x.id,date:x.date,amount:Number(x.signedAmount.toFixed(2)),description:x.redactedDescription}))};
        const data=await callEdge(payload,{timeout:60000});
        for(const item of data.classifications||[])if(item?.id)results.set(item.id,item);
        done+=batch.length;setProgress(done,prepared.length,`AI анализирует · пакет ${Math.ceil(done/AI_BATCH_SIZE)} из ${Math.ceil(prepared.length/AI_BATCH_SIZE)}`);
        if(i+AI_BATCH_SIZE<prepared.length)await sleep(120);
      }
      reviewed=prepared.map(row=>normalizeClassification(row,results.get(row.id)||classificationFallback(row)));
      for(const r of reviewed){
        if(window.FinanceControl?.hasExternalId?.(r.externalId)){r.duplicate=true;r.selected=false}
      }
      setProgress(prepared.length,prepared.length,'AI анализ завершён');
      updateConnectionBadges('ok','AI готов');
      renderReview();$('reviewSection').classList.remove('hidden');
      setTimeout(()=>$('reviewSection').scrollIntoView({behavior:'smooth',block:'start'}),120);
    }catch(error){
      updateConnectionBadges('bad','Ошибка AI');
      $('analysisProgressText').textContent=`Ошибка: ${error.message}`;$('analysisProgressBar').style.width='0%';$('analysisProgressPct').textContent='!';
      window.FinanceControl?.showToast?.(error.message||'AI анализ не удался');
    }finally{analyzing=false;$('analyzeAiBtn').disabled=false}
  }

  function kindLabel(k){return KINDS.find(x=>x[0]===k)?.[1]||k}
  function getFilteredReview(){
    const query=($('reviewSearch')?.value||'').trim().toLowerCase();
    return reviewed.filter(r=>{
      if(reviewFilter==='review'&&!r.needsReview)return false;
      if(reviewFilter==='expense'&&!(r.kind==='expense'||r.kind==='debt_payment'))return false;
      if(reviewFilter==='income'&&!(r.kind==='income'||r.kind==='refund'))return false;
      if(query&&!`${r.description} ${r.merchant} ${r.category} ${kindLabel(r.kind)}`.toLowerCase().includes(query))return false;
      return true;
    });
  }
  function optionList(items,current){return items.map(([v,l])=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(l)}</option>`).join('')}
  function categoryOptions(current){return CATEGORIES.map(v=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(v)}</option>`).join('')}
  function renderReview(){
    if(!reviewed.length)return;
    const rows=getFilteredReview();const visible=rows.slice(0,reviewVisible);
    const duplicates=reviewed.filter(r=>r.duplicate).length;
    const needs=reviewed.filter(r=>r.needsReview&&!r.duplicate).length;
    $('reviewCount').textContent=`${needs} требуют внимания${duplicates?` · ${duplicates} дублик.`:''}`;
    $('reviewList').innerHTML=visible.map(r=>`<article class="review-item ${r.needsReview?'needs-review':''}" data-review-id="${esc(r.id)}">
      <input class="review-check" type="checkbox" data-review-select="${esc(r.id)}" ${r.selected?'checked':''} ${r.duplicate?'disabled':''} aria-label="Добавить операцию" />
      <div class="review-main"><strong>${esc(r.merchant||r.description)}</strong><span>${esc(formatShortDate(r.date))} · ${esc(r.description)}</span>${r.duplicate?'<span class="duplicate-tag">Уже импортировано</span>':''}</div>
      <div class="review-kind"><select data-review-kind="${esc(r.id)}" aria-label="Тип операции">${optionList(KINDS,r.kind)}</select></div>
      <div class="review-category"><select data-review-category="${esc(r.id)}" aria-label="Категория">${categoryOptions(r.category)}</select></div>
      <div class="review-side"><div class="review-amount ${r.signedAmount>0?'income':'expense'}">${r.signedAmount>0?'+':'−'}${money(r.amount)}</div><div class="confidence ${r.classificationSource==='prepared'?'prepared':(r.confidence<.78?'low':'')}"><span class="confidence-dot"></span>${r.classificationSource==='prepared'?(r.needsReview?'Проверь':'Подготовлено'):`${Math.round(r.confidence*100)}% AI`}</div></div>
    </article>`).join('')+(rows.length>visible.length?`<button class="secondary-btn full-btn" type="button" id="reviewLoadMore">Показать ещё ${Math.min(REVIEW_PAGE_SIZE,rows.length-visible.length)}</button>`:'')+(!rows.length?'<div class="empty-state"><strong>Ничего не найдено</strong>Измени фильтр или поиск.</div>':'');
    updateImportSummary();
    $('reviewLoadMore')?.addEventListener('click',()=>{reviewVisible+=REVIEW_PAGE_SIZE;renderReview()});
  }
  function updateImportSummary(){
    const selected=reviewed.filter(r=>r.selected&&!r.duplicate).length;
    const total=reviewed.filter(r=>!r.duplicate).length;
    $('selectedImportSummary').textContent=`${selected} из ${total} выбрано`;
    $('duplicateSummary').textContent=reviewed.some(r=>r.duplicate)?`${reviewed.filter(r=>r.duplicate).length} дубликатов будут пропущены`:'Дубликаты будут пропущены автоматически';
    $('commitImportBtn').disabled=selected===0;
  }
  function updateKindImplications(r){
    if(r.kind==='transfer')r.category='Переводы';
    if(r.kind==='refund')r.category='Возвраты';
    if(r.kind==='debt_payment')r.category='Погашение долга';
    if(r.kind==='income'&&['Переводы','Возвраты','Погашение долга'].includes(r.category))r.category='Прочий доход';
    if(r.kind==='expense'&&['Переводы','Возвраты','Погашение долга','Зарплата','Прочий доход'].includes(r.category))r.category='Другое';
    r.needsReview=false;r.confidence=Math.max(r.confidence,.99);
  }

  function commitImport(){
    const rows=reviewed.filter(r=>r.selected&&!r.duplicate);
    if(!rows.length)return;
    const transactions=rows.map(r=>({
      type:(r.kind==='income'||r.kind==='refund'||(r.kind==='transfer'&&r.signedAmount>0))?'income':'expense',
      kind:r.kind,amount:r.amount,category:r.category,date:r.date,
      merchant:r.merchant,note:r.description,externalId:r.externalId,importedByAI:r.classificationSource==='ai'
    }));
    const result=window.FinanceControl?.bulkImportTransactions?.(transactions,{preserveAvailableBalance:true});
    if(result){
      window.FinanceControl.showToast(`Готово: добавлено ${result.added}${result.duplicates?`, ${result.duplicates} дубликатов пропущено`:''}`);
      resetImport(false);window.FinanceControl.showPage('transactions');
    }
  }

  function resetImport(clearFile=true){
    prepared=[];reviewed=[];reviewVisible=REVIEW_PAGE_SIZE;reviewFilter='all';
    $('preparedSection')?.classList.add('hidden');$('reviewSection')?.classList.add('hidden');$('analysisProgress')?.classList.add('hidden');
    if(clearFile){importSource='bank';csv={headers:[],rows:[],fileName:'',delimiter:';'};$('bankFile').value='';$('bankFileLabel').textContent='Выбрать CSV';$('fileSummary').classList.add('hidden');$('mappingPanel').classList.add('hidden');if($('preparedFile'))$('preparedFile').value='';if($('preparedFileLabel'))$('preparedFileLabel').textContent='Выбрать готовый JSON';$('preparedFileSummary')?.classList.add('hidden')}
  }
  function openAiSettings(){
    window.FinanceControl?.showPage?.('settings');
    setTimeout(()=>$('aiSettingsCard')?.scrollIntoView({behavior:'smooth',block:'center'}),100);
  }

  // File input + drag/drop
  $('bankFile')?.addEventListener('change',()=>loadBankFile($('bankFile').files?.[0]));
  $('preparedFile')?.addEventListener('change',()=>loadPreparedFile($('preparedFile').files?.[0]));
  $('downloadPreparedTemplateBtn')?.addEventListener('click',downloadPreparedTemplate);
  const drop=$('bankDropZone');
  if(drop){
    ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')}));
    ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')}));
    drop.addEventListener('drop',e=>loadBankFile(e.dataTransfer?.files?.[0]));
  }
  const preparedDrop=$('preparedDropZone');
  if(preparedDrop){
    ['dragenter','dragover'].forEach(ev=>preparedDrop.addEventListener(ev,e=>{e.preventDefault();preparedDrop.classList.add('drag')}));
    ['dragleave','drop'].forEach(ev=>preparedDrop.addEventListener(ev,e=>{e.preventDefault();preparedDrop.classList.remove('drag')}));
    preparedDrop.addEventListener('drop',e=>loadPreparedFile(e.dataTransfer?.files?.[0]));
  }
  $('prepareImportBtn')?.addEventListener('click',prepareOperations);
  $('analyzeAiBtn')?.addEventListener('click',analyzeWithAI);
  $('resetImportBtn')?.addEventListener('click',()=>resetImport(true));
  $('commitImportBtn')?.addEventListener('click',commitImport);
  $('saveAiConfigBtn')?.addEventListener('click',saveConfig);
  $('testAiBtn')?.addEventListener('click',()=>{saveConfig();testConnection()});
  $('openAiSettingsBtn')?.addEventListener('click',openAiSettings);
  $('reviewSearch')?.addEventListener('input',()=>{reviewVisible=REVIEW_PAGE_SIZE;renderReview()});
  qsa('[data-review-filter]').forEach(btn=>btn.addEventListener('click',()=>{
    reviewFilter=btn.dataset.reviewFilter||'all';reviewVisible=REVIEW_PAGE_SIZE;
    qsa('[data-review-filter]').forEach(x=>x.classList.toggle('active',x===btn));renderReview();
  }));
  document.body.addEventListener('change',e=>{
    const select=e.target.closest('[data-review-select]');
    if(select){const r=reviewed.find(x=>x.id===select.dataset.reviewSelect);if(r){r.selected=select.checked;updateImportSummary()}return}
    const kind=e.target.closest('[data-review-kind]');
    if(kind){const r=reviewed.find(x=>x.id===kind.dataset.reviewKind);if(r){r.kind=kind.value;updateKindImplications(r);renderReview()}return}
    const cat=e.target.closest('[data-review-category]');
    if(cat){const r=reviewed.find(x=>x.id===cat.dataset.reviewCategory);if(r){r.category=cat.value;r.needsReview=false;r.confidence=Math.max(r.confidence,.99);renderReview()}return}
  });

  hydrateConfig();
  const c=loadConfig();
  if(c.functionUrl&&c.accessToken)updateConnectionBadges('idle','Настроено');
})();
