(()=>{
  'use strict';

  const STORAGE_KEY='finance-control-v3';
  const PREVIOUS_KEYS=['finance-control-v2','finance-control-v1'];
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
      version:3,
      settings:{
        startBalance:0,
        spendBudget:0,
        debtBudget:0,
        debtStrategy:'avalanche',
        salaryDay:0,
        reserveFloor:0
      },
      transactions:[],
      debts:[]
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

    out.transactions=(Array.isArray(raw?.transactions)?raw.transactions:[]).map(t=>({
      id:String(t.id||uid()),
      type:t.type==='income'?'income':'expense',
      amount:Math.max(0,Number(t.amount)||0),
      category:String(t.category||'Без категории').slice(0,80),
      date:/^\d{4}-\d{2}-\d{2}$/.test(t.date||'')?t.date:today(),
      note:String(t.note||'').slice(0,180),
      createdAt:Number(t.createdAt)||0
    })).filter(t=>t.amount>0);

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
  let balanceMasked=false;
  let toastTimer=null;

  function persist(message){
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
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

  function monthStats(){
    let income=0,lifestyleExpense=0,debtPayments=0,allExpense=0,allDelta=0;
    for(const t of state.transactions){
      const signed=t.type==='income'?t.amount:-t.amount;
      allDelta+=signed;
      if(!isThisMonth(t.date))continue;
      if(t.type==='income')income+=t.amount;
      else{
        allExpense+=t.amount;
        if(t.category==='Погашение долга')debtPayments+=t.amount;
        else lifestyleExpense+=t.amount;
      }
    }
    return{income,lifestyleExpense,debtPayments,allExpense,cashflow:income-allExpense,allDelta};
  }

  function totals(){
    const m=monthStats();
    const debt=state.debts.reduce((s,d)=>s+d.balance,0);
    const minPayments=state.debts.reduce((s,d)=>s+d.min,0);
    const available=state.settings.startBalance+m.allDelta;
    return{...m,debt,minPayments,available,netPosition:available-debt};
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

  function txIconLabel(category,type){
    if(type==='income')return'↗';
    const map={'Еда':'ЕД','Аренда':'ДМ','Транспорт':'ТР','Покупки':'ПК','Развлечения':'РЗ','Подписки':'ПД','Здоровье':'ЗД','Путешествия':'ПТ','Погашение долга':'ДЛ'};
    return map[category]||String(category||'Р').trim().slice(0,2).toUpperCase()||'Р';
  }

  function txRow(t,{compact=false}={}){
    const sign=t.type==='income'?'+':'−';
    const note=[fmtDate(t.date),t.note].filter(Boolean).join(' • ');
    return `<div class="tx-row">
      <div class="tx-mark ${t.type==='income'?'income':''}">${esc(txIconLabel(t.category,t.type))}</div>
      <div class="tx-main"><b>${esc(t.category||'Без категории')}</b><span>${esc(note||fmtDate(t.date))}</span></div>
      <div class="tx-side">
        <div class="tx-amount ${t.type==='income'?'income':''}">${sign}${money2(t.amount)}</div>
        ${compact?'':`<div class="tx-actions">
          <button class="row-icon" type="button" data-edit-tx="${esc(t.id)}" aria-label="Редактировать"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m4 16-.5 4.5L8 20l10.5-10.5-4-4Z" stroke-linejoin="round"/><path d="m13.5 6.5 4 4"/></svg></button>
          <button class="row-icon danger" type="button" data-del-tx="${esc(t.id)}" aria-label="Удалить"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>`}
      </div>
    </div>`;
  }

  function sortedTransactions(){
    return state.transactions.slice().sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt-a.createdAt));
  }

  function renderDashboard(){
    const t=totals();
    const monthName=new Intl.DateTimeFormat('ru-RU',{month:'long'}).format(new Date());
    $('monthCaption').textContent=monthName.charAt(0).toUpperCase()+monthName.slice(1);

    const visibleBalance=balanceMasked?'••••••':money2(t.available);
    $('availableMetric').textContent=visibleBalance;
    $('availableMetric').classList.toggle('masked',balanceMasked);

    const flow=$('cashflowDelta');
    flow.textContent=`${t.cashflow>=0?'＋':'−'} ${money(Math.abs(t.cashflow))} за месяц`;
    flow.className='trend-chip'+(t.cashflow>0?' good':t.cashflow<0?' bad':'');

    $('incomeMetric').textContent=money(t.income);
    $('incomeSub').textContent='за текущий месяц';
    $('expenseMetric').textContent=money(t.lifestyleExpense);
    $('expenseSub').textContent=t.debtPayments>0?`+ ${money(t.debtPayments)} по долгам`:'без платежей по долгам';
    $('debtMetric').textContent=money(t.debt);
    $('debtSub').textContent=state.debts.length?`${state.debts.length} активн. · мин. ${money(t.minPayments)}/мес.`:'нет долгов';

    const budget=state.settings.spendBudget;
    const budgetLeft=Math.max(0,budget-t.lifestyleExpense);
    const safeDaily=budget>0?budgetLeft/daysLeftInMonth():null;
    $('safeDailyMetric').textContent=safeDaily===null?'—':money(safeDaily);
    const salary=salaryCountdown();
    $('safeDailySub').textContent=salary?`до зарплаты ${salary.days} дн.`:(budget>0?`${daysLeftInMonth()} дн. до конца месяца`:'задай лимит расходов');

    const needsSetup=state.settings.startBalance===0&&state.settings.spendBudget===0&&state.settings.debtBudget===0&&!state.transactions.length&&!state.debts.length;
    $('setupBanner').classList.toggle('hidden',!needsSetup);

    const recent=sortedTransactions().slice(0,5);
    $('recentList').innerHTML=recent.length?recent.map(t=>txRow(t,{compact:true})).join(''):`<div class="empty-state"><strong>Операций пока нет</strong>Добавь первый доход или расход — баланс начнёт считаться автоматически.</div>`;

    renderDebtFocus();
    renderBudgetPanel();
    renderCategoryChart();
  }

  function renderDebtFocus(){
    const el=$('debtFocus');
    if(!state.debts.length){
      el.innerHTML=`<div class="empty-state"><strong>Долгов нет</strong>Если есть кредит, рассрочка или личный долг — добавь его, и приложение построит порядок погашения.<br><button class="secondary-btn" type="button" data-create-debt>Добавить долг</button></div>`;
      return;
    }
    const d=priorityDebts()[0];
    const pct=percentPaid(d);
    const due=dueStatus(d);
    const sim=simulatePayoff();
    el.innerHTML=`
      <div class="focus-top">
        <div><div class="focus-kicker">Следующий в приоритете</div><div class="focus-name">${esc(d.name)}</div></div>
        <div class="focus-balance">${money2(d.balance)}<small>${d.apr.toFixed(2)}% годовых</small></div>
      </div>
      <div class="progress success"><span style="width:${pct.toFixed(1)}%"></span></div>
      <div class="focus-meta"><span>Погашено ${pct.toFixed(0)}%</span><span>${due?esc(due.text):'дата не задана'}</span></div>
      <div class="focus-grid">
        <div class="mini-card"><span>Минимум</span><strong>${money(d.min)} / мес.</strong></div>
        <div class="mini-card"><span>Общий прогноз</span><strong>${sim.months?`~ ${sim.months} мес.`:'нужен бюджет'}</strong></div>
      </div>
      <button class="primary-btn focus-cta" type="button" data-pay-debt="${esc(d.id)}">Записать платёж</button>`;
  }

  function renderBudgetPanel(){
    const el=$('budgetPanel');
    const t=totals();
    const budget=state.settings.spendBudget;
    if(!(budget>0)){
      el.innerHTML=`<div class="empty-state"><strong>Месячный лимит не задан</strong>Укажи сумму обычных расходов в настройках. Платежи по долгам будут учитываться отдельно.<br><button class="secondary-btn" type="button" data-go="settings">Задать лимит</button></div>`;
      return;
    }
    const spent=t.lifestyleExpense;
    const left=budget-spent;
    const pct=clamp(spent/budget*100,0,100);
    const reserve=Math.max(0,Number(state.settings.reserveFloor)||0);
    const freeAboveReserve=t.available-reserve;
    el.innerHTML=`
      <div class="budget-top">
        <div><div class="budget-number">${money(spent)}</div><div class="budget-caption">потрачено из ${money(budget)}</div></div>
        <div class="budget-right"><strong>${left>=0?money(left):`−${money(Math.abs(left))}`}</strong><span>${left>=0?'осталось':'перерасход'}</span></div>
      </div>
      <div class="progress"><span style="width:${pct.toFixed(1)}%"></span></div>
      <div class="budget-foot"><span>${pct.toFixed(0)}% лимита</span><span>${money(Math.max(0,left)/daysLeftInMonth())} / день</span></div>
      ${reserve>0&&freeAboveReserve<0?`<div class="warning-inline">Свободный баланс уже на ${money(Math.abs(freeAboveReserve))} ниже твоего неснижаемого резерва ${money(reserve)}.</div>`:''}`;
  }

  function renderCategoryChart(){
    const monthExpenses=state.transactions.filter(t=>t.type==='expense'&&t.category!=='Погашение долга'&&isThisMonth(t.date));
    const sums=new Map();
    for(const t of monthExpenses)sums.set(t.category,(sums.get(t.category)||0)+t.amount);
    const rows=[...sums.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
    const el=$('categoryChart');
    if(!rows.length){el.innerHTML=`<div class="empty-state"><strong>Пока нечего анализировать</strong>Категории появятся после первых расходов в этом месяце.</div>`;return}
    const max=Math.max(...rows.map(r=>r[1]),1);
    el.innerHTML=`<div class="category-list">${rows.map(([name,value])=>`<div class="category-row"><div class="category-name">${esc(name)}</div><div class="category-bar"><span style="width:${(value/max*100).toFixed(1)}%"></span></div><div class="category-value">${money(value)}</div></div>`).join('')}</div>`;
  }

  function renderTransactions(){
    const query=($('txSearch')?.value||'').trim().toLowerCase();
    let rows=sortedTransactions();
    if(currentTxFilter==='income')rows=rows.filter(t=>t.type==='income');
    if(currentTxFilter==='expense')rows=rows.filter(t=>t.type==='expense'&&t.category!=='Погашение долга');
    if(currentTxFilter==='debt')rows=rows.filter(t=>t.category==='Погашение долга');
    if(query)rows=rows.filter(t=>`${t.category} ${t.note}`.toLowerCase().includes(query));
    $('txList').innerHTML=rows.length?rows.map(t=>txRow(t)).join(''):`<div class="empty-state"><strong>Ничего не найдено</strong>Измени фильтр или добавь новую операцию.</div>`;
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
    $('debtTotalSummary').textContent=money2(t.debt);
    $('debtCountSummary').textContent=`${state.debts.length} активн.`;
    $('minPaymentsSummary').textContent=money(t.minPayments);
    $('debtBudgetSummary').textContent=state.settings.debtBudget>0?`бюджет ${money(state.settings.debtBudget)}`:'бюджет не задан';
    $('payoffSummary').textContent=sim.months?`~ ${sim.months} мес.`:'—';
    $('payoffDateSummary').textContent=sim.months?payoffDate(sim.months):(sim.warning||'нужны данные');
    $('interestSummary').textContent=sim.totalInterest===null?'—':money2(sim.totalInterest);
    $('strategyCaption').textContent=state.settings.debtStrategy==='avalanche'?'avalanche · высокий % первым':'snowball · маленький долг первым';

    const ordered=priorityDebts();
    $('debtList').innerHTML=ordered.length?ordered.map(debtCard).join(''):`<div class="surface" style="grid-column:1/-1"><div class="empty-state"><strong>Долгов пока нет</strong>Добавь первый долг, чтобы появился план погашения.<br><button class="secondary-btn" type="button" data-create-debt>Добавить долг</button></div></div>`;
    renderPlan(sim);
    renderStrategyCompare();
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

  function renderSettings(){
    const s=state.settings;
    $('startBalance').value=s.startBalance||'';
    $('spendBudget').value=s.spendBudget||'';
    $('debtBudget').value=s.debtBudget||'';
    $('debtStrategy').value=s.debtStrategy;
    $('salaryDay').value=s.salaryDay||'';
    $('reserveFloor').value=s.reserveFloor||'';
  }

  function render(){
    renderDashboard();
    renderTransactions();
    renderDebts();
    renderSettings();
  }

  function showPage(id){
    qsa('.page').forEach(p=>p.classList.toggle('hidden',p.id!==id));
    qsa('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.tab===id));
    window.scrollTo({top:0,behavior:'smooth'});
  }

  qsa('.nav-item').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.tab)));
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
      amount,
      category:$('txCategory').value.trim()||'Без категории',
      date:$('txDate').value||today(),
      note:$('txNote').value.trim(),
      createdAt:existing?.createdAt||Date.now()
    };
    const i=state.transactions.findIndex(t=>t.id===id);
    if(i>=0)state.transactions[i]=item;else state.transactions.push(item);
    closeDialog('txDialog');
    persist(i>=0?'Операция обновлена':'Операция добавлена');
  });

  $('txSearch').addEventListener('input',renderTransactions);
  qsa('.filter-chip').forEach(btn=>btn.addEventListener('click',()=>{
    currentTxFilter=btn.dataset.filter||'all';
    qsa('.filter-chip').forEach(x=>x.classList.toggle('active',x===btn));
    renderTransactions();
  }));

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

  $('quickDebt').addEventListener('click',()=>prepDebt());
  $('addDebtBtn').addEventListener('click',()=>prepDebt());

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
      id:uid(),type:'expense',amount:paid,category:'Погашение долга',
      date:$('paymentDate').value||today(),note:$('paymentNote').value.trim()||d.name,createdAt:Date.now()
    });
    const closed=d.balance<=0.005;
    if(closed)state.debts=state.debts.filter(x=>x.id!==d.id);
    closeDialog('paymentDialog');
    persist(closed?'Долг закрыт 🎉':'Платёж записан');
  });

  document.body.addEventListener('click',e=>{
    const createDebt=e.target.closest('[data-create-debt]');if(createDebt){prepDebt();return}
    const editTx=e.target.closest('[data-edit-tx]');if(editTx){const t=state.transactions.find(x=>x.id===editTx.dataset.editTx);if(t)prepTransaction(t.type,t);return}
    const delTx=e.target.closest('[data-del-tx]');if(delTx){const t=state.transactions.find(x=>x.id===delTx.dataset.delTx);if(t&&confirm(`Удалить операцию «${t.category}» на ${money2(t.amount)}?`)){state.transactions=state.transactions.filter(x=>x.id!==t.id);persist('Операция удалена')}return}
    const pay=e.target.closest('[data-pay-debt]');if(pay){const d=state.debts.find(x=>x.id===pay.dataset.payDebt);if(d)prepPayment(d);return}
    const editDebt=e.target.closest('[data-edit-debt]');if(editDebt){const d=state.debts.find(x=>x.id===editDebt.dataset.editDebt);if(d)prepDebt(d);return}
    const delDebt=e.target.closest('[data-del-debt]');if(delDebt){const d=state.debts.find(x=>x.id===delDebt.dataset.delDebt);if(d&&confirm(`Удалить долг «${d.name}»? Уже записанные платежи останутся в операциях.`)){state.debts=state.debts.filter(x=>x.id!==d.id);persist('Долг удалён')}return}
  });

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

  $('toggleBalance').addEventListener('click',()=>{balanceMasked=!balanceMasked;renderDashboard()});
  $('privacyInfo').addEventListener('click',()=>showToast('Финансовые данные сохраняются только в этом браузере'));

  $('exportBtn').addEventListener('click',()=>{
    const payload=JSON.stringify(state,null,2);
    const blob=new Blob([payload],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=`finance-control-backup-${today()}.json`;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),500);
    showToast('Резервная копия создана');
  });

  $('importBtn').addEventListener('click',()=>$('importFile').click());
  $('importFile').addEventListener('change',async()=>{
    const file=$('importFile').files?.[0];if(!file)return;
    try{
      const raw=JSON.parse(await file.text());
      const imported=sanitizeState(raw);
      if(!confirm(`Импортировать ${imported.transactions.length} операций и ${imported.debts.length} долгов? Текущие данные будут заменены.`))return;
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

  render();
  if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
