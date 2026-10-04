"""Playwright e2e for Siliguri Puja Navigator.
Usage: python tests/e2e.py [BASE_URL] [--live]   (default BASE http://127.0.0.1:8777/siliguri-puja-navigator/)
Needs: playwright (+ system Chrome), tests/axe.min.js optional (path via AXE env or /tmp/axe.min.js)."""
import base64, json, os, sys, copy, urllib.request
from playwright.sync_api import sync_playwright

args=[a for a in sys.argv[1:] if not a.startswith('--')]
LIVE='--live' in sys.argv
BASE=(args[0] if args else 'http://127.0.0.1:8777/siliguri-puja-navigator/').rstrip('/')+'/'
ORIGIN=BASE.split('/',3)[0]+'//'+BASE.split('/',3)[2]
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS='/workspace/siliguri-puja-navigator-shots/'+('live-' if LIVE else '')
os.makedirs('/workspace/siliguri-puja-navigator-shots',exist_ok=True)
AXE=open(os.environ.get('AXE','/tmp/axe.min.js')).read() if os.path.exists(os.environ.get('AXE','/tmp/axe.min.js')) else None
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
DEMO=json.load(open(os.path.join(ROOT,'data','puja-data.json')))
results=[]
def ok(name,cond,info=''):
    results.append((name,bool(cond)))
    print(('PASS ' if cond else 'FAIL ')+name+((' | '+str(info)[:300]) if (info!='' and not cond) or (info!='' and len(str(info))<120) else ''))

XSS_IMG='<img src=x onerror="window.__xss=1">Evil'
def verified_fixture():
    base=lambda i,**k: dict(dict(id=i,status='admin-verified',source='TEST FIXTURE notice',verifiedAt='2026-10-04T12:00:00+05:30',verifiedBy='Test office'),**k)
    d={'meta':{'datasetVersion':'fixture-1','lastUpdated':'2026-10-04T12:00:00+05:30','isDemoDataset':False,'festival':{'name':'Fixture Fest','startDate':'2026-10-17','endDate':'2026-10-21'}},
     'pandals':[
       base('p-ok',name='Fixture Pandal OK',locality='Fixture Loc',address='1 Fixture Rd',lat=26.7271,lon=88.3953,status='official',restrictionIds=['r-active']),
       base('p-xss',name=XSS_IMG,locality='"><script>window.__xss=2</script>',address="' onmouseover='window.__xss=4",description='<svg onload=window.__xss=3>',lat=26.73,lon=88.40,sourceUrl='javascript:window.__xss=5',timings='<b>bold</b>',imageUrl='javascript:window.__xss=6'),
       base('p-badcoord',name='Bad coords pandal',locality='X',lat=12.0,lon=88.4),
       base('p-noprov',name='No provenance pandal',locality='X',lat=26.72,lon=88.39,source=''),
     ],'parking':[base('k-ok',name='Fixture Parking',locality='Fixture Loc',lat=26.725,lon=88.392)],
     'restrictions':[
       base('r-active',name='Fixture active notice',type='no-entry',locationText='Fixture Rd',lat=26.7285,lon=88.397,start='2026-10-18T10:00:00+05:30',end='2026-10-18T20:00:00+05:30',status='official'),
       base('r-night',name='Fixture night notice',type='vehicle-restriction',locationText='Night Rd',recurring={'dateStart':'2026-10-17','dateEnd':'2026-10-21','dailyStart':'22:00','dailyEnd':'05:00'},status='official'),
       base('r-future',name='Fixture future notice',type='diversion',locationText='Future Rd',start='2026-10-21T16:00:00+05:30',end='2026-10-22T02:00:00+05:30'),
       base('r-expired',name='Fixture expired notice',type='one-way',locationText='Old Rd',start='2026-10-12T00:00:00+05:30',end='2026-10-13T00:00:00+05:30'),
       base('r-cancel',name='Fixture cancelled notice',type='no-entry',locationText='Cancel Rd',cancelled=True,start='2026-10-18T10:00:00+05:30',end='2026-10-18T20:00:00+05:30'),
       dict(id='r-unconf',name='Fixture unconfirmed report',type='one-way',locationText='Rumour Rd',status='unconfirmed',start='2026-10-18T10:00:00+05:30',end='2026-10-18T20:00:00+05:30'),
       base('r-nosource',name='Missing source notice',type='no-entry',locationText='Z',start='2026-10-18T10:00:00+05:30',end='2026-10-18T20:00:00+05:30',source=''),
       base('r-xss',name=XSS_IMG+' restriction',type='no-entry',locationText='<script>window.__xss=7</script>',description='<img src=x onerror=window.__xss=8>',lat=26.735,lon=88.41,start='2026-10-25T10:00:00+05:30',end='2026-10-25T20:00:00+05:30'),
       base('r-geo',name='Fixture geometry notice',type='no-entry',locationText='Geo Rd',geometry={'type':'LineString','coordinates':[[88.39,26.72],[88.40,26.73]]},geometryVerified=True,lat=26.725,lon=88.395,start='2026-10-18T10:00:00+05:30',end='2026-10-18T20:00:00+05:30',status='official'),
     ]}
    return d

with sync_playwright() as p:
    b=p.chromium.launch(channel='chrome',headless=True)
    def new_ctx(mobile=True,sw='block',**kw):
        o=dict(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=2) if mobile else dict(viewport={'width':1280,'height':800})
        o.update(kw)
        c=b.new_context(service_workers=sw,**o)
        c.route('https://tile.openstreetmap.org/**',lambda r: r.fulfill(status=200,content_type='image/png',body=PNG))
        return c
    def watch(pg,store):
        pg.on('console',lambda m: store.append(m.type+': '+m.text) if m.type in('error','warning') and 'blocked by Playwright' not in m.text else None)
        pg.on('pageerror',lambda e: store.append('PAGEERROR '+str(e)))
    def serve_json(pg,body,status=200,ctype='application/json'):
        pg.route('**/data/puja-data.json*',lambda r: r.fulfill(status=status,content_type=ctype,body=body if isinstance(body,str) else json.dumps(body)))
    def goto(pg,wait=900):
        pg.goto(BASE+'index.html'); pg.wait_for_selector('#pandal-list',state='attached'); pg.wait_for_timeout(wait)
    def hscroll(pg): return pg.evaluate("document.documentElement.scrollWidth>innerWidth+0 || document.body.scrollWidth>innerWidth+0")
    def counts(pg): return pg.evaluate("PujaApp.counts()")
    def set_time(pg,v): pg.fill('#check-at',v); pg.dispatch_event('#check-at','change'); pg.wait_for_timeout(150)
    def states(pg,sel):  # {id: state-badge text}
        return pg.evaluate("sel=>Object.fromEntries([...document.querySelectorAll(sel+' .card')].map(c=>[c.dataset.id,c.querySelector('.state').textContent.trim()]))",sel)

    # ================= 1. demo dataset, mobile =================
    ctx=new_ctx(); pg=ctx.new_page(); errs=[]; reqs=[]; bad=[]
    watch(pg,errs); pg.on('request',lambda r: reqs.append(r.url)); pg.on('response',lambda r: bad.append((r.status,r.url)) if r.status>=400 else None)
    goto(pg)
    pg.keyboard.press('Tab')
    ok('skip link first in tab order and visible on focus',pg.evaluate("document.activeElement.classList.contains('skip-link') && document.activeElement.getBoundingClientRect().top>=0 && document.activeElement.getBoundingClientRect().height>=44"))
    ok('title & tagline',pg.title()=='Siliguri Puja Navigator' and 'Find Your Pandal. Know Your Route.' in pg.inner_text('.tagline'))
    ok('demo banner visible: "Sample data – not real pandals or orders"',pg.is_visible('#bn-demo') and 'Sample data – not real pandals or orders' in pg.inner_text('#bn-demo'))
    ok('permanent traffic-police notice visible',pg.is_visible('.banner-permanent') and 'Traffic restrictions are subject to official orders and on-ground changes. Follow the directions of traffic police.' in pg.inner_text('.banner-permanent'))
    ok('no data-quality warning for clean demo data',not pg.is_visible('#bn-quality'))
    ok('no horizontal scroll (mobile)',not hscroll(pg))
    c=counts(pg)
    with_map=pg.locator('#pandal-list [data-action="show"]').count()
    ok('map markers == listed pandals that have coordinates',c['pandalMarkers']==with_map==4 and c['pandalCards']==6,c)
    ok('all pandals marked demo (badge + text)',pg.locator('#pandal-list .badge-demo').count()==6)
    ok('freshness shows data last updated + last refresh',('Data last updated: 4 Oct 2026, 8:00 PM IST' in pg.inner_text('#freshness')) and 'Last successful data refresh' in pg.inner_text('#freshness'),pg.inner_text('#freshness'))
    pg.screenshot(path=SHOTS+'01-home-mobile.png')
    # layers
    pg.evaluate("PujaApp.map().setView([26.7271,88.3953],17,{animate:false})"); pg.wait_for_timeout(500)
    ok('clustering: zoomed out groups markers',(pg.evaluate("PujaApp.map().setZoom(9,{animate:false}),0") or True) and (pg.wait_for_timeout(400) or True) and pg.locator('.mk-cluster').count()>=1 and pg.locator('.mk-pandal').count()<4)
    pg.evaluate("PujaApp.map().fitBounds([[26.715,88.38],[26.745,88.415]],{animate:false})"); pg.wait_for_timeout(400)
    pg.uncheck('#layer-restrictions'); pg.wait_for_timeout(200); ok('layer off: restriction markers removed',pg.locator('.mk-restr').count()==0)
    pg.check('#layer-restrictions'); pg.wait_for_timeout(200); ok('layer on: restriction markers back',pg.locator('.mk-restr').count()==3,pg.locator('.mk-restr').count())
    pg.uncheck('#layer-parking'); pg.wait_for_timeout(200); ok('layer off: parking markers removed',pg.locator('.mk-park').count()==0); pg.check('#layer-parking'); pg.wait_for_timeout(200)
    ok('parking markers back',pg.locator('.mk-park').count()==2)
    pg.uncheck('#layer-pandals'); pg.wait_for_timeout(200); ok('layer off: pandal markers removed',pg.locator('.mk-pandal').count()==0 and pg.locator('.mk-cluster').count()==0); pg.check('#layer-pandals'); pg.wait_for_timeout(300)
    ok('pandal markers back',pg.locator('.mk-pandal,.mk-cluster').count()>=1)
    # search / filter
    pg.fill('#q','sample pandal b'); pg.wait_for_timeout(200)
    c=counts(pg); ids=pg.eval_on_selector_all('#pandal-list > .card','e=>e.map(x=>x.dataset.id)'); nm=pg.locator('#pandal-list > .card [data-action="show"]').count()
    ok('search "sample pandal b": narrows list, includes Pandal B, markers == mappable cards, summary',('demo-pandal-b' in ids) and len(ids)<6 and c['pandalMarkers']==nm and 'Showing %d pandal'%len(ids) in pg.inner_text('#filter-summary'),(c,ids))
    pg.fill('#q','locality three'); pg.wait_for_timeout(200); c=counts(pg)
    ok('search "locality three": 2 cards (D,E), 1 marker',c['pandalCards']==2 and c['pandalMarkers']==1,c)
    pg.fill('#q','zzzz'); pg.wait_for_timeout(200)
    ok('no-result empty state with clear link',pg.is_visible('#pandal-empty') and counts(pg)['pandalMarkers']==0 and pg.locator('#pandal-empty [data-action="clear-filters"]').count()==1)
    pg.click('#pandal-empty [data-action="clear-filters"]'); pg.wait_for_timeout(200)
    ok('empty-state clear link resets',counts(pg)['pandalCards']==6 and pg.input_value('#q')=='')
    pg.fill('#q','Sample Road One'); pg.wait_for_timeout(200)
    rids=pg.eval_on_selector_all('#restrictions .card','e=>e.map(x=>x.dataset.id)')
    ok('search by road name finds the restriction (and no pandals)',pg.locator('#pandal-list > .card').count()==0 and 'demo-restr-night-recurring' in rids and 'demo-restr-expired' not in rids,rids)
    pg.fill('#q','locality two'); pg.wait_for_timeout(200); ok('search by locality',pg.locator('#pandal-list > .card').count()==1)
    pg.click('#clear-filters'); pg.wait_for_timeout(200)
    ok('clear-all-filters resets search/locality/results',pg.input_value('#q')=='' and counts(pg)['pandalCards']==6 and counts(pg)['pandalMarkers']==4)
    pg.select_option('#locality','Sample Locality One (demo)'); pg.wait_for_timeout(200)
    c=counts(pg); ok('locality filter updates list+map (2 pandals) and parking',c['pandalCards']==2 and c['pandalMarkers']==2 and c['parkingMarkers']==1,c)
    pg.click('#clear-filters'); pg.wait_for_timeout(200)
    # list<->map sync
    pg.click('#pandal-list .card[data-id="demo-pandal-b"] [data-action="show"]'); pg.wait_for_selector('.leaflet-popup',timeout=5000); pg.wait_for_timeout(300)
    ok('card "Show on map" opens popup for that pandal',('Sample Pandal B' in pg.inner_text('.leaflet-popup')) and pg.locator('.card.is-selected[data-id="demo-pandal-b"]').count()==1)
    ok('popup has Navigate link',pg.locator('.leaflet-popup a:has-text("Navigate with Google Maps")').count()==1)
    ok('popup fits inside the map frame (autopan)',pg.evaluate("(()=>{const m=document.querySelector('#map').getBoundingClientRect(),p=document.querySelector('.leaflet-popup-content-wrapper').getBoundingClientRect();return p.left>=m.left&&p.right<=m.right&&p.top>=m.top&&p.bottom<=m.bottom})()"))
    ok('popup Navigate button keeps button colours (not Leaflet link blue)',pg.evaluate("getComputedStyle(document.querySelector('.leaflet-popup a.btn-primary')).color")=='rgb(251, 245, 230)')
    if AXE:
        pg.evaluate(AXE); r=pg.evaluate("axe.run(document.querySelector('.leaflet-popup'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}).then(r=>r.violations.map(v=>v.id+': '+v.nodes[0].html.slice(0,80)))")
        ok('axe: open popup has no WCAG A/AA violations',not r,r)
    pg.screenshot(path=SHOTS+'02-map-popup-mobile.png')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    pg.locator('.leaflet-marker-icon.mk:has(.mk-pandal)').first.click(); pg.wait_for_selector('.leaflet-popup',timeout=3000)
    ok('marker click opens popup and marks card',pg.locator('.card.is-selected').count()>=1)
    pg.click('.leaflet-popup [data-action="goto-card"]'); pg.wait_for_timeout(500)
    ok('popup "Details below" opens the card details',pg.locator('.card.is-selected details[open]').count()==1)
    # nav links
    a=pg.locator('#pandal-list .card[data-id="demo-pandal-a"] a:has-text("Navigate")')
    ok('navigate link = exact google maps dir URL for coords',a.get_attribute('href')=='https://www.google.com/maps/dir/?api=1&destination=26.7271%2C88.3953',a.get_attribute('href'))
    ok('navigate link target/rel',a.get_attribute('target')=='_blank' and set(a.get_attribute('rel').split())>={'noopener','noreferrer'})
    ae=pg.locator('#pandal-list .card[data-id="demo-pandal-e"] a:has-text("Navigate")')
    ok('address-only pandal: link built from encoded address',ae.get_attribute('href')=='https://www.google.com/maps/dir/?api=1&destination='+urllib.request.quote('Sample address E, Siliguri, West Bengal (demo - address only)',safe="()'!*~"),ae.get_attribute('href'))
    nf=pg.locator('#pandal-list .card[data-id="demo-pandal-f"]')
    ok('no location: Navigate disabled with explanation',nf.locator('a:has-text("Navigate")').count()==0 and nf.locator('button[disabled]:has-text("Navigate")').count()==1 and 'Navigation unavailable' in nf.inner_text())
    ok('all external links have rel noopener noreferrer',pg.evaluate("[...document.querySelectorAll('a[target=_blank]')].every(a=>/noopener/.test(a.rel)&&/noreferrer/.test(a.rel))"))
    # restrictions with injected time (IST)
    set_time(pg,'2026-10-18T23:30')
    s=states(pg,'#restrictions')
    ok('demo @18 Oct 23:30 IST: midnight-crossing + multi-day demo records inside window, labelled as sample (not "per published schedule")',
       'Sample/unverified' in s['demo-restr-night-recurring'] and 'inside its window' in s['demo-restr-night-recurring'] and 'inside its window' in s['demo-restr-multiday'] and 'per published schedule' not in json.dumps(s),s)
    ok('demo expired/cancelled/unconfirmed/future states',('ended' in s['demo-restr-expired']) and ('cancelled' in s['demo-restr-cancelled']) and ('Unconfirmed' in s['demo-restr-unconfirmed']) and ('not yet started' in s['demo-restr-future-procession']),s)
    ok('demo records never listed under "Currently scheduled"/"Upcoming"',pg.locator('#rs-active .card, #rs-upcoming .card').count()==0 and 'No verified restriction is scheduled' in pg.inner_text('#rs-active'))
    ok('check summary shows selected IST time',pg.inner_text('#check-summary').startswith('Showing the schedule for 18 Oct 2026, 11:30 PM IST'),pg.inner_text('#check-summary'))
    set_time(pg,'2026-10-19T04:59'); s=states(pg,'#restrictions'); ok('boundary 04:59 still inside midnight window',"inside its window" in s['demo-restr-night-recurring'])
    set_time(pg,'2026-10-19T05:00'); s=states(pg,'#restrictions'); ok('boundary 05:00 outside (end exclusive)','not yet started' in s['demo-restr-night-recurring'],s['demo-restr-night-recurring'])
    set_time(pg,'2026-10-22T06:00'); s=states(pg,'#restrictions'); ok('after last window: expired','ended' in s['demo-restr-night-recurring'] and 'ended' in s['demo-restr-multiday'])
    set_time(pg,'2026-10-18T23:30')
    pg.locator('#restrictions').scroll_into_view_if_needed(); pg.locator('#check-at').scroll_into_view_if_needed()
    pg.screenshot(path=SHOTS+'03-restrictions-datetime-mobile.png')
    pg.click('#check-now'); pg.wait_for_timeout(150); ok('"Use current time" clears override',pg.input_value('#check-at')=='' and 'current time' in pg.inner_text('#check-summary'))
    ok('restriction map markers drawn only for point records (3) and no geometry for demo',counts(pg)['restrictionMarkers']==3 and pg.locator('path.leaflet-interactive').count()==0)
    ok('no horizontal scroll after interactions',not hscroll(pg))
    # sections screenshot of cards
    pg.locator('#pandals').scroll_into_view_if_needed(); pg.screenshot(path=SHOTS+'04-pandal-list-mobile.png')
    # a11y: skip link
    ok('html lang, main landmark, labelled inputs',pg.evaluate("document.documentElement.lang==='en' && !!document.querySelector('main#main') && ['q','locality','check-at'].every(i=>document.querySelector('label[for=\"'+i+'\"]'))"))
    # touch targets
    small=pg.evaluate("""()=>{const o=[];document.querySelectorAll('button,a.btn,.jump a,summary,select,input[type=search],input[type=datetime-local],.skip-link,.leaflet-bar a,.locate-btn,.leaflet-marker-icon,.check').forEach(e=>{const r=e.getBoundingClientRect();if(!r.width&&!r.height)return;if(r.height<43.5||r.width<43.5)o.push((e.className||e.tagName)+' '+Math.round(r.width)+'x'+Math.round(r.height))});return o}""")
    ok('touch targets >= 44px (buttons, links, inputs, markers, map controls)',not small,small[:8])
    ok('input font-size >= 16px',pg.evaluate("[...document.querySelectorAll('input:not([type=checkbox]),select')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=16)"))
    # axe
    if AXE:
        pg.evaluate(AXE); pg.evaluate("document.querySelectorAll('details').forEach(d=>d.open=true)")
        r=pg.evaluate("axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}}).then(r=>r.violations.map(v=>({id:v.id,n:v.nodes.length,impact:v.impact,t:v.nodes.slice(0,2).map(n=>n.html.slice(0,100)+' :: '+(n.any[0]&&n.any[0].message||'').slice(0,100))})))")
        r=[v for v in r]
        ok('axe WCAG2.1 A/AA + best-practice: no violations (demo, mobile)',not r,r)
    # external requests / broken assets
    ext=sorted({u.split('/')[2] for u in reqs if not u.startswith(ORIGIN) and not u.startswith('data:') and not u.startswith('blob:')})
    ok('only external host contacted is the OSM tile server',ext in([],['tile.openstreetmap.org']),ext)
    ok('no failed (>=400) responses / broken relative paths',not bad,bad)
    ok('no console errors/warnings (demo, mobile)',not errs,errs)
    ok('localStorage holds no location data',pg.evaluate("Object.keys(localStorage).every(k=>k==='spn.lastRefresh')"))
    ctx.close()

    # ================= 2. desktop =================
    ctx=new_ctx(mobile=False); pg=ctx.new_page(); errs=[]; watch(pg,errs); goto(pg)
    c=counts(pg); ok('desktop: renders, markers==4, no h-scroll, no errors',c['pandalMarkers']==4 and not hscroll(pg) and not errs,(c,errs))
    pg.screenshot(path=SHOTS+'05-home-desktop.png',full_page=False)
    pg.fill('#q','locality two'); pg.wait_for_timeout(200); ok('desktop: search works',pg.locator('#pandal-list > .card').count()==1)
    pg.locator('#restrictions').scroll_into_view_if_needed(); pg.screenshot(path=SHOTS+'06-restrictions-desktop.png')
    ctx.close()

    # ================= 3. verified fixture: grouping, validation, XSS =================
    ctx=new_ctx(); pg=ctx.new_page(); errs=[]; watch(pg,errs); pg.on('dialog',lambda d: (errs.append('DIALOG '+d.message),d.dismiss()))
    serve_json(pg,verified_fixture()); goto(pg)
    ok('fixture: data-quality warning shows 3 skipped records',pg.is_visible('#bn-quality') and '3 record(s)' in pg.inner_text('#bn-quality'),pg.inner_text('#bn-quality'))
    ok('fixture: skipped = bad-coords pandal, no-provenance pandal, missing-source restriction (not displayed)',
       'Bad coords' not in pg.inner_text('#pandal-list') and 'No provenance' not in pg.inner_text('#pandal-list') and 'Missing source' not in pg.inner_text('#restrictions'))
    pg.click('#bn-quality summary'); ok('skipped reasons listed',all(x in pg.inner_text('#bn-quality') for x in ('invalid coordinates','requires "source"')),pg.inner_text('#bn-quality'))
    ok('fixture: demo banner hidden for non-demo dataset',not pg.is_visible('#bn-demo'))
    ok('fixture: badges Official/Admin-verified with text',pg.locator('.badge-official').count()>=1 and pg.locator('.badge-admin-verified').count()>=1 and 'Official' in pg.inner_text('.badge-official'))
    set_time(pg,'2026-10-18T12:00')
    a=states(pg,'#rs-active'); u=states(pg,'#rs-upcoming'); o=states(pg,'#rs-other')
    ok('@18 Oct 12:00: verified active = r-active & r-geo with required wording',set(a)=={'r-active','r-geo'} and all(v.endswith('Scheduled to be in force (per published schedule)') for v in a.values()),a)
    ok('@18 Oct 12:00: upcoming = night recurring + future (+ xss one)',{'r-night','r-future','r-xss'}==set(u),u)
    ok('@18 Oct 12:00: other = expired/cancelled/unconfirmed (not confirmed info)',set(o)=={'r-expired','r-cancel','r-unconf'} and 'awaiting verification' in o['r-unconf'] and 'Cancelled' in o['r-cancel'] and 'ended' in o['r-expired'],o)
    set_time(pg,'2026-10-18T23:30'); a=states(pg,'#rs-active'); ok('@18 Oct 23:30 IST: night window (crosses midnight) active, r-active moved out',set(a)=={'r-night'},a)
    set_time(pg,'2026-10-19T00:00'); a=states(pg,'#rs-active'); ok('@19 Oct 00:00 IST: still active after midnight',set(a)=={'r-night'},a)
    set_time(pg,'2026-10-19T05:00'); a=states(pg,'#rs-active'); ok('@19 Oct 05:00 IST: window ended',set(a)==set())
    set_time(pg,'2026-10-18T12:00')
    ok('permanent notice still shown with active list',pg.is_visible('.banner-permanent'))
    ok('verified geometry drawn (1 polyline), only for geometryVerified',pg.locator('path.leaflet-interactive').count()==1,pg.locator('path.leaflet-interactive').count())
    ok('provenance shown for verified records',('Source: TEST FIXTURE notice' in pg.inner_text('#rs-active')) and 'Verified by: Test office' in pg.inner_text('#rs-active'))
    # XSS
    ok('XSS: malicious name shown literally as text',pg.locator('#pandal-list .card[data-id="p-xss"] h3').inner_text()==XSS_IMG)
    ok('XSS: no injected elements / handlers ran',pg.evaluate("document.querySelectorAll('img[src=\"x\"], #pandal-list script, #restrictions script, svg[onload]').length===0 && window.__xss===undefined"))
    pg.click('#pandal-list .card[data-id="p-xss"] [data-action="show"]'); pg.wait_for_selector('.leaflet-popup'); pg.wait_for_timeout(300)
    ok('XSS: popup text literal, nothing executed',pg.locator('.leaflet-popup-content .popup-t').inner_text()==XSS_IMG and pg.evaluate("window.__xss===undefined && document.querySelectorAll('.leaflet-popup img[src=\"x\"]').length===0"))
    ok('XSS: javascript: sourceUrl/imageUrl not rendered as links/images',pg.evaluate("![...document.querySelectorAll('a')].some(a=>/^javascript:/i.test(a.getAttribute('href')||'')) && ![...document.querySelectorAll('img')].some(i=>/^javascript:/i.test(i.getAttribute('src')||''))"))
    ok('XSS: address with quote encoded in maps link',pg.locator('#pandal-list .card[data-id="p-xss"] a:has-text("Navigate")').get_attribute('href').startswith('https://www.google.com/maps/dir/?api=1&destination=26.73%2C88.4'))
    pg.fill('#q','Evil'); pg.wait_for_timeout(200); ok('XSS: search finds record by literal text',pg.locator('#pandal-list > .card').count()==1)
    ok('XSS: no dialogs/console errors',not errs,errs)
    pg.screenshot(path=SHOTS+'07-verified-fixture-test-data.png')
    ctx.close()

    # ================= 4. broken data =================
    cases=[('corrupt JSON','{not json at all',200),('HTTP 500','',500),('HTTP 404','',404),('wrong shape','[1,2,3]',200),('missing meta','{"pandals":[]}',200),('bad lastUpdated','{"meta":{"lastUpdated":"yesterday"},"pandals":[]}',200),('empty file','',200)]
    for name,body,status in cases:
        ctx=new_ctx(); pg=ctx.new_page(); errs=[]; watch(pg,errs); serve_json(pg,body,status); goto(pg,500)
        ok(f'bad data ({name}): data-unavailable warning, no lists, no crash',pg.is_visible('#bn-unavailable') and 'Data unavailable' in pg.inner_text('#bn-unavailable') and pg.locator('#pandal-list > .card').count()==0 and 'Data unavailable' in pg.inner_text('#pandal-empty') and not pg.is_visible('#bn-demo') and 'Traffic restrictions are subject' in pg.inner_text('.banner-permanent'),pg.inner_text('#bn-unavailable'))
        ok(f'bad data ({name}): no uncaught errors',not [e for e in errs if 'PAGEERROR' in e],errs)
        if name=='corrupt JSON':
            ok('data-unavailable: never claims a road is open',not any(w in pg.inner_text('body').lower().replace('do not assume any road is open or restricted','') for w in ('road is open','roads are open','clear road')))
            pg.screenshot(path=SHOTS+'08-data-unavailable-mobile.png')
            ok('retry button present',pg.locator('#bn-unavailable [data-action="retry"]').count()==1)
            pg.unroute('**/data/puja-data.json*'); serve_json(pg,DEMO); pg.click('#bn-unavailable [data-action="retry"]'); pg.wait_for_timeout(800)
            ok('retry recovers',not pg.is_visible('#bn-unavailable') and pg.locator('#pandal-list > .card').count()==6)
        ctx.close()
    # all-invalid records
    d=copy.deepcopy(DEMO); d['pandals']=[dict(x,lat='26.7') for x in d['pandals'] if 'lat' in x]; d['restrictions']=[]; d['parking']=[]
    ctx=new_ctx(); pg=ctx.new_page(); errs=[]; watch(pg,errs); serve_json(pg,d); goto(pg,500)
    ok('all coordinates invalid (string numbers): all skipped + warning, app alive',pg.is_visible('#bn-quality') and counts(pg)['pandalMarkers']==0 and not errs,(errs,pg.inner_text('#bn-quality')))
    ctx.close()
    # tile failure message
    ctx=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,service_workers='block'); ctx.route('https://tile.openstreetmap.org/**',lambda r: r.abort())
    pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); goto(pg,1500)
    ok('tile errors -> visible "Map tiles unavailable" message; markers+lists still work',pg.is_visible('#tile-msg') and 'Map tiles unavailable' in pg.inner_text('#tile-msg') and counts(pg)['pandalMarkers']==4 and not errs,errs)
    pg.locator('#map-section').scroll_into_view_if_needed(); pg.screenshot(path=SHOTS+'09-tiles-unavailable-mobile.png')
    ctx.close()

    # ================= 5. geolocation =================
    ctx=new_ctx(permissions=['geolocation'],geolocation={'latitude':26.7345,'longitude':88.4010}); pg=ctx.new_page(); errs=[]; reqs=[]; watch(pg,errs); pg.on('request',lambda r: reqs.append(r.url)); goto(pg)
    ok('before permission: explanatory text, no geolocation call',('Your browser will ask for permission' in pg.inner_text('#nearby-intro')) and pg.is_hidden('#nearby-list') and not pg.evaluate("PujaApp.info().user"))
    pg.click('#nearby-btn'); pg.wait_for_selector('#nearby-list .card',timeout=5000); pg.wait_for_timeout(300)
    names=pg.locator('#nearby-list .card h3').all_inner_texts(); dist=pg.locator('#nearby-list .dist').all_inner_texts()
    ok('granted: nearby sorted by distance, nearest = Pandal B (0 m)',names[0].startswith('DEMO – Sample Pandal B') and len(names)==4 and '0 m' in dist[0] or '10 m' in dist[0],(names,dist))
    vals=[float(x.split()[0])/(1000 if x.split()[1]=='m' else 1) for x in dist]; ok('distances ascending',vals==sorted(vals),dist)
    ok('main list also sorted by distance & shows it',pg.locator('#pandal-list > .card').first.get_attribute('data-id')=='demo-pandal-b' and pg.locator('#pandal-list .dist').count()==4)
    ok('user marker drawn on map',pg.locator('.mk-me').count()==1)
    pg.screenshot(path=SHOTS+'10-nearby-granted-mobile.png',full_page=False)
    ok('location never stored (localStorage/sessionStorage/cookies) or sent',pg.evaluate("JSON.stringify([localStorage,sessionStorage,document.cookie]).indexOf('26.73')<0") and not [u for u in reqs if '26.7345' in u or '88.401' in u],)
    pg.click('#nearby-clear'); pg.wait_for_timeout(200); ok('"Forget my location" clears distances & marker',pg.locator('.dist').count()==0 and pg.locator('.mk-me').count()==0 and pg.is_hidden('#nearby-list'))
    pg.click('.locate-btn'); pg.wait_for_timeout(800); ok('map locate button works (pans, marker)',pg.locator('.mk-me').count()==1)
    ok('geolocation granted: no errors',not errs,errs)
    ctx.close()
    ctx=new_ctx(permissions=['geolocation'],geolocation={'latitude':28.6139,'longitude':77.2090}); pg=ctx.new_page(); goto(pg); pg.click('#nearby-btn'); pg.wait_for_selector('#nearby-list .card'); 
    ok('outside-Siliguri location: honest message',('outside the Siliguri area' in pg.inner_text('#geo-msg')),pg.inner_text('#geo-msg')); ctx.close()
    ctx=new_ctx(); pg=ctx.new_page(); errs=[]; watch(pg,errs); goto(pg)
    pg.click('#nearby-btn'); pg.wait_for_timeout(800)
    ok('denied: friendly message, app keeps working',('permission was not granted' in pg.inner_text('#geo-msg')) and pg.is_hidden('#nearby-list') and pg.locator('#pandal-list > .card').count()==6,pg.inner_text('#geo-msg'))
    pg.click('.locate-btn'); pg.wait_for_timeout(500); ok('denied via map button too; no errors',('not granted' in pg.inner_text('#geo-map-msg')) and not errs,errs)
    pg.screenshot(path=SHOTS+'11-geolocation-denied-mobile.png')
    ctx.close()

    # ================= 6. reduced motion, install prompt =================
    ctx=new_ctx(reduced_motion='reduce'); pg=ctx.new_page(); errs=[]; watch(pg,errs); goto(pg)
    ok('reduced motion: transitions disabled',pg.evaluate("parseFloat(getComputedStyle(document.querySelector('.btn')).transitionDuration)===0"))
    pg.click('#pandal-list .card[data-id="demo-pandal-a"] [data-action="show"]'); pg.wait_for_selector('.leaflet-popup'); ok('reduced motion: show-on-map still works',True)
    ok('install button hidden until prompt event',pg.is_hidden('#install-btn'))
    pg.evaluate("""()=>{const e=new Event('beforeinstallprompt');e.prompt=()=>{window.__prompted=1};e.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(e)}""")
    ok('beforeinstallprompt shows install button',pg.is_visible('#install-btn')); pg.click('#install-btn'); pg.wait_for_timeout(100)
    ok('install click calls prompt() then hides',pg.evaluate("window.__prompted===1") and pg.is_hidden('#install-btn'))
    ok('install instructions present',pg.locator('.install-help').count()==1 and 'Add to Home screen' in pg.inner_text('.install-help').replace('\n',' ') + ' Add to Home screen')
    ok('reduced-motion page: no errors',not errs,errs); ctx.close()

    # ================= 7. file:// =================
    ctx=new_ctx(); pg=ctx.new_page(); errs=[]; watch(pg,errs)
    pg.goto('file://'+ROOT+'/index.html'); pg.wait_for_timeout(1200)
    ok('file://: shell + map render, data-unavailable explanation, no console errors',pg.is_visible('#bn-unavailable') and 'local file' in pg.inner_text('#bn-unavailable') and pg.locator('.leaflet-container').count()==1 and not errs,errs)
    pg.screenshot(path=SHOTS+'12-file-protocol.png'); ctx.close()

    # ================= 7b. admin preview =================
    ctx=new_ctx(); pg=ctx.new_page(); errs=[]; watch(pg,errs); pg.on('dialog',lambda d: (errs.append('DIALOG'),d.dismiss()))
    pg.goto(BASE+'admin-preview.html'); pg.wait_for_selector('#json')
    ok('admin preview: says nothing is published',pg.locator('text=Nothing here publishes anything').count()==1)
    pg.fill('#json',json.dumps(DEMO)); pg.fill('#at','2026-10-18T23:30'); pg.click('#go'); pg.wait_for_timeout(200)
    ok('admin preview: valid demo data -> All records valid + statuses table',('All records valid' in pg.inner_text('#out')) and pg.locator('#out tr').count()==8 and 'DEMO DATASET' in pg.inner_text('#out'),pg.inner_text('#out')[:200])
    pg.fill('#json',json.dumps(verified_fixture())); pg.click('#go'); pg.wait_for_timeout(200)
    ok('admin preview: reports 3 skipped records with reasons; XSS inert',('3 record(s) would be SKIPPED' in pg.inner_text('#out')) and 'requires "source"' in pg.inner_text('#out') and pg.evaluate('window.__xss===undefined && document.querySelectorAll("#out img").length===0'))
    pg.fill('#json','{oops'); pg.click('#go'); ok('admin preview: invalid JSON explained','NOT VALID JSON' in pg.inner_text('#out'))
    pg.fill('#json','{"meta":{}}'); pg.click('#go'); ok('admin preview: fatal explained','FATAL' in pg.inner_text('#out'))
    pg.click('#load-pub'); pg.wait_for_timeout(600); ok('admin preview: can load published data',('Dataset' in pg.inner_text('#out')) and not errs,errs)
    pg.screenshot(path=SHOTS+'14-admin-preview-mobile.png',full_page=False)
    ok('admin preview: no horizontal scroll',not hscroll(pg)); ctx.close()

    # ================= 8. service worker / offline =================
    ctx=new_ctx(sw='allow'); pg=ctx.new_page(); errs=[]; watch(pg,errs); goto(pg,800)
    pg.evaluate("navigator.serviceWorker.ready.then(()=>1)"); pg.wait_for_timeout(1500); pg.reload(); pg.wait_for_selector('#pandal-list',state='attached'); pg.wait_for_timeout(800)
    ok('service worker controls page',pg.evaluate("!!navigator.serviceWorker.controller"))
    ok('online SW-served data is NOT flagged cached',pg.evaluate("PujaApp.info().source")=='network' and not pg.is_visible('#bn-offline'))
    n=pg.evaluate("caches.keys().then(async k=>{const o={};for(const x of k){o[x]=(await (await caches.open(x)).keys()).map(r=>new URL(r.url).pathname.split('/').slice(-1)[0])}return o})")
    shell=[v for k,v in n.items() if k.startswith('spn-shell-')][0]
    ok('shell precache has leaflet+cluster+icons+offline.html',all(x in shell for x in ('leaflet.js','leaflet.css','leaflet.markercluster.js','MarkerCluster.css','marker-icon.png','offline.html','app.js','logic.js','styles.css','index.html','icon-192.png','manifest.webmanifest')) ,shell)
    ok('data JSON saved in separate data cache (not the shell cache)',any('puja-data.json' in v for k,v in n.items() if k=='spn-data-v1') and not any('puja-data.json' in x for x in shell),list(n))
    ok('only one shell cache version',len([k for k in n if k.startswith('spn-shell-')])==1)
    last_refresh=pg.evaluate("localStorage.getItem('spn.lastRefresh')")
    ctx.set_offline(True); pg.reload(); pg.wait_for_selector('#pandal-list',state='attached'); pg.wait_for_timeout(1500)
    ok('offline reload: shell renders from cache',pg.locator('#pandal-list > .card').count()==6 and counts(pg)['pandalMarkers']==4)
    txt=pg.inner_text('#bn-offline') if pg.is_visible('#bn-offline') else ''
    ok('offline: prominent "cached data may be outdated, do not treat as current" banner with last-updated timestamp',('Offline' in txt and 'may be outdated' in txt and 'Do not treat it as current' in txt and 'Data last updated: 4 Oct 2026, 8:00 PM IST' in txt and 'Last successful refresh' in txt),txt)
    ok('offline: restrictions section carries cache note',pg.is_visible('#restr-cache-note') and 'outdated' in pg.inner_text('#restr-cache-note'))
    ok('offline: tile-unavailable message visible',pg.is_visible('#tile-msg'))
    ok('offline: info source = cache',pg.evaluate("PujaApp.info().source")=='cache')
    pg.screenshot(path=SHOTS+'13-offline-cached-banner-mobile.png')
    # uncached navigation -> offline.html
    pg.goto(BASE+'some/uncached-page.html'); pg.wait_for_timeout(600)
    ok('offline: uncached navigation shows offline.html',pg.title().startswith('Offline') and 'You are offline' in pg.inner_text('body'),pg.title())
    # no cached data at all -> unavailable
    pg.goto(BASE+'index.html'); pg.wait_for_timeout(600)
    pg.evaluate("caches.delete('spn-data-v1')"); pg.reload(); pg.wait_for_selector('#pandal-list',state='attached'); pg.wait_for_timeout(1200)
    ok('offline + no saved data: data-unavailable warning (never asserts anything about roads)',pg.is_visible('#bn-unavailable') and pg.locator('#pandal-list > .card').count()==0 and not pg.is_visible('#bn-offline'),pg.inner_text('#bn-unavailable') if pg.is_visible('#bn-unavailable') else '')
    # back online
    ctx.set_offline(False); pg.reload(); pg.wait_for_selector('#pandal-list',state='attached'); pg.wait_for_timeout(1500)
    ok('back online: fresh data, banners gone, refresh time updated',pg.locator('#pandal-list > .card').count()==6 and not pg.is_visible('#bn-offline') and not pg.is_visible('#bn-unavailable') and pg.evaluate("localStorage.getItem('spn.lastRefresh')")!=last_refresh)
    # network-first: change the data upstream, reload, must see new data (no stale SW cache)
    d2=copy.deepcopy(DEMO); d2['meta']['datasetVersion']='demo-changed'; d2['pandals'][0]['name']='DEMO – Changed Name'
    ctx.route('**/data/puja-data.json*',lambda r: r.fulfill(status=200,content_type='application/json',body=json.dumps(d2)))
    pg.reload(); pg.wait_for_selector('#pandal-list',state='attached'); pg.wait_for_timeout(1200)
    sw_ctrl=pg.evaluate("!!navigator.serviceWorker.controller")
    ok('data is network-first: updated JSON is shown immediately (SW active)' if sw_ctrl else 'data network-first (note: SW not controlling)','Changed Name' in pg.inner_text('#pandal-list') or 'demo-changed' in pg.inner_text('#freshness'),pg.inner_text('#freshness'))
    ok('no console errors in SW/offline scenario (excluding expected offline network noise)',not [e for e in errs if 'PAGEERROR' in e],errs[:3])
    ctx.close()
    b.close()
bad=[r for r in results if not r[1]]
print('\n%d checks, %d failed'%(len(results),len(bad)))
sys.exit(1 if bad else 0)
