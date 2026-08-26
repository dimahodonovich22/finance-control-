(()=>{
  'use strict';

  const STORAGE_KEY='finance-control-v8';
  const PREVIOUS_KEYS=['finance-control-v7','finance-control-v6','finance-control-v5','finance-control-v4','finance-control-v3','finance-control-v2','finance-control-v1'];
  const $=id=>document.getElementById(id);
  const qsa=sel=>Array.from(document.querySelectorAll(sel));
  const uid=()=>globalThis.crypto?.randomUUID?.()||`id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,Number(n)||0));
  const parseDecimalInput=value=>{
    const normalized=String(value??'').trim().replace(/\s+/g,'').replace(',', '.');
    if(!normalized)return NaN;
    const n=Number(normalized);
    return Number.isFinite(n)?n:NaN;
  };
  const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  const monthKey=()=>today().slice(0,7);
  const isThisMonth=s=>typeof s==='string'&&s.slice(0,7)===monthKey();
  const money=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'EUR',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(n)||0);
  const money2=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0);
  const fmtDate=s=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return '';
    const [y,m,d]=s.split('-').map(Number);
    const now=new Date();
    return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:y!==now.getFullYear()?'numeric':undefined}).format(new Date(y,m-1,d));
  };
  const parseDateOnly=s=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return null;
    const [y,m,d]=s.split('-').map(Number);
    return new Date(y,m-1,d,12,0,0,0);
  };
  const daysBetween=(a,b)=>Math.round((b-a)/86400000);

  function defaultState(){
    return{
      version:8,
      settings:{
        startBalance:0,
        spendBudget:0,
        debtBudget:0,
        debtStrategy:'avalanche',
        salaryDay:0,
        reserveFloor:0,
        savingsGoalName:'',
        savingsGoalAmount:0
      },
      meta:{lastBackupAt:''},
      transactions:[],
      debts:[],
      closedDebts:[],
      scheduledPayments:[],
      receivables:[]
    };
  }

  function sanitizeState(raw){
    const out=defaultState();
    const s=raw?.settings||{};
    out.settings.startBalance=Number(s.startBalance)||0;
    out.settings.spendBudget=Math.max(0,Number(s.spendBudget)||0);
    out.settings.debtBudget=Math.max(0,Number(s.debtBudget)||0);
    out.settings.debtStrategy=s.debtStrategy==='snowball'?'snowball':'avalanche';
    out.settings.salaryDay=Math.round(clamp(s.salaryDay,0,31));
    out.settings.reserveFloor=Math.max(0,Number(s.reserveFloor)||0);
    out.settings.savingsGoalName=String(s.savingsGoalName||'').slice(0,80);
    out.settings.savingsGoalAmount=Math.max(0,Number(s.savingsGoalAmount)||0);
    out.meta.lastBackupAt=/^\d{4}-\d{2}-\d{2}/.test(raw?.meta?.lastBackupAt||'')?String(raw.meta.lastBackupAt):'';

    out.transactions=(Array.isArray(raw?.transactions)?raw.transactions:[]).map(t=>{
      const type=t.type==='income'?'income':'expense';
      const allowedKinds=['income','expense','transfer','refund','debt_payment','receivable_out','receivable_return','savings_transfer','savings_spend'];
      const fallbackKind=t.category==='Погашение долга'?'debt_payment':type;
      return{
        id:String(t.id||uid()),
        type,
        kind:allowedKinds.includes(t.kind)?t.kind:fallbackKind,
        amount:Math.max(0,Number(t.amount)||0),
        category:String(t.category||'Без категории').slice(0,80),
        date:/^\d{4}-\d{2}-\d{2}$/.test(t.date||'')?t.date:today(),
        note:String(t.note||'').slice(0,180),
        merchant:String(t.merchant||'').slice(0,100),
        externalId:String(t.externalId||'').slice(0,180),
        importedByAI:Boolean(t.importedByAI),
        origin:['scheduled_payment','receivable','debt','savings'].includes(t.origin)?t.origin:'',
        originId:String(t.originId||'').slice(0,100),
        bankReconciled:Boolean(t.bankReconciled),
        createdAt:Number(t.createdAt)||0
      };
    }).filter(t=>t.amount>0);

    out.debts=(Array.isArray(raw?.debts)?raw.debts:[]).map(d=>{
      const balance=Math.max(0,Number(d.balance)||0);
      const original=Math.max(balance,Number(d.original)||balance);
      return{
        id:String(d.id||uid()),
        name:String(d.name||'Долг').slice(0,80),
        balance,
        original,
        apr:clamp(d.apr,0,1000),
        min:Math.max(0,Number(d.min)||0),
        due:/^\d{4}-\d{2}-\d{2}$/.test(d.due||'')?d.due:''
      };
    }).filter(d=>d.balance>0.005);

    out.closedDebts=(Array.isArray(raw?.closedDebts)?raw.closedDebts:[]).map(d=>({
      id:String(d.id||uid()),name:String(d.name||'Долг').slice(0,80),balance:0,
      original:Math.max(0,Number(d.original)||0),apr:clamp(d.apr,0,1000),min:Math.max(0,Number(d.min)||0),
      due:'',closedAt:/^\d{4}-\d{2}-\d{2}$/.test(d.closedAt||'')?d.closedAt:today()
    }));

    out.scheduledPayments=(Array.isArray(raw?.scheduledPayments)?raw.scheduledPayments:[]).map(x=>({
      id:String(x.id||uid()),
      name:String(x.name||'Платёж').slice(0,90),
      amount:Math.max(0,Number(x.amount)||0),
      due:/^\d{4}-\d{2}-\d{2}$/.test(x.due||'')?x.due:today(),
      category:String(x.category||'Другое').slice(0,80),
      note:String(x.note||'').slice(0,180),
      recurrence:['monthly','yearly'].includes(x.recurrence)?x.recurrence:'once',
      seriesId:String(x.seriesId||x.id||uid()),
      previousOccurrenceId:String(x.previousOccurrenceId||''),
      nextOccurrenceId:String(x.nextOccurrenceId||''),
      generatedFrom:String(x.generatedFrom||''),
      paid:Boolean(x.paid),
      paidAt:/^\d{4}-\d{2}-\d{2}$/.test(x.paidAt||'')?x.paidAt:'',
      transactionId:String(x.transactionId||''),
      createdAt:Number(x.createdAt)||0
    })).filter(x=>x.amount>0);

    out.receivables=(Array.isArray(raw?.receivables)?raw.receivables:[]).map(x=>({
      id:String(x.id||uid()),
      person:String(x.person||'Мне должны').slice(0,90),
      amount:Math.max(0,Number(x.amount)||0),
      due:/^\d{4}-\d{2}-\d{2}$/.test(x.due||'')?x.due:'',
      note:String(x.note||'').slice(0,180),
      sourceMode:['gave_now','existing_tx'].includes(x.sourceMode)?x.sourceMode:'record_only',
      sourceTransactionId:String(x.sourceTransactionId||''),
      settled:Boolean(x.settled),
      settledAt:/^\d{4}-\d{2}-\d{2}$/.test(x.settledAt||'')?x.settledAt:'',
      transactionId:String(x.transactionId||''),
      createdAt:Number(x.createdAt)||0
    })).filter(x=>x.amount>0);
    return out;
  }

  function loadState(){
    try{
      const current=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
      if(current)return sanitizeState(current);
      for(const key of PREVIOUS_KEYS){
        const previous=JSON.parse(localStorage.getItem(key)||'null');
        if(previous){
          const migrated=sanitizeState(previous);
          localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated));
          return migrated;
        }
      }
    }catch(error){console.warn('State load failed',error)}
    return defaultState();
  }

  let state=loadState();
  let currentTxFilter='all';
  let currentDebtView='owed';
  let txVisibleLimit=50;
  let activeTxDetailId='';
  let balanceMasked=false;
  let toastTimer=null;

  function persist(message){
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    mirrorStateToIndexedDB();
    render();
    if(message)showToast(message);
  }

  function showToast(message){
    const el=$('toast');
    el.textContent=message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>el.classList.remove('show'),2300);
  }

  function savingsImpact(t){
    const kind=t?.kind||'';
    if(kind==='savings_transfer')return t.type==='expense'?t.amount:-t.amount;
    if(kind==='savings_spend')return -t.amount;
    return 0;
  }

  function availableImpact(t){
    const kind=t?.kind||(t?.category==='Погашение долга'?'debt_payment':t?.type);
    if(kind==='transfer'||kind==='savings_spend')return 0;
    return t.type==='income'?t.amount:-t.amount;
  }

  function rawSavingsBalance(excludeId=''){
    return state.transactions.reduce((sum,t)=>t.id===excludeId?sum:sum+savingsImpact(t),0);
  }

  function savingsBalance(excludeId=''){
    return Math.max(0,rawSavingsBalance(excludeId));
  }

  function balancesWithoutTransaction(id=''){
    const t=totals();
    const existing=state.transactions.find(x=>x.id===id);
    return{
      available:t.available-(existing?availableImpact(existing):0),
      saved:t.saved-(existing?savingsImpact(existing):0)
    };
  }

  function monthStats(){
    let income=0,lifestyleExpense=0,debtPayments=0,refunds=0,receivableOut=0,receivableReturns=0,transfers=0,savingsNet=0,savingsAdded=0,savingsReturned=0,savingsSpent=0,allExpense=0,allDelta=0;
    for(const t of state.transactions){
      const kind=t.kind||(t.category==='Погашение долга'?'debt_payment':t.type);
      allDelta+=availableImpact(t);
      if(!isThisMonth(t.date))continue;
      if(kind==='transfer'){transfers+=t.amount;continue}
      if(kind==='savings_transfer'){
        if(t.type==='expense'){savingsAdded+=t.amount;savingsNet+=t.amount}else{savingsReturned+=t.amount;savingsNet-=t.amount}
        continue;
      }
      if(kind==='savings_spend'){
        savingsSpent+=t.amount;savingsNet-=t.amount;allExpense+=t.amount;lifestyleExpense+=t.amount;
        continue;
      }
      if(kind==='refund'){
        refunds+=t.amount;
        if(t.type==='income')lifestyleExpense-=t.amount;
        else lifestyleExpense+=t.amount;
        continue;
      }
      if(kind==='receivable_out'){receivableOut+=t.amount;continue}
      if(kind==='receivable_return'){
        receivableReturns+=t.amount;
        continue;
      }
      if(kind==='debt_payment'||t.category==='Погашение долга'){
        debtPayments+=t.amount;
        allExpense+=t.amount;
        continue;
      }
      if(t.type==='income')income+=t.amount;
      else{allExpense+=t.amount;lifestyleExpense+=t.amount}
    }
    lifestyleExpense=Math.max(0,lifestyleExpense);
    return{income,lifestyleExpense,debtPayments,refunds,receivableOut,receivableReturns,transfers,savingsNet,savingsAdded,savingsReturned,savingsSpent,allExpense,cashflow:income+refunds+receivableReturns-allExpense-receivableOut,allDelta};
  }

  function totals(){
    const m=monthStats();
    const debt=state.debts.reduce((s,d)=>s+d.balance,0);
    const minPayments=state.debts.reduce((s,d)=>s+d.min,0);
    const available=state.settings.startBalance+m.allDelta;
    const saved=savingsBalance();
    const totalCapital=available+saved;
    return{...m,debt,minPayments,available,saved,totalCapital,netPosition:totalCapital-debt};
  }

  function daysLeftInMonth(){
    const now=new Date();
    const last=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    return Math.max(1,last-now.getDate()+1);
  }

  function salaryCountdown(){
    const day=Number(state.settings.salaryDay)||0;
    if(day<1)return null;
    const now=new Date();
    let target=new Date(now.getFullYear(),now.getMonth(),Math.min(day,new Date(now.getFullYear(),now.getMonth()+1,0).getDate()),12);
    const todayMid=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);
    if(target<todayMid){
      const nextMonth=new Date(now.getFullYear(),now.getMonth()+1,1);
      const last=new Date(nextMonth.getFullYear(),nextMonth.getMonth()+1,0).getDate();
      target=new Date(nextMonth.getFullYear(),nextMonth.getMonth(),Math.min(day,last),12);
    }
    return{days:Math.max(0,daysBetween(todayMid,target)),date:target};
  }

  function priorityDebts(strategy=state.settings.debtStrategy,debts=state.debts){
    const arr=debts.filter(d=>d.balance>0.005).slice();
    if(strategy==='snowball')return arr.sort((a,b)=>(a.balance-b.balance)||(b.apr-a.apr)||(a.name.localeCompare(b.name)));
    return arr.sort((a,b)=>(b.apr-a.apr)||(a.balance-b.balance)||(a.name.localeCompare(b.name)));
  }

  function simulatePayoff(strategy=state.settings.debtStrategy,budget=state.settings.debtBudget){
    const active=state.debts.filter(d=>d.balance>0.005);
    if(!active.length)return{months:0,totalInterest:0,warning:null,closed:[]};
    budget=Math.max(0,Number(budget)||0);
    const minSum=active.reduce((s,d)=>s+d.min,0);
    if(budget<=0)return{months:null,totalInterest:null,warning:'Задай месячный бюджет на долги, чтобы появился прогноз.',closed:[]};
    if(budget+0.005<minSum)return{months:null,totalInterest:null,warning:`Бюджет ${money(budget)} ниже суммы минимальных платежей ${money(minSum)}.`,closed:[]};

    const items=active.map(d=>({...d,balance:Number(d.balance)}));
    let totalInterest=0;
    const closed=[];

    for(let month=1;month<=600;month++){
      const before=items.reduce((s,d)=>s+Math.max(0,d.balance),0);
      for(const d of items){
        if(d.balance<=0.005)continue;
        const interest=d.balance*(d.apr/100/12);
        d.balance+=interest;
        totalInterest+=interest;
      }

      let left=budget;
      for(const d of items){
        if(d.balance<=0.005)continue;
        const payment=Math.min(d.balance,d.min,left);
        d.balance-=payment;
        left-=payment;
        if(left<=0.005)break;
      }

      while(left>0.005){
        const live=priorityDebts(strategy,items);
        if(!live.length)break;
        const d=live[0];
        const payment=Math.min(d.balance,left);
        d.balance-=payment;
        left-=payment;
      }

      for(const d of items){
        if(d.balance<=0.005 && !closed.some(x=>x.id===d.id))closed.push({id:d.id,name:d.name,month});
      }

      const after=items.reduce((s,d)=>s+Math.max(0,d.balance),0);
      if(after<=0.01)return{months:month,totalInterest,warning:null,closed};
      if(month>6&&after>=before-0.01)return{months:null,totalInterest:null,warning:'При текущем бюджете долг почти не уменьшается. Увеличь месячный платёж.',closed};
    }
    return{months:null,totalInterest:null,warning:'Расчёт превышает 50 лет. Проверь ставки и месячный бюджет.',closed};
  }

  function payoffDate(months){
    if(!months)return'';
    const d=new Date();
    d.setDate(1);
    d.setMonth(d.getMonth()+months);
    return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(d);
  }

  function percentPaid(d){return d.original>0?clamp((d.original-d.balance)/d.original*100,0,100):0}

  function dueStatus(d){
    if(!d.due)return null;
    const due=parseDateOnly(d.due);if(!due)return null;
    const now=new Date();
    const todayMid=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);
    const diff=daysBetween(todayMid,due);
    if(diff<0)return{kind:'overdue',text:`Просрочено на ${Math.abs(diff)} дн.`};
    if(diff===0)return{kind:'today',text:'Платёж сегодня'};
    if(diff<=7)return{kind:'soon',text:`Платёж через ${diff} дн.`};
    return{kind:'later',text:fmtDate(d.due)};
  }

  function planningHorizon(){
    const salary=salaryCountdown();
    if(salary){
      const d=salary.date;
      const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return{date,days:Math.max(1,salary.days||1),salary:true,label:salary.days===0?'зарплата сегодня':`до зарплаты ${salary.days} дн.`};
    }
    const now=new Date();
    const last=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    const date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
    return{date,days:Math.max(1,last-now.getDate()+1),salary:false,label:`${Math.max(1,last-now.getDate()+1)} дн. до конца месяца`};
  }

  function debtObligationsUntil(targetDate){
    return state.debts.filter(d=>d.min>0&&d.due&&d.due<=targetDate).slice().sort((a,b)=>a.due.localeCompare(b.due));
  }

  function planningStats(){
    const activePayments=state.scheduledPayments.filter(x=>!x.paid);
    const activeReceivables=state.receivables.filter(x=>!x.settled);
    const currentMonth=monthKey();
    const scheduledTotal=activePayments.reduce((s,x)=>s+x.amount,0);
    const scheduledMonth=activePayments.filter(x=>x.due.slice(0,7)===currentMonth).reduce((s,x)=>s+x.amount,0);
    const receivableTotal=activeReceivables.reduce((s,x)=>s+x.amount,0);
    const settledReceivables=state.receivables.filter(x=>x.settled);
    const receivableSettled=settledReceivables.reduce((s,x)=>s+x.amount,0);
    const now=parseDateOnly(today());
    const overdue=activeReceivables.filter(x=>x.due&&parseDateOnly(x.due)<now);
    const receivableOverdue=overdue.reduce((s,x)=>s+x.amount,0);
    const nextPayment=activePayments.slice().sort((a,b)=>a.due.localeCompare(b.due)||(a.createdAt-b.createdAt))[0]||null;
    const nextReceivable=activeReceivables.slice().sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||(a.createdAt-b.createdAt))[0]||null;
    const horizon=planningHorizon();
    const scheduledUntilPayday=activePayments.filter(x=>x.due<=horizon.date).reduce((s,x)=>s+x.amount,0);
    const debtDue=debtObligationsUntil(horizon.date);
    const debtDueTotal=debtDue.reduce((s,d)=>s+Math.min(d.min,d.balance),0);
    return{activePayments,activeReceivables,settledReceivables,scheduledTotal,scheduledMonth,receivableTotal,receivableSettled,receivableOverdue,overdue,nextPayment,nextReceivable,horizon,scheduledUntilPayday,debtDue,debtDueTotal};
  }

  function safeSpendingGuide(){
    const t=totals();
    const p=planningStats();
    const reserve=Math.max(0,Number(state.settings.reserveFloor)||0);
    const obligations=p.scheduledUntilPayday+p.debtDueTotal;
    const freeCash=Math.max(0,t.available-reserve-obligations);
    const cashPerDay=freeCash/Math.max(1,p.horizon.days);
    let safe=cashPerDay;
    if(state.settings.spendBudget>0){
      const budgetLeft=Math.max(0,state.settings.spendBudget-t.lifestyleExpense-p.scheduledMonth);
      const budgetPerDay=budgetLeft/Math.max(1,daysLeftInMonth());
      safe=Math.min(safe,budgetPerDay);
    }
    return{safe:Math.max(0,safe),freeCash,obligations,reserve,horizon:p.horizon,hasBasis:t.available!==0||state.settings.spendBudget>0||obligations>0};
  }

  function addRecurringDate(date,recurrence){
    const d=parseDateOnly(date);if(!d)return date;
    const y=d.getFullYear(),m=d.getMonth(),day=d.getDate();
    if(recurrence==='monthly'){
      const first=new Date(y,m+1,1,12);const last=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
      const next=new Date(first.getFullYear(),first.getMonth(),Math.min(day,last),12);
      return `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`;
    }
    if(recurrence==='yearly'){
      const last=new Date(y+1,m+1,0).getDate();const next=new Date(y+1,m,Math.min(day,last),12);
      return `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`;
    }
    return date;
  }

  function recurrenceLabel(r){return r==='monthly'?'ежемесячно':r==='yearly'?'ежегодно':''}

  function ensureNextRecurringPayment(x){
    if(!x||x.recurrence==='once'||!x.paid)return null;
    if(x.nextOccurrenceId&&state.scheduledPayments.some(i=>i.id===x.nextOccurrenceId))return state.scheduledPayments.find(i=>i.id===x.nextOccurrenceId);
    const nextId=uid();
    const next={id:nextId,name:x.name,amount:x.amount,due:addRecurringDate(x.due,x.recurrence),category:x.category,note:x.note,recurrence:x.recurrence,seriesId:x.seriesId||x.id,previousOccurrenceId:x.id,nextOccurrenceId:'',generatedFrom:x.id,paid:false,paidAt:'',transactionId:'',createdAt:Date.now()};
    x.nextOccurrenceId=nextId;
    state.scheduledPayments.push(next);
    return next;
  }

  function daysDiffFromToday(date){
    const d=parseDateOnly(date);
    const t=parseDateOnly(today());
    return d&&t?daysBetween(t,d):null;
  }

  function planDueLabel(date,done=false,doneAt=''){
    if(done)return doneAt?`Оплачено ${fmtDate(doneAt)}`:'Оплачено';
    if(!date)return'Без срока';
    const diff=daysDiffFromToday(date);
    if(diff<0)return`Просрочено на ${Math.abs(diff)} дн.`;
    if(diff===0)return'Сегодня';
    if(diff===1)return'Завтра';
    if(diff<=7)return`Через ${diff} дн.`;
    return fmtDate(date);
  }

  function txIconLabel(category,type){
    if(type==='income')return'↗';
    const map={'Еда':'ЕД','Аренда':'ДМ','Транспорт':'ТР','Покупки':'ПК','Развлечения':'РЗ','Подписки':'ПД','Здоровье':'ЗД','Путешествия':'ПТ','Погашение долга':'ДЛ','Возврат долга мне':'↙','Дал в долг':'→','В отложенные':'→','Из отложенных':'←','Из отложенных денег':'−'};
    return map[category]||String(category||'Р').trim().slice(0,2).toUpperCase()||'Р';
  }

  function txRow(t,{compact=false}={}){
    const kind=t.kind||t.type;
    const isSavings=kind==='savings_transfer';
    const isSavingsSpend=kind==='savings_spend';
    const isTransfer=['transfer','savings_transfer','receivable_out','receivable_return'].includes(kind);
    const sign=isSavings?(t.type==='expense'?'→':'←'):(kind==='receivable_out'?'→':kind==='receivable_return'?'←':(t.type==='income'?'+':'−'));
    const note=[fmtDate(t.date),isSavingsSpend?'из отложенных':(t.merchant||''),t.note].filter(Boolean).join(' • ');
    const amountClass=isTransfer?'transfer':(t.type==='income'?'income':'');
    return `<button class="tx-row tx-row-button ${isSavings?'savings-move-row':''}${isSavingsSpend?' savings-spend-row':''}" type="button" data-tx-id="${esc(t.id)}" aria-label="Открыть операцию ${esc(t.category)} ${money2(t.amount)}">
      <div class="tx-mark ${amountClass}">${esc(txIconLabel(t.category,t.type))}</div>
      <div class="tx-main"><b>${esc(t.category||'Без категории')}</b><span>${esc(note||fmtDate(t.date))}</span></div>
      <div class="tx-side"><div class="tx-amount ${amountClass}">${sign} ${money2(t.amount)}</div>${compact?'':'<span class="tx-chevron">›</span>'}</div>
    </button>`;
  }

  function sortedTransactions(){
    return state.transactions.slice().sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt-a.createdAt));
  }

  function renderDashboard(){
    const t=totals();
    const p=planningStats();
    const guide=safeSpendingGuide();
    const monthName=new Intl.DateTimeFormat('ru-RU',{month:'long'}).format(new Date());
    $('monthCaption').textContent=monthName.charAt(0).toUpperCase()+monthName.slice(1);

    $('availableMetric').textContent=balanceMasked?'••••••':money2(t.available);
    $('availableMetric').classList.toggle('masked',balanceMasked);
    $('savingsMetric').textContent=balanceMasked?'••••••':money2(t.saved);
    $('savingsMetric').classList.toggle('masked',balanceMasked);

    const savingsNet=t.savingsNet||0;
    $('savingsMonthDelta').textContent=savingsNet>0?`＋ ${money(savingsNet)} в отложенные за месяц`:savingsNet<0?`− ${money(Math.abs(savingsNet))} из отложенных за месяц`:'Без изменений за месяц';
    $('savingsMonthDelta').className='trend-chip'+(savingsNet>0?' good':savingsNet<0?' bad':'');
    const capital=Math.max(0,t.totalCapital);
    $('savingsShare').textContent=`${capital>0?clamp(t.saved/capital*100,0,100).toFixed(0):0}% всех денег`;
    const goalAmount=Math.max(0,Number(state.settings.savingsGoalAmount)||0);
    const goalPct=goalAmount>0?clamp(t.saved/goalAmount*100,0,100):0;
    $('savingsGoalLabel').textContent=state.settings.savingsGoalName||'Цель не задана';
    $('savingsGoalValue').textContent=goalAmount>0?`${money(t.saved)} из ${money(goalAmount)}`:'Добавить цель';
    $('savingsGoalProgress').style.width=`${goalPct.toFixed(1)}%`;

    $('cashflowDelta').textContent=`${t.cashflow>=0?'＋':'−'} ${money(Math.abs(t.cashflow))} за месяц`;
    $('cashflowDelta').className='trend-chip'+(t.cashflow>0?' good':t.cashflow<0?' bad':'');

    $('expenseMetric').textContent=money(t.lifestyleExpense);
    $('expenseSub').textContent=t.debtPayments>0?`+ ${money(t.debtPayments)} по долгам`:'обычные расходы';
    $('debtMetric').textContent=money(t.debt);
    $('debtSub').textContent=state.debts.length?`${state.debts.length} активн. · мин. ${money(t.minPayments)}`:'нет долгов';
    $('receivableMetric').textContent=money(p.receivableTotal);
    $('receivableMetricSub').textContent=p.activeReceivables.length?`${p.activeReceivables.length} ждут возврата`:'никто не должен';
    $('safeDailyMetric').textContent=guide.hasBasis?money(guide.safe):'—';
    $('safeDailySub').textContent=guide.hasBasis?`${guide.horizon.label} · обязательства ${money(guide.obligations)}`:'задай стартовый баланс';

    const needsSetup=state.settings.startBalance===0&&state.settings.spendBudget===0&&state.settings.debtBudget===0&&!state.transactions.length&&!state.debts.length&&!state.scheduledPayments.length&&!state.receivables.length;
    $('setupBanner').classList.toggle('hidden',!needsSetup);

    const candidates=[];
    if(p.nextPayment)candidates.push({kind:'scheduled',name:p.nextPayment.name,amount:p.nextPayment.amount,due:p.nextPayment.due,label:p.nextPayment.category});
    for(const d of p.debtDue)candidates.push({kind:'debt',name:d.name,amount:Math.min(d.min,d.balance),due:d.due,label:'Минимальный платёж по долгу',id:d.id});
    candidates.sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
    const next=candidates[0];
    const brief=$('nextActionCard');
    if(next){
      brief.innerHTML=`<div class="daily-brief-main"><div><span class="daily-brief-kicker">${esc(planDueLabel(next.due))}</span><strong>${esc(next.name)}</strong><small>${esc(next.label)}</small></div><b>${money2(next.amount)}</b></div><div class="daily-brief-summary"><span>До ${p.horizon.salary?'зарплаты':'конца месяца'} зарезервировано</span><strong>${money2(guide.obligations)}</strong></div><div class="daily-brief-footer"><span>После резерва и обязательств</span><b>${money2(guide.freeCash)} свободно</b>${next.kind==='debt'?`<button class="secondary-btn mini-action" type="button" data-pay-debt="${esc(next.id)}">Оплатить</button>`:''}</div>`;
    }else{
      brief.innerHTML=`<div class="daily-clear"><span class="daily-clear-dot">✓</span><div><strong>Ближайших обязательств нет</strong><p>${guide.horizon.label}. После резерва свободно ${money2(guide.freeCash)}.</p></div><button class="secondary-btn mini-action" type="button" data-new-scheduled>Запланировать</button></div>`;
    }

    const recent=sortedTransactions().slice(0,3);
    $('recentList').innerHTML=recent.length?recent.map(t=>txRow(t,{compact:true})).join(''):`<div class="empty-state"><strong>Операций пока нет</strong>Добавь первый доход или расход.</div>`;
  }

  function txDayTitle(date){
    if(date===today())return'Сегодня';
    const y=new Date();y.setDate(y.getDate()-1);
    const yd=`${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`;
    if(date===yd)return'Вчера';
    return fmtDate(date);
  }

  function filteredTransactions(){
    const query=($('txSearch')?.value||'').trim().toLowerCase();
    let rows=sortedTransactions();
    if(currentTxFilter==='income')rows=rows.filter(t=>t.type==='income'&&!['transfer','savings_transfer','receivable_return'].includes(t.kind||''));
    if(currentTxFilter==='expense')rows=rows.filter(t=>t.type==='expense'&&!['transfer','savings_transfer','debt_payment','receivable_out'].includes(t.kind||'expense')&&t.category!=='Погашение долга');
    if(currentTxFilter==='debt')rows=rows.filter(t=>(t.kind||'')==='debt_payment'||t.category==='Погашение долга');
    if(currentTxFilter==='transfer')rows=rows.filter(t=>['transfer','savings_transfer'].includes(t.kind||''));
    if(currentTxFilter==='receivable')rows=rows.filter(t=>['receivable_out','receivable_return'].includes(t.kind||''));
    if(query)rows=rows.filter(t=>`${t.category} ${t.note} ${t.merchant||''}`.toLowerCase().includes(query));
    return rows;
  }

  function renderTransactions(){
    const all=filteredTransactions();
    const rows=all.slice(0,txVisibleLimit);
    const groups=[];
    for(const t of rows){
      let g=groups[groups.length-1];
      if(!g||g.date!==t.date){g={date:t.date,rows:[]};groups.push(g)}
      g.rows.push(t);
    }
    $('txList').innerHTML=groups.length?groups.map(g=>{
      const net=g.rows.reduce((sum,t)=>{
        if(['transfer','savings_transfer'].includes(t.kind||''))return sum;
        return sum+(t.type==='income'?t.amount:-t.amount);
      },0);
      return `<section class="tx-day-group"><div class="tx-day-head"><strong>${esc(txDayTitle(g.date))}</strong><span class="${net>0?'income':''}">${net===0?'':`${net>0?'+':'−'} ${money2(Math.abs(net))}`}</span></div>${g.rows.map(t=>txRow(t)).join('')}</section>`;
    }).join(''):`<div class="empty-state"><strong>Ничего не найдено</strong>Измени фильтр или добавь новую операцию.</div>`;
    const more=$('loadMoreTxBtn');
    if(more){more.classList.toggle('hidden',all.length<=txVisibleLimit);more.textContent=`Показать ещё · ${Math.max(0,all.length-txVisibleLimit)}`}
    qsa('.filter-chip[data-filter]').forEach(x=>x.classList.toggle('active',x.dataset.filter===currentTxFilter));
    const mf=$('moreFilterBtn');if(mf)mf.classList.toggle('active',!['all','income','expense'].includes(currentTxFilter));
  }

  function debtCard(d,index){
    const pct=percentPaid(d);
    const due=dueStatus(d);
    const dueWarn=due&&['overdue','today','soon'].includes(due.kind)?`<div class="debt-due-warning">${esc(due.text)}${d.min>0?` · минимум ${money(d.min)}`:''}</div>`:'';
    return `<article class="debt-card ${index===0?'priority':''}">
      <div class="debt-card-head">
        <div><div class="debt-card-name">${esc(d.name)}</div>${index===0?'<span class="priority-badge">Приоритет №1</span>':''}</div>
        <div class="debt-card-balance">${money2(d.balance)}<small>из ${money(d.original)}</small></div>
      </div>
      <div class="progress success"><span style="width:${pct.toFixed(1)}%"></span></div>
      <div class="debt-foot"><span>Погашено ${pct.toFixed(0)}%</span><span>${money(Math.max(0,d.original-d.balance))}</span></div>
      <div class="debt-meta-grid">
        <div class="debt-meta-item"><span>APR</span><strong>${d.apr.toFixed(2)}%</strong></div>
        <div class="debt-meta-item"><span>Минимум</span><strong>${money(d.min)}</strong></div>
        <div class="debt-meta-item"><span>След. платёж</span><strong>${due?esc(due.text):'—'}</strong></div>
      </div>
      ${dueWarn}
      <div class="debt-actions">
        <button class="primary-btn" type="button" data-pay-debt="${esc(d.id)}">Платёж</button>
        <button class="secondary-btn" type="button" data-edit-debt="${esc(d.id)}">Изменить</button>
        <button class="danger-link" type="button" data-del-debt="${esc(d.id)}">Удалить</button>
      </div>
    </article>`;
  }

  function renderDebts(){
    const t=totals();
    const sim=simulatePayoff();
    const p=planningStats();
    $('debtTotalSummary').textContent=money2(t.debt);
    $('debtCountSummary').textContent=`${state.debts.length} активн.`;
    $('minPaymentsSummary').textContent=money(t.minPayments);
    $('debtBudgetSummary').textContent=state.settings.debtBudget>0?`бюджет ${money(state.settings.debtBudget)}`:'бюджет не задан';
    $('payoffSummary').textContent=sim.months?`~ ${sim.months} мес.`:'—';
    $('payoffDateSummary').textContent=sim.months?payoffDate(sim.months):(sim.warning||'нужны данные');
    $('interestSummary').textContent=sim.totalInterest===null?'—':money2(sim.totalInterest);
    $('strategyCaption').textContent=state.settings.debtStrategy==='avalanche'?'avalanche · высокий % первым':'snowball · маленький долг первым';

    const ordered=priorityDebts();
    $('debtList').innerHTML=ordered.length?ordered.map(debtCard).join(''):`<div class="surface" style="grid-column:1/-1"><div class="empty-state"><strong>Долгов пока нет</strong>Добавь кредит, рассрочку или личный долг.<br><button class="secondary-btn" type="button" data-create-debt>Добавить долг</button></div></div>`;
    renderPlan(sim);renderStrategyCompare();

    $('closedDebtCount').textContent=state.closedDebts.length;
    $('closedDebtsSection').classList.toggle('hidden',!state.closedDebts.length);
    $('closedDebtList').innerHTML=state.closedDebts.slice().sort((a,b)=>b.closedAt.localeCompare(a.closedAt)).map(d=>`<div class="closed-debt-row"><span class="closed-check">✓</span><div><strong>${esc(d.name)}</strong><small>Закрыт ${fmtDate(d.closedAt)} · исходно ${money2(d.original)}</small></div><button class="danger-text" type="button" data-del-closed-debt="${esc(d.id)}">Удалить из архива</button></div>`).join('');

    $('receivableTotalSummary').textContent=money2(p.receivableTotal);
    $('receivableCountSummary').textContent=p.activeReceivables.length?`${p.activeReceivables.length} ждут возврата`:'никто не должен';
    $('receivableOverdueSummary').textContent=money2(p.receivableOverdue);
    $('receivableOverdueCount').textContent=p.overdue.length?`${p.overdue.length} просрочено`:'всё вовремя';
    $('receivableNextAmount').textContent=p.nextReceivable?money2(p.nextReceivable.amount):'—';
    $('receivableNextLabel').textContent=p.nextReceivable?`${p.nextReceivable.person} · ${p.nextReceivable.due?planDueLabel(p.nextReceivable.due):'без срока'}`:'ничего не ожидается';
    $('receivableSettledSummary').textContent=money2(p.receivableSettled);
    $('receivableSettledCount').textContent=`${p.settledReceivables.length} закрыт.`;
    const receivables=sortedReceivables();
    $('receivableList').innerHTML=receivables.length?receivables.map(receivableRow).join(''):`<div class="empty-state"><strong>Список пуст</strong>Добавь человека или компанию, которые должны вернуть деньги.<br><button class="secondary-btn" type="button" data-new-receivable>Добавить запись</button></div>`;

    $('owedDebtsView').classList.toggle('hidden',currentDebtView!=='owed');
    $('receivableDebtsView').classList.toggle('hidden',currentDebtView!=='receivable');
    qsa('[data-debt-view]').forEach(btn=>{const active=btn.dataset.debtView===currentDebtView;btn.classList.toggle('active',active);btn.setAttribute('aria-selected',active?'true':'false')});
    $('debtAddContextBtn').textContent=currentDebtView==='owed'?'+ Добавить долг':'+ Мне должны';
  }

  function renderPlan(sim){
    const el=$('planPanel');
    if(!state.debts.length){el.innerHTML='<div class="empty-state"><strong>План пока не нужен</strong>Когда появятся долги, здесь будет последовательность их закрытия.</div>';return}
    const ordered=priorityDebts();
    const callout=sim.months
      ?`При бюджете <strong>${money(state.settings.debtBudget)} / мес.</strong> ориентир — <strong>${sim.months} мес.</strong>, примерно до <strong>${esc(payoffDate(sim.months))}</strong>. Расчётные проценты: <strong>${money2(sim.totalInterest)}</strong>.`
      :esc(sim.warning||'Нужны данные для прогноза.');
    el.innerHTML=`
      <div class="plan-callout ${sim.warning?'warning':''}">${callout}</div>
      <div class="plan-order">${ordered.map((d,i)=>`<div class="plan-order-row"><div class="order-num">${i+1}</div><div class="order-main"><strong>${esc(d.name)}</strong><span>${d.apr.toFixed(2)}% · минимум ${money(d.min)}</span></div><div class="order-balance">${money2(d.balance)}</div></div>`).join('')}</div>
      <div class="inline-note">Модель приблизительная: проценты начисляются помесячно, минимальные платежи учитываются для всех долгов, а весь свободный остаток бюджета идёт в приоритетный долг. Банковские условия могут отличаться.</div>`;
  }

  function renderStrategyCompare(){
    const el=$('strategyCompare');
    if(!state.debts.length){el.innerHTML='<div class="empty-state"><strong>Нечего сравнивать</strong>Добавь хотя бы один долг.</div>';return}
    const avalanche=simulatePayoff('avalanche');
    const snowball=simulatePayoff('snowball');
    const card=(name,data,key)=>`<div class="strategy-card ${state.settings.debtStrategy===key?'active':''}"><span>${name}</span><strong>${data.months?`${data.months} мес.`:'—'}</strong><small>${data.totalInterest!==null?`${money2(data.totalInterest)} процентов`:esc(data.warning||'Нет расчёта')}</small></div>`;
    let insight='Обе стратегии пока дают одинаковый прогноз.';
    if(avalanche.totalInterest!==null&&snowball.totalInterest!==null){
      const diff=snowball.totalInterest-avalanche.totalInterest;
      if(diff>0.01)insight=`Avalanche экономит примерно <strong>${money2(diff)}</strong> процентов при этих вводных.`;
      else if(diff<-0.01)insight=`Snowball в этой модели экономит примерно <strong>${money2(Math.abs(diff))}</strong> процентов.`;
    }
    if(avalanche.months&&snowball.months&&avalanche.months!==snowball.months){
      const faster=avalanche.months<snowball.months?'Avalanche':'Snowball';
      insight+=` ${faster} также быстрее примерно на <strong>${Math.abs(avalanche.months-snowball.months)} мес.</strong>`;
    }
    el.innerHTML=`<div class="compare-grid">${card('Avalanche',avalanche,'avalanche')}${card('Snowball',snowball,'snowball')}</div><div class="strategy-savings">${insight}</div>`;
  }

  function sortedScheduled(){
    const active=state.scheduledPayments.filter(x=>!x.paid).slice().sort((a,b)=>a.due.localeCompare(b.due)||(a.createdAt-b.createdAt));
    const recentPaid=state.scheduledPayments.filter(x=>x.paid).slice().sort((a,b)=>(b.paidAt||b.due).localeCompare(a.paidAt||a.due)).slice(0,6);
    return active.concat(recentPaid);
  }

  function sortedReceivables(){
    return state.receivables.slice().sort((a,b)=>Number(a.settled)-Number(b.settled)||(a.due||'9999').localeCompare(b.due||'9999')||(a.createdAt-b.createdAt));
  }

  function scheduledRow(x){
    const late=!x.paid&&daysDiffFromToday(x.due)<0;
    const repeat=recurrenceLabel(x.recurrence);
    return `<div class="plan-money-row ${x.paid?'done':''} ${late?'late':''}">
      <label class="plan-check" aria-label="${x.paid?'Снять отметку оплачено':'Отметить оплачено'}"><input type="checkbox" data-toggle-scheduled="${esc(x.id)}" ${x.paid?'checked':''} /><span aria-hidden="true">✓</span></label>
      <div class="plan-money-main"><strong>${esc(x.name)}</strong><span>${esc(planDueLabel(x.due,x.paid,x.paidAt))} · ${esc(x.category)}${repeat?` · ${esc(repeat)}`:''}${x.note?` · ${esc(x.note)}`:''}</span></div>
      <div class="plan-money-side"><b>${money2(x.amount)}</b><div class="row-mini-actions"><button type="button" data-edit-scheduled="${esc(x.id)}">Изменить</button><button type="button" class="danger-text" data-del-scheduled="${esc(x.id)}">Удалить</button></div></div>
    </div>`;
  }

  function receivableRow(x){
    const late=!x.settled&&x.due&&daysDiffFromToday(x.due)<0;
    return `<div class="plan-money-row ${x.settled?'done':''} ${late?'late':''}">
      <label class="plan-check" aria-label="${x.settled?'Снять отметку вернули':'Отметить, что вернули'}"><input type="checkbox" data-toggle-receivable="${esc(x.id)}" ${x.settled?'checked':''} /><span aria-hidden="true">✓</span></label>
      <div class="plan-money-main"><strong>${esc(x.person)}</strong><span>${esc(x.settled?(x.settledAt?`Вернули ${fmtDate(x.settledAt)}`:'Вернули'):(x.due?planDueLabel(x.due):'Срок не задан'))}${x.note?` · ${esc(x.note)}`:''}</span></div>
      <div class="plan-money-side"><b>${money2(x.amount)}</b><div class="row-mini-actions"><button type="button" data-edit-receivable="${esc(x.id)}">Изменить</button><button type="button" class="danger-text" data-del-receivable="${esc(x.id)}">Удалить</button></div></div>
    </div>`;
  }

  function renderPlans(){
    const p=planningStats();
    $('scheduledTotalSummary').textContent=money2(p.scheduledTotal);
    $('scheduledCountSummary').textContent=p.activePayments.length?`${p.activePayments.length} ждут оплаты`:'ничего не ожидает';
    $('scheduledPaydaySummary').textContent=money2(p.scheduledUntilPayday+p.debtDueTotal);
    $('scheduledPaydayLabel').textContent=p.horizon.salary?p.horizon.label:'день зарплаты не задан';
    $('scheduledNextAmount').textContent=p.nextPayment?money2(p.nextPayment.amount):'—';
    $('scheduledNextSummary').textContent=p.nextPayment?`${p.nextPayment.name} · ${planDueLabel(p.nextPayment.due)}`:'ничего не запланировано';
    $('debtDueSummary').textContent=money2(p.debtDueTotal);
    $('debtDueCount').textContent=p.debtDue.length?`${p.debtDue.length} до ${p.horizon.salary?'зарплаты':'конца месяца'}`:'нет ближайших';

    const payments=sortedScheduled();
    $('scheduledList').innerHTML=payments.length?payments.map(scheduledRow).join(''):`<div class="empty-state"><strong>Нет обязательных платежей</strong>Добавь аренду, страховку или счёт. Можно сделать платёж ежемесячным.<br><button class="secondary-btn" type="button" data-new-scheduled>Добавить платёж</button></div>`;
    $('debtObligationsList').innerHTML=p.debtDue.length?p.debtDue.map(d=>`<div class="debt-obligation-row"><div><strong>${esc(d.name)}</strong><span>${esc(planDueLabel(d.due))} · автоматически из долга</span></div><b>${money2(Math.min(d.min,d.balance))}</b><button class="secondary-btn mini-action" type="button" data-pay-debt="${esc(d.id)}">Оплатить</button></div>`).join(''):`<div class="empty-state"><strong>Нет ближайших минимумов</strong>Если у долга задана дата и минимальный платёж, он появится здесь автоматически.</div>`;
  }

  function savingsLedgerItems(){
    const movements=state.transactions.filter(t=>['savings_transfer','savings_spend'].includes(t.kind||''))
      .slice().sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt-b.createdAt));
    let running=0;
    const withBalance=movements.map(t=>{running+=savingsImpact(t);return{...t,balanceAfter:Math.max(0,running)}});
    return withBalance.reverse();
  }

  function savingsLedgerRow(t){
    const toSavings=(t.kind||'')==='savings_transfer'&&t.type==='expense';
    const fromSavings=(t.kind||'')==='savings_transfer'&&t.type==='income';
    const spend=(t.kind||'')==='savings_spend';
    const title=toSavings?'Отложил':fromSavings?'Вернул в доступные':`Потратил · ${t.category||'Расход'}`;
    const sign=toSavings?'+':'−';
    const cls=toSavings?'positive':spend?'spend':'negative';
    return `<div class="savings-ledger-row" data-savings-ledger-id="${esc(t.id)}">
      <div class="savings-ledger-icon ${cls}">${toSavings?'↓':fromSavings?'↑':'−'}</div>
      <div class="savings-ledger-main"><strong>${esc(title)}</strong><span>${esc(fmtDate(t.date))}${t.note?` · ${esc(t.note)}`:''}</span><small>Остаток после: ${money2(t.balanceAfter)}</small></div>
      <div class="savings-ledger-side"><b class="${cls}">${sign} ${money2(t.amount)}</b><div><button type="button" data-edit-savings="${esc(t.id)}">Изменить</button><button type="button" data-delete-savings="${esc(t.id)}">Удалить</button></div></div>
    </div>`;
  }

  function renderSavingsWallet(){
    if(!$('savingsWalletBalance'))return;
    const t=totals();
    const items=savingsLedgerItems();
    const capital=Math.max(0,t.totalCapital);
    $('savingsWalletBalance').textContent=money2(t.saved);
    $('savingsWalletShare').textContent=`${capital>0?clamp(t.saved/capital*100,0,100).toFixed(0):0}% всех денег`;
    $('savingsAddedMonth').textContent=money2(t.savingsAdded||0);
    $('savingsReturnedMonth').textContent=money2(t.savingsReturned||0);
    $('savingsSpentMonth').textContent=money2(t.savingsSpent||0);
    $('savingsWalletGoalName').textContent=state.settings.savingsGoalName||'Не задана';
    $('savingsWalletGoalValue').textContent=state.settings.savingsGoalAmount>0?`${money(t.saved)} / ${money(state.settings.savingsGoalAmount)}`:'Добавить →';
    $('savingsLedgerCount').textContent=`${items.length} ${items.length===1?'движение':'движений'}`;
    $('savingsLedgerList').innerHTML=items.length?items.map(savingsLedgerRow).join(''):`<div class="empty-state"><strong>История пока пустая</strong>Отложи первую сумму — здесь появится полный журнал движений.</div>`;
  }

  function renderSettings(){
    const s=state.settings;
    $('startBalance').value=s.startBalance||'';
    $('spendBudget').value=s.spendBudget||'';
    $('debtBudget').value=s.debtBudget||'';
    $('debtStrategy').value=s.debtStrategy;
    $('salaryDay').value=s.salaryDay||'';
    $('reserveFloor').value=s.reserveFloor||'';
    if($('savingsGoalName'))$('savingsGoalName').value=s.savingsGoalName||'';
    if($('savingsGoalAmount'))$('savingsGoalAmount').value=s.savingsGoalAmount||'';
    if($('backupStatus'))$('backupStatus').textContent=state.meta.lastBackupAt?`Последняя резервная копия: ${fmtDate(state.meta.lastBackupAt.slice(0,10))}`:'Резервная копия ещё не создавалась.';
  }

  function render(){
    renderDashboard();
    renderTransactions();
    renderDebts();
    renderPlans();
    renderSavingsWallet();
    renderSettings();
  }

  function showPage(id){
    qsa('.page').forEach(p=>p.classList.toggle('hidden',p.id!==id));
    qsa('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.tab===id));
    $('settingsShortcut')?.classList.toggle('settings-active',id==='settings');
    window.scrollTo({top:0,behavior:'smooth'});
  }

  qsa('.nav-item').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.tab)));
  $('settingsShortcut')?.addEventListener('click',()=>showPage('settings'));
  document.body.addEventListener('click',e=>{
    const go=e.target.closest('[data-go]');
    if(go){showPage(go.dataset.go);return}
  });

  function openDialog(id){const d=$(id);if(d&&typeof d.showModal==='function')d.showModal()}
  function closeDialog(id){const d=$(id);if(d?.open)d.close()}
  qsa('[data-close]').forEach(b=>b.addEventListener('click',()=>closeDialog(b.dataset.close)));
  qsa('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close()}));

  function prepTransaction(type='expense',tx=null){
    $('txForm').reset();
    $('txId').value=tx?.id||'';
    $('txType').value=tx?.type||type;
    $('txAmount').value=tx?.amount||'';
    $('txCategory').value=tx?.category||'';
    $('txDate').value=tx?.date||today();
    $('txNote').value=tx?.note||'';
    $('txDialogTitle').textContent=tx?'Изменить операцию':'Новая операция';
    $('txSubmit').textContent=tx?'Сохранить':'Добавить';
    openDialog('txDialog');
    setTimeout(()=>$('txAmount').focus(),80);
  }

  $('quickIncome').addEventListener('click',()=>prepTransaction('income'));
  $('quickExpense').addEventListener('click',()=>prepTransaction('expense'));
  $('addTxBtn').addEventListener('click',()=>prepTransaction('expense'));

  $('txForm').addEventListener('submit',e=>{
    e.preventDefault();
    const amount=parseDecimalInput($('txAmount').value);
    if(!(amount>0))return showToast('Укажи сумму больше нуля');
    const id=$('txId').value||uid();
    const existing=state.transactions.find(t=>t.id===id);
    const item={
      id,
      type:$('txType').value==='income'?'income':'expense',
      kind:$('txType').value==='income'?'income':'expense',
      amount,
      category:$('txCategory').value.trim()||'Без категории',
      date:$('txDate').value||today(),
      note:$('txNote').value.trim(),
      merchant:existing?.merchant||'',
      externalId:existing?.externalId||'',
      importedByAI:Boolean(existing?.importedByAI),
      createdAt:existing?.createdAt||Date.now()
    };
    const i=state.transactions.findIndex(t=>t.id===id);
    if(i>=0)state.transactions[i]=item;else state.transactions.push(item);
    closeDialog('txDialog');
    persist(i>=0?'Операция обновлена':'Операция добавлена');
  });

  $('txSearch').addEventListener('input',()=>{txVisibleLimit=50;renderTransactions()});
  qsa('.filter-chip[data-filter]').forEach(btn=>btn.addEventListener('click',()=>{
    currentTxFilter=btn.dataset.filter||'all';txVisibleLimit=50;renderTransactions();
  }));
  $('moreFilterBtn')?.addEventListener('click',()=>openDialog('txFilterDialog'));
  $('loadMoreTxBtn')?.addEventListener('click',()=>{txVisibleLimit+=50;renderTransactions()});
  document.body.addEventListener('click',e=>{
    const choose=e.target.closest('[data-choose-filter]');
    if(choose){currentTxFilter=choose.dataset.chooseFilter||'all';txVisibleLimit=50;closeDialog('txFilterDialog');renderTransactions();return}
    const debtView=e.target.closest('[data-debt-view]');
    if(debtView){currentDebtView=debtView.dataset.debtView==='receivable'?'receivable':'owed';renderDebts();return}
  });

  function prepDebt(d=null){
    $('debtForm').reset();
    $('debtId').value=d?.id||'';
    $('debtName').value=d?.name||'';
    $('debtBalance').value=d?.balance||'';
    $('debtApr').value=d?.apr??0;
    $('debtMin').value=d?.min??0;
    $('debtDue').value=d?.due||'';
    $('debtDialogTitle').textContent=d?'Изменить долг':'Новый долг';
    $('debtSubmit').textContent=d?'Сохранить':'Добавить долг';
    openDialog('debtDialog');
    setTimeout(()=>$('debtName').focus(),80);
  }

  $('quickDebt').addEventListener('click',()=>{currentDebtView='owed';prepDebt()});
  $('debtAddContextBtn')?.addEventListener('click',()=>currentDebtView==='receivable'?prepReceivable():prepDebt());

  $('debtForm').addEventListener('submit',e=>{
    e.preventDefault();
    const balance=parseDecimalInput($('debtBalance').value);
    if(!(balance>0))return showToast('Укажи остаток долга');
    const id=$('debtId').value||uid();
    const existing=state.debts.find(d=>d.id===id);
    const item={
      id,
      name:$('debtName').value.trim()||'Долг',
      balance,
      original:existing?Math.max(existing.original,balance):balance,
      apr:Math.max(0,parseDecimalInput($('debtApr').value)||0),
      min:Math.max(0,parseDecimalInput($('debtMin').value)||0),
      due:$('debtDue').value||''
    };
    const i=state.debts.findIndex(d=>d.id===id);
    if(i>=0)state.debts[i]=item;else state.debts.push(item);
    closeDialog('debtDialog');
    persist(i>=0?'Долг обновлён':'Долг добавлен');
  });

  function prepPayment(d){
    $('paymentForm').reset();
    $('paymentDebtId').value=d.id;
    $('paymentAmount').value=d.min>0?Math.min(d.balance,d.min):'';
    $('paymentDate').value=today();
    $('paymentSubtitle').textContent=`${d.name} · осталось ${money2(d.balance)}`;
    openDialog('paymentDialog');
    setTimeout(()=>$('paymentAmount').focus(),80);
  }

  $('paymentForm').addEventListener('submit',e=>{
    e.preventDefault();
    const d=state.debts.find(x=>x.id===$('paymentDebtId').value);
    if(!d)return closeDialog('paymentDialog');
    const amount=parseDecimalInput($('paymentAmount').value);
    if(!(amount>0))return showToast('Укажи сумму платежа');
    const paid=Math.min(amount,d.balance);
    d.balance=Math.max(0,d.balance-paid);
    state.transactions.push({
      id:uid(),type:'expense',kind:'debt_payment',amount:paid,category:'Погашение долга',
      date:$('paymentDate').value||today(),note:$('paymentNote').value.trim()||d.name,createdAt:Date.now()
    });
    const closed=d.balance<=0.005;
    if(closed){
      state.closedDebts.push({...d,balance:0,closedAt:$('paymentDate').value||today()});
      state.debts=state.debts.filter(x=>x.id!==d.id);
    }else if(d.due&&(d.min<=0||paid+0.005>=d.min)&&d.due<=($('paymentDate').value||today())){
      d.due=addRecurringDate(d.due,'monthly');
    }
    closeDialog('paymentDialog');
    persist(closed?'Долг закрыт 🎉':'Платёж записан');
  });

  function prepScheduled(x=null){
    $('scheduledForm').reset();
    $('scheduledId').value=x?.id||'';
    $('scheduledName').value=x?.name||'';
    $('scheduledAmount').value=x?.amount||'';
    $('scheduledDue').value=x?.due||today();
    $('scheduledCategory').value=x?.category||'';
    $('scheduledNote').value=x?.note||'';
    $('scheduledRecurrence').value=x?.recurrence||'once';
    $('scheduledDialogTitle').textContent=x?'Изменить платёж':'Новый платёж';
    $('scheduledSubmit').textContent=x?'Сохранить':'Добавить платёж';
    openDialog('scheduledDialog');
    setTimeout(()=>$('scheduledName').focus(),80);
  }

  function prepReceivable(x=null){
    $('receivableForm').reset();
    $('receivableId').value=x?.id||'';
    $('receivablePerson').value=x?.person||'';
    $('receivableAmount').value=x?.amount||'';
    $('receivableDue').value=x?.due||'';
    $('receivableNote').value=x?.note||'';
    $('receivableMode').value=x?.sourceMode||'record_only';
    $('receivableMode').disabled=Boolean(x);
    $('receivableDialogTitle').textContent=x?'Изменить запись':'Новая запись';
    $('receivableSubmit').textContent=x?'Сохранить':'Добавить запись';
    openDialog('receivableDialog');
    setTimeout(()=>$('receivablePerson').focus(),80);
  }

  // Planner actions are delegated deliberately: this is resilient to DOM refreshes on iOS/PWA.
  document.body.addEventListener('click',e=>{
    const scheduled=e.target.closest('#addScheduledBtn');
    if(scheduled){e.preventDefault();prepScheduled();return}
    const receivable=e.target.closest('#addReceivableBtn');
    if(receivable){e.preventDefault();prepReceivable();return}
  });

  $('scheduledForm').addEventListener('submit',e=>{
    e.preventDefault();
    const amount=parseDecimalInput($('scheduledAmount').value);
    if(!(amount>0))return showToast('Укажи сумму платежа');
    const id=$('scheduledId').value||uid();
    const existing=state.scheduledPayments.find(x=>x.id===id);
    const item={
      id,name:$('scheduledName').value.trim()||'Платёж',amount,
      due:$('scheduledDue').value||today(),category:$('scheduledCategory').value.trim()||'Другое',
      note:$('scheduledNote').value.trim(),recurrence:['monthly','yearly'].includes($('scheduledRecurrence').value)?$('scheduledRecurrence').value:'once',
      seriesId:existing?.seriesId||id,previousOccurrenceId:existing?.previousOccurrenceId||'',nextOccurrenceId:existing?.nextOccurrenceId||'',generatedFrom:existing?.generatedFrom||'',
      paid:Boolean(existing?.paid),paidAt:existing?.paidAt||'',transactionId:existing?.transactionId||'',createdAt:existing?.createdAt||Date.now()
    };
    const i=state.scheduledPayments.findIndex(x=>x.id===id);
    if(i>=0)state.scheduledPayments[i]=item;else state.scheduledPayments.push(item);
    if(item.paid&&item.transactionId){
      const tx=state.transactions.find(t=>t.id===item.transactionId);
      if(tx){tx.amount=item.amount;tx.category=item.category;tx.note=`Обязательный платёж: ${item.name}${item.note?` · ${item.note}`:''}`;tx.merchant=item.name}
    }
    closeDialog('scheduledDialog');
    persist(i>=0?'Платёж обновлён':'Платёж запланирован');
  });

  $('receivableForm').addEventListener('submit',e=>{
    e.preventDefault();
    const amount=parseDecimalInput($('receivableAmount').value);
    if(!(amount>0))return showToast('Укажи сумму');
    const id=$('receivableId').value||uid();
    const existing=state.receivables.find(x=>x.id===id);
    const sourceMode=existing?.sourceMode||($('receivableMode').value==='gave_now'?'gave_now':'record_only');
    const item={
      id,person:$('receivablePerson').value.trim()||'Мне должны',amount,
      due:$('receivableDue').value||'',note:$('receivableNote').value.trim(),sourceMode,
      sourceTransactionId:existing?.sourceTransactionId||'',settled:Boolean(existing?.settled),settledAt:existing?.settledAt||'',transactionId:existing?.transactionId||'',
      createdAt:existing?.createdAt||Date.now()
    };
    if(!existing&&sourceMode==='gave_now'){
      const sourceId=uid();item.sourceTransactionId=sourceId;
      state.transactions.push({id:sourceId,type:'expense',kind:'receivable_out',amount,category:'Дал в долг',date:today(),note:`Дал в долг: ${item.person}${item.note?` · ${item.note}`:''}`,merchant:item.person,externalId:`receivable-out:${id}`,importedByAI:false,origin:'receivable',originId:id,bankReconciled:false,createdAt:Date.now()});
    }
    const i=state.receivables.findIndex(x=>x.id===id);
    if(i>=0)state.receivables[i]=item;else state.receivables.push(item);
    if(item.settled&&item.transactionId){const tx=state.transactions.find(t=>t.id===item.transactionId);if(tx){tx.amount=item.amount;tx.note=`Вернули долг: ${item.person}${item.note?` · ${item.note}`:''}`;tx.merchant=item.person}}
    $('receivableMode').disabled=false;
    closeDialog('receivableDialog');
    currentDebtView='receivable';
    persist(i>=0?'Запись обновлена':'Добавлено: мне должны');
  });

  function setScheduledPaid(x,paid){
    x.paid=paid;x.paidAt=paid?today():'';
    if(paid){
      if(!x.transactionId||!state.transactions.some(t=>t.id===x.transactionId)){
        const transactionId=uid();x.transactionId=transactionId;
        state.transactions.push({id:transactionId,type:'expense',kind:'expense',amount:x.amount,category:x.category,date:today(),note:`Обязательный платёж: ${x.name}${x.note?` · ${x.note}`:''}`,merchant:x.name,externalId:`planned-payment:${x.id}`,importedByAI:false,origin:'scheduled_payment',originId:x.id,bankReconciled:false,createdAt:Date.now()});
      }
      ensureNextRecurringPayment(x);
    }else{
      if(x.transactionId){state.transactions=state.transactions.filter(t=>t.id!==x.transactionId);x.transactionId=''}
      if(x.nextOccurrenceId){
        const next=state.scheduledPayments.find(i=>i.id===x.nextOccurrenceId);
        if(next&&!next.paid&&next.generatedFrom===x.id)state.scheduledPayments=state.scheduledPayments.filter(i=>i.id!==next.id);
        x.nextOccurrenceId='';
      }
    }
  }

  function setReceivableSettled(x,settled){
    x.settled=settled;
    x.settledAt=settled?today():'';
    if(settled){
      if(!x.transactionId||!state.transactions.some(t=>t.id===x.transactionId)){
        const transactionId=uid();
        x.transactionId=transactionId;
        state.transactions.push({
          id:transactionId,type:'income',kind:'receivable_return',amount:x.amount,category:'Возврат долга мне',
          date:today(),note:`Вернули долг: ${x.person}${x.note?` · ${x.note}`:''}`,
          merchant:x.person,externalId:`receivable-return:${x.id}`,importedByAI:false,
          origin:'receivable',originId:x.id,bankReconciled:false,createdAt:Date.now()
        });
      }
    }else if(x.transactionId){
      state.transactions=state.transactions.filter(t=>t.id!==x.transactionId);
      x.transactionId='';
    }
  }

  document.body.addEventListener('change',e=>{
    const scheduled=e.target.closest('[data-toggle-scheduled]');
    if(scheduled){
      const x=state.scheduledPayments.find(i=>i.id===scheduled.dataset.toggleScheduled);
      if(x){setScheduledPaid(x,scheduled.checked);persist(scheduled.checked?'Платёж отмечен как оплаченный':'Платёж снова запланирован')}
      return;
    }
    const receivable=e.target.closest('[data-toggle-receivable]');
    if(receivable){
      const x=state.receivables.find(i=>i.id===receivable.dataset.toggleReceivable);
      if(x){setReceivableSettled(x,receivable.checked);persist(receivable.checked?'Отмечено: деньги вернули':'Возврат снова ожидается')}
    }
  });

  document.body.addEventListener('click',e=>{
    const txRowButton=e.target.closest('[data-tx-id]');if(txRowButton){openTxDetail(txRowButton.dataset.txId);return}
    const newScheduled=e.target.closest('[data-new-scheduled]');if(newScheduled){prepScheduled();return}
    const newReceivable=e.target.closest('[data-new-receivable]');if(newReceivable){prepReceivable();return}
    const editScheduled=e.target.closest('[data-edit-scheduled]');if(editScheduled){const x=state.scheduledPayments.find(i=>i.id===editScheduled.dataset.editScheduled);if(x)prepScheduled(x);return}
    const delScheduled=e.target.closest('[data-del-scheduled]');if(delScheduled){const x=state.scheduledPayments.find(i=>i.id===delScheduled.dataset.delScheduled);if(x&&confirm(`Удалить запланированный платёж «${x.name}»?${x.transactionId?' Связанный расход тоже будет удалён.':''}`)){if(x.transactionId)state.transactions=state.transactions.filter(t=>t.id!==x.transactionId);state.scheduledPayments=state.scheduledPayments.filter(i=>i.id!==x.id);persist('Платёж удалён')}return}
    const editReceivable=e.target.closest('[data-edit-receivable]');if(editReceivable){const x=state.receivables.find(i=>i.id===editReceivable.dataset.editReceivable);if(x)prepReceivable(x);return}
    const delReceivable=e.target.closest('[data-del-receivable]');if(delReceivable){const x=state.receivables.find(i=>i.id===delReceivable.dataset.delReceivable);if(x&&confirm(`Удалить запись «${x.person}»?${x.transactionId||x.sourceMode==='gave_now'?' Связанные автоматические операции тоже будут удалены.':''}`)){if(x.transactionId)state.transactions=state.transactions.filter(t=>t.id!==x.transactionId);if(x.sourceMode==='gave_now'&&x.sourceTransactionId)state.transactions=state.transactions.filter(t=>t.id!==x.sourceTransactionId);state.receivables=state.receivables.filter(i=>i.id!==x.id);persist('Запись удалена')}return}
    const createDebt=e.target.closest('[data-create-debt]');if(createDebt){prepDebt();return}
    const editTx=e.target.closest('[data-edit-tx]');if(editTx){const t=state.transactions.find(x=>x.id===editTx.dataset.editTx);if(t)prepTransaction(t.type,t);return}
    const delTx=e.target.closest('[data-del-tx]');if(delTx){
      const t=state.transactions.find(x=>x.id===delTx.dataset.delTx);
      if(t){
        if(['savings_transfer','savings_spend'].includes(t.kind||'')&&savingsImpact(t)>0&&rawSavingsBalance(t.id)<-0.005){showToast('Нельзя удалить: отложенный баланс станет отрицательным');return}
        if(confirm(`Удалить операцию «${t.category}» на ${money2(t.amount)}?`)){
          state.transactions=state.transactions.filter(x=>x.id!==t.id);
          persist((t.kind||'')==='savings_transfer'?'Перемещение денег удалено':'Операция удалена');
        }
      }
      return
    }
    const delClosed=e.target.closest('[data-del-closed-debt]');if(delClosed){state.closedDebts=state.closedDebts.filter(d=>d.id!==delClosed.dataset.delClosedDebt);persist('Удалено из архива');return}
    const pay=e.target.closest('[data-pay-debt]');if(pay){const d=state.debts.find(x=>x.id===pay.dataset.payDebt);if(d)prepPayment(d);return}
    const editDebt=e.target.closest('[data-edit-debt]');if(editDebt){const d=state.debts.find(x=>x.id===editDebt.dataset.editDebt);if(d)prepDebt(d);return}
    const delDebt=e.target.closest('[data-del-debt]');if(delDebt){const d=state.debts.find(x=>x.id===delDebt.dataset.delDebt);if(d&&confirm(`Удалить долг «${d.name}»? Уже записанные платежи останутся в операциях.`)){state.debts=state.debts.filter(x=>x.id!==d.id);persist('Долг удалён')}return}
  });


  function openTxDetail(id){
    const t=state.transactions.find(x=>x.id===id);if(!t)return;
    activeTxDetailId=id;
    $('txDetailTitle').textContent=t.category||'Операция';
    $('txDetailSubtitle').textContent=`${fmtDate(t.date)}${t.merchant?` · ${t.merchant}`:''}`;
    const kindLabel={income:'Доход',expense:'Расход',transfer:'Перевод',savings_transfer:'Перемещение в отложенные',debt_payment:'Платёж по долгу',receivable_out:'Дал в долг',receivable_return:'Вернули долг',refund:'Возврат',savings_spend:'Расход из отложенных'}[t.kind||t.type]||'Операция';
    $('txDetailBody').innerHTML=`<div class="tx-detail-amount ${t.type==='income'?'income':''}">${t.type==='income'?'+':'−'} ${money2(t.amount)}</div><div class="tx-detail-grid"><div><span>Тип</span><strong>${esc(kindLabel)}</strong></div><div><span>Категория</span><strong>${esc(t.category)}</strong></div>${t.note?`<div class="wide"><span>Комментарий</span><strong>${esc(t.note)}</strong></div>`:''}${(t.kind||'')==='savings_spend'?'<div class="wide"><span>Источник средств</span><strong>Отложенные деньги</strong></div>':''}${t.importedByAI?'<div class="wide"><span>Источник</span><strong>Импортировано из выписки</strong></div>':''}</div>`;
    const special=['savings_transfer','savings_spend','debt_payment','receivable_out','receivable_return'].includes(t.kind||'');
    $('txDetailEdit').classList.toggle('hidden',special&&!['savings_transfer','savings_spend'].includes(t.kind||''));
    const lockedDelete=['debt_payment','receivable_out','receivable_return'].includes(t.kind||'')||Boolean(t.origin);
    $('txDetailDelete').classList.toggle('hidden',lockedDelete);
    $('txDetailReceivable').classList.toggle('hidden',!(t.type==='expense'&&!special&&(t.kind||'expense')!=='transfer'));
    openDialog('txDetailDialog');
  }

  $('txDetailEdit')?.addEventListener('click',()=>{const t=state.transactions.find(x=>x.id===activeTxDetailId);if(!t)return;closeDialog('txDetailDialog');if(['savings_transfer','savings_spend'].includes(t.kind||'')){const direction=(t.kind||'')==='savings_spend'?'spend_savings':t.type==='expense'?'to_savings':'from_savings';prepSavingsTransfer(direction,t)}else prepTransaction(t.type,t)});
  $('txDetailDelete')?.addEventListener('click',()=>{
    const t=state.transactions.find(x=>x.id===activeTxDetailId);if(!t)return;
    if(['savings_transfer','savings_spend'].includes(t.kind||'')&&savingsImpact(t)>0&&rawSavingsBalance(t.id)<-0.005)return showToast('Нельзя удалить: отложенный баланс станет отрицательным');
    if(confirm(`Удалить операцию «${t.category}» на ${money2(t.amount)}?`)){state.transactions=state.transactions.filter(x=>x.id!==t.id);closeDialog('txDetailDialog');persist('Операция удалена')}
  });
  $('txDetailReceivable')?.addEventListener('click',()=>{
    const t=state.transactions.find(x=>x.id===activeTxDetailId);if(!t||t.type!=='expense')return;
    t.kind='receivable_out';t.category='Дал в долг';
    const rid=uid();
    state.receivables.push({id:rid,person:(t.merchant||t.note||'Контрагент').slice(0,90),amount:t.amount,due:'',note:t.note||'',sourceMode:'existing_tx',sourceTransactionId:t.id,settled:false,settledAt:'',transactionId:'',createdAt:Date.now()});
    t.origin='receivable';t.originId=rid;
    closeDialog('txDetailDialog');currentDebtView='receivable';showPage('debts');persist('Операция отмечена как деньги, которые тебе должны');
  });

  let reopenSavingsWalletAfterAction=false;
  function prepSavingsTransfer(direction='to_savings',tx=null,{returnToWallet=false}={}){
    const t=totals();
    const toSavings=direction==='to_savings';
    const fromSavings=direction==='from_savings';
    const spendSavings=direction==='spend_savings';
    reopenSavingsWalletAfterAction=returnToWallet;
    $('savingsTransferForm').reset();
    $('savingsTransferDirection').value=direction;
    $('savingsEditId').value=tx?.id||'';
    $('savingsTransferAmount').value=tx?.amount||'';
    $('savingsTransferDate').value=tx?.date||today();
    $('savingsTransferNote').value=tx?.note||'';
    $('savingsSpendCategoryField').classList.toggle('hidden',!spendSavings);
    $('savingsSpendCategory').required=spendSavings;
    $('savingsSpendCategory').value=spendSavings?(tx?.category||''):'';
    $('savingsTransferTitle').textContent=tx?'Изменить движение':toSavings?'Отложить деньги':fromSavings?'Вернуть в доступные':'Потратить из отложенных';
    $('savingsTransferSubtitle').textContent=toSavings
      ?`Доступно сейчас ${money2(t.available)}. Перевод не считается расходом.`
      :fromSavings?`Отложено ${money2(t.saved)}. Возврат не считается доходом.`
      :`Отложено ${money2(t.saved)}. Эта сумма станет настоящим расходом, но не уменьшит «Доступно сейчас».`;
    $('savingsTransferSubmit').textContent=tx?'Сохранить':toSavings?'Отложить':fromSavings?'Вернуть':'Записать расход';
    if(returnToWallet)closeDialog('savingsWalletDialog');
    openDialog('savingsTransferDialog');
    setTimeout(()=>$('savingsTransferAmount').focus(),80);
  }

  function openSavingsWallet(){renderSavingsWallet();openDialog('savingsWalletDialog')}
  $('savingsHistoryBtn')?.addEventListener('click',e=>{e.stopPropagation();openSavingsWallet()});
  $('savingsCard')?.addEventListener('click',e=>{if(e.target.closest('button,input,select,a'))return;openSavingsWallet()});
  $('savingsGoalStrip')?.addEventListener('click',e=>{e.stopPropagation();$('savingsGoalName').value=state.settings.savingsGoalName||'';$('savingsGoalAmount').value=state.settings.savingsGoalAmount||'';openDialog('savingsGoalDialog')});
  $('savingsWalletGoalBtn')?.addEventListener('click',()=>{closeDialog('savingsWalletDialog');$('savingsGoalName').value=state.settings.savingsGoalName||'';$('savingsGoalAmount').value=state.settings.savingsGoalAmount||'';openDialog('savingsGoalDialog')});

  $('saveMoneyBtn')?.addEventListener('click',e=>{e.stopPropagation();prepSavingsTransfer('to_savings')});
  $('returnMoneyBtn')?.addEventListener('click',e=>{
    e.stopPropagation();if(totals().saved<=0.005)return showToast('В отложенных пока нет денег');prepSavingsTransfer('from_savings');
  });
  $('spendSavingsBtn')?.addEventListener('click',e=>{
    e.stopPropagation();if(totals().saved<=0.005)return showToast('В отложенных пока нет денег');prepSavingsTransfer('spend_savings');
  });

  document.body.addEventListener('click',e=>{
    const action=e.target.closest('[data-savings-wallet-action]');
    if(action){const direction=action.dataset.savingsWalletAction;if(direction!=='to_savings'&&totals().saved<=0.005)return showToast('В отложенных пока нет денег');prepSavingsTransfer(direction,null,{returnToWallet:true});return}
    const edit=e.target.closest('[data-edit-savings]');
    if(edit){const tx=state.transactions.find(t=>t.id===edit.dataset.editSavings);if(!tx)return;const direction=(tx.kind||'')==='savings_spend'?'spend_savings':tx.type==='expense'?'to_savings':'from_savings';prepSavingsTransfer(direction,tx,{returnToWallet:true});return}
    const del=e.target.closest('[data-delete-savings]');
    if(del){const tx=state.transactions.find(t=>t.id===del.dataset.deleteSavings);if(!tx)return;const savedAfter=rawSavingsBalance(tx.id);if(savingsImpact(tx)>0&&savedAfter<-0.005)return showToast('Нельзя удалить: отложенный баланс станет отрицательным');if(confirm(`Удалить движение на ${money2(tx.amount)}?`)){state.transactions=state.transactions.filter(t=>t.id!==tx.id);persist('Движение удалено');renderSavingsWallet()}return}
  });

  $('savingsTransferForm')?.addEventListener('submit',e=>{
    e.preventDefault();
    const direction=['from_savings','spend_savings'].includes($('savingsTransferDirection').value)?$('savingsTransferDirection').value:'to_savings';
    const amount=parseDecimalInput($('savingsTransferAmount').value);
    if(!(amount>0))return showToast('Укажи сумму');
    const editId=$('savingsEditId').value||'';
    const base=balancesWithoutTransaction(editId);
    if(direction==='to_savings'&&amount>base.available+0.005)return showToast(`Доступно только ${money2(Math.max(0,base.available))}`);
    if(direction!=='to_savings'&&amount>base.saved+0.005)return showToast(`Отложено только ${money2(Math.max(0,base.saved))}`);
    const existing=state.transactions.find(t=>t.id===editId);
    const spend=direction==='spend_savings';
    const item={
      id:editId||uid(),
      type:direction==='from_savings'?'income':'expense',
      kind:spend?'savings_spend':'savings_transfer',
      amount,
      category:spend?($('savingsSpendCategory').value.trim()||'Другое'):(direction==='to_savings'?'В отложенные':'Из отложенных'),
      date:$('savingsTransferDate').value||today(),
      note:$('savingsTransferNote').value.trim()||(spend?'Расход из отложенных':direction==='to_savings'?'Перевод в отложенные':'Возврат в доступные'),
      merchant:spend?'Отложенные деньги':'Отложенные деньги',
      externalId:existing?.externalId||'',
      importedByAI:Boolean(existing?.importedByAI),
      origin:spend?'savings':'',
      originId:'',bankReconciled:false,createdAt:existing?.createdAt||Date.now()
    };
    const i=state.transactions.findIndex(t=>t.id===item.id);
    if(i>=0)state.transactions[i]=item;else state.transactions.push(item);
    closeDialog('savingsTransferDialog');
    persist(editId?'Движение обновлено':spend?`Потрачено ${money2(amount)} из отложенных`:direction==='to_savings'?`Отложено ${money2(amount)}`:`Возвращено ${money2(amount)} в доступные`);
    if(reopenSavingsWalletAfterAction){reopenSavingsWalletAfterAction=false;setTimeout(openSavingsWallet,30)}
  });

  $('savingsGoalForm')?.addEventListener('submit',e=>{
    e.preventDefault();
    const amount=parseDecimalInput($('savingsGoalAmount').value);
    state.settings.savingsGoalName=$('savingsGoalName').value.trim().slice(0,80);
    state.settings.savingsGoalAmount=Number.isFinite(amount)&&amount>0?amount:0;
    if(state.settings.savingsGoalAmount>0&&!state.settings.savingsGoalName)state.settings.savingsGoalName='Моя цель';
    closeDialog('savingsGoalDialog');
    persist(state.settings.savingsGoalAmount>0?'Цель накопления сохранена':'Цель очищена');
  });

  $('clearSavingsGoalBtn')?.addEventListener('click',()=>{
    state.settings.savingsGoalName='';
    state.settings.savingsGoalAmount=0;
    closeDialog('savingsGoalDialog');
    persist('Цель накопления убрана');
  });

  function initWalletCarousel(){
    const carousel=$('walletCarousel');
    if(!carousel||carousel.dataset.ready==='1')return;
    carousel.dataset.ready='1';
    const slides=()=>Array.from(carousel.querySelectorAll('[data-wallet-slide]'));
    const dots=qsa('[data-wallet-dot]');
    let raf=0;
    const setActive=index=>{
      dots.forEach((dot,i)=>{
        const active=i===index;
        dot.classList.toggle('active',active);
        dot.setAttribute('aria-selected',active?'true':'false');
      });
    };
    const sync=()=>{
      raf=0;
      const list=slides();
      if(!list.length)return;
      let best=0,bestDist=Infinity;
      list.forEach((slide,i)=>{
        const target=slide.offsetLeft-carousel.offsetLeft;
        const dist=Math.abs(carousel.scrollLeft-target);
        if(dist<bestDist){bestDist=dist;best=i}
      });
      setActive(best);
    };
    carousel.addEventListener('scroll',()=>{
      if(raf)return;
      raf=requestAnimationFrame(sync);
    },{passive:true});
    dots.forEach((dot,i)=>dot.addEventListener('click',()=>{
      const slide=slides()[i];
      if(slide)carousel.scrollTo({left:slide.offsetLeft-carousel.offsetLeft,behavior:'smooth'});
      setActive(i);
    }));
    setActive(0);
  }

  $('settingsForm').addEventListener('submit',e=>{
    e.preventDefault();
    state.settings.startBalance=parseDecimalInput($('startBalance').value)||0;
    state.settings.spendBudget=Math.max(0,parseDecimalInput($('spendBudget').value)||0);
    state.settings.debtBudget=Math.max(0,parseDecimalInput($('debtBudget').value)||0);
    state.settings.debtStrategy=$('debtStrategy').value==='snowball'?'snowball':'avalanche';
    state.settings.salaryDay=Math.round(clamp($('salaryDay').value,0,31));
    state.settings.reserveFloor=Math.max(0,parseDecimalInput($('reserveFloor').value)||0);
    persist('Настройки сохранены');
  });

  qsa('[data-toggle-balance]').forEach(btn=>btn.addEventListener('click',()=>{balanceMasked=!balanceMasked;renderDashboard()}));
  $('privacyInfo').addEventListener('click',()=>showToast('Данные локальны. В сеть уходят только очищенные операции, когда ты сам запускаешь AI импорт'));

  $('exportBtn').addEventListener('click',()=>{
    const payload=JSON.stringify(state,null,2);
    const blob=new Blob([payload],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=`finance-control-backup-${today()}.json`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),500);
    state.meta.lastBackupAt=today();localStorage.setItem(STORAGE_KEY,JSON.stringify(state));mirrorStateToIndexedDB();renderSettings();showToast('Резервная копия создана');
  });

  $('importBtn').addEventListener('click',()=>$('importFile').click());
  $('importFile').addEventListener('change',async()=>{
    const file=$('importFile').files?.[0];if(!file)return;
    try{
      const raw=JSON.parse(await file.text());
      const imported=sanitizeState(raw);
      if(!confirm(`Импортировать ${imported.transactions.length} операций, ${imported.debts.length} долгов, ${imported.scheduledPayments.length} платежей и ${imported.receivables.length} записей «мне должны»? Текущие данные будут заменены.`))return;
      state=imported;persist('Данные импортированы');
    }catch(error){showToast('Не удалось прочитать JSON-файл')}
    finally{$('importFile').value=''}
  });

  $('resetBtn').addEventListener('click',()=>{
    if(confirm('Удалить все финансовые данные из этого браузера? Это действие нельзя отменить.')){
      state=defaultState();
      localStorage.removeItem(STORAGE_KEY);
      PREVIOUS_KEYS.forEach(k=>localStorage.removeItem(k));
      persist('Все данные удалены');
    }
  });

  const IDB_NAME='finance-control-resilience';
  function openLocalDb(){return new Promise((resolve,reject)=>{try{const req=indexedDB.open(IDB_NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('snapshots'))req.result.createObjectStore('snapshots')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)}catch(e){reject(e)}})}
  async function mirrorStateToIndexedDB(){if(!('indexedDB' in window))return;try{const db=await openLocalDb();const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(JSON.parse(JSON.stringify(state)),'latest');tx.oncomplete=()=>db.close()}catch{}}
  async function restoreFromIndexedDBIfNeeded(){if(!('indexedDB' in window)||localStorage.getItem(STORAGE_KEY))return;try{const db=await openLocalDb();const tx=db.transaction('snapshots','readonly');const req=tx.objectStore('snapshots').get('latest');req.onsuccess=()=>{if(req.result){state=sanitizeState(req.result);localStorage.setItem(STORAGE_KEY,JSON.stringify(state));render();showToast('Данные восстановлены из локальной копии')}db.close()}}catch{}}

  window.FinanceControl={
    getState:()=>JSON.parse(JSON.stringify(state)),
    hasExternalId:(externalId)=>Boolean(externalId&&state.transactions.some(t=>t.externalId===externalId)),
    bulkImportTransactions:(items=[],options={})=>{
      const preserveAvailableBalance=options.preserveAvailableBalance!==false;
      const existingIds=new Set(state.transactions.map(t=>t.externalId).filter(Boolean));
      let added=0,duplicates=0,importedDelta=0;
      for(const raw of Array.isArray(items)?items:[]){
        const amount=Math.max(0,Number(raw.amount)||0);
        const externalId=String(raw.externalId||'').slice(0,180);
        if(!(amount>0))continue;
        if(externalId&&existingIds.has(externalId)){duplicates++;continue}
        const type=raw.type==='income'?'income':'expense';
        const allowedKinds=['income','expense','transfer','refund','debt_payment','receivable_out','receivable_return','savings_transfer','savings_spend'];
        const kind=allowedKinds.includes(raw.kind)?raw.kind:type;
        const normalizedDate=/^\d{4}-\d{2}-\d{2}$/.test(raw.date||'')?raw.date:today();
        const rawCategory=String(raw.category||'Без категории').slice(0,80);
        const normalizedMerchant=String(raw.merchant||raw.note||'').toLowerCase();
        const importedDate=parseDateOnly(normalizedDate);
        const matchingPlan=type==='expense'?state.scheduledPayments.find(x=>!x.paid&&Math.abs(x.amount-amount)<0.01&&Math.abs(daysBetween(parseDateOnly(x.due),importedDate))<=7&&(x.category===rawCategory||normalizedMerchant.includes(x.name.toLowerCase())||x.name.toLowerCase().includes(normalizedMerchant.split(' ')[0]||'__none__'))):null;
        if(matchingPlan){
          const transactionId=uid();matchingPlan.paid=true;matchingPlan.paidAt=normalizedDate;matchingPlan.transactionId=transactionId;
          state.transactions.push({id:transactionId,type,kind,amount,category:rawCategory,date:normalizedDate,note:String(raw.note||`Обязательный платёж: ${matchingPlan.name}`).slice(0,180),merchant:String(raw.merchant||matchingPlan.name).slice(0,100),externalId,importedByAI:Boolean(raw.importedByAI),origin:'scheduled_payment',originId:matchingPlan.id,bankReconciled:true,createdAt:Date.now()+added});
          ensureNextRecurringPayment(matchingPlan);if(!['transfer','savings_spend'].includes(kind))importedDelta+=type==='income'?amount:-amount;if(externalId)existingIds.add(externalId);added++;continue;
        }
        const matchingReceivable=type==='income'?state.receivables.find(x=>!x.settled&&Math.abs(x.amount-amount)<0.01&&(normalizedMerchant.includes(x.person.toLowerCase())||(!x.due||Math.abs(daysBetween(parseDateOnly(x.due),importedDate))<=14))):null;
        if(matchingReceivable){
          const transactionId=uid();matchingReceivable.settled=true;matchingReceivable.settledAt=normalizedDate;matchingReceivable.transactionId=transactionId;
          state.transactions.push({id:transactionId,type:'income',kind:'receivable_return',amount,category:'Возврат долга мне',date:normalizedDate,note:String(raw.note||`Вернули долг: ${matchingReceivable.person}`).slice(0,180),merchant:String(raw.merchant||matchingReceivable.person).slice(0,100),externalId,importedByAI:Boolean(raw.importedByAI),origin:'receivable',originId:matchingReceivable.id,bankReconciled:true,createdAt:Date.now()+added});
          importedDelta+=amount;if(externalId)existingIds.add(externalId);added++;continue;
        }
        const reconcile=state.transactions.find(t=>
          ['scheduled_payment','receivable'].includes(t.origin)&&!t.bankReconciled&&
          Math.abs(t.amount-amount)<0.01&&Math.abs(daysBetween(parseDateOnly(t.date),parseDateOnly(normalizedDate)))<=3&&
          t.type===type
        );
        if(reconcile){
          reconcile.externalId=externalId||reconcile.externalId;
          reconcile.merchant=String(raw.merchant||reconcile.merchant||'').slice(0,100);
          reconcile.bankReconciled=true;
          if(externalId)existingIds.add(externalId);
          duplicates++;
          continue;
        }
        state.transactions.push({
          id:uid(),type,kind,amount,
          category:rawCategory,
          date:normalizedDate,
          note:String(raw.note||'').slice(0,180),
          merchant:String(raw.merchant||'').slice(0,100),
          externalId,importedByAI:Boolean(raw.importedByAI),origin:'',originId:'',bankReconciled:false,createdAt:Date.now()+added
        });
        if(!['transfer','savings_spend'].includes(kind))importedDelta+=type==='income'?amount:-amount;
        if(externalId)existingIds.add(externalId);
        added++;
      }
      if(preserveAvailableBalance&&added)state.settings.startBalance-=importedDelta;
      persist(added?`Импортировано ${added} операций`:'Новых операций не найдено');
      return{added,duplicates,importedDelta,preservedBalance:preserveAvailableBalance};
    },
    showPage,
    showToast
  };

  initWalletCarousel();
  render();
  restoreFromIndexedDBIfNeeded();
  if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js?v=5.1').catch(()=>{});
})();
