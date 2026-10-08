(function(){
  "use strict";

  // ================= constants =================
  var USER_KEY = 'venueDiary:currentUser:v1';
  var ADMIN_SESSION_KEY = 'venueDiary:adminSession:v1';

  var HALLS_DEFAULT = {
    ballroom: { id:'ballroom', name:'The Ballroom', capacity:500 },
    bayu: { id:'bayu', name:'The Bayu', capacity:500 }
  };
  var SESSIONS = [
    { id:'siang', label:'Siang' },
    { id:'malam', label:'Malam' }
  ];
  var EVENT_TIME_OPTIONS = [
    '11:00 AM - 3:00 PM',
    '12:00 PM - 4:00 PM',
    '7:30 PM - 10:30 PM'
  ];
  var PACKAGE_OPTIONS = ['Simple','Premium'];
  var CEREMONY_OPTIONS = ['Nikah Sahaja','Sanding Sahaja','Nikah & Sanding'];
  var BRIDAL_ATTIRE_OPTIONS = ['Payong Sutera','Seri Andaman 3R','Khadijah Zainur','N/A'];
  var FLOWER_BOUQUET_OPTIONS = ['Besi', 'Fresh Flower', 'N/A'];
  var MAKEUP_OPTIONS = ['Riasan Asri','Wanila Virana','Najjj','Juliezuliana','Yusra Solek','Kamiera MUA','N/A'];
  var GROOM_STYLIST_OPTIONS = ['Redhuan Rizal', 'Najhan', 'N/A'];
  var PHOTOGRAPHER_OPTIONS = ['Zarul Rafiq Photography','S.A. Fotografi','Lukagrafi','Harry Hakimie','Artsy.co','Duan Huhu','N/A'];
  var VIDEOGRAPHER_OPTIONS = ['Artsy.co', 'N/A'];
  var OPTIONAL_FIELD_KEYS = ['eventType','bridalAttire','flowerBouquet','makeupArtist','groomStylist','photographer','photographerOptions','videographer','dulangNikah','dulangSanding','brideName','brideContactNumber','groomName','groomContactNumber','additionalAddons'];
  var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MONTHS_AHEAD = 17; // rolling window: current month + 17 months

  // ================= state =================
  var db = null;
  function defaultData(){
    return { halls: Object.assign({}, HALLS_DEFAULT), slots:{}, bookings:{}, roles:{}, people:{}, adminAuth:null };
  }
  var state = defaultData();
  var currentUserId = null;
  var me = { id:null, name:'' };
  var view = { tab:'dashboard', hallFilters:{all:true}, sessionFilters:{all:true} };
  var modalState = null;

  // ================= local session helpers =================
  function loadCurrentUser(){ try{ return JSON.parse(localStorage.getItem(USER_KEY)); }catch(e){ return null; } }
  function saveCurrentUser(u){ localStorage.setItem(USER_KEY, JSON.stringify(u)); }
  function isAdminSessionActive(){ return sessionStorage.getItem(ADMIN_SESSION_KEY)==='1'; }
  function setAdminSessionActive(on){ if(on) sessionStorage.setItem(ADMIN_SESSION_KEY,'1'); else sessionStorage.removeItem(ADMIN_SESSION_KEY); }

  async function hashText(text){
    if(window.crypto && window.crypto.subtle){
      try{
        var enc = new TextEncoder().encode(text);
        var buf = await window.crypto.subtle.digest('SHA-256', enc);
        return Array.prototype.map.call(new Uint8Array(buf), function(b){ return b.toString(16).padStart(2,'0'); }).join('');
      }catch(e){}
    }
    var h = 0;
    for(var i=0;i<text.length;i++){ h = (Math.imul(31,h) + text.charCodeAt(i))|0; }
    return 'fallback-' + h;
  }

  // ================= Firestore plumbing =================
  function reportError(context, err){
    console.error(context, err);
    var msg = (err && err.message) ? err.message : String(err);
    showToast(context + ': ' + msg, 'error');
  }
  function fsSet(collection, id, data, merge){
    return db.collection(collection).doc(id).set(data, merge ? { merge:true } : undefined);
  }
  function fsUpdate(collection, id, data){
    return db.collection(collection).doc(id).update(data);
  }
  function fsDelete(collection, id){
    return db.collection(collection).doc(id).delete();
  }
  function watchCollection(name, targetKey){
    db.collection(name).onSnapshot(function(snapshot){
      var map = {};
      snapshot.forEach(function(doc){ map[doc.id] = doc.data(); });
      state[targetKey] = map;
      clearFatalBanner();
      renderAll();
    }, function(err){
      reportError('Could not load "'+name+'" from Firebase', err);
      showFatalBanner('Lost connection to the "'+name+'" data in Firebase. Check your internet connection and Firestore security rules (read access for this collection), then refresh the page.');
    });
  }
  function watchDoc(collection, id, targetKey){
    db.collection(collection).doc(id).onSnapshot(function(doc){
      state[targetKey] = doc.exists ? doc.data() : null;
      renderAll();
    }, function(err){
      reportError('Could not load admin settings from Firebase', err);
    });
  }
  function showFatalBanner(msg){
    var zone = document.getElementById('bannerZone');
    if(zone) zone.innerHTML = '<div class="banner"><div class="banner-inner">⚠ '+esc(msg)+'</div></div>';
  }
  function clearFatalBanner(){ var zone = document.getElementById('bannerZone'); if(zone) zone.innerHTML=''; }
  function registerPerson(id, name){
    state.people[id] = { id:id, name:name };
    fsSet('people', id, { id:id, name:name }, true).catch(function(err){
      reportError('Could not save your name to Firebase', err);
    });
  }

  // ================= helpers =================
  function esc(s){
    return String(s===undefined||s===null?'':s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function pad(n){ return (n<10?'0':'')+n; }
  function dkey(y,m,d){ return y+'-'+pad(m+1)+'-'+pad(d); }
  function todayDate(){ return new Date(); }
  function todayKey(){ var t=todayDate(); return dkey(t.getFullYear(), t.getMonth(), t.getDate()); }
  function monthKeyOf(y,m){ return y+'-'+pad(m+1); }
  function parseDateKey(key){ var p=key.split('-'); return { y:parseInt(p[0]), m:parseInt(p[1])-1, d:parseInt(p[2]) }; }
  function dateObjFromKey(key){ var p=parseDateKey(key); return new Date(p.y,p.m,p.d); }
  function fmtDateSlash(key){ var p=parseDateKey(key); return pad(p.d)+'/'+pad(p.m+1)+'/'+p.y; }
  function fmtDateHeader(key){ var p=parseDateKey(key); return p.d+' '+MONTH_NAMES[p.m]+' '+p.y; }
  function dayOf(key){ return parseDateKey(key).d; }
  function monthAbbrOf(key){ return MONTH_NAMES[parseDateKey(key).m].slice(0,3).toUpperCase(); }
  function yearOf(key){ return parseDateKey(key).y; }
  function daysBetween(fromKey, toKey){
    var a = dateObjFromKey(fromKey), b = dateObjFromKey(toKey);
    return Math.round((b - a) / 86400000);
  }
  function slotDocId(hallId, date, session){ return hallId+'__'+date+'__'+session; }
  function slugify(name){
    var s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
    return 'u-' + (s || 'guest');
  }
  function genId(prefix){ return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7); }
  function initials(name){
    var parts = (name||'').trim().split(/\s+/).filter(Boolean);
    if(parts.length===0) return '?';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }
  function hallList(){ return Object.keys(state.halls).map(function(id){ return state.halls[id]; }); }
  function hallName(id){ return (state.halls[id] && state.halls[id].name) || id; }
  function sessionLabel(id){ var s=SESSIONS.filter(function(x){return x.id===id;})[0]; return s?s.label:id; }

  function showToast(msg, type){
    var box = document.getElementById('toasts');
    if(!box) return;
    var t = document.createElement('div');
    t.className = 'toast' + (type==='error' ? ' error' : '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function(){ t.remove(); }, 3600);
  }

  function getRole(userId){ if(!userId) return 'staff'; var r=state.roles[userId]; return (r&&r.role)||'staff'; }
  function isAdmin(){
    return !!(currentUserId && state.adminAuth && isAdminSessionActive() &&
      currentUserId === slugify(state.adminAuth.name) && getRole(currentUserId)==='admin');
  }
  function canEditBooking(b){
    if(!currentUserId) return false;
    if(isAdmin()) return true;
    return !!(b.staffName && slugify(b.staffName) === currentUserId);
  }
  function computeCompleteness(b){
    var filled = OPTIONAL_FIELD_KEYS.filter(function(k){ 
      if (k === 'additionalAddons' || k === 'photographerOptions') return Array.isArray(b[k]) && b[k].length > 0;
      return !!b[k]; 
    }).length;
    return { filled: filled, total: OPTIONAL_FIELD_KEYS.length };
  }

  function bookingsArray(){ return Object.keys(state.bookings).map(function(id){ return Object.assign({id:id}, state.bookings[id]); }); }

  function slotStatus(hallId, date, session, excludeBookingId){
    var sid = slotDocId(hallId,date,session);
    var found = bookingsArray().filter(function(b){ return b.slotId===sid && b.id!==excludeBookingId; })[0];
    if(found) return { status:'booked', booking:found };
    var sdoc = state.slots[sid];
    if(sdoc && sdoc.status==='maintenance') return { status:'maintenance' };
    return { status:'available' };
  }

  // ================= print PDF helper =================
  function printBookingPDF(b){
    var printWin = window.open('', 'black', 'width=800,height=900');
    if(!printWin) return;

    var rows = [
      ['Masa Majlis', b.eventTime],
      ['Jumlah Pax', b.pax ? b.pax + ' pax' : ''],
      ['Staff', b.staffName],
      ['Contact Number', b.clientContactNumber],
      ['Package Type', b.packageType],
      ['Jenis Majlis', b.eventType],
      ['Bridal Attire', b.bridalAttire],
      ['Flower Bouquet', b.flowerBouquet],
      ['Makeup Artist', b.makeupArtist],
      ['Groom Stylist', b.groomStylist],
      ['Photographer', b.photographer],
      ['Pakej Photographer', Array.isArray(b.photographerOptions) && b.photographerOptions.length > 0 ? b.photographerOptions.join(', ') : ''],
      ['Videographer', b.videographer],
      ['Dulang Hantaran (Nikah)', b.dulangNikah],
      ['Dulang Hantaran (Sanding)', b.dulangSanding],
      ["Bride's Full Name", b.brideName],
      ["Bride's Ctc Number", b.brideContactNumber],
      ["Groom's Full Name", b.groomName],
      ["Groom's Ctc Number", b.groomContactNumber],
      ['Dynamic Add-ons / Other Info', Array.isArray(b.additionalAddons) && b.additionalAddons.length > 0 ? b.additionalAddons.join(', ') : ''],
      ['Catatan', b.notes]
    ].filter(function(r){ return r[1]; });

    var isPaid = b.paymentStatus === 'selesai';
    var statusText = isPaid ? 'Selesai Bayar' : 'Belum Bayar';
    var statusClass = isPaid ? 'status-paid' : 'status-unpaid';

    var html = '<!DOCTYPE html><html><head><title>Booking Detail - ' + esc(b.clientName || 'Booking') + '</title>';
    html += '<style>';
    html += '* { box-sizing: border-box; }';
    html += 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 24px; color: #1e293b; background: #ffffff; line-height: 1.5; }';
    html += '.header-card { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #ffffff; padding: 20px 24px; border-radius: 12px; margin-bottom: 20px; border-left: 6px solid #d4af37; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }';
    html += 'h1 { font-size: 22px; margin: 0 0 12px 0; font-weight: 700; color: #ffffff; letter-spacing: -0.3px; }';
    html += '.meta-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; background: rgba(255, 255, 255, 0.08); padding: 12px 16px; border-radius: 8px; font-size: 13px; border: 1px solid rgba(255,255,255,0.1); }';
    html += '.meta-item { color: #cbd5e1; }';
    html += '.meta-item strong { color: #ffffff; font-weight: 600; }';
    html += '.status-badge { display: inline-block; padding: 3px 10px; border-radius: 14px; font-weight: 600; font-size: 11.5px; margin-left: 4px; }';
    html += '.status-paid { background-color: #dcfce7; color: #166534; }';
    html += '.status-unpaid { background-color: #fef3c7; color: #92400e; }';
    html += 'table { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 15px; border-radius: 10px; overflow: hidden; border: 1px solid #e2e8f0; }';
    html += 'th { background-color: #1e293b; color: #ffffff; padding: 12px 16px; font-size: 13px; font-weight: 600; text-align: left; text-transform: uppercase; letter-spacing: 0.5px; }';
    html += 'td { padding: 10px 16px; text-align: left; font-size: 13px; border-bottom: 1px solid #e2e8f0; color: #334155; }';
    html += 'tr:last-child td { border-bottom: none; }';
    html += 'tr:nth-child(even) td { background-color: #f8fafc; }';
    html += '.key-cell { font-weight: 600; color: #0f172a; width: 35%; background-color: #f1f5f9; border-right: 1px solid #e2e8f0; }';
    html += '@media print { ';
    html += '  body { padding: 0; } ';
    html += '  .header-card, .status-badge, th, .key-cell, tr:nth-child(even) td { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } ';
    html += '}';
    html += '</style></head><body>';
    
    html += '<div class="header-card">';
    html += '<h1>' + esc(b.clientName || 'TBC') + '</h1>';
    html += '<div class="meta-grid">';
    html += '<div class="meta-item"><strong>Lokasi:</strong> ' + esc(hallName(b.hallId)) + '</div>';
    html += '<div class="meta-item"><strong>Sesi:</strong> ' + esc(sessionLabel(b.eventSession)) + '</div>';
    html += '<div class="meta-item"><strong>Tarikh:</strong> ' + esc(fmtDateSlash(b.eventDate)) + '</div>';
    html += '<div class="meta-item"><strong>Status Bayaran:</strong> <span class="status-badge ' + statusClass + '">' + statusText + '</span></div>';
    html += '</div></div>';

    html += '<table><thead><tr><th style="width:35%;">Perkara</th><th>Butiran</th></tr></thead><tbody>';
    rows.forEach(function(r){
      html += '<tr><td class="key-cell">' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '</body></html>';

    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
    printWin.focus();

    setTimeout(function(){
      printWin.print();
      printWin.close();
    }, 400);
  }

  // ================= init =================
  function init(){
    if(!window.db){
      showFatalBanner('Firebase isn\'t initialized (window.db is missing) — check the Firebase <script> tags and firebaseConfig in index.html.');
      return;
    }
    db = window.db;

    var existingUser = loadCurrentUser();
    if(existingUser && existingUser.id){
      currentUserId = existingUser.id; me = existingUser;
      registerPerson(me.id, me.name);
    } else {
      document.getElementById('signInOverlay').classList.add('open');
    }
    view.tab = 'dashboard';
    renderAll();

    watchCollection('bookings', 'bookings');
    watchCollection('slots', 'slots');
    watchCollection('people', 'people');
    watchCollection('roles', 'roles');
    watchDoc('settings', 'adminAuth', 'adminAuth');
  }

  document.getElementById('signInForm').addEventListener('submit', function(e){
    e.preventDefault();
    var name = document.getElementById('signInName').value.trim();
    if(!name) return;
    var id = slugify(name);
    me = { id:id, name:name };
    currentUserId = id;
    saveCurrentUser(me);
    registerPerson(id, name);
    setAdminSessionActive(false);
    document.getElementById('signInOverlay').classList.remove('open');
    renderAll();
    showToast('Signed in as ' + name + '.');
  });

  function renderAll(){
    renderTopbar();
    renderTabbar();
    renderMain();
  }

  // ================= topbar =================
  function renderTopbar(){
    var el = document.getElementById('topbarRight');
    if(!el) return;
    var html = '<span class="today-label">'+esc(fmtDateHeader(todayKey()))+'</span>';
    html += '<button class="btn btn-sm" id="refreshBtn">↻ Refresh</button>';
    if(currentUserId){
      var admin = isAdmin();
      html += '<div class="who"><span class="avatar">'+esc(initials(me.name))+'</span>'+
              '<span class="role-badge'+(admin?' admin':'')+'">'+(admin?'Admin':'Staff')+'</span></div>';
      if(admin){
        html += '<button class="btn btn-sm" id="adminBtn">Urus Pasukan</button>';
      } else if(!state.adminAuth){
        html += '<button class="btn btn-sm btn-ghost" id="adminSetupBtn">Setup Admin</button>';
      } else {
        html += '<button class="btn btn-sm btn-ghost" id="adminLoginBtn">Admin Log In</button>';
      }
      html += '<button class="btn btn-sm btn-ghost" id="switchUserBtn">Switch</button>';
      html += '<button class="btn btn-gold" id="addBookingBtn">+ Tambah Booking</button>';
    } else {
      html += '<span class="helper-text">Sign in to add bookings.</span>';
    }
    el.innerHTML = html;
    document.getElementById('refreshBtn').addEventListener('click', function(){
      renderAll(); showToast('View refreshed.');
    });
    var ab = document.getElementById('addBookingBtn');
    if(ab) ab.addEventListener('click', function(){ openModal('bookingForm', {}); });
    var adm = document.getElementById('adminBtn');
    if(adm) adm.addEventListener('click', function(){ openModal('admin', {}); });
    var asb = document.getElementById('adminSetupBtn');
    if(asb) asb.addEventListener('click', function(){ openModal('adminSetup', {}); });
    var alb = document.getElementById('adminLoginBtn');
    if(alb) alb.addEventListener('click', function(){ openModal('adminLogin', {}); });
    var su = document.getElementById('switchUserBtn');
    if(su) su.addEventListener('click', switchUser);
  }

  function switchUser(){
    localStorage.removeItem(USER_KEY);
    setAdminSessionActive(false);
    currentUserId = null; me = { id:null, name:'' };
    closeModal();
    document.getElementById('signInName').value = '';
    document.getElementById('signInOverlay').classList.add('open');
    renderTopbar();
  }

  // ================= tabbar =================
  function monthTabs(){
    var t = todayDate();
    var tabs = [];
    for(var i=0;i<=MONTHS_AHEAD;i++){
      var y = t.getFullYear(), m = t.getMonth()+i;
      while(m>11){ m-=12; y++; }
      tabs.push({ key: monthKeyOf(y,m), label: MONTH_NAMES[m], year:y, month:m });
    }
    return tabs;
  }
  function renderTabbar(){
    var el = document.getElementById('tabbar');
    var html = '<button class="tab'+(view.tab==='dashboard'?' active':'')+'" data-tab="dashboard">▦ Dashboard</button>';
    monthTabs().forEach(function(mt){
      html += '<button class="tab'+(view.tab===mt.key?' active':'')+'" data-tab="'+mt.key+'">'+mt.label+'</button>';
    });
    el.innerHTML = html;
    Array.prototype.forEach.call(el.querySelectorAll('.tab'), function(btn){
      btn.addEventListener('click', function(){
        view.tab = btn.getAttribute('data-tab');
        renderTabbar();
        renderMain();
      });
    });
  }

  // ================= main dispatch =================
  function renderMain(){
    if(view.tab === 'dashboard') renderDashboard();
    else renderMonth(view.tab);
  }

  // ================= tags =================
  function hallTag(hallId){ return '<span class="tag '+hallId+'">'+esc(hallName(hallId))+'</span>'; }
  function sessionTag(sessionId){ return '<span class="tag '+sessionId+'">'+esc(sessionLabel(sessionId))+'</span>'; }
  function paymentTag(status){
    return status==='selesai' ? '<span class="tag paid">Selesai bayar</span>' : '<span class="tag unpaid">Belum bayar</span>';
  }

  // ================= dashboard =================
  function renderDashboard(){
    var all = bookingsArray();
    var tKey = todayKey();
    var curYear = yearOf(tKey), nextYear = curYear+1;
    var curMonthKey = tKey.slice(0,7);

    var totalCurYear = all.filter(function(b){ return yearOf(b.eventDate)===curYear; }).length;
    var totalNextYear = all.filter(function(b){ return yearOf(b.eventDate)===nextYear; }).length;
    var thisMonthCount = all.filter(function(b){ return b.eventDate.slice(0,7)===curMonthKey; }).length;
    var upcoming = all.filter(function(b){ return b.eventDate >= tKey; });
    var bayuTotal = all.filter(function(b){ return b.hallId==='bayu'; }).length;
    var ballroomTotal = all.filter(function(b){ return b.hallId==='ballroom'; }).length;

    var html = '<div class="stat-grid">';
    html += statCard('📅', 'Total job '+curYear, totalCurYear, 'job', true);
    html += statCard('📅', 'Total job '+nextYear, totalNextYear, 'job', true);
    html += statCard('📅', 'Bulan ini', thisMonthCount, MONTH_NAMES[parseDateKey(tKey).m], false);
    html += statCard('⏱', 'Job akan datang', upcoming.length, 'dari hari ini', false);
    html += statCard('🏛', hallName('bayu'), bayuTotal, 'job keseluruhan', false);
    html += statCard('🏛', hallName('ballroom'), ballroomTotal, 'job keseluruhan', false);
    html += '</div>';

    html += '<div class="section-label">Next job</div>';
    upcoming.sort(function(a,b){ return a.eventDate===b.eventDate ? a.eventSession.localeCompare(b.eventSession) : a.eventDate.localeCompare(b.eventDate); });
    if(upcoming.length===0){
      html += '<div class="empty-note">No upcoming jobs yet.</div>';
    } else {
      var groups = [];
      var byDate = {};
      upcoming.forEach(function(b){
        if(!byDate[b.eventDate]){ byDate[b.eventDate] = []; groups.push(b.eventDate); }
        byDate[b.eventDate].push(b);
      });
      groups.slice(0,8).forEach(function(dateKey){
        var jobs = byDate[dateKey];
        var daysLeft = daysBetween(tKey, dateKey);
        html += '<div class="job-card">';
        html += '<div class="job-date"><div class="d">'+dayOf(dateKey)+'</div><div class="m">'+monthAbbrOf(dateKey)+'</div><div class="y">'+yearOf(dateKey)+'</div></div>';
        html += '<div class="job-main"><div class="job-count">'+jobs.length+' job</div>';
        jobs.forEach(function(b){
          html += '<div class="job-entry" data-open-booking="'+b.id+'">';
          html += '<div class="job-entry-name">'+esc(b.clientName || 'TBC')+' ('+(b.pax||'-')+' pax)</div>';
          html += '<div class="job-tags">';
          if(b.packageType) html += '<span class="tag package">'+esc(b.packageType)+'</span>';
          html += hallTag(b.hallId);
          html += sessionTag(b.eventSession);
          html += '</div></div>';
        });
        html += '</div>';
        html += '<div class="job-days-left"><div class="n">'+(daysLeft<=0?0:daysLeft)+'</div><div class="l">hari lagi</div></div>';
        html += '</div>';
      });
    }
    document.getElementById('mainView').innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll('[data-open-booking]'), function(el){
      el.addEventListener('click', function(){ openModal('bookingView', { id: el.getAttribute('data-open-booking') }); });
    });
  }
  function statCard(icon, label, value, sub, gold){
    return '<div class="stat-card"><div class="stat-icon">'+icon+'</div>'+
      '<div class="stat-label">'+esc(label)+'</div>'+
      '<div class="stat-value'+(gold?' gold':'')+'">'+value+'</div>'+
      '<div class="stat-sub">'+esc(sub)+'</div></div>';
  }

  // ================= month view =================
  function renderMonth(monthKey){
    var parts = monthKey.split('-');
    var y = parseInt(parts[0]), m = parseInt(parts[1])-1;
    var monthBookings = bookingsArray().filter(function(b){ return b.eventDate.slice(0,7)===monthKey; });
    var paidCount = monthBookings.filter(function(b){ return b.paymentStatus==='selesai'; }).length;
    var unpaidCount = monthBookings.length - paidCount;

    var html = '';
    html += '<div class="month-banner"><div class="month-banner-left">'+
      '<div class="month-banner-icon">🗓</div>'+
      '<div><div class="month-banner-title">Tambah booking baru</div>'+
      '<div class="month-banner-sub">Pilih tarikh, hall dan pakej — data terus masuk ke jadual di bawah.</div></div></div>'+
      (currentUserId ? '<button class="btn btn-gold" id="bannerAddBtn">Tambah Booking</button>' : '') +
      '</div>';

    html += '<div class="month-head"><div class="month-title">'+MONTH_NAMES[m]+' '+y+'</div>'+
      '<div class="month-count">'+monthBookings.length+' job</div></div>';

    html += '<div class="pay-grid">';
    html += '<div class="pay-card"><div class="pay-icon paid">✓</div><div><div class="pay-value paid">'+paidCount+' job</div><div class="pay-label">Selesai bayar</div></div></div>';
    html += '<div class="pay-card"><div class="pay-icon unpaid">⏱</div><div><div class="pay-value unpaid">'+unpaidCount+' job</div><div class="pay-label">Belum bayar</div></div></div>';
    html += '</div>';

    html += '<div class="filter-row" id="filterRow">';
    html += filterPill('all','Semua');
    hallList().forEach(function(h){ html += filterPill(h.id, h.name); });
    SESSIONS.forEach(function(s){ html += filterPill(s.id, s.label); });
    html += '</div>';

    var filtered = monthBookings.filter(passesFilters).sort(function(a,b){
      return a.eventDate===b.eventDate ? a.eventSession.localeCompare(b.eventSession) : a.eventDate.localeCompare(b.eventDate);
    });

    html += '<div class="table-wrap"><table class="booking-table"><thead><tr>'+
      '<th>Tarikh</th><th>Lokasi</th><th>Client</th><th>Pakej</th><th>Pax</th><th>Majlis</th><th>Masa</th><th>Bayaran &amp; Info</th>'+
      '</tr></thead><tbody>';
    if(filtered.length===0){
      html += '<tr><td colspan="8"><div class="empty-note">No bookings match this view yet.</div></td></tr>';
    } else {
      filtered.forEach(function(b){
        html += '<tr data-row-booking="'+b.id+'">'+
          '<td>'+fmtDateSlash(b.eventDate)+'</td>'+
          '<td>'+hallTag(b.hallId)+'</td>'+
          '<td><div class="cell-couple">'+esc(b.clientName||'TBC')+'</div><div class="cell-sub">'+esc(b.clientContactNumber||'')+'</div>'+
            (function(){ var c=computeCompleteness(b); return c.filled<c.total ? '<span class="tag muted" style="margin-top:4px;display:inline-block;">Perlu lengkap ('+c.filled+'/'+c.total+')</span>' : ''; })()+
            '</td>'+
          '<td><span class="tag package">'+esc(b.packageType||'')+'</span></td>'+
          '<td><strong>'+esc(b.pax||'-')+'</strong></td>'+
          '<td>'+esc(b.eventType||'')+'</td>'+
          '<td>'+sessionTag(b.eventSession)+'</td>'+
          '<td><div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">'+
            paymentTag(b.paymentStatus)+
            '<button class="btn btn-sm btn-ghost" data-more-info="'+b.id+'" style="border:1px solid var(--line); padding:3px 8px; font-size:11.5px; background:var(--paper-raised);">More Info</button>'+
          '</div></td>'+
          '</tr>';
      });
    }
    html += '</tbody></table></div>';

    document.getElementById('mainView').innerHTML = html;

    var bannerBtn = document.getElementById('bannerAddBtn');
    if(bannerBtn) bannerBtn.addEventListener('click', function(){ openModal('bookingForm', {}); });

    Array.prototype.forEach.call(document.querySelectorAll('#filterRow [data-filter]'), function(btn){
      btn.addEventListener('click', function(){
        var key = btn.getAttribute('data-filter');
        toggleFilter(key);
        renderMonth(monthKey);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-row-booking]'), function(row){
      row.addEventListener('click', function(){ openModal('bookingView', { id: row.getAttribute('data-row-booking') }); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-more-info]'), function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        openModal('bookingView', { id: btn.getAttribute('data-more-info') });
      });
    });
  }
  function filterPill(key, label){
    var isHall = !!state.halls[key];
    var active = key==='all' ? !!view.hallFilters.all && !!view.sessionFilters.all
      : (isHall ? !!view.hallFilters[key] : !!view.sessionFilters[key]);
    return '<button class="filter-pill'+(active?' active':'')+'" data-filter="'+key+'">'+esc(label)+'</button>';
  }
  function toggleFilter(key){
    if(key==='all'){ view.hallFilters = {all:true}; view.sessionFilters = {all:true}; return; }
    if(state.halls[key]){
      delete view.hallFilters.all;
      view.hallFilters[key] = !view.hallFilters[key];
      if(!Object.keys(view.hallFilters).some(function(k){return view.hallFilters[k];})) view.hallFilters = {all:true};
    } else {
      delete view.sessionFilters.all;
      view.sessionFilters[key] = !view.sessionFilters[key];
      if(!Object.keys(view.sessionFilters).some(function(k){return view.sessionFilters[k];})) view.sessionFilters = {all:true};
    }
  }
  function passesFilters(b){
    var hallOk = view.hallFilters.all || !!view.hallFilters[b.hallId];
    var sessOk = view.sessionFilters.all || !!view.sessionFilters[b.eventSession];
    return hallOk && sessOk;
  }

  // ================= modal plumbing =================
  var overlay = document.getElementById('modalOverlay');
  var modalEl = document.getElementById('modal');
  overlay.addEventListener('click', function(e){ if(e.target===overlay) closeModal(); });

  function openModal(type, payload){ modalState = { type:type, payload:payload||{} }; overlay.classList.add('open'); renderModal(); }
  function closeModal(){ modalState = null; overlay.classList.remove('open'); modalEl.innerHTML=''; }
  function isModalShowing(type, id){ return !!(modalState && modalState.type===type && (id===undefined || modalState.payload.id===id)); }

  function modalFrame(icon, title, sub, bodyHtml, footHtml){
    modalEl.innerHTML =
      '<div class="modal-head"><div><div class="modal-title">'+(icon?icon+' ':'')+esc(title)+'</div>'+
      (sub?'<div class="modal-sub">'+esc(sub)+'</div>':'')+'</div>'+
      '<button class="btn btn-sm btn-ghost" id="modalCloseBtn">✕</button></div>'+
      '<div class="modal-body">'+bodyHtml+'</div>'+
      (footHtml ? '<div class="modal-foot">'+footHtml+'</div>' : '');
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  }
  function renderModal(){
    if(!modalState) return;
    if(modalState.type==='bookingForm') renderBookingForm(modalState.payload);
    else if(modalState.type==='bookingView') renderBookingView(modalState.payload.id);
    else if(modalState.type==='admin') renderAdminModal();
    else if(modalState.type==='adminSetup') renderAdminSetupModal();
    else if(modalState.type==='adminLogin') renderAdminLoginModal();
  }

  // ================= select-with-custom & Dynamic Add-ons Component =================
  function selectOtherField(cfg){
    var value = cfg.value || '';
    var inOptions = cfg.options.indexOf(value) !== -1;
    var selVal = value==='' ? '' : (inOptions ? value : '__other__');
    var html = '<div class="field">';
    html += '<label class="field-label" for="f_'+cfg.name+'">'+esc(cfg.label)+(cfg.required?' <span class="req">*</span>':'')+'</label>';
    html += '<select id="f_'+cfg.name+'" data-role="selother" data-target="'+cfg.name+'"'+(cfg.required?' required':'')+'>';
    html += '<option value=""'+(selVal===''?' selected':'')+' disabled>'+esc(cfg.placeholderOption||'Pilih satu')+'</option>';
    cfg.options.forEach(function(o){ html += '<option value="'+esc(o)+'"'+(selVal===o?' selected':'')+'>'+esc(o)+'</option>'; });
    html += '<option value="__other__"'+(selVal==='__other__'?' selected':'')+'>Lain-lain / custom</option>';
    html += '</select>';
    html += '<input type="text" class="field-other" data-other-for="'+cfg.name+'" placeholder="'+esc(cfg.placeholder||'Enter custom value')+'" '+
            'style="display:'+(selVal==='__other__'?'block':'none')+';" value="'+esc(selVal==='__other__'?value:'')+'">';
    html += '</div>';
    return html;
  }
  function bindSelectOther(container){
    Array.prototype.forEach.call(container.querySelectorAll('[data-role="selother"]'), function(sel){
      sel.addEventListener('change', function(){
        var other = container.querySelector('[data-other-for="'+sel.getAttribute('data-target')+'"]');
        if(!other) return;
        if(sel.value==='__other__'){ other.style.display='block'; other.focus(); }
        else { other.style.display='none'; other.value=''; }
      });
    });
  }
  function readSelectOther(container, name){
    var sel = container.querySelector('[data-target="'+name+'"]');
    if(!sel) return '';
    if(sel.value==='__other__'){ var o = container.querySelector('[data-other-for="'+name+'"]'); return o?o.value.trim():''; }
    return sel.value;
  }

  function readPhotographerOptions(container){
    var cbs = container.querySelectorAll('.photo-opt-cb:checked');
    var res = [];
    Array.prototype.forEach.call(cbs, function(cb){ res.push(cb.value); });
    return res;
  }

  function dynamicAddonsContainer(existingAddons){
    var list = Array.isArray(existingAddons) ? existingAddons : [];
    var html = '<div class="field" style="margin-top:14px; padding-top:10px; border-top:1px dashed var(--line);">';
    html += '<label class="field-label" style="font-weight:600; font-size:13px;">Add-on Vendor</label>';
    html += '<div id="addonsDynamicList" style="display:flex; flex-direction:column; gap:8px;">';
    list.forEach(function(item){
      html += '<div class="addon-row">';
      html += '<input type="text" class="addon-input" value="'+esc(item)+'" placeholder="Taip maklumat info...">';
      html += '<button type="button" class="btn btn-sm btn-danger remove-addon-btn">✕</button>';
      html += '</div>';
    });
    html += '</div>';
    html += '<div style="margin-top:10px; display:flex; gap:8px; align-items:center; font-size:13px; color:var(--ink-soft);">';
    html += '<button type="button" id="addOptionBtn" style="background:none; border:none; padding:0; color:var(--gold, #d4af37); text-decoration:underline; font-weight:500; cursor:pointer;">Add option</button>';
    html += '</div></div>';
    return html;
  }

  function createAddonRow(placeholderText){
    var row = document.createElement('div');
    row.className = 'addon-row';
    row.innerHTML = '<input type="text" class="addon-input" placeholder="'+esc(placeholderText||'Taip maklumat info...')+'">' +
                    '<button type="button" class="btn btn-sm btn-danger remove-addon-btn">✕</button>';
    row.querySelector('.remove-addon-btn').addEventListener('click', function(){
      row.remove();
    });
    return row;
  }

  function bindDynamicAddons(container){
    var listContainer = container.querySelector('#addonsDynamicList');
    var addOptBtn = container.querySelector('#addOptionBtn');
    var addOtherBtn = container.querySelector('#addOtherBtn');

    if(addOptBtn && listContainer){
      addOptBtn.addEventListener('click', function(e){
        e.preventDefault();
        var num = listContainer.querySelectorAll('.addon-row').length + 1;
        var row = createAddonRow('Option ' + num + ': Taip maklumat...');
        listContainer.appendChild(row);
        row.querySelector('input').focus();
      });
    }

    if(addOtherBtn && listContainer){
      addOtherBtn.addEventListener('click', function(e){
        e.preventDefault();
        var row = createAddonRow('Other: Taip maklumat pilihan...');
        listContainer.appendChild(row);
        row.querySelector('input').focus();
      });
    }

    Array.prototype.forEach.call(container.querySelectorAll('.remove-addon-btn'), function(btn){
      btn.addEventListener('click', function(){
        var row = btn.closest('.addon-row');
        if(row) row.remove();
      });
    });
  }

  function readDynamicAddons(container){
    var inputs = container.querySelectorAll('.addon-input');
    var result = [];
    Array.prototype.forEach.call(inputs, function(inp){
      var val = inp.value.trim();
      if(val) result.push(val);
    });
    return result;
  }

  function textField(name, label, existing, required, def, type, placeholder){
    var val = existing ? (existing[name]||'') : (def||'');
    return '<div class="field"><label class="field-label" for="f_'+name+'">'+esc(label)+(required?' <span class="req">*</span>':'')+'</label>'+
      '<input type="'+(type||'text')+'" id="f_'+name+'" name="'+name+'" value="'+esc(val)+'"'+(required?' required':'')+(placeholder?' placeholder="'+esc(placeholder)+'"':'')+'>'+
      '</div>';
  }
  function selectFieldPlain(name, label, options, value, required, placeholder){
    var html = '<div class="field"><label class="field-label" for="f_'+name+'">'+esc(label)+(required?' <span class="req">*</span>':'')+'</label>';
    html += '<select id="f_'+name+'" name="'+name+'"'+(required?' required':'')+'>';
    html += '<option value=""'+(value?'':' selected')+' disabled>'+esc(placeholder)+'</option>';
    options.forEach(function(o){ html += '<option value="'+esc(o.v)+'"'+(value===o.v?' selected':'')+'>'+esc(o.l)+'</option>'; });
    html += '</select></div>';
    return html;
  }

  // ================= booking form (add / edit) =================
  function renderBookingForm(payload){
    var editId = payload.editId || null;
    var isEdit = !!editId;
    var existing = isEdit ? state.bookings[editId] : null;
    if(isEdit && !existing){ closeModal(); return; }
    var completeness = existing ? computeCompleteness(existing) : { filled:0, total:OPTIONAL_FIELD_KEYS.length };
    var openMore = !!payload.focusMore || (isEdit && completeness.filled < completeness.total);

    var body = '<form id="bookingForm">';
    body += '<div class="fieldset-title">Maklumat wajib (1–8)</div>';
    body += textField('staffName','1. Staff Name', existing, true, me.name||'Staff');
    body += textField('clientName',"2. Client's Name", existing, true, '', 'text');
    body += textField('clientContactNumber','3. Contact Number', existing, true, '', 'tel');
    body += selectOtherField({name:'packageType', label:'4. Package Type', options:PACKAGE_OPTIONS, value: existing?existing.packageType:'', required:true, placeholder:'Nama pakej custom', placeholderOption:'Pilih pakej'});
    body += textField('pax','5. Jumlah Pax / Tetamu', existing, true, '', 'text');
    body += textField('eventDate','6. Event Date', existing, true, todayKey(), 'date');
    body += '<div class="grid-2">';
    body += selectFieldPlain('hallId','Hall', hallList().map(function(h){return {v:h.id,l:h.name};}), existing?existing.hallId:'', true, 'Pilih hall');
    body += selectFieldPlain('eventSession','7. Event Session (Siang/Malam)', SESSIONS.map(function(s){return {v:s.id,l:s.label};}), existing?existing.eventSession:'', true, 'Pilih masa');
    body += '</div>';
    body += selectOtherField({name:'eventTime', label:'8. Masa Majlis', options:EVENT_TIME_OPTIONS, value: existing?existing.eventTime:'', required:true, placeholder:'cth: 10:00 AM - 2:00 PM', placeholderOption:'Pilih masa majlis'});
    body += '<div id="availabilityNote"></div>';

    body += '<details class="more"'+(openMore?' open':'')+'><summary>Butiran &amp; Add-on — boleh isi sekarang atau kemudian ('+completeness.filled+'/'+completeness.total+' lengkap)</summary><div class="more-body">';
    body += selectOtherField({name:'eventType', label:'Jenis Majlis', options:CEREMONY_OPTIONS, value: existing?existing.eventType:'', placeholder:'Jenis majlis custom', placeholderOption:'Pilih jenis'});
    body += '<div class="fieldset-title">Butiran Pakej</div>';
    body += selectOtherField({name:'bridalAttire', label:'Bridal Attire', options:BRIDAL_ATTIRE_OPTIONS, value: existing?existing.bridalAttire:'', placeholder:'Custom attire', placeholderOption:'Pilih satu'});
    body += selectOtherField({name:'flowerBouquet', label:'Flower Bouquet', options:FLOWER_BOUQUET_OPTIONS, value: existing?existing.flowerBouquet:'', placeholder:'Custom flower bouquet', placeholderOption:'Pilih satu'});
    body += selectOtherField({name:'makeupArtist', label:'Makeup Artist', options:MAKEUP_OPTIONS, value: existing?existing.makeupArtist:'', placeholder:'Custom makeup artist', placeholderOption:'Pilih satu'});
    body += selectOtherField({name:'groomStylist', label:'Groom Stylist', options:GROOM_STYLIST_OPTIONS, value: existing?existing.groomStylist:'', placeholder:'Custom groom stylist', placeholderOption:'Pilih satu'});
    
    // Photographer + Checkbox options (Outdoor / Album)
    body += selectOtherField({name:'photographer', label:'Photographer', options:PHOTOGRAPHER_OPTIONS, value: existing?existing.photographer:'', placeholder:'Custom photographer', placeholderOption:'Pilih satu'});
    var existingPhotoOpts = (existing && Array.isArray(existing.photographerOptions)) ? existing.photographerOptions : [];
    body += '<div class="field" style="margin-top:-6px; margin-bottom:12px;">';
    body += '<label class="field-label">Pilihan Photographer</label>';
    body += '<div style="display:flex; gap:16px; align-items:center; margin-top:4px;">';
    body += '<label style="display:flex; align-items:center; gap:6px; font-weight:normal; cursor:pointer;"><input type="checkbox" class="photo-opt-cb" value="Outdoor"'+(existingPhotoOpts.indexOf('Outdoor')!==-1?' checked':'')+'> Outdoor</label>';
    body += '<label style="display:flex; align-items:center; gap:6px; font-weight:normal; cursor:pointer;"><input type="checkbox" class="photo-opt-cb" value="Album"'+(existingPhotoOpts.indexOf('Album')!==-1?' checked':'')+'> Album</label>';
    body += '</div></div>';

    body += selectOtherField({name:'videographer', label:'Videographer', options:VIDEOGRAPHER_OPTIONS, value: existing?existing.videographer:'', placeholder:'Custom videographer', placeholderOption:'Pilih satu'});

    // Dulang Hantaran Inputs (Nikah & Sanding) - Color changed to standard white
    body += '<div class="field" style="margin-top:10px;">';
    body += '<label class="field-label" style="font-weight:600; font-size:13px;">Dulang Hantaran</label>';
    body += '<div class="grid-2" style="margin-top:4px;">';
    body += textField('dulangNikah', 'Nikah', existing, false, '', 'text');
    body += textField('dulangSanding', 'Sanding', existing, false, '', 'text');
    body += '</div></div>';

    body += '<div class="fieldset-title">Add-on (maklumat pengantin)</div>';
    body += '<div class="grid-2">';
    body += textField('brideName',"Bride's Full Name", existing, false, '');
    body += textField('brideContactNumber',"Bride's Ctc Number", existing, false, '', 'tel');
    body += '</div>';
    body += '<div class="grid-2">';
    body += textField('groomName',"Groom's Full Name", existing, false, '');
    body += textField('groomContactNumber',"Groom's Ctc Number", existing, false, '', 'tel');
    body += '</div>';

    body += dynamicAddonsContainer(existing ? existing.additionalAddons : []);

    body += textField('notes','Catatan Tambahan', existing, false, '', 'text', 'Optional');
    body += '</div></details>';
    body += '</form>';

    var foot = '<button class="btn" id="cancelBtn">Batal</button>'+
      '<button type="submit" form="bookingForm" class="btn btn-gold">📨 Hantar Booking</button>';

    modalFrame('📝', isEdit ? 'Kemaskini Booking' : 'Tambah Booking Baru', 'The Ballroom & The Bayu — Wedding Booking', body, foot);
    bindSelectOther(modalEl);
    bindDynamicAddons(modalEl);
    document.getElementById('cancelBtn').addEventListener('click', closeModal);

    function updateAvailabilityNote(){
      var form = document.getElementById('bookingForm');
      var d = form.eventDate.value, h = form.hallId.value, s = form.eventSession.value;
      var note = document.getElementById('availabilityNote');
      if(!d || !h || !s){ note.innerHTML=''; return; }
      var info = slotStatus(h, d, s, editId);
      if(info.status==='available') note.innerHTML = '<div class="availability-note ok">Slot ini kosong — sedia untuk ditempah.</div>';
      else if(info.status==='maintenance') note.innerHTML = '<div class="availability-note bad">Slot ini ditanda sebagai penyelenggaraan oleh admin.</div>';
      else note.innerHTML = '<div class="availability-note bad">Slot ini sudah ditempah untuk '+esc(info.booking.clientName||'seseorang')+'.</div>';
    }
    var formEl = document.getElementById('bookingForm');
    ['eventDate','hallId','eventSession'].forEach(function(n){ formEl[n].addEventListener('change', updateAvailabilityNote); });
    updateAvailabilityNote();

    formEl.addEventListener('submit', function(e){
      e.preventDefault();
      var fields = {
        eventDate: formEl.eventDate.value,
        hallId: formEl.hallId.value,
        eventSession: formEl.eventSession.value,
        eventTime: readSelectOther(modalEl, 'eventTime'),
        packageType: readSelectOther(modalEl, 'packageType'),
        pax: formEl.pax.value.trim(),
        eventType: readSelectOther(modalEl, 'eventType'),
        clientName: formEl.clientName.value.trim(),
        clientContactNumber: formEl.clientContactNumber.value.trim(),
        notes: formEl.notes.value.trim(),
        staffName: formEl.staffName.value.trim() || (me.name||'Staff'),
        bridalAttire: readSelectOther(modalEl, 'bridalAttire'),
        flowerBouquet: readSelectOther(modalEl, 'flowerBouquet'),
        makeupArtist: readSelectOther(modalEl, 'makeupArtist'),
        groomStylist: readSelectOther(modalEl, 'groomStylist'),
        photographer: readSelectOther(modalEl, 'photographer'),
        photographerOptions: readPhotographerOptions(modalEl),
        videographer: readSelectOther(modalEl, 'videographer'),
        dulangNikah: formEl.dulangNikah.value.trim(),
        dulangSanding: formEl.dulangSanding.value.trim(),
        brideName: formEl.brideName.value.trim(),
        brideContactNumber: formEl.brideContactNumber.value.trim(),
        groomName: formEl.groomName.value.trim(),
        groomContactNumber: formEl.groomContactNumber.value.trim(),
        additionalAddons: readDynamicAddons(modalEl)
      };
      if(!fields.eventDate || !fields.hallId || !fields.eventSession || !fields.eventTime || !fields.packageType || !fields.pax || !fields.staffName || !fields.clientName || !fields.clientContactNumber){
        showToast('Sila isi semua ruangan wajib (1–8).', 'error');
        return;
      }
      var sid = slotDocId(fields.hallId, fields.eventDate, fields.eventSession);
      var info = slotStatus(fields.hallId, fields.eventDate, fields.eventSession, editId);
      if(info.status !== 'available'){
        showToast('Slot ini tidak tersedia — pilih tarikh/hall/masa lain.', 'error');
        return;
      }
      fields.slotId = sid;

      if(isEdit){
        fields.paymentStatus = existing.paymentStatus || 'belum';
        fields.createdBy = existing.createdBy;
        fields.createdAt = existing.createdAt;
        var previous = state.bookings[editId];
        state.bookings[editId] = fields;
        closeModal();
        renderAll();
        openModal('bookingView', { id: editId });
        fsSet('bookings', editId, fields).then(function(){
          showToast('Booking dikemaskini.');
        }).catch(function(err){
          state.bookings[editId] = previous;
          if(isModalShowing('bookingView', editId)) openModal('bookingView', { id: editId }); else renderAll();
          reportError('Booking tidak dapat dikemaskini di Firebase', err);
        });
      } else {
        fields.paymentStatus = 'belum';
        fields.createdBy = currentUserId;
        fields.createdAt = new Date().toISOString();
        var id = genId('bk');
        state.bookings[id] = fields;
        closeModal();
        renderAll();
        openModal('bookingView', { id: id });
        fsSet('bookings', id, fields).then(function(){
          showToast('Booking berjaya disimpan.');
        }).catch(function(err){
          delete state.bookings[id];
          if(isModalShowing('bookingView', id)) closeModal();
          renderAll();
          reportError('Booking TIDAK disimpan ke Firebase', err);
        });
      }
    });
  }

  // ================= booking view =================
  function renderBookingView(id){
    var b = state.bookings[id];
    if(!b){ closeModal(); showToast('Booking ini sudah tiada.', 'error'); return; }
    var completeness = computeCompleteness(b);

    var rows = [
      ['Masa Majlis', b.eventTime],
      ['Jumlah Pax', b.pax ? b.pax + ' pax' : ''],
      ['Staff', b.staffName],
      ['Contact Number', b.clientContactNumber],
      ['Package Type', b.packageType],
      ['Jenis Majlis', b.eventType],
      ['Bridal Attire', b.bridalAttire],
      ['Flower Bouquet', b.flowerBouquet],
      ['Makeup Artist', b.makeupArtist],
      ['Groom Stylist', b.groomStylist],
      ['Photographer', b.photographer],
      ['Pakej Photographer', Array.isArray(b.photographerOptions) && b.photographerOptions.length > 0 ? b.photographerOptions.join(', ') : ''],
      ['Videographer', b.videographer],
      ['Dulang Hantaran (Nikah)', b.dulangNikah],
      ['Dulang Hantaran (Sanding)', b.dulangSanding],
      ["Bride's Full Name", b.brideName],
      ["Bride's Ctc Number", b.brideContactNumber],
      ["Groom's Full Name", b.groomName],
      ["Groom's Ctc Number", b.groomContactNumber],
      ['Vendor luar', Array.isArray(b.additionalAddons) && b.additionalAddons.length > 0 ? b.additionalAddons.join(', ') : ''],
      ['Catatan', b.notes]
    ].filter(function(r){ return r[1]; });

    var body = '<div class="detail-head"><div>'+
      '<div class="detail-name">'+esc(b.clientName||'TBC')+'</div>'+
      '<div class="detail-meta">'+hallTag(b.hallId)+' '+sessionTag(b.eventSession)+' · '+fmtDateSlash(b.eventDate)+'</div>'+
      '</div>'+paymentTag(b.paymentStatus)+'</div>';
    if(completeness.filled < completeness.total){
      body += '<div class="availability-note bad">Butiran &amp; Add-on: '+completeness.filled+'/'+completeness.total+' lengkap — boleh disambung bila-bila masa.</div>';
    } else {
      body += '<div class="availability-note ok">Semua butiran optional sudah lengkap.</div>';
    }
    body += '<div class="detail-rows">';
    rows.forEach(function(r){ body += '<div class="detail-row"><div class="k">'+esc(r[0])+'</div><div class="v">'+esc(r[1])+'</div></div>'; });
    body += '</div>';
    body += '<div id="deleteConfirmZone"></div>';

    var foot = '';
    foot += '<button class="btn btn-sm" id="printPdfBtn">📄 Cetak PDF</button>';

    if(currentUserId){
      foot += '<button class="btn btn-sm" id="togglePayBtn">'+(b.paymentStatus==='selesai' ? 'Tandakan belum bayar' : 'Tandakan sudah bayar')+'</button>';
    }
    if(canEditBooking(b)){
      if(completeness.filled < completeness.total){
        foot += '<button class="btn btn-gold btn-sm" id="completeBtn">Lengkapkan Maklumat</button>';
      }
      foot += '<button class="btn" id="editBtn">Edit</button>';
      foot += '<button class="btn btn-danger" id="deleteBtn">Delete</button>';
    }

    modalFrame('📋', 'Butiran Booking', null, body, foot || null);

    var printBtn = document.getElementById('printPdfBtn');
    if(printBtn) {
      printBtn.addEventListener('click', function(){
        printBookingPDF(b);
      });
    }

    var togglePay = document.getElementById('togglePayBtn');
    if(togglePay) togglePay.addEventListener('click', function(){
      var newStatus = (b.paymentStatus==='selesai') ? 'belum' : 'selesai';
      var previous = b.paymentStatus;
      state.bookings[id] = Object.assign({}, b, { paymentStatus: newStatus });
      openModal('bookingView', { id:id });
      fsUpdate('bookings', id, { paymentStatus: newStatus }).catch(function(err){
        state.bookings[id] = Object.assign({}, state.bookings[id], { paymentStatus: previous });
        if(isModalShowing('bookingView', id)) openModal('bookingView', { id:id }); else renderAll();
        reportError('Status bayaran tidak dapat dikemaskini', err);
      });
    });
    var completeBtn = document.getElementById('completeBtn');
    if(completeBtn) completeBtn.addEventListener('click', function(){ openModal('bookingForm', { editId:id, focusMore:true }); });
    var editBtn = document.getElementById('editBtn');
    if(editBtn) editBtn.addEventListener('click', function(){ openModal('bookingForm', { editId:id }); });
    var deleteBtn = document.getElementById('deleteBtn');
    if(deleteBtn) deleteBtn.addEventListener('click', function(){
      document.getElementById('deleteConfirmZone').innerHTML =
        '<div class="confirm-row" style="margin-top:10px;">Padam booking ini? '+
        '<button class="btn btn-sm btn-danger" id="confirmDelete">Ya, padam</button>'+
        '<button class="btn btn-sm" id="cancelDelete">Batal</button></div>';
      document.getElementById('confirmDelete').addEventListener('click', function(){
        var previous = state.bookings[id];
        delete state.bookings[id];
        closeModal();
        renderAll();
        showToast('Booking dipadam.');
        fsDelete('bookings', id).catch(function(err){
          state.bookings[id] = previous;
          renderAll();
          reportError('Padam GAGAL — booking dipulihkan semula', err);
        });
      });
      document.getElementById('cancelDelete').addEventListener('click', function(){ document.getElementById('deleteConfirmZone').innerHTML=''; });
    });
  }

  // ================= admin auth modals =================
  function renderAdminSetupModal(){
    var body = '<p class="helper-text">This creates the one admin account for your system data. Only this exact name + password combination will be able to log in as admin.</p>';
    body += '<form id="adminSetupForm">';
    body += textField('adminName','Admin Name', null, true, me.name||'');
    body += textField('adminPassword','Password', null, true, '', 'password');
    body += textField('adminPasswordConfirm','Confirm Password', null, true, '', 'password');
    body += '</form>';
    var foot = '<button class="btn" id="cancelBtn">Batal</button>'+
      '<button type="submit" form="adminSetupForm" class="btn btn-gold">Create Admin Account</button>';
    modalFrame('🔐', 'Setup Admin', null, body, foot);
    document.getElementById('cancelBtn').addEventListener('click', closeModal);
    document.getElementById('adminSetupForm').addEventListener('submit', async function(e){
      e.preventDefault();
      var form = e.target;
      var name = form.adminName.value.trim();
      var pw = form.adminPassword.value;
      var pw2 = form.adminPasswordConfirm.value;
      if(!name || !pw){ showToast('Sila isi nama dan kata laluan.', 'error'); return; }
      if(pw.length < 4){ showToast('Kata laluan sekurang-kurangnya 4 aksara.', 'error'); return; }
      if(pw !== pw2){ showToast('Kata laluan pengesahan tidak sepadan.', 'error'); return; }
      var hash = await hashText(pw);
      var id = slugify(name);

      state.adminAuth = { name:name, passwordHash:hash };
      state.roles[id] = { role:'admin' };
      state.people[id] = { id:id, name:name };
      me = { id:id, name:name };
      currentUserId = id;
      saveCurrentUser(me);
      setAdminSessionActive(true);
      closeModal();
      renderAll();
      showToast('Admin account created — you are logged in as admin.');

      Promise.all([
        fsSet('settings','adminAuth',{ name:name, passwordHash:hash }),
        fsSet('roles', id, { role:'admin' }),
        fsSet('people', id, { id:id, name:name })
      ]).catch(function(err){
        reportError('Admin account could not be fully saved to Firebase — it may not persist after reload', err);
      });
    });
  }

  function renderAdminLoginModal(){
    var body = '<div id="adminLoginError"></div>';
    body += '<form id="adminLoginForm">';
    body += textField('loginName','Name', null, true, '');
    body += textField('loginPassword','Password', null, true, '', 'password');
    body += '</form>';
    var foot = '<button class="btn" id="cancelBtn">Batal</button>'+
      '<button type="submit" form="adminLoginForm" class="btn btn-gold">Log In</button>';
    modalFrame('🔐', 'Admin Log In', null, body, foot);
    document.getElementById('cancelBtn').addEventListener('click', closeModal);
    document.getElementById('adminLoginForm').addEventListener('submit', async function(e){
      e.preventDefault();
      var form = e.target;
      var name = form.loginName.value.trim();
      var pw = form.loginPassword.value;
      var errZone = document.getElementById('adminLoginError');
      if(!state.adminAuth){ errZone.innerHTML = '<div class="availability-note bad">No admin account exists yet.</div>'; return; }
      var hash = await hashText(pw);
      var nameMatches = name.toLowerCase() === state.adminAuth.name.toLowerCase();
      var pwMatches = hash === state.adminAuth.passwordHash;
      if(!nameMatches || !pwMatches){
        errZone.innerHTML = '<div class="availability-note bad">Nama atau kata laluan salah.</div>';
        return;
      }
      var id = slugify(state.adminAuth.name);
      state.roles[id] = { role:'admin' };
      me = { id:id, name: state.adminAuth.name };
      currentUserId = id;
      saveCurrentUser(me);
      registerPerson(id, me.name);
      setAdminSessionActive(true);
      closeModal();
      renderAll();
      showToast('Logged in as admin.');

      fsSet('roles', id, { role:'admin' }).catch(function(err){
        reportError('Could not confirm admin role in Firebase', err);
      });
    });
  }

  // ================= admin modal =================
  function renderAdminModal(){
    var body = '<div class="fieldset-title">Pasukan</div>';
    body += '<div id="teamCard"></div>';
    body += '<p class="helper-text">Admin boleh memadam peranan staff. Admin hanya boleh dilog masuk dengan nama + kata laluan yang betul.</p>';

    body += '<div class="fieldset-title">Tukar kata laluan admin</div>';
    body += '<form id="changePwForm">';
    body += textField('curPw','Kata laluan semasa', null, true, '', 'password');
    body += '<div class="grid-2">';
    body += textField('newName','Nama admin (boleh kekal sama)', null, true, state.adminAuth?state.adminAuth.name:'');
    body += textField('newPw','Kata laluan baru', null, true, '', 'password');
    body += '</div>';
    body += '<button type="submit" class="btn btn-sm" style="margin-top:8px;">Kemaskini</button>';
    body += '</form>';

    body += '<div class="fieldset-title">Selia slot (maintenance)</div>';
    body += '<div class="grid-2">';
    body += selectFieldPlain('maintHall','Hall', hallList().map(function(h){return {v:h.id,l:h.name};}), '', false, 'Pilih hall');
    body += textField('maintDate','Tarikh', null, false, todayKey(), 'date');
    body += '</div>';
    body += selectFieldPlain('maintSession','Masa', SESSIONS.map(function(s){return {v:s.id,l:s.label};}), '', false, 'Pilih masa');
    body += '<div id="maintStatusZone"></div>';
    body += '<div class="drawer-actions"><button class="btn btn-sm" id="checkSlotBtn">Semak status</button></div>';

    modalFrame('🛠', 'Manage team', null, body, null);
    renderTeamList();

    document.getElementById('changePwForm').addEventListener('submit', async function(e){
      e.preventDefault();
      var form = e.target;
      var curPw = form.curPw.value;
      var newName = form.newName.value.trim();
      var newPw = form.newPw.value;
      if(!newName || !newPw){ showToast('Sila isi semua ruangan.', 'error'); return; }
      if(newPw.length < 4){ showToast('Kata laluan sekurang-kurangnya 4 aksara.', 'error'); return; }
      var curHash = await hashText(curPw);
      if(curHash !== state.adminAuth.passwordHash){ showToast('Kata laluan semasa salah.', 'error'); return; }
      var oldId = slugify(state.adminAuth.name);
      var newHash = await hashText(newPw);
      var newId = slugify(newName);

      var prevAuth = state.adminAuth, prevOldRole = state.roles[oldId], prevOldPerson = state.people[oldId];
      state.adminAuth = { name:newName, passwordHash:newHash };
      if(newId !== oldId){ delete state.roles[oldId]; delete state.people[oldId]; }
      state.roles[newId] = { role:'admin' };
      state.people[newId] = { id:newId, name:newName };
      if(currentUserId === oldId){ me = { id:newId, name:newName }; currentUserId = newId; saveCurrentUser(me); }
      showToast('Kata laluan admin dikemaskini.');
      renderAll();
      openModal('admin', {});

      var writes = [ fsSet('settings','adminAuth',{ name:newName, passwordHash:newHash }) ];
      if(newId !== oldId){ writes.push(fsDelete('roles', oldId)); writes.push(fsDelete('people', oldId)); }
      writes.push(fsSet('roles', newId, { role:'admin' }));
      writes.push(fsSet('people', newId, { id:newId, name:newName }));
      Promise.all(writes).catch(function(err){
        state.adminAuth = prevAuth;
        if(prevOldRole) state.roles[oldId] = prevOldRole;
        if(prevOldPerson) state.people[oldId] = prevOldPerson;
        reportError('Kata laluan TIDAK dapat dikemaskini di Firebase — sila cuba lagi', err);
        renderAll();
      });
    });

    document.getElementById('checkSlotBtn').addEventListener('click', function(){
      var h = document.getElementById('f_maintHall').value;
      var d = document.getElementById('f_maintDate').value;
      var s = document.getElementById('f_maintSession').value;
      var zone = document.getElementById('maintStatusZone');
      if(!h||!d||!s){ zone.innerHTML = '<p class="helper-text">Pilih hall, tarikh dan masa dahulu.</p>'; return; }
      var info = slotStatus(h,d,s);
      var label = info.status==='booked' ? 'Ditempah oleh '+(info.booking.clientName||'seseorang') : (info.status==='maintenance' ? 'Dalam penyelenggaraan' : 'Tersedia');
      var canToggle = info.status !== 'booked';
      zone.innerHTML = '<div class="availability-note '+(info.status==='available'?'ok':'bad')+'">'+esc(label)+'</div>'+
        (canToggle ? '<button class="btn btn-sm" id="toggleMaintBtn" style="margin-top:8px;">'+(info.status==='maintenance'?'Tandakan tersedia':'Tandakan penyelenggaraan')+'</button>' : '');
      var toggleBtn = document.getElementById('toggleMaintBtn');
      if(toggleBtn) toggleBtn.addEventListener('click', function(){
        var sid = slotDocId(h,d,s);
        var nextStatus = info.status==='maintenance' ? 'available' : 'maintenance';
        var previous = state.slots[sid];
        state.slots[sid] = { hallId:h, date:d, session:s, status: nextStatus };
        showToast('Status slot dikemaskini.');
        document.getElementById('checkSlotBtn').click();
        fsSet('slots', sid, state.slots[sid]).catch(function(err){
          state.slots[sid] = previous;
          reportError('Slot tidak dapat dikemaskini di Firebase', err);
        });
      });
    });
  }

  function renderTeamList(){
    var card = document.getElementById('teamCard');
    if(!card) return;
    var ids = Object.keys(state.people);
    if(ids.length===0){ card.innerHTML = '<div class="empty-note">No one has signed in yet.</div>'; return; }
    var html = '';
    ids.forEach(function(id){
      var p = state.people[id];
      var role = getRole(id);
      var isSelf = (id === currentUserId);
      html += '<div class="team-row" style="display:flex; justify-content:space-between; align-items:center;">'+
        '<div style="display:flex; align-items:center;">'+
          '<span class="avatar">'+esc(initials(p.name))+'</span>'+
          '<div class="team-info">'+
            '<div class="team-name">'+esc(p.name||'Someone')+'</div>'+
            '<div class="helper-text">'+(isSelf ? 'You · ' : '')+role+'</div>'+
          '</div>'+
        '</div>';
      if(!isSelf && role === 'staff'){
        html += '<button class="btn btn-sm btn-danger" data-remove-user="'+id+'">Remove</button>';
      }
      html += '</div>';
    });
    card.innerHTML = html;
    Array.prototype.forEach.call(card.querySelectorAll('[data-remove-user]'), function(btn){
      btn.addEventListener('click', function(){
        var userId = btn.getAttribute('data-remove-user');
        var prevPerson = state.people[userId], prevRole = state.roles[userId];
        delete state.people[userId];
        delete state.roles[userId];
        renderTeamList();
        showToast('Staff member removed.');
        Promise.all([ fsDelete('people', userId), fsDelete('roles', userId) ]).catch(function(err){
          if(prevPerson) state.people[userId] = prevPerson;
          if(prevRole) state.roles[userId] = prevRole;
          renderTeamList();
          reportError('Could not remove that person from Firebase', err);
        });
      });
    });
  }

  init();
})();